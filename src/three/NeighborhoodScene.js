import * as THREE from 'three'
import gsap from 'gsap'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { WORLD, sharedMaterial } from './materials.js'
import { canopyGeometry, trunkGeometry, bushGeometry, palmGeometry } from './procedural/nature.js'
import { canvasTexture, ringTexture, radialTexture } from './procedural/textures.js'
import { stylize, stylizeWater } from './stylize.js'
import { buildBarrioCues } from './ThemeCues.js'

/**
 * Neighborhoods. Each barrio is built from a layout (data/layouts.js) into its own
 * place: street graph, painted ground, houses (provided GLBs), landmark, plants,
 * street furniture and the session's emergency cues. Built barrios are cached,
 * so going back to one is instant.
 *
 * World units ≈ meters; houses ~6 wide; the guide ~1.75 tall; the street runs
 * north (−Z) away from the camera.
 */

const GROUND = { minX: -50, maxX: 50, minZ: -62, maxZ: 38, px: 2048 }
const v3 = (x, z, y = 0) => new THREE.Vector3(x, y, z)
const MAX_CACHED = 2

/** Ground surface styles (painted into the ground texture) */
const STYLES = {
    cobble: { kind: 'grid', base: '#BFB09A', tone: [220, 207, 188], size: 0.62, round: 0.28 },
    stone: { kind: 'irregular', base: '#B5A389', tone: [214, 197, 172], size: 0.95, round: 0.34 },
    pavers: { kind: 'rect', base: '#BDB7AC', tone: [222, 217, 208], size: 0.95, round: 0.06 },
    gravel: { kind: 'gravel', base: '#D8C8A6' },
    road: { kind: 'road', base: '#A9A49A' },
}

function seeded(n) {
    let s = n
    return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

function segDist(x, z, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1]
    const l2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2))
    return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
}

/* ================================================================= */

export class NeighborhoodScene {
    constructor(loader, theme) {
        this.loader = loader
        this.theme = theme
        this.group = new THREE.Group()
        this.group.name = 'neighborhood'
        this.cache = new Map() // barrio id → built content
        this.content = null
        this.selected = null
        this.hovered = null
        this.focusMode = false

        this.#outer()
        this.#distance()
        this.#cueAssets()
    }

    /** Preload what every barrio needs (lamp model). */
    async build() {
        this.lampTemplate = await this.loader.load('lamp-post')
    }

    /* ---------------- public API (used by App) ---------------- */

    get start() {
        return v3(...this.content.layout.start)
    }
    get startNode() {
        const [sx, sz] = this.content.layout.start
        return Object.entries(this.content.layout.nodes).find(([, p]) => p[0] === sx && p[1] === sz)?.[0] ?? Object.keys(this.content.layout.nodes)[0]
    }
    get cameraOffset() {
        return this.content.layout.camera?.offset
    }
    get cameraLook() {
        return this.content.layout.camera?.look
    }
    get houses() {
        return this.content?.houses ?? new Map()
    }

    /** Build (or reuse) a barrio without showing it — call ahead of time to hide loading. */
    async prepare(barrio) {
        if (this.cache.has(barrio.id)) return this.cache.get(barrio.id)
        const content = await this.#buildContent(barrio)
        this.cache.set(barrio.id, content)
        // keep memory bounded: drop the oldest cached barrio that is not active
        while (this.cache.size > MAX_CACHED) {
            const oldest = [...this.cache.keys()].find((k) => this.content?.id !== k && k !== barrio.id)
            if (!oldest) break
            this.#dispose(this.cache.get(oldest))
            this.cache.delete(oldest)
        }
        return content
    }

    async setBarrio(barrio) {
        const content = await this.prepare(barrio)
        if (this.content) this.group.remove(this.content.group)
        this.content = content
        this.group.add(content.group)
        this.selected = this.hovered = null
        this.focusMode = false
        this.#refreshCues()
        this.halo.material.opacity = 0
    }

    house(id) {
        return this.content.houses.get(id)
    }

    labelAnchor(id, out = new THREE.Vector3()) {
        const h = this.content.houses.get(id)
        return out.copy(h.center).setY(h.size.y + 1.0)
    }

    pick(raycaster) {
        const hit = raycaster.intersectObjects(this.content.proxies, false)[0]
        return hit ? hit.object.userData.houseId : null
    }

    /** Ground height for walkers (bridges); 0 elsewhere. */
    heightAt(x, z) {
        return this.content?.heightAt?.(x, z) ?? 0
    }

    /**
     * Camera framing for a house: behind the guide (at the door), looking at the
     * façade from the street side. Candidates blocked by another house are skipped.
     */
    viewpointFor(id, { distance = 14.5, height = 8.6 } = {}) {
        const h = this.content.houses.get(id)
        const door = h.door
        const look = door.clone().lerp(h.center, 0.6).setY(2.1)
        const link = this.content.layout.nodes[this.content.layout.slots[h.data.slot].link]
        const toStreet = v3(link[0] - door.x, link[1] - door.z)
        if (toStreet.length() < 2) toStreet.copy(h.front)
        toStreet.normalize()
        const back = new THREE.Vector3(0, 0, 1)
        const others = [...this.content.proxies.filter((p) => p.userData.houseId !== id), ...this.content.occluders]
        const ray = new THREE.Raycaster()
        const eye = door.clone().setY(1.4)
        let best = null
        // try a few blends between "from the street" and "from behind", then a higher angle
        for (const h of [height, height * 1.3, height * 1.6]) {
            for (const w of [0.4, 0.55, 0.7, 0.85, 1]) {
                const dir = toStreet.clone().multiplyScalar(w).addScaledVector(back, 1 - w).normalize()
                const pos = door.clone().addScaledVector(dir, distance * (h === height ? 1 : 0.85)).setY(h)
                const to = pos.clone().sub(eye)
                const len = to.length()
                ray.set(eye, to.normalize())
                ray.far = len
                if (!ray.intersectObjects(others, false).length) return { pos, look }
                best ??= { pos, look }
            }
        }
        return best
    }

