import * as THREE from 'three'
import gsap from 'gsap'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { WORLD, sharedMaterial } from './materials.js'
import { canopyGeometry, trunkGeometry, bushGeometry, palmGeometry } from './procedural/nature.js'
import { canvasTexture, ringTexture, radialTexture } from './procedural/textures.js'
import { stylize, stylizeWater } from './stylize.js'
import { buildBarrioCues } from './ThemeCues.js'
import { buildCollectionPoint, collectionPointProxy, DISPLAY_SLOTS } from './CollectionPoint.js'
import { SUPPLIES, CATEGORIES, perBox } from '../data/catalog.js'
import * as props from './props.js'

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
/** Supplies shown at the stand: each unit about this big. */
const DISPLAY_UNIT = 0.36
/** A street lamp at night: light strength, how far it reaches, and the size of its halo and ground pool (m). */
const LAMP = { intensity: 16, reach: 13, halo: 1.5, pool: 4.2 }
/** How much of a slot one lot may take: at most this many boxes, or this many loose units. */
/*
 * What a donor leaves is laid out side by side, never piled up: at most four
 * boxes (or four loose units) per supply, in a 2 × 2 square with a gap all
 * round, sized so the squares of neighbouring supplies on the counter do not
 * touch either. A box is shrunk to DISPLAY_BOX of the prop's size for that.
 */
const DISPLAY_MAX_BOXES = 4
const DISPLAY_MAX_UNITS = 4
const DISPLAY_BOX = 0.47
/** Centre-to-centre spacing of the 2 × 2 square, across and front to back. */
const DISPLAY_GAP = { x: 0.48, z: 0.42 }
/** Space between people waiting in line at the counter. */
const QUEUE_GAP = 1.1

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