    /** Shortest route along the street graph from a node to a house door. */
    route(fromNode, houseId) {
        const { layout, houses } = this.content
        const graph = new Map(Object.keys(layout.nodes).map((k) => [k, []]))
        const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
        for (const [a, b] of layout.edges) {
            const d = d2(layout.nodes[a], layout.nodes[b])
            graph.get(a).push([b, d])
            graph.get(b).push([a, d])
        }
        for (const [id, e] of houses) {
            if (!e.labelled) continue
            const key = `door:${id}`
            const link = layout.slots[e.data.slot].link
            const d = d2([e.door.x, e.door.z], layout.nodes[link])
            graph.set(key, [[link, d]])
            graph.get(link).push([key, d])
        }
        const pos = (k) => (k.startsWith('door:') ? houses.get(k.slice(5)).door.clone() : v3(...layout.nodes[k]))
        const target = `door:${houseId}`
        const dist = new Map([[fromNode, 0]])
        const prev = new Map()
        const open = new Set([fromNode])
        while (open.size) {
            let u = null
            for (const n of open) if (u === null || dist.get(n) < dist.get(u)) u = n
            open.delete(u)
            if (u === target) break
            for (const [v, w] of graph.get(u) ?? []) {
                const nd = dist.get(u) + w
                if (nd < (dist.get(v) ?? Infinity)) {
                    dist.set(v, nd)
                    prev.set(v, u)
                    open.add(v)
                }
            }
        }
        const keys = [target]
        while (prev.has(keys[0])) keys.unshift(prev.get(keys[0]))
        return { nodes: keys, points: keys.map(pos) }
    }

    /* ---------------- selection visuals ---------------- */

    setHover(id) {
        if (this.hovered === id) return
        this.hovered = id
        this.#refreshCues()
    }

    setSelected(id) {
        this.selected = id
        this.#refreshCues()
        const h = id && this.content.houses.get(id)
        if (h) {
            this.halo.position.copy(h.center).setY(0.06)
            const r = Math.max(h.size.x, h.size.z) * 1.45
            this.halo.scale.set(r, r, r)
            gsap.to(this.halo.material, { opacity: 0.85, duration: 0.9, ease: 'sine.out' })
        } else {
            gsap.to(this.halo.material, { opacity: 0, duration: 0.6, ease: 'sine.inOut' })
        }
    }

    setFocusMode(on) {
        this.focusMode = on
        this.#refreshCues()
    }