/** Blend two #rrggbb colours; k = 0 keeps a, k = 1 gives b. */
function mixHex(a, b, k) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const [r1, g1, b1] = p(a)
    const [r2, g2, b2] = p(b)
    const c = (x, y) => Math.round(x + (y - x) * k)
    return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`
}

function segDist(x, z, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1]
    const l2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2))
    return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
}

/** Smoothstep that also works when the range runs backwards (e0 > e1). */
const smooth = (e0, e1, x) => {
    const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
    return k * k * (3 - 2 * k)
}

/**
 * Build a barrio's relief from its layout.
 *
 * A ridge rises from `south` to `crest` and settles again by `north`, fading
 * out sideways so the ground still meets the flat world at the edges. Every
 * house, the landmark and the open spot get a level terrace, so a hillside
 * barrio keeps buildable lots and a walkable street instead of tilted houses.
 *
 * @returns {null | ((x:number, z:number) => number)}
 */
function makeTerrain(L) {
    const t = L.terrain
    if (!t) return null
    const base = (x, z) => {
        const ridge = z > t.crest ? smooth(t.south, t.crest, z) : smooth(t.north, t.crest, z)
        const side = 1 - smooth(t.sideFade, t.sideEnd, Math.abs(x))
        return t.height * ridge * side
    }
    const pads = Object.values(L.slots).map((sl) => ({ x: sl.x, z: sl.z, r: t.pad ?? 7 }))
    if (L.open) pads.push({ x: L.open[0], z: L.open[1], r: 5.5 })
    if (L.acopio) pads.push({ x: L.acopio.x, z: L.acopio.z, r: 8 })
    if (L.feature && L.feature.x !== undefined) pads.push({ x: L.feature.x, z: L.feature.z, r: t.featurePad ?? 10 })
    for (const p of pads) p.y = base(p.x, p.z)
    return (x, z) => {
        let y = base(x, z)
        for (const p of pads) {
            const w = 1 - smooth(p.r * 0.5, p.r, Math.hypot(x - p.x, z - p.z))
            if (w > 0) y = y * (1 - w) + p.y * w
        }
        return y
    }
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
        const [x, z] = this.content.layout.start
        return v3(x, z, this.heightAt(x, z))
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
        this.setNight(this.night ?? 0)
        this.#matchOuterGrass(barrio)
        this.selected = this.hovered = null
        this.focusMode = false
        this.#refreshCues()
        this.halo.material.opacity = 0
    }

    house(id) {
        return this.content.houses.get(id)
    }

    get acopio() {
        return this.content?.acopio ?? null
    }

    /**
     * Place in the line at the counter: 0 is at the counter itself, each next
     * person stands one step further out, straight back from the stand.
     */
    queueSpot(i) {
        const a = this.content.acopio
        const p = a.door.clone().addScaledVector(new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)), i * QUEUE_GAP)
        p.y = this.heightAt(p.x, p.z)
        return p
    }

    /** Anchor for the collection point's floating label. */
    acopioAnchor(out = new THREE.Vector3()) {
        const a = this.content.acopio
        return out.copy(a.center).setY(a.center.y + 3.9)
    }

    labelAnchor(id, out = new THREE.Vector3()) {
        const h = this.content.houses.get(id)
        return out.copy(h.center).setY(h.center.y + h.size.y + 1.0)
    }

    /**
     * What the pointer is over. The collection point is the only thing a person
     * acts on inside a barrio, so it is tested first and the houses are left as
     * scenery (their proxies still serve the camera's line-of-sight checks).
     */
    pick(raycaster) {
        const a = this.content?.acopio
        if (a && raycaster.intersectObject(a.proxy, false).length) return 'acopio'
        return null
    }

    /** Ground height for walkers (bridges); 0 elsewhere. */
    heightAt(x, z) {
        return this.content?.heightAt?.(x, z) ?? 0
    }

    /**
     * Where to stand to see the collection point's front.
     *
     * Starts square in front of the stand and widens the angle, then backs off,
     * until nothing in the barrio is in the way. Barrios differ in how tightly
     * the houses sit around the stand, so the framing is found rather than
     * assumed.
     *
     * @returns {{pos: THREE.Vector3, look: THREE.Vector3}}
     */
    acopioViewpoint({ dist = 17.5, rise = 0.44, lift = 1.9, offsets = [0.26, -0.26, 0.6, -0.6, 0] } = {}) {
        const a = this.content.acopio
        const look = a.center.clone().setY(a.center.y + lift)
        const front = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw))
        const side = new THREE.Vector3(-front.z, 0, front.x)
        const blockers = [...this.content.proxies, ...this.content.occluders]
        const ray = new THREE.Raycaster()
        let fallback = null
        for (const d of [dist, dist * 1.22, dist * 1.5]) {
            for (const off of offsets) {
                for (const up of [rise, rise * 1.5, rise * 2.2]) {
                    const dir = front.clone().addScaledVector(side, off).setY(up).normalize()
                    const pos = look.clone().addScaledVector(dir, d)
                    const to = look.clone().sub(pos)
                    const len = to.length()
                    ray.set(pos, to.normalize())
                    ray.far = len - 1.5
                    if (!ray.intersectObjects(blockers, false).length) return { pos, look, dir, dist: d }
                    fallback ??= { pos, look, dir, dist: d }
                }
            }
        }
        return fallback
    }

    /**
     * Camera framing for a house: behind the guide (at the door), looking at the
     * façade from the street side. Candidates blocked by another house are skipped.
     */
    viewpointFor(id, { distance = 14.5, height = 8.6 } = {}) {
        const h = this.content.houses.get(id)
        const door = h.door
        const look = door.clone().lerp(h.center, 0.6).setY(door.y + 2.1)
        const link = this.content.layout.nodes[this.content.layout.slots[h.data.slot].link]
        const toStreet = v3(link[0] - door.x, link[1] - door.z)
        if (toStreet.length() < 2) toStreet.copy(h.front)
        toStreet.normalize()
        const back = new THREE.Vector3(0, 0, 1)
        const others = [...this.content.proxies.filter((p) => p.userData.houseId !== id), ...this.content.occluders]
        const ray = new THREE.Raycaster()
        const eye = door.clone().setY(door.y + 1.4)
        let best = null
        // try a few blends between "from the street" and "from behind", then a higher angle
        for (const h of [height, height * 1.3, height * 1.6]) {
            for (const w of [0.4, 0.55, 0.7, 0.85, 1]) {
                const dir = toStreet.clone().multiplyScalar(w).addScaledVector(back, 1 - w).normalize()
                const pos = door.clone().addScaledVector(dir, distance * (h === height ? 1 : 0.85)).setY(door.y + h)
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

    /**
     * Shortest route along the street graph to a target: a house door, or
     * 'acopio' for the collection point.
     */
    route(fromNode, target) {
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
        const acopio = this.content.acopio
        if (acopio) {
            const link = layout.acopio.link
            const d = d2([acopio.door.x, acopio.door.z], layout.nodes[link])
            graph.set('acopio', [[link, d]])
            graph.get(link).push(['acopio', d])
        }
        const pos = (k) =>
            k === 'acopio' ? acopio.door.clone() : k.startsWith('door:') ? houses.get(k.slice(5)).door.clone() : v3(...layout.nodes[k])
        const targetKey = target === 'acopio' ? 'acopio' : `door:${target}`
        const dist = new Map([[fromNode, 0]])
        const prev = new Map()
        const open = new Set([fromNode])
        while (open.size) {
            let u = null
            for (const n of open) if (u === null || dist.get(n) < dist.get(u)) u = n
            open.delete(u)
            if (u === targetKey) break
            for (const [v, w] of graph.get(u) ?? []) {
                const nd = dist.get(u) + w
                if (nd < (dist.get(v) ?? Infinity)) {
                    dist.set(v, nd)
                    prev.set(v, u)
                    open.add(v)
                }
            }
        }
        const keys = [targetKey]
        while (prev.has(keys[0])) keys.unshift(prev.get(keys[0]))
        return { nodes: keys, points: keys.map(pos) }
    }

    /* ---------------- selection visuals ---------------- */

    /* ---- the collection point is the only thing that lights up ---- */

    setHover(on) {
        if (this.hovered === !!on) return
        this.hovered = !!on
        this.#refreshCues()
    }

    setSelected(on) {
        this.selected = !!on
        this.#refreshCues()
        const a = this.content?.acopio
        if (!a) return
        if (on) {
            this.halo.position.copy(a.center).setY(a.center.y + 0.06)
            this.halo.scale.set(9, 9, 9)
            gsap.to(this.halo.material, { opacity: 0.8, duration: 0.9, ease: 'sine.out' })
        } else {
            gsap.to(this.halo.material, { opacity: 0, duration: 0.6, ease: 'sine.inOut' })
        }
    }

    /** While a panel is open the ring steps back; it has done its job. */
    setFocusMode(on) {
        this.focusMode = on
        this.#refreshCues()
    }

    /* ---------------- supplies left at the stand ---------------- */

    /**
     * What is on the stand, in two layers:
     *   basket     what the donor is choosing right now (mirrors the panel)
     *   delivered  what has been handed over and waits for the families
     * Each kind of supply keeps its own spot. Up to five units are shown one by
     * one; above that they are packed into a single box. As the families take
     * their share the box drops back to the loose units that remain.
     */
    #display() {
        const a = this.content?.acopio
        if (!a) return null
        const d = (a.display ??= { group: new THREE.Group(), items: new Map(), slots: new Map(), basket: new Map(), delivered: new Map() })
        if (!d.group.parent) a.group.add(d.group)
        return d
    }

    /** @param basket Map<itemId, qty> the donor's basket as it is now */
    setDisplay(basket) {
        const d = this.#display()
        if (!d) return
        // only the supplies whose amount changed react; the rest of the stand stays still
        const before = d.basket
        d.basket = new Map(basket)
        const changed = new Set([...before.keys(), ...d.basket.keys()].filter((id) => (before.get(id) ?? 0) !== (d.basket.get(id) ?? 0)))
        this.#refreshDisplay(changed)
    }

    /** The basket was confirmed: it stays on the stand until the families collect it. */
    commitDisplay() {
        const d = this.#display()
        if (!d) return
        for (const [id, q] of d.basket) d.delivered.set(id, (d.delivered.get(id) ?? 0) + q)
        d.basket = new Map()
    }

    /** A family takes its share off the counter. @param items Map<itemId, qty> */
    takeFromDisplay(items) {
        const d = this.#display()
        if (!d) return
        for (const [id, q] of items) {
            const left = (d.delivered.get(id) ?? 0) - q
            if (left > 0) d.delivered.set(id, left)
            else d.delivered.delete(id)
        }
        this.#refreshDisplay(new Set(items.keys()))
    }

    /** Only the basket preview goes; anything already delivered stays for the families. */
    clearDisplay() {
        this.setDisplay(new Map())
    }

    /** Everything goes (leaving the barrio). */
    resetDisplay() {
        const d = this.#display()
        if (!d) return
        const ids = new Set([...d.basket.keys(), ...d.delivered.keys()])
        d.basket = new Map()
        d.delivered = new Map()
        this.#refreshDisplay(ids)
    }

    #refreshDisplay(ids) {
        const a = this.content.acopio
        for (const id of ids) this.loader.load(SUPPLIES[id].asset).then((t) => this.#reconcile(a, id, t))
    }

    #reconcile(a, id, template) {
        const d = a.display
        const count = (d.basket.get(id) ?? 0) + (d.delivered.get(id) ?? 0)
        const shown = d.items.get(id) ?? { mode: 'units', objs: [] }
        if (count && !d.slots.has(id)) {
            const used = new Set(d.slots.values())
            const free = DISPLAY_SLOTS.findIndex((_, i) => !used.has(i))
            if (free < 0) return
            d.slots.set(id, free)
        }
        const slot = DISPLAY_SLOTS[d.slots.get(id)]
        const size = template.size
        const s = DISPLAY_UNIT / Math.max(size.x, size.y, size.z, 1e-6)
        const pop = (obj, scale, y, delay = 0) => {
            obj.position.y = y + 0.7
            obj.scale.setScalar(0.001)
            d.group.add(obj)
            gsap.to(obj.scale, { x: scale, y: scale, z: scale, duration: 0.55, delay, ease: 'back.out(2.6)' })
            gsap.to(obj.position, { y, duration: 0.5, delay, ease: 'bounce.out' })
        }
        const vanish = (obj) => {
            gsap.killTweensOf(obj.scale)
            gsap.killTweensOf(obj.position)
            gsap.to(obj.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.3, ease: 'back.in(2)', onComplete: () => d.group.remove(obj) })
        }
        // A box only appears once there is enough of this item to fill one, and how
        // much that takes comes from the thing itself: dozens of tins, a pair of
        // blankets. Below that the units stay loose on the counter.
        const per = perBox(id)
        const boxes = Math.min(DISPLAY_MAX_BOXES, Math.floor(count / per))
        const mode = boxes > 0 ? 'box' : 'units'
        const want = mode === 'box' ? boxes : Math.min(count, DISPLAY_MAX_UNITS)

        // switching between boxes and loose units: the old form goes, the new one pops in
        if (shown.mode !== mode || !count) {
            shown.objs.forEach(vanish)
            shown.objs = []
            shown.mode = mode
        }

        if (mode === 'box' && count) {
            let added = 0
            while (shown.objs.length < want) {
                const i = shown.objs.length
                const box = this.#supplyBox(id, template, s)
                // a 2 × 2 square on the counter, nothing on top of anything
                box.position.x = slot.x + ((i % 2) - 0.5) * DISPLAY_GAP.x
                box.position.z = slot.z + (Math.floor(i / 2) - 0.5) * DISPLAY_GAP.z
                box.rotation.y = (Math.random() - 0.5) * 0.08
                pop(box, DISPLAY_BOX, slot.y, 0.12 + added++ * 0.07)
                shown.objs.push(box)
            }
            while (shown.objs.length > want) vanish(shown.objs.pop())
            if (!added && shown.objs.length) {
                // the same boxes, with more inside: a small squash says so
                const box = shown.objs[0]
                const k = DISPLAY_BOX
                gsap.fromTo(box.scale, { x: 1.08 * k, y: 0.9 * k, z: 1.08 * k }, { x: k, y: k, z: k, duration: 0.4, ease: 'back.out(3)' })
            }
        } else if (mode === 'units') {
            let added = 0
            while (shown.objs.length < want) {
                const i = shown.objs.length
                const obj = this.loader.instanceSync(template)
                obj.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true))
                // four in a square with room between them, none on top
                obj.position.x = slot.x + ((i % 2) - 0.5) * DISPLAY_GAP.x
                obj.position.z = slot.z + (Math.floor(i / 2) - 0.5) * DISPLAY_GAP.z
                obj.rotation.y = (Math.random() - 0.5) * 0.3
                pop(obj, s, slot.y, 0.12 + added++ * 0.06)
                shown.objs.push(obj)
            }
            while (shown.objs.length > want) vanish(shown.objs.pop())
        }

        if (count) d.items.set(id, shown)
        else {
            d.items.delete(id)
            d.slots.delete(id)
        }
    }

    /**
     * A cardboard box holding a full load of one supply — how many that is comes
     * from perBox in the catalogue. Taped in the colour of the supply's category,
     * with one unit on the lid so it is clear at a glance what is inside.
     */
    #supplyBox(id, template, unitScale) {
        const g = props.supplyBox(CATEGORIES[SUPPLIES[id].category].color)
        const sample = this.loader.instanceSync(template)
        sample.scale.setScalar(unitScale * 0.75)
        sample.position.y = 0.5
        sample.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true))
        g.add(sample)
        return g
    }

    #refreshCues() {
        const a = this.content?.acopio
        if (!a?.ring) return
        const target = this.focusMode ? 0 : this.selected ? 0.5 : this.hovered ? 1 : 0.78
        gsap.to(a.ring.material, { opacity: target, duration: 0.5, ease: 'sine.out' })
        a.ring.material.color.set(this.hovered || this.selected ? '#F5333F' : '#FFFFFF')
        const sc = this.hovered && !this.selected ? 1.1 : 1
        gsap.to(a.ring.scale, { x: sc, y: sc, z: sc, duration: 0.5, ease: 'sine.out' })
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

    /**
     * The open country takes the barrio's own grass, tinted by the same emergency
     * pass the painted ground uses. The two meet in the same colour, so the fade
     * at the edge of the painted ground has nothing to reveal.
     */
    #matchOuterGrass(barrio) {
        const look = barrio.layout?.look
        if (!look?.grass) return
        const skin = this.theme?.skin
        const grass = skin?.grass ? mixHex(look.grass, skin.grass, skin.grassMix ?? 0.5) : look.grass
        this.outerMat.color.set(grass)
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
        const terrain = makeTerrain(L)
        /** Ground height anywhere in this barrio (flat barrios return 0). */
        const gy = terrain ?? (() => 0)
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
        // where visitors walk in to the collection point
        const acopioFront = L.acopio ? v3(Math.sin(L.acopio.yaw), Math.cos(L.acopio.yaw)) : null
        const acopioDoor = L.acopio ? v3(L.acopio.x, L.acopio.z).addScaledVector(acopioFront, 3.6) : null
        if (L.acopio) {
            links.push({
                a: L.nodes[L.acopio.link],
                b: [acopioDoor.x, acopioDoor.z],
                w: 2.8,
                style: mainStyle === 'road' ? 'pavers' : mainStyle,
                link: true,
            })
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
        const seg = terrain ? 180 : 1
        const groundGeo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, seg, seg)
            .rotateX(-Math.PI / 2)
            .translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
        if (terrain) {
            const pos = groundGeo.attributes.position
            for (let i = 0; i < pos.count; i++) pos.setY(i, terrain(pos.getX(i), pos.getZ(i)))
            pos.needsUpdate = true
            groundGeo.computeVertexNormals()
        }
        disposables.push(groundGeo)
        const wet = Math.min(1, this.theme.mood.wet + (this.theme.skin?.damp ?? 0))
        const groundMat = stylize(
            new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 - wet * 0.45, envMapIntensity: 0.6 + wet, transparent: true, depthWrite: true }),
            { ao: 0, rim: 0 }
        )
        disposables.push(groundMat)
        const ground = new THREE.Mesh(groundGeo, groundMat)
        ground.renderOrder = -1 // first of the transparent pass: it is the floor
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
            obj.position.set(slot.x, gy(slot.x, slot.z), slot.z)
            obj.rotation.y = slot.yaw
            obj.userData.houseId = h.id
            group.add(obj)
            const size = template.size
            const front = v3(Math.sin(slot.yaw), Math.cos(slot.yaw))
            const entry = { data: h, object: obj, center: v3(slot.x, slot.z, obj.position.y), front, size, labelled: !!h.category }
            blocked.push({ x: slot.x, z: slot.z, r: Math.max(size.x, size.z) * 0.62 })
            if (entry.labelled) {
                entry.door = doors[h.slot].clone()
                entry.door.y = gy(entry.door.x, entry.door.z)
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
                blocked.push({ x: entry.door.x, z: entry.door.z, r: 1.8 })
            }
            houses.set(h.id, entry)
        }
        await yieldFrame()

        /* ---- collection point: the barrio's one interactive place ---- */
        let acopio = null
        if (L.acopio) {
            const ay = gy(L.acopio.x, L.acopio.z)
            const stand = buildCollectionPoint()
            stand.position.set(L.acopio.x, ay, L.acopio.z)
            stand.rotation.y = L.acopio.yaw
            group.add(stand)
            const proxy = collectionPointProxy()
            proxy.position.copy(stand.position)
            proxy.rotation.y = L.acopio.yaw
            group.add(proxy)
            disposables.push(proxy.geometry)
            acopio = {
                group: stand,
                proxy,
                yaw: L.acopio.yaw,
                center: v3(L.acopio.x, L.acopio.z, ay),
                door: v3(acopioDoor.x, acopioDoor.z, gy(acopioDoor.x, acopioDoor.z)),
                counter: v3(L.acopio.x, L.acopio.z, ay).addScaledVector(acopioFront, 1.9).setY(ay + 1.0),
                // where the guide waits while the panel is open: beside the counter, not in front of it
                aside: v3(L.acopio.x, L.acopio.z, ay).add(new THREE.Vector3(-4.3, 0, 1.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), L.acopio.yaw)),
            }
            const ring = new THREE.Mesh(
                new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2),
                new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, opacity: 0.8, depthWrite: false, color: '#FFFFFF' })
            )
            ring.position.copy(acopio.door).setY(acopio.door.y + 0.05)
            ring.renderOrder = 1
            acopio.ring = ring
            group.add(ring)
            blocked.push({ x: L.acopio.x, z: L.acopio.z, r: 4.6 })
            blocked.push({ x: acopioDoor.x, z: acopioDoor.z, r: 2 })
        }

        /* ---- landmark feature ---- */
        let heightAt = null
        const feat = this.#feature(L, group, blocked, updaters, disposables, rand, gy)
        if (feat?.heightAt) heightAt = feat.heightAt

        /* ---- lamps ---- */
        const lamps = []
        for (const [x, z, side] of L.lamps) {
            const l = this.loader.instanceSync(this.lampTemplate)
            l.position.set(x, gy(x, z), z)
            l.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2
            group.add(l)
            blocked.push({ x, z, r: 0.9 })
            lamps.push(this.#lampLight(group, l, gy))
        }

        /* ---- vegetation ---- */
        const [ox, oz] = L.open
        blocked.push({ x: ox, z: oz, r: 3.4 })
        blocked.push({ x: L.start[0], z: L.start[1] + 2, r: 3.5 })
        const occluders = this.#vegetation(L, group, blocked, distToPaths, rand, disposables, gy)
        if (L.look.walls) this.#walls(L, paths, links, group, gy, L.acopio)
        this.#streetLife(L, group, houses, blocked, distToPaths, rand, gy)
        await yieldFrame()

        /* ---- emergency context cues ---- */
        const pathPoints = []
        for (const p of paths) {
            if (p.style === 'road') continue
            const n = Math.ceil(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) / 3)
            for (let i = 0; i <= n; i++) {
                const x = p.a[0] + ((p.b[0] - p.a[0]) * i) / n
                const z = p.a[1] + ((p.b[1] - p.a[1]) * i) / n
                // nothing from the emergency cues lands on or right around the collection point
                const nearStand = L.acopio && Math.hypot(x - L.acopio.x, z - L.acopio.z) < 6.5
                if (z < 14 && z > -30 && Math.abs(x) < 28 && !nearStand) pathPoints.push(v3(x, z))
            }
        }
        const fillers = Object.entries(L.slots).filter(([k]) => k.startsWith('F')).map(([, s]) => s)
        const doorList = Object.entries(doors).map(([k, d]) => Object.assign(d.clone(), { yaw: L.slots[k].yaw }))
        // clear places near the street where a cue can stand without crowding anything
        const spots = []
        for (let i = 0; i < 600 && spots.length < 6; i++) {
            const x = (rand() - 0.5) * 44
            const z = -26 + rand() * 34
            const d = distToPaths(x, z)
            if (d < 2.6 || d > 7) continue
            if (blocked.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + 2.2)) continue
            if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 7)) continue
            spots.push({ x, z })
        }
        // the inspection barrier uses the textured obstacle model (procedural one if it fails)
        const obstacle = this.theme.cues.barrio.includes('inspection') ? await this.loader.load('obstacle') : null
        const barrier = obstacle?.source === 'glb' ? () => this.loader.instanceSync(obstacle) : null
        const cues = buildBarrioCues(this.theme, { layout: L, doors: doorList, fillers, open: L.open, pathPoints, spots, heightAt: gy, rand, barrier })
        group.add(cues.group)
        updaters.push(cues.update)

        return {
            id: barrio.id,
            layout: L,
            group,
            houses,
            acopio,
            proxies,
            occluders,
            disposables,
            heightAt: terrain && heightAt ? (x, z) => terrain(x, z) + heightAt(x, z) : (terrain ?? heightAt),
            lamps,
            update: (dt, t) => updaters.forEach((u) => u(dt, t)),
        }
    }

    /* ---------------- street lamps at night ---------------- */

    /**
     * What a lamp gives off once it is dark: a real light under its head, so
     * the street and the nearest façades are lit, a soft halo round the bulb,
     * and a warm pool on the ground. Everything starts switched off; setNight
     * turns it up. The light is always there (at zero by day) so nothing has
     * to recompile when night falls.
     */
    #lampLight(group, lamp, gy) {
        lamp.updateMatrixWorld(true)
        const box = new THREE.Box3()
        lamp.traverse((o) => {
            if (o.isMesh && [o.material].flat().some((m) => m?.name?.startsWith('house:lamp'))) box.expandByObject(o)
        })
        const head = box.isEmpty() ? lamp.position.clone().setY(lamp.position.y + 3.4) : box.getCenter(new THREE.Vector3())
        head.y = box.isEmpty() ? head.y : box.min.y + (box.max.y - box.min.y) * 0.35

        const light = new THREE.PointLight('#FFCF8A', 0, LAMP.reach, 2)
        light.position.copy(head).setY(head.y - 0.15)
        group.add(light)

        this.lampHaloMat ??= new THREE.SpriteMaterial({
            map: radialTexture({ inner: 'rgba(255,255,255,1)', outer: 'rgba(255,255,255,0)', w: 128 }),
            color: '#FFD9A0',
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
        })
        const halo = new THREE.Sprite(this.lampHaloMat)
        halo.position.copy(head)
        halo.scale.setScalar(LAMP.halo)
        halo.renderOrder = 6
        group.add(halo)

        this.lampPoolMat ??= new THREE.MeshBasicMaterial({
            map: radialTexture({ inner: 'rgba(255,255,255,1)', outer: 'rgba(255,255,255,0)', w: 128 }),
            color: '#FFC777',
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            fog: false,
        })
        this.lampPoolGeo ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
        const pool = new THREE.Mesh(this.lampPoolGeo, this.lampPoolMat)
        pool.scale.set(LAMP.pool * 2, 1, LAMP.pool * 2)
        pool.position.set(head.x, gy(head.x, head.z) + 0.06, head.z)
        pool.renderOrder = 2
        group.add(pool)

        return { light, halo, pool }
    }

    /** 0 by day, 1 at full night: lamps come on gradually through dusk. */
    setNight(n) {
        this.night = n
        const on = n > 0.02
        if (this.lampHaloMat) this.lampHaloMat.opacity = 0.85 * n
        if (this.lampPoolMat) this.lampPoolMat.opacity = 0.5 * n
        for (const l of this.content?.lamps ?? []) {
            l.light.intensity = LAMP.intensity * n
            l.halo.visible = l.pool.visible = on
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
            /* grass, tinted by the session's emergency context */
            const skin = this.theme.skin
            ctx.fillStyle = skin?.grass ? mixHex(L.look.grass, skin.grass, skin.grassMix ?? 0.5) : L.look.grass
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
                const [x, y] = toC(f.parkX ?? f.x, f.parkZ ?? f.z)
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

            /* the emergency context, laid over the whole barrio */
            if (skin?.paint) this.#paintSkin(ctx, cw, ch, skin.paint, rand, toC, s, [...paths, ...links])

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

            /* The painted barrio dissolves into the open country around it. Without
               this the ground is a rectangle: a hard line where its tone, its grass
               and the emergency's own pass all stop at once. */
            ctx.globalCompositeOperation = 'destination-out'
            const band = 11 * s // metres of ground given over to the fade
            const ramp = (x0, y0, x1, y1) => {
                const g = ctx.createLinearGradient(x0, y0, x1, y1)
                g.addColorStop(0, 'rgba(0,0,0,1)')
                g.addColorStop(0.42, 'rgba(0,0,0,0.5)')
                g.addColorStop(1, 'rgba(0,0,0,0)')
                return g
            }
            ctx.fillStyle = ramp(0, 0, band, 0)
            ctx.fillRect(0, 0, band, ch)
            ctx.fillStyle = ramp(cw, 0, cw - band, 0)
            ctx.fillRect(cw - band, 0, band, ch)
            ctx.fillStyle = ramp(0, 0, 0, band)
            ctx.fillRect(0, 0, cw, band)
            ctx.fillStyle = ramp(0, ch, 0, ch - band)
            ctx.fillRect(0, ch - band, cw, band)
            ctx.globalCompositeOperation = 'source-over'
        })
        tex.anisotropy = 8
        return tex
    }

    /**
     * The session's emergency context, painted over the finished ground.
     *
     * Each pass is weather and traces of it, never damage: ash settling, dust
     * raised and resting, ground still wet.
     * They are drawn last so they read as something that happened to the
     * barrio, not as part of how the barrio was built.
     */
    #paintSkin(ctx, cw, ch, kind, rand, toC, s, shapes) {
        /** Soft irregular blotch, used by most passes. */
        const blotch = (x, y, r, fill) => {
            const g = ctx.createRadialGradient(x, y, 0, x, y, r)
            g.addColorStop(0, fill)
            g.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.fillStyle = g
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
        }
        /** A band hugging every walkable surface, for things that collect at the edges. */
        const alongPaths = (width, style) => {
            ctx.save()
            ctx.strokeStyle = style
            ctx.lineCap = 'round'
            for (const sh of shapes) {
                ctx.lineWidth = (sh.w + width) * s
                ctx.beginPath()
                ctx.moveTo(...toC(...sh.a))
                ctx.lineTo(...toC(...sh.b))
                ctx.stroke()
            }
            ctx.restore()
        }

        if (kind === 'ash') {
            // a fine grey fall, heavier in drifts
            for (let i = 0; i < 34; i++) blotch(rand() * cw, rand() * ch, 110 + rand() * 260, 'rgba(146,142,136,0.2)')
            for (let i = 0; i < 26000; i++) {
                ctx.fillStyle = rand() < 0.65 ? 'rgba(168,164,158,0.35)' : 'rgba(96,92,88,0.3)'
                ctx.fillRect(rand() * cw, rand() * ch, 2 + rand() * 3, 2 + rand() * 3)
            }
            // ash banks up where the ground meets a kerb
            alongPaths(1.5, 'rgba(158,152,145,0.26)')
            return
        }

        if (kind === 'dust') {
            // dry dust lifted and settled again, palest on open ground
            for (let i = 0; i < 52; i++) blotch(rand() * cw, rand() * ch, 130 + rand() * 320, 'rgba(216,200,164,0.38)')
            for (let i = 0; i < 18000; i++) {
                ctx.fillStyle = 'rgba(208,192,160,0.4)'
                ctx.fillRect(rand() * cw, rand() * ch, 2 + rand() * 4, 2 + rand() * 4)
            }
            // hairline settling lines in the paving, thin and quiet
            ctx.save()
            ctx.strokeStyle = 'rgba(122,110,94,0.3)'
            ctx.lineWidth = 1.6
            for (let i = 0; i < 26; i++) {
                let x = rand() * cw
                let y = rand() * ch
                ctx.beginPath()
                ctx.moveTo(x, y)
                for (let k = 0; k < 4; k++) {
                    x += (rand() - 0.5) * 70
                    y += (rand() - 0.5) * 70
                    ctx.lineTo(x, y)
                }
                ctx.stroke()
            }
            ctx.restore()
            alongPaths(1.8, 'rgba(206,190,158,0.3)')
            return
        }

        if (kind === 'wet') {
            // ground that has not dried, darkest where the water ran
            for (let i = 0; i < 44; i++) blotch(rand() * cw, rand() * ch, 90 + rand() * 230, 'rgba(84,96,104,0.26)')
            alongPaths(2.6, 'rgba(90,102,110,0.3)')
            alongPaths(0.6, 'rgba(104,92,74,0.34)')
            // scattered dark pools on open ground
            ctx.save()
            for (let i = 0; i < 40; i++) {
                ctx.fillStyle = `rgba(74,86,96,${0.16 + rand() * 0.2})`
                ctx.beginPath()
                ctx.ellipse(rand() * cw, rand() * ch, 14 + rand() * 46, 8 + rand() * 24, rand() * Math.PI, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.restore()
        }
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

    #feature(L, parent, blocked, updaters, disposables, rand, gy = () => 0) {
        const f = L.feature
        const group = new THREE.Group()
        group.name = 'landmark'
        group.position.y = gy(f.x ?? 0, f.z ?? 0)
        parent.add(group)
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
            const b = props.bench()
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
            const k = props.kiosk()
            k.position.set(f.x, 0, f.z)
            group.add(k)
            bench(-2.4, -24.6, 0, -22)
            bench(2.6, -19.4, 0, -22)
            blocked.push({ x: f.x, z: f.z, r: 2.8 })
        }

        if (f.type === 'chapel') {
            if (!L.terrain) {
                const grass = stylize(sharedMaterial('nb:mound', { color: '#93AE7F', roughness: 1 }), { ao: 0, rim: 0.05 })
                const mound = add(new THREE.Mesh(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), grass), false)
                mound.scale.set(9.5, 2.2, 9.5)
                mound.position.set(f.x, -0.05, f.z)
            }
            const ch = props.chapel()
            ch.position.set(f.x, L.terrain ? 0 : 1.55, f.z - 1)
            group.add(ch)
            // steps up the hill
            for (let i = 0; i < 7; i++) {
                const st = props.chapelStep()
                st.position.set(f.x, L.terrain ? 0.06 : 0.12 + i * 0.26, f.z + 9.3 - i * 0.65)
                group.add(st)
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
            const bridge = props.footbridge(f.width, deckH)
            bridge.position.set(bx, 0, f.z)
            group.add(bridge)
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
                    const goal = props.goal()
                    goal.position.set(c.x + gx, 0, c.z)
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
            // benches on the far side, away from the collection point in front of the pond
            for (const a of [1.7, 3.14, 4.6]) bench(f.x + Math.sin(a) * (f.r + 1.8), f.z + Math.cos(a) * (f.r + 1.8), f.x, f.z)
            blocked.push({ x: f.x, z: f.z, r: f.r + 1.2 })
        }
        return null
    }

    /* ---------------- plants ---------------- */

    #vegetation(L, group, blocked, distToPaths, rand, disposables, gy = () => 0) {
        const isBlocked = (x, z, pad = 0) => blocked.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + pad)
        const trees = []
        const CORE = 34 // radius of the barrio proper; planting inside it stays sparse

        // A few trees inside, placed well clear of the street so the place stays open.
        for (let i = 0; i < 1400 && trees.length < L.look.trees; i++) {
            const x = (rand() - 0.5) * 54
            const z = -34 + rand() * 50
            if (Math.hypot(x, z + 8) > CORE) continue
            if (distToPaths(x, z) < 3.4 || isBlocked(x, z, 2.2)) continue
            if (z > L.start[1] - 4 && Math.abs(x - L.start[0]) < 11) continue
            // keep the line of sight from the camera to the collection point clear
            if (L.acopio && z > L.acopio.z - 2 && Math.abs(x - L.acopio.x) < 11) continue
            if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 7)) continue
            trees.push([x, z, 1.05 + rand() * 0.45])
        }

        /**
         * The belt around the barrio. This is what fills the view: a wide ring
         * of trees beyond the streets, thickening with distance, so the eye has
         * somewhere to rest without anything crowding the place itself.
         */
        const inner = trees.length
        for (let i = 0; i < 4000 && trees.length < inner + (L.look.outer ?? 0); i++) {
            const a = rand() * Math.PI * 2
            const r = CORE + 2 + Math.pow(rand(), 0.6) * 96
            const x = Math.sin(a) * r
            const z = -8 + Math.cos(a) * r * 0.85
            if (distToPaths(x, z) < 3 || isBlocked(x, z, 2)) continue
            if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 4.4)) continue
            trees.push([x, z, 1.0 + rand() * 0.6])
        }
        if (L.look.parkTrees && L.feature.type === 'pond') {
            const f = L.feature
            const px = f.parkX ?? f.x, pz = f.parkZ ?? f.z
            for (let i = 0; i < 200 && trees.length < L.look.trees + 18 + L.look.parkTrees; i++) {
                const a = rand() * Math.PI * 2
                const r = 2.2 + rand() * (L.ring.r - 4)
                const x = px + Math.sin(a) * r, z = pz + Math.cos(a) * r
                if (L.acopio && z > L.acopio.z - 2 && Math.abs(x - L.acopio.x) < 6) continue
                if (distToPaths(x, z) < 1.6 || isBlocked(x, z, 0.8)) continue
                if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 3)) continue
                trees.push([x, z, 1.0 + rand() * 0.35])
            }
        }

        const leaf = stylize(sharedMaterial('nb:leaf', { color: '#FFFFFF', roughness: 0.92 }), { ao: 0.42, aoHeight: 2.6, rim: 0.2, sway: 0 })
        const canopy = new THREE.InstancedMesh(canopyGeometry(2), leaf, trees.length)
        const trunk = new THREE.InstancedMesh(trunkGeometry(), stylize(sharedMaterial('nb:trunk', { color: WORLD.trunk, roughness: 1 })), trees.length)
        disposables.push(canopy, trunk)
        const leafColors = (this.theme.skin?.leaf ?? WORLD.leaf).map((c) => new THREE.Color(c))
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
        trees.forEach(([x, z, s], i) => {
            const y = gy(x, z)
            q.setFromAxisAngle(up, rand() * Math.PI * 2)
            m.compose(p.set(x, y + s * 1.5, z), q, sc.set(s * 1.35, s * 1.25, s * 1.35))
            canopy.setMatrixAt(i, m)
            canopy.setColorAt(i, leafColors[Math.floor(rand() * leafColors.length)])
            m.compose(p.set(x, y, z), q, sc.set(s * 1.3, s * 1.35, s * 1.3))
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
        const blocksStand = (x, z) => L.acopio && z > L.acopio.z - 2 && Math.abs(x - L.acopio.x) < 6.5
        if (Array.isArray(L.look.palms)) palms = L.look.palms.filter(([x, z]) => !blocksStand(x, z)).map(([x, z]) => [x, z, 1.0 + rand() * 0.2])
        else if (L.look.palms > 0) {
            for (let i = 0; i < 400 && palms.length < L.look.palms; i++) {
                const x = (rand() - 0.5) * 60, z = -20 + rand() * 30
                if (distToPaths(x, z) < 1.4 || isBlocked(x, z, 0.6) || blocksStand(x, z)) continue
                palms.push([x, z, 1.0 + rand() * 0.25])
                blocked.push({ x, z, r: 1 })
            }
        }
        if (palms.length) {
            const palmMesh = new THREE.InstancedMesh(palmGeometry(), stylize(sharedMaterial('nb:palm', { vertexColors: true, roughness: 0.95 }), { sway: 0, rim: 0.18 }), palms.length)
            palms.forEach(([x, z, s], i) => {
                q.setFromAxisAngle(up, rand() * Math.PI * 2)
                m.compose(p.set(x, gy(x, z), z), q, sc.set(s * 1.25, s * 1.45, s * 1.25))
                palmMesh.setMatrixAt(i, m)
            })
            palmMesh.castShadow = true
            disposables.push(palmMesh)
            group.add(palmMesh)
        }

        // bushes + flowers along path edges, a few in planters
        const bushes = []
        for (let i = 0; i < 1600 && bushes.length < L.look.bushes; i++) {
            const x = (rand() - 0.5) * 60, z = -40 + rand() * 56
            const dp = distToPaths(x, z)
            if (dp < 1.0 || dp > 2.6 || isBlocked(x, z, -0.2)) continue
            if (bushes.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < 2.6)) continue
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
            stylize(sharedMaterial('nb:bush', { color: '#FFFFFF', roughness: 0.95 }), { ao: 0.4, aoHeight: 0.9, rim: 0.2, sway: 0 }),
            bushes.length
        )
        disposables.push(bushMesh)
        const bushColors = ['#7C9B66', '#87A56F', '#6F8E5E', '#8FAA78'].map((c) => new THREE.Color(c))
        const flowers = []
        bushes.forEach(([x, z, s, y], i) => {
            const by = y + gy(x, z)
            q.setFromAxisAngle(up, rand() * Math.PI * 2)
            m.compose(p.set(x, by, z), q, sc.set(s, s * 0.9, s))
            bushMesh.setMatrixAt(i, m)
            bushMesh.setColorAt(i, bushColors[Math.floor(rand() * bushColors.length)])
            if (rand() < 0.6) {
                const n = 4 + Math.floor(rand() * 7)
                for (let k = 0; k < n; k++) {
                    const a = rand() * Math.PI * 2, rr = 0.25 + rand() * 0.35
                    flowers.push([x + Math.cos(a) * rr * s, by + 0.62 * s + rand() * 0.25 * s, z + Math.sin(a) * rr * s, i])
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

    /**
     * Small signs of ordinary life: potted plants at the doors people use,
     * a bin or two by the street, a bicycle leaning where someone left it.
     *
     * None of it is interactive and none of it is emergency-related. It exists
     * so a barrio reads as somewhere lived in rather than a diagram of houses.
     */
    #streetLife(L, group, houses, blocked, distToPaths, rand, gy) {
        const place = (obj, x, z, yaw = 0) => {
            obj.position.set(x, gy(x, z), z)
            obj.rotation.y = yaw
            group.add(obj)
            blocked.push({ x, z, r: 0.8 })
        }
        const pot = (scale) => props.pot(rand, scale)
        const bin = props.bin
        const bicycle = props.bicycle

        // a pair of pots beside every door the guide actually visits
        for (const [, h] of houses) {
            if (!h.labelled || !h.door) continue
            const toHouse = new THREE.Vector3().subVectors(h.center, h.door).setY(0).normalize()
            const side = new THREE.Vector3(-toHouse.z, 0, toHouse.x)
            for (const k of [-1, 1]) {
                const x = h.door.x + toHouse.x * 1.5 + side.x * k * 1.25
                const z = h.door.z + toHouse.z * 1.5 + side.z * k * 1.25
                place(pot(0.85 + rand() * 0.4), x, z, rand() * Math.PI)
            }
        }

        // bins and bicycles along the street, wherever there is room
        let bins = 0
        let bikes = 0
        for (let i = 0; i < 900 && (bins < 4 || bikes < 3); i++) {
            const x = (rand() - 0.5) * 48
            const z = -28 + rand() * 40
            const d = distToPaths(x, z)
            if (d < 1.1 || d > 2.6) continue
            if (blocked.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + 1.1)) continue
            if (bins < 4 && rand() < 0.55) {
                place(bin(), x, z, rand() * Math.PI * 2)
                bins++
            } else if (bikes < 3) {
                place(bicycle(), x, z, rand() * Math.PI * 2)
                bikes++
            }
        }
    }

    /** Low whitewashed walls with a terracotta cap along a lane (colonial barrios). */
    #walls(L, paths, links, group, gy = () => 0, acopio = null) {
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
                    if (acopio && Math.hypot(x - acopio.x, z - acopio.z) < 6.4) continue
                    const w = props.wallSection()
                    w.position.set(x, gy(x, z), z)
                    w.rotation.y = Math.atan2(-uz, ux)
                    group.add(w)
                }
            }
        }
    }
}