    #refreshCues() {
        if (!this.content) return
        for (const [id, h] of this.content.houses) {
            if (!h.ring) continue
            const sel = id === this.selected
            const hov = id === this.hovered
            const hidden = this.focusMode && !sel
            const arrived = this.focusMode && sel
            gsap.to(h.ring.material, { opacity: hidden || arrived ? 0 : sel ? 0.7 : hov ? 1 : 0.72, duration: 0.5, ease: 'sine.out' })
            h.ring.material.color.set(sel || hov ? '#F5333F' : '#FFFFFF')
            const s = hov && !sel ? 1.12 : 1
            gsap.to(h.ring.scale, { x: s, y: s, z: s, duration: 0.5, ease: 'sine.out' })
        }
    }

    update(dt, t) {
        this.content?.update?.(dt, t)
    }

    /* ================================================================
       Static, shared parts
       ================================================================ */

    #outer() {
        this.outerMat = stylize(new THREE.MeshStandardMaterial({ color: WORLD.grass, roughness: 1 }), { ao: 0, rim: 0 })
        const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), this.outerMat)
        outer.position.y = -0.03
        outer.receiveShadow = true
        this.group.add(outer)
    }

    #distance() {
        const hillMat = stylize(sharedMaterial('nb:hill', { color: '#86A37A', roughness: 1 }), { ao: 0, rim: 0.08 })
        const hills = [
            [-150, -210, 110, 46], [-40, -260, 130, 40], [80, -240, 120, 36], [190, -190, 110, 40], [-230, -80, 100, 44], [230, -60, 90, 30],
        ]
        for (const [x, z, rad, h] of hills) {
            const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), hillMat)
            hill.scale.set(rad, h, rad * 0.7)
            hill.position.set(x, -2, z)
            this.group.add(hill)
        }
        const r = seeded(5)
        const n = 150
        const blocks = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
            stylize(sharedMaterial('nb:far', { color: '#FFFFFF', roughness: 1 }), { ao: 0.2, aoHeight: 6, rim: 0 }),
            n
        )
        const cols = ['#EFE6D8', '#E8E0D3', '#F3F0EA', '#E5D3BD', '#DCE2E5'].map((c) => new THREE.Color(c))
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
        let i = 0
        while (i < n) {
            const x = (r() - 0.5) * 300
            const z = -78 - r() * 90
            const tall = r() < 0.16
            m.compose(p.set(x, 0, z), q.setFromAxisAngle(up, (r() - 0.5) * 0.4), sc.set(4 + r() * 4, tall ? 10 + r() * 16 : 3 + r() * 3, 4 + r() * 4))
            blocks.setMatrixAt(i, m)
            blocks.setColorAt(i, cols[Math.floor(r() * cols.length)])
            i++
        }
        this.group.add(blocks)
    }

    #cueAssets() {
        this.ringTex = ringTexture({ width: 0.1 })
        this.halo = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({
                map: canvasTexture(256, 256, (ctx, w) => {
                    const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.28, w / 2, w / 2, w / 2)
                    g.addColorStop(0, 'rgba(245,51,63,0)')
                    g.addColorStop(0.55, 'rgba(245,51,63,0.3)')
                    g.addColorStop(0.75, 'rgba(245,51,63,0.14)')
                    g.addColorStop(1, 'rgba(245,51,63,0)')
                    ctx.fillStyle = g
                    ctx.fillRect(0, 0, w, w)
                }),
                transparent: true,
                opacity: 0,
                depthWrite: false,
            })
        )
        this.halo.renderOrder = 1
        this.group.add(this.halo)
        this.blobTex = radialTexture({ inner: 'rgba(30,40,30,0.5)', outer: 'rgba(30,40,30,0)' })
    }

    #dispose(content) {
        for (const d of content.disposables) d.dispose?.()
    }

    /* ================================================================
       Building one barrio
       ================================================================ */

    async #buildContent(barrio) {
        const L = barrio.layout
        const yieldFrame = () => new Promise((r) => setTimeout(r, 0))
        const rand = seeded(barrio.id.length * 7919 + barrio.id.charCodeAt(0))
        const group = new THREE.Group()
        group.name = `barrio-${barrio.id}`
        const disposables = []
        const houses = new Map()
        const proxies = []
        const blocked = [] // {x,z,r} areas plants must avoid
        const updaters = []

        // Paths: layout paths + ring (as segments) + garden paths to each labelled door
        const doors = {}
        for (const [k, s] of Object.entries(L.slots)) {
            if (!s.link) continue
            const f = v3(Math.sin(s.yaw), Math.cos(s.yaw))
            doors[k] = v3(s.x, s.z).addScaledVector(f, s.door ?? 4.1)
        }
        const mainStyle = L.paths[0]?.[3] ?? 'cobble'
        const paths = L.paths.map(([a, b, w, style]) => ({ a, b, w, style }))
        if (L.ring) {
            const { x, z, r, w, style } = L.ring
            const N = 28
            for (let i = 0; i < N; i++) {
                const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2
                paths.push({ a: [x + Math.sin(a0) * r, z + Math.cos(a0) * r], b: [x + Math.sin(a1) * r, z + Math.cos(a1) * r], w, style })
            }
        }
        const links = []
        for (const [k, d] of Object.entries(doors)) {
            const n = L.nodes[L.slots[k].link]
            links.push({ a: n, b: [d.x, d.z], w: 2.2, style: mainStyle === 'road' ? 'pavers' : mainStyle, link: true })
        }
        const circles = L.circles.map(([x, z, r, style]) => ({ x, z, r, style }))
        const allPaths = [...paths, ...links]
        const distToPaths = (x, z) => {
            let best = Infinity
            for (const p of allPaths) best = Math.min(best, segDist(x, z, p.a, p.b) - p.w / 2)
            for (const c of circles) best = Math.min(best, Math.hypot(x - c.x, z - c.z) - c.r)
            return best
        }

        /* ---- ground ---- */
        const groundTex = this.#paintGround(L, paths, links, circles, rand)
        disposables.push(groundTex)
        const { minX, maxX, minZ, maxZ } = GROUND
        const groundGeo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).rotateX(-Math.PI / 2).translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
        disposables.push(groundGeo)
        const wet = this.theme.mood.wet
        const groundMat = stylize(new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 - wet * 0.45, envMapIntensity: 0.6 + wet }), { ao: 0, rim: 0 })
        disposables.push(groundMat)
        const ground = new THREE.Mesh(groundGeo, groundMat)
        ground.receiveShadow = true
        group.add(ground)
        await yieldFrame()

        /* ---- houses ---- */
        const all = [...barrio.houses, ...barrio.fillers]
        await Promise.all(all.map((h) => this.loader.load(h.model)))
        for (const h of all) {
            const slot = L.slots[h.slot]
            if (!slot) continue
            const template = await this.loader.load(h.model)
            const obj = this.loader.instanceSync(template, { scheme: h.scheme })
            obj.position.set(slot.x, 0, slot.z)
            obj.rotation.y = slot.yaw
            obj.userData.houseId = h.id
            group.add(obj)
            const size = template.size
            const front = v3(Math.sin(slot.yaw), Math.cos(slot.yaw))
            const entry = { data: h, object: obj, center: v3(slot.x, slot.z), front, size, labelled: !!h.category }
            blocked.push({ x: slot.x, z: slot.z, r: Math.max(size.x, size.z) * 0.62 })
            if (entry.labelled) {
                entry.door = doors[h.slot].clone()
                const proxy = new THREE.Mesh(
                    new THREE.BoxGeometry(size.x + 1.2, size.y + 1, size.z + 1.2).translate(0, (size.y + 1) / 2, 0),
                    new THREE.MeshBasicMaterial({ visible: false })
                )
                proxy.position.copy(obj.position)
                proxy.rotation.y = slot.yaw
                proxy.userData.houseId = h.id
                group.add(proxy)
                proxies.push(proxy)
                disposables.push(proxy.geometry)
                const ring = new THREE.Mesh(
                    new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2),
                    new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, opacity: 0.72, depthWrite: false, color: '#FFFFFF' })
                )
                ring.position.copy(entry.door).setY(0.05)
                ring.renderOrder = 1
                entry.ring = ring
                group.add(ring)
                blocked.push({ x: entry.door.x, z: entry.door.z, r: 1.8 })
            }
            houses.set(h.id, entry)
        }
        await yieldFrame()

        /* ---- landmark feature ---- */
        let heightAt = null
        const feat = this.#feature(L, group, blocked, updaters, disposables, rand)
        if (feat?.heightAt) heightAt = feat.heightAt

        /* ---- lamps ---- */
        for (const [x, z, side] of L.lamps) {
            const l = this.loader.instanceSync(this.lampTemplate)
            l.position.set(x, 0, z)
            l.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2
            group.add(l)
            blocked.push({ x, z, r: 0.9 })
        }

        /* ---- vegetation ---- */
        const [ox, oz] = L.open
        blocked.push({ x: ox, z: oz, r: 3.4 })
        blocked.push({ x: L.start[0], z: L.start[1] + 2, r: 3.5 })
        const occluders = this.#vegetation(L, group, blocked, distToPaths, rand, disposables)
        if (L.look.walls) this.#walls(L, paths, links, group)
        await yieldFrame()

        /* ---- emergency context cues ---- */
        const pathPoints = []
        for (const p of paths) {
            if (p.style === 'road') continue
            const n = Math.ceil(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) / 3)
            for (let i = 0; i <= n; i++) {
                const x = p.a[0] + ((p.b[0] - p.a[0]) * i) / n
                const z = p.a[1] + ((p.b[1] - p.a[1]) * i) / n
                if (z < 14 && z > -30 && Math.abs(x) < 28) pathPoints.push(v3(x, z))
            }
        }
        const fillers = Object.entries(L.slots).filter(([k]) => k.startsWith('F')).map(([, s]) => s)
        const doorList = Object.entries(doors).map(([k, d]) => Object.assign(d.clone(), { yaw: L.slots[k].yaw }))
        const cues = buildBarrioCues(this.theme, { layout: L, doors: doorList, fillers, open: L.open, pathPoints, rand })
        group.add(cues.group)
        updaters.push(cues.update)

        return {
            id: barrio.id,
            layout: L,
            group,
            houses,
            proxies,
            occluders,
            disposables,
            heightAt,
            update: (dt, t) => updaters.forEach((u) => u(dt, t)),
        }
    }

    /* ---------------- ground painting ---------------- */

    #paintGround(L, paths, links, circles, rand) {
        const { minX, maxX, minZ, maxZ, px } = GROUND
        const W = maxX - minX
        const H = maxZ - minZ
        const s = px / W
        const toC = (x, z) => [(x - minX) * s, (z - minZ) * s]
        const ch = Math.round(H * s)

        const tex = canvasTexture(px, ch, (ctx, cw) => {
            /* grass */
            ctx.fillStyle = L.look.grass
            ctx.fillRect(0, 0, cw, ch)
            for (let i = 0; i < 26000; i++) {
                ctx.fillStyle = rand() < 0.5 ? `rgba(110,140,85,${0.05 + rand() * 0.08})` : `rgba(214,220,170,${0.05 + rand() * 0.07})`
                ctx.fillRect(rand() * cw, rand() * ch, 2 + rand() * 5, 2 + rand() * 5)
            }
            for (let i = 0; i < 46; i++) {
                const x = rand() * cw, y = rand() * ch, rad = 80 + rand() * 220
                const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
                g.addColorStop(0, rand() < 0.5 ? 'rgba(120,152,96,0.2)' : 'rgba(214,214,160,0.18)')
                g.addColorStop(1, 'rgba(0,0,0,0)')
                ctx.fillStyle = g
                ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
            }
            // tiny wildflowers
            for (let i = 0; i < 900; i++) {
                ctx.fillStyle = ['rgba(255,255,255,0.7)', 'rgba(242,214,120,0.7)', 'rgba(232,160,170,0.6)'][Math.floor(rand() * 3)]
                ctx.beginPath()
                ctx.arc(rand() * cw, rand() * ch, 1.6 + rand() * 1.2, 0, Math.PI * 2)
                ctx.fill()
            }

            /* features painted under 3D */
            const f = L.feature
            if (f.type === 'pond') {
                const [x, y] = toC(f.x, f.z)
                const g = ctx.createRadialGradient(x, y, 0, x, y, f.park * s)
                g.addColorStop(0, 'rgba(120,160,95,0.55)')
                g.addColorStop(0.85, 'rgba(120,160,95,0.4)')
                g.addColorStop(1, 'rgba(120,160,95,0)')
                ctx.fillStyle = g
                ctx.beginPath()
                ctx.arc(x, y, f.park * s, 0, Math.PI * 2)
                ctx.fill()
            }
            if (f.type === 'canal') {
                const [, y0] = toC(0, f.z - f.width / 2 - 0.7)
                const [, y1] = toC(0, f.z + f.width / 2 + 0.7)
                ctx.fillStyle = '#B3A88F'
                ctx.fillRect(0, y0, cw, y1 - y0)
            }
            if (f.type === 'chapel') {
                const [x, y] = toC(f.x, f.z)
                const g = ctx.createRadialGradient(x, y, 0, x, y, 10 * s)
                g.addColorStop(0, 'rgba(118,148,94,0.45)')
                g.addColorStop(1, 'rgba(118,148,94,0)')
                ctx.fillStyle = g
                ctx.fillRect(x - 10 * s, y - 10 * s, 20 * s, 20 * s)
            }

            /* surfaces, grouped by style: walkable first, then roads, then crossings */
            const shapes = [...paths, ...links].map((p) => ({ ...p, type: 'seg' })).concat(circles.map((c) => ({ ...c, type: 'circle' })))
            const styleOrder = [...new Set(shapes.map((p) => p.style))].sort((a, b) => (a === 'road') - (b === 'road'))
            const drawShape = (c2, sh, extra = 0, cap = 'round') => {
                if (sh.type === 'circle') {
                    c2.beginPath()
                    c2.arc(...toC(sh.x, sh.z), (sh.r + extra) * s, 0, Math.PI * 2)
                    c2.fill()
                    return
                }
                c2.lineCap = cap
                c2.lineWidth = (sh.w + extra) * s
                c2.beginPath()
                c2.moveTo(...toC(...sh.a))
                c2.lineTo(...toC(...sh.b))
                c2.stroke()
            }

            for (const style of styleOrder) {
                const st = STYLES[style] ?? STYLES.cobble
                const list = shapes.filter((p) => p.style === style)
                const cap = st.kind === 'road' ? 'butt' : 'round'
                // curb / soft edge
                if (st.kind !== 'road') {
                    ctx.save()
                    ctx.strokeStyle = ctx.fillStyle = 'rgba(140,128,108,0.5)'
                    list.forEach((sh) => drawShape(ctx, sh, 0.5, cap))
                    ctx.restore()
                }
                const mask = document.createElement('canvas')
                mask.width = cw
                mask.height = ch
                const mc = mask.getContext('2d')
                mc.strokeStyle = mc.fillStyle = '#fff'
                list.forEach((sh) => drawShape(mc, sh, 0, cap))

                const pat = document.createElement('canvas')
                pat.width = cw
                pat.height = ch
                const pc = pat.getContext('2d')
                this.#fillStyle(pc, st, cw, ch, s, rand)
                pc.globalCompositeOperation = 'destination-in'
                pc.drawImage(mask, 0, 0)
                ctx.drawImage(pat, 0, 0)

                if (st.kind === 'road') {
                    // dashed centre line
                    ctx.save()
                    ctx.strokeStyle = 'rgba(245,242,232,0.85)'
                    ctx.lineWidth = 0.13 * s
                    ctx.setLineDash([1.4 * s, 1.6 * s])
                    list.forEach((sh) => {
                        if (sh.type !== 'seg') return
                        ctx.beginPath()
                        ctx.moveTo(...toC(...sh.a))
                        ctx.lineTo(...toC(...sh.b))
                        ctx.stroke()
                    })
                    ctx.restore()
                }
            }

            // Zebra crossings where garden paths cross a road
            const roads = paths.filter((p) => p.style === 'road')
            if (roads.length) {
                ctx.save()
                ctx.fillStyle = 'rgba(248,246,240,0.92)'
                for (const l of links) {
                    const dx = l.b[0] - l.a[0], dz = l.b[1] - l.a[1]
                    const len = Math.hypot(dx, dz)
                    const ux = dx / len, uz = dz / len
                    for (let t = 0; t < len; t += 0.62) {
                        const x = l.a[0] + ux * t, z = l.a[1] + uz * t
                        if (!roads.some((r) => segDist(x, z, r.a, r.b) < r.w / 2 - 0.1)) continue
                        const [cx, cy] = toC(x, z)
                        ctx.save()
                        ctx.translate(cx, cy)
                        ctx.rotate(Math.atan2(uz, ux))
                        ctx.fillRect(-0.16 * s, -1.1 * s, 0.32 * s, 2.2 * s)
                        ctx.restore()
                    }
                }
                ctx.restore()
            }

            // Soft contact shading under every house
            for (const sl of Object.values(L.slots)) {
                const [x, y] = toC(sl.x, sl.z)
                const rad = 5.4 * s
                const g = ctx.createRadialGradient(x, y, rad * 0.4, x, y, rad)
                g.addColorStop(0, 'rgba(40,50,30,0.24)')
                g.addColorStop(1, 'rgba(40,50,30,0)')
                ctx.fillStyle = g
                ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
            }
        })
        tex.anisotropy = 8
        return tex
    }

    #fillStyle(pc, st, cw, ch, s, rand) {
        pc.fillStyle = st.base
        pc.fillRect(0, 0, cw, ch)
        if (st.kind === 'gravel') {
            for (let i = 0; i < 90000; i++) {
                const k = (rand() - 0.5) * 40
                pc.fillStyle = `rgba(${200 + k},${186 + k},${152 + k},0.7)`
                pc.fillRect(rand() * cw, rand() * ch, 2, 2)
            }
            return
        }
        if (st.kind === 'road') {
            for (let i = 0; i < 30000; i++) {
                pc.fillStyle = `rgba(${rand() < 0.5 ? 255 : 60},${rand() < 0.5 ? 255 : 60},${rand() < 0.5 ? 255 : 60},0.05)`
                pc.fillRect(rand() * cw, rand() * ch, 2, 2)
            }
            return
        }
        const [r0, g0, b0] = st.tone
        const gap = 2.2
        if (st.kind === 'rect') {
            const w = st.size * s, h = st.size * 0.5 * s
            for (let y = 0, row = 0; y < ch; y += h, row++) {
                for (let x = -w + (row % 2) * w * 0.5; x < cw; x += w) {
                    const k = (rand() - 0.5) * 16
                    pc.fillStyle = `rgb(${r0 + k},${g0 + k},${b0 + k})`
                    pc.beginPath()
                    pc.roundRect(x + gap / 2, y + gap / 2, w - gap, h - gap, st.round * s)
                    pc.fill()
                }
            }
            return
        }
        if (st.kind === 'irregular') {
            for (let y = 0; y < ch; y += st.size * s * 0.8) {
                let x = -rand() * st.size * s
                while (x < cw) {
                    const w = st.size * s * (0.6 + rand() * 0.8)
                    const h = st.size * s * (0.55 + rand() * 0.35)
                    const k = (rand() - 0.5) * 26
                    pc.fillStyle = `rgb(${r0 + k},${g0 + k * 0.9},${b0 + k * 0.8})`
                    pc.beginPath()
                    pc.roundRect(x + gap, y + gap + (rand() - 0.5) * 3, w - gap * 2, h - gap * 2, st.round * s)
                    pc.fill()
                    x += w
                }
            }
            return
        }
        // grid cobbles
        const stone = st.size * s
        for (let y = 0; y < ch; y += stone) {
            const off = (Math.round(y / stone) % 2) * stone * 0.5
            for (let x = -stone; x < cw; x += stone) {
                const k = (rand() - 0.5) * 22
                pc.fillStyle = `rgb(${r0 + k},${g0 + k},${b0 + k * 0.8})`
                pc.beginPath()
                pc.roundRect(x + off + gap / 2, y + gap / 2, stone - gap + (rand() - 0.5) * 2, stone - gap + (rand() - 0.5) * 2, stone * st.round)
                pc.fill()
            }
        }
    }

    /* ---------------- landmarks ---------------- */

    #feature(L, group, blocked, updaters, disposables, rand) {
        const f = L.feature
        const stone = stylize(sharedMaterial('nb:stone', { color: '#D9CFBF', roughness: 0.95 }))
        const wood = stylize(sharedMaterial('nb:wood', { color: '#A27A55', roughness: 0.85 }))
        const metal = sharedMaterial('nb:metal', { color: '#4A5560', roughness: 0.6, metalness: 0.3 })
        const white = stylize(sharedMaterial('nb:white', { color: '#F6F2EA', roughness: 0.85 }))
        const terracotta = stylize(sharedMaterial('nb:terracotta', { color: '#C27052', roughness: 0.8 }))
        const add = (m, cast = true) => {
            m.castShadow = cast
            m.receiveShadow = true
            group.add(m)
            return m
        }
        const bench = (x, z, faceX, faceZ) => {
            const b = new THREE.Group()
            const seat = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.1, 0.5, 2, 0.03), wood)
            seat.position.y = 0.48
            const back = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.42, 0.08, 2, 0.03), wood)
            back.position.set(0, 0.78, -0.24)
            back.rotation.x = -0.12
            b.add(seat, back)
            for (const lx of [-0.75, 0.75]) {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.46), metal)
                leg.position.set(lx, 0.24, 0)
                b.add(leg)
            }
            b.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true))
            b.position.set(x, 0, z)
            b.lookAt(faceX, 0, faceZ)
            group.add(b)
            blocked.push({ x, z, r: 1.2 })
        }
        const water = () => {
            const mat = stylizeWater(new THREE.MeshStandardMaterial({ color: '#7FA9BC', roughness: 0.18, metalness: 0.05, envMapIntensity: 1.3 }), { scale: 1 })
            disposables.push(mat)
            return mat
        }

        if (f.type === 'planter') {
            const planter = add(new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.0, 0.55, 32, 1, true), stone))
            planter.position.set(f.x, 0.27, f.z)
            const cap = add(new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.12, 8, 36).rotateX(Math.PI / 2), stone))
            cap.position.set(f.x, 0.55, f.z)
            const soil = add(new THREE.Mesh(new THREE.CircleGeometry(1.9, 28).rotateX(-Math.PI / 2), sharedMaterial('nb:soil', { color: '#7D6A55', roughness: 1 })), false)
            soil.position.set(f.x, 0.45, f.z)
            for (const a of [2.2, -0.95]) bench(f.x + Math.sin(a) * (f.r - 1.6), f.z + Math.cos(a) * (f.r - 1.6), f.x, f.z)
            blocked.push({ x: f.x, z: f.z, r: 2.4, planter: true })
        }

        if (f.type === 'kiosk') {
            const base = add(new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.1, 0.3, 8), stone))
            base.position.set(f.x, 0.15, f.z)
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2
                const post = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), white))
                post.position.set(f.x + Math.cos(a) * 1.7, 1.5, f.z + Math.sin(a) * 1.7)
            }
            const roof = add(new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.3, 8), terracotta))
            roof.position.set(f.x, 3.35, f.z)
            const finial = add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), white))
            finial.position.set(f.x, 4.05, f.z)
            bench(-2.4, -24.6, 0, -22)
            bench(2.6, -19.4, 0, -22)
            blocked.push({ x: f.x, z: f.z, r: 2.8 })
        }

        if (f.type === 'chapel') {
            const grass = stylize(sharedMaterial('nb:mound', { color: '#93AE7F', roughness: 1 }), { ao: 0, rim: 0.05 })
            const mound = add(new THREE.Mesh(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), grass), false)
            mound.scale.set(9.5, 2.2, 9.5)
            mound.position.set(f.x, -0.05, f.z)
            const ch = new THREE.Group()
            const plinth = new THREE.Mesh(new RoundedBoxGeometry(6.4, 0.8, 10.2, 2, 0.1), stone)
            plinth.position.y = 0.4
            const nave = new THREE.Mesh(new THREE.BoxGeometry(5.2, 4.2, 8.6), white)
            nave.position.y = 2.9
            const roofShape = new THREE.Shape()
            roofShape.moveTo(-3.0, 0)
            roofShape.lineTo(3.0, 0)
            roofShape.lineTo(0, 1.9)
            roofShape.closePath()
            const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 9.2, bevelEnabled: false }).translate(0, 0, -4.6), terracotta)
            roof.position.y = 5.0
            const tower = new THREE.Mesh(new THREE.BoxGeometry(2.3, 7.8, 2.3), white)
            tower.position.set(0, 4.7, 4.6)
            const towerTop = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.6, 4), terracotta)
            towerTop.rotation.y = Math.PI / 4
            towerTop.position.set(0, 9.4, 4.6)
            const bellOpen = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 2.4), sharedMaterial('nb:dark', { color: '#3A3530', roughness: 1 }))
            bellOpen.position.set(0, 7.3, 4.6)
            const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.1), sharedMaterial('nb:door', { color: '#6F4B33', roughness: 0.8 }))
            door.position.set(0, 1.8, 5.78)
            const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), white)
            crossV.position.set(0, 10.6, 4.6)
            const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), white)
            crossH.position.set(0, 10.75, 4.6)
            ch.add(plinth, nave, roof, tower, towerTop, bellOpen, door, crossV, crossH)
            ch.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true))
            ch.position.set(f.x, 1.55, f.z - 1)
            group.add(ch)
            // steps up the hill
            for (let i = 0; i < 7; i++) {
                const st = add(new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.3, 0.7, 2, 0.05), stone))
                st.position.set(f.x, 0.12 + i * 0.26, f.z + 9.3 - i * 0.65)
            }
            blocked.push({ x: f.x, z: f.z, r: 10 })
        }

        if (f.type === 'canal') {
            const len = 120
            const wmesh = add(new THREE.Mesh(new THREE.PlaneGeometry(len, f.width).rotateX(-Math.PI / 2), water()), false)
            wmesh.position.set(0, 0.04, f.z)
            for (const side of [-1, 1]) {
                const edge = add(new THREE.Mesh(new THREE.BoxGeometry(len, 0.34, 0.55), stone))
                edge.position.set(0, 0.17, f.z + side * (f.width / 2 + 0.27))
            }
            // footbridge: a gentle deck with ramps and white railings
            const deckH = 0.45
            const bx = f.bridgeX
            const deck = add(new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.24, f.width + 2.2, 2, 0.06), wood))
            deck.position.set(bx, deckH - 0.12, f.z)
            for (const side of [-1, 1]) {
                const ramp = add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.9), wood))
                ramp.position.set(bx, deckH / 2 - 0.06, f.z + side * (f.width / 2 + 2.0))
                ramp.rotation.x = side * 0.23
                for (const rx of [-1.55, 1.55]) {
                    const rail = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, f.width + 2.2), white))
                    rail.position.set(bx + rx, deckH + 0.9, f.z)
                    for (let k = -2; k <= 2; k++) {
                        const post = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), white))
                        post.position.set(bx + rx, deckH + 0.45, f.z + k * ((f.width + 2) / 4))
                    }
                }
            }
            // sports court on the south bank
            if (L.court) {
                const c = L.court
                const courtTex = canvasTexture(512, 300, (ctx, w, h) => {
                    ctx.fillStyle = '#B9775D'
                    ctx.fillRect(0, 0, w, h)
                    ctx.fillStyle = '#7FA174'
                    ctx.fillRect(18, 18, w - 36, h - 36)
                    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
                    ctx.lineWidth = 5
                    ctx.strokeRect(30, 30, w - 60, h - 60)
                    ctx.beginPath()
                    ctx.moveTo(w / 2, 30)
                    ctx.lineTo(w / 2, h - 30)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.arc(w / 2, h / 2, 40, 0, Math.PI * 2)
                    ctx.stroke()
                })
                disposables.push(courtTex)
                const court = add(new THREE.Mesh(new THREE.PlaneGeometry(14, 8.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: courtTex, roughness: 0.9 })), false)
                court.position.set(c.x, 0.03, c.z)
                for (const gx of [-6.6, 6.6]) {
                    const goal = new THREE.Group()
                    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), white)
                    p1.position.set(0, 0.7, -1.0)
                    const p2 = p1.clone()
                    p2.position.z = 1.0
                    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.08), white)
                    bar.position.y = 1.4
                    goal.add(p1, p2, bar)
                    goal.position.set(c.x + gx, 0, c.z)
                    goal.traverse((o) => o.isMesh && (o.castShadow = true))
                    group.add(goal)
                }
                blocked.push({ x: c.x, z: c.z, r: 8.5 })
            }
            // keep plants off the banks
            for (let x = -48; x <= 48; x += 6) blocked.push({ x, z: f.z, r: f.width / 2 + 1.4 })
            const zMin = f.z - f.width / 2 - 2.2, zMax = f.z + f.width / 2 + 2.2
            return {
                heightAt: (x, z) => {
                    if (Math.abs(x - bx) > 1.7 || z < zMin - 1.6 || z > zMax + 1.6) return 0
                    if (z >= f.z - f.width / 2 - 1.1 && z <= f.z + f.width / 2 + 1.1) return deckH
                    const d = z < f.z ? zMin - 1.6 : zMax + 1.6
                    const edge = z < f.z ? f.z - f.width / 2 - 1.1 : f.z + f.width / 2 + 1.1
                    return deckH * THREE.MathUtils.clamp((z - d) / (edge - d), 0, 1)
                },
            }
        }

        if (f.type === 'pond') {
            const pond = add(new THREE.Mesh(new THREE.CircleGeometry(f.r, 48).rotateX(-Math.PI / 2), water()), false)
            pond.position.set(f.x, 0.05, f.z)
            const rim = add(new THREE.Mesh(new THREE.TorusGeometry(f.r + 0.12, 0.22, 10, 56).rotateX(Math.PI / 2), stone))
            rim.position.set(f.x, 0.08, f.z)
            rim.scale.y = 0.6
            const lily = sharedMaterial('nb:lily', { color: '#7FA866', roughness: 0.8 })
            for (let i = 0; i < 6; i++) {
                const a = rand() * Math.PI * 2, rr = 0.8 + rand() * (f.r - 1.4)
                const pad = add(new THREE.Mesh(new THREE.CircleGeometry(0.32 + rand() * 0.18, 14, 0.4, Math.PI * 1.8).rotateX(-Math.PI / 2), lily), false)
                pad.position.set(f.x + Math.cos(a) * rr, 0.07, f.z + Math.sin(a) * rr)
            }
            for (const a of [0.5, 2.6, 4.4]) bench(f.x + Math.sin(a) * (f.r + 1.8), f.z + Math.cos(a) * (f.r + 1.8), f.x, f.z)
            blocked.push({ x: f.x, z: f.z, r: f.r + 1.2 })
        }
        return null
    }

    /* ---------------- plants ---------------- */

    #vegetation(L, group, blocked, distToPaths, rand, disposables) {
        const isBlocked = (x, z, pad = 0) => blocked.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + pad)
        const trees = []
        // framing trees around the place, then fill
        for (let i = 0; i < 1400 && trees.length < L.look.trees + 18; i++) {
            const far = trees.length >= L.look.trees
            const x = (rand() - 0.5) * (far ? 96 : 60)
            const z = far ? -60 + rand() * 30 : -40 + rand() * 58
            if (distToPaths(x, z) < 2.3 || isBlocked(x, z, 1.6)) continue
            // keep the view from the follow camera to the guide clear
            if (z > L.start[1] - 4 && Math.abs(x - L.start[0]) < 11) continue
            if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 3.6)) continue
            trees.push([x, z, 1.05 + rand() * 0.45])
        }
        if (L.look.parkTrees && L.feature.type === 'pond') {
            const f = L.feature
            for (let i = 0; i < 200 && trees.length < L.look.trees + 18 + L.look.parkTrees; i++) {
                const a = rand() * Math.PI * 2
                const r = f.r + 1.8 + rand() * (L.ring.r - f.r - 3.4)
                const x = f.x + Math.sin(a) * r, z = f.z + Math.cos(a) * r
                if (distToPaths(x, z) < 1.6 || isBlocked(x, z, 0.8)) continue
                if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 3)) continue
                trees.push([x, z, 1.0 + rand() * 0.35])
            }
        }

        const leaf = stylize(sharedMaterial('nb:leaf', { color: '#FFFFFF', roughness: 0.92 }), { ao: 0.42, aoHeight: 2.6, rim: 0.2, sway: 0.18 })
        const canopy = new THREE.InstancedMesh(canopyGeometry(2), leaf, trees.length)
        const trunk = new THREE.InstancedMesh(trunkGeometry(), stylize(sharedMaterial('nb:trunk', { color: WORLD.trunk, roughness: 1 })), trees.length)
        disposables.push(canopy, trunk)
        const leafColors = WORLD.leaf.map((c) => new THREE.Color(c))
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
        trees.forEach(([x, z, s], i) => {
            q.setFromAxisAngle(up, rand() * Math.PI * 2)
            m.compose(p.set(x, s * 1.5, z), q, sc.set(s * 1.35, s * 1.25, s * 1.35))
            canopy.setMatrixAt(i, m)
            canopy.setColorAt(i, leafColors[Math.floor(rand() * leafColors.length)])
            m.compose(p.set(x, 0, z), q, sc.set(s * 1.3, s * 1.35, s * 1.3))
            trunk.setMatrixAt(i, m)
            blocked.push({ x, z, r: 1.2 })
        })
        for (const im of [canopy, trunk]) {
            im.castShadow = true
            im.receiveShadow = true
            im.computeBoundingSphere()
            group.add(im)
        }

        // palms
        let palms = []
        if (Array.isArray(L.look.palms)) palms = L.look.palms.map(([x, z]) => [x, z, 1.0 + rand() * 0.2])
        else if (L.look.palms > 0) {
            for (let i = 0; i < 400 && palms.length < L.look.palms; i++) {
                const x = (rand() - 0.5) * 60, z = -20 + rand() * 30
                if (distToPaths(x, z) < 1.4 || isBlocked(x, z, 0.6)) continue
                palms.push([x, z, 1.0 + rand() * 0.25])
                blocked.push({ x, z, r: 1 })
            }
        }
        if (palms.length) {
            const palmMesh = new THREE.InstancedMesh(palmGeometry(), stylize(sharedMaterial('nb:palm', { vertexColors: true, roughness: 0.95 }), { sway: 0.08, rim: 0.18 }), palms.length)
            palms.forEach(([x, z, s], i) => {
                q.setFromAxisAngle(up, rand() * Math.PI * 2)
                m.compose(p.set(x, 0, z), q, sc.set(s * 1.25, s * 1.45, s * 1.25))
                palmMesh.setMatrixAt(i, m)
            })
            palmMesh.castShadow = true
            disposables.push(palmMesh)
            group.add(palmMesh)
        }

        // bushes + flowers along path edges, a few in planters
        const bushes = []
        for (let i = 0; i < 1600 && bushes.length < L.look.bushes; i++) {
            const x = (rand() - 0.5) * 70, z = -46 + rand() * 64
            const dp = distToPaths(x, z)
            if (dp < 0.8 || dp > 3.2 || isBlocked(x, z, -0.2)) continue
            bushes.push([x, z, 0.55 + rand() * 0.45, 0])
        }
        const planter = blocked.find((b) => b.planter)
        if (planter) {
            bushes.push([planter.x, planter.z, 0.95, 0.42])
            for (let k = 0; k < 6; k++) {
                const a = (k / 6) * Math.PI * 2 + 0.3
                bushes.push([planter.x + Math.cos(a) * 1.15, planter.z + Math.sin(a) * 1.15, 0.6, 0.42])
            }
        }
        const bushMesh = new THREE.InstancedMesh(
            bushGeometry(2),
            stylize(sharedMaterial('nb:bush', { color: '#FFFFFF', roughness: 0.95 }), { ao: 0.4, aoHeight: 0.9, rim: 0.2, sway: 0.06 }),
            bushes.length
        )
        disposables.push(bushMesh)
        const bushColors = ['#7C9B66', '#87A56F', '#6F8E5E', '#8FAA78'].map((c) => new THREE.Color(c))
        const flowers = []
        bushes.forEach(([x, z, s, y], i) => {
            q.setFromAxisAngle(up, rand() * Math.PI * 2)
            m.compose(p.set(x, y, z), q, sc.set(s, s * 0.9, s))
            bushMesh.setMatrixAt(i, m)
            bushMesh.setColorAt(i, bushColors[Math.floor(rand() * bushColors.length)])
            if (rand() < 0.6) {
                const n = 4 + Math.floor(rand() * 7)
                for (let k = 0; k < n; k++) {
                    const a = rand() * Math.PI * 2, rr = 0.25 + rand() * 0.35
                    flowers.push([x + Math.cos(a) * rr * s, y + 0.62 * s + rand() * 0.25 * s, z + Math.sin(a) * rr * s, i])
                }
            }
        })
        bushMesh.castShadow = true
        bushMesh.receiveShadow = true
        group.add(bushMesh)

        const flowerMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 1), sharedMaterial('nb:flower', { color: '#FFFFFF', roughness: 0.6 }), flowers.length)
        disposables.push(flowerMesh)
        const fc = L.look.flowers.map((c) => new THREE.Color(c))
        flowers.forEach(([x, y, z, b], i) => {
            m.compose(p.set(x, y, z), q.identity(), sc.set(1, 1, 1))
            flowerMesh.setMatrixAt(i, m)
            flowerMesh.setColorAt(i, fc[(b + Math.floor(rand() * 1.4)) % fc.length])
        })
        group.add(flowerMesh)
        return [canopy]
    }

    /** Low whitewashed walls with a terracotta cap along a lane (colonial barrios). */
    #walls(L, paths, links, group) {
        const wall = stylize(sharedMaterial('nb:wallLow', { color: '#F1ECE2', roughness: 0.9 }), { ao: 0.3, aoHeight: 0.8 })
        const cap = stylize(sharedMaterial('nb:wallCap', { color: '#BF6F50', roughness: 0.85 }))
        const geo = new THREE.BoxGeometry(1, 0.7, 0.32).translate(0, 0.35, 0)
        const capGeo = new THREE.BoxGeometry(1, 0.1, 0.42).translate(0, 0.75, 0)
        for (const p of paths) {
            if (p.style === 'road' || p.a[1] > 11) continue
            const dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1]
            const len = Math.hypot(dx, dz)
            const ux = dx / len, uz = dz / len
            for (const side of [-1, 1]) {
                for (let t = 0.8; t < len - 0.8; t += 2.6) {
                    const x = p.a[0] + ux * t - uz * side * (p.w / 2 + 0.55)
                    const z = p.a[1] + uz * t + ux * side * (p.w / 2 + 0.55)
                    if (links.some((l) => segDist(x, z, l.a, l.b) < 1.8)) continue
                    const seg = new THREE.Mesh(geo, wall)
                    seg.scale.x = 1.9
                    seg.position.set(x, 0, z)
                    seg.rotation.y = Math.atan2(-uz, ux)
                    const c = new THREE.Mesh(capGeo, cap)
                    c.scale.x = 1.9
                    c.position.copy(seg.position)
                    c.rotation.copy(seg.rotation)
                    seg.castShadow = c.castShadow = true
                    seg.receiveShadow = true
                    group.add(seg, c)
                }
            }
        }
    }
}
