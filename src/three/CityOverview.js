import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ZONES } from '../data/zones.js'
import { WORLD, HOUSE_SCHEMES, sharedMaterial } from './materials.js'
import { canopyGeometry, trunkGeometry, palmGeometry } from './procedural/nature.js'
import { canvasTexture, crossTexture } from './procedural/textures.js'
import { stylize, stylizeWater } from './stylize.js'
import { buildCityCues } from './ThemeCues.js'

/**
 * An abstracted, readable Cali: Farallones hills to the west with Cristo Rey
 * and Tres Cruces, the Río Cali crossing the centre toward the Río Cauca,
 * a few main avenues, low-rise blocks, and five territorial zones.
 * Not a digital twin — a calm miniature.
 */

/* ---------------- deterministic helpers ---------------- */
let seed = 1234567
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const smooth = THREE.MathUtils.smoothstep
const lerp = THREE.MathUtils.lerp

function hash(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return s - Math.floor(s)
}
function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm(x, y) {
    let s = 0, a = 0.5, f = 1
    for (let i = 0; i < 4; i++) {
        s += a * vnoise(x * f, y * f)
        f *= 2.03
        a *= 0.5
    }
    return s
}

/* ---------------- geography ---------------- */
const CITY_C = new THREE.Vector2(14, 4)
function cityRadius(theta) {
    return 114 * (1 + 0.09 * Math.sin(3 * theta + 0.7) + 0.05 * Math.sin(5 * theta + 2.1))
}
const WEST_EDGE = (z) => -86 + 5 * Math.sin(z * 0.035 + 0.5)

function urbanMask(x, z) {
    const dx = x - CITY_C.x, dz = z - CITY_C.y
    const r = Math.hypot(dx, dz)
    const R = cityRadius(Math.atan2(dz, dx))
    const radial = 1 - smooth(r, R - 10, R + 4)
    const west = smooth(x, WEST_EDGE(z) - 2, WEST_EDGE(z) + 8)
    return radial * west
}

function mountainFactor(x, z) {
    return smooth(-(x + 6 * Math.sin(z * 0.03)), 92, 150)
}

export function heightAt(x, z) {
    const m = mountainFactor(x, z)
    if (m <= 0) return 0
    let h = m * (52 + 20 * Math.sin(z * 0.022 + 1) + 10 * Math.sin(z * 0.061))
    h += m * (fbm(x * 0.035, z * 0.035) - 0.5) * 34
    h += 30 * Math.exp(-((x + 132) ** 2 + (z - 10) ** 2) / (2 * 15 ** 2)) // Cerro de Cristo Rey
    h += 22 * Math.exp(-((x + 116) ** 2 + (z + 72) ** 2) / (2 * 14 ** 2)) // Cerro de las Tres Cruces
    return Math.max(0, h)
}

const RIVERS = [
    {
        id: 'cali',
        width: 4.2,
        clear: 5.5,
        points: [[-190, 10], [-150, 7], [-118, 2], [-96, -2], [-74, -6], [-50, -4], [-26, -9], [-4, -15], [16, -21], [36, -26], [60, -33], [88, -40], [116, -49], [140, -55], [158, -58]],
    },
    {
        id: 'melendez',
        width: 2.6,
        clear: 4,
        points: [[-170, 104], [-120, 96], [-84, 90], [-50, 95], [-14, 104], [24, 106], [62, 98], [100, 90], [132, 84], [160, 80]],
    },
    {
        id: 'cauca',
        width: 10,
        clear: 12,
        points: [[150, -460], [160, -300], [150, -170], [162, -70], [152, 30], [166, 130], [152, 250], [162, 460]],
    },
]

const ROADS = [
    [[-86, 44], [-50, 38], [-10, 32], [30, 34], [70, 44], [128, 62]], // Calle 5 / Autopista Sur
    [[2, -14], [8, -50], [18, -88], [30, -128]], // Avenida 3 Norte
    [[46, 122], [62, 60], [70, 4], [62, -56], [44, -112]], // Autopista Simón Bolívar / Oriental
    [[-80, -64], [-72, -22], [-74, 26], [-62, 84]], // Circunvalar
    [[-30, 10], [12, 4], [52, -2], [118, -18]], // Calle 25
]

function curveFrom(points, y = 0) {
    return new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal')
}

function sampleCurve(curve, spacing) {
    const n = Math.max(2, Math.ceil(curve.getLength() / spacing))
    return curve.getSpacedPoints(n)
}

/** Flat ribbon (river / road / outline) along sampled points on the XZ plane. */
function ribbonGeometry(points, width, y, closed = false) {
    const pos = []
    const uv = []
    const idx = []
    const n = points.length
    let acc = 0
    for (let i = 0; i < n; i++) {
        const p = points[i]
        const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
        const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
        const dx = next.x - prev.x, dz = next.z - prev.z
        const len = Math.hypot(dx, dz) || 1
        const nx = -dz / len, nz = dx / len
        if (i > 0) acc += p.distanceTo(points[i - 1])
        pos.push(p.x + nx * width * 0.5, y, p.z + nz * width * 0.5, p.x - nx * width * 0.5, y, p.z - nz * width * 0.5)
        uv.push(acc, 0, acc, 1)
    }
    const segs = closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
        const a = i * 2, b = ((i + 1) % n) * 2
        idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
}

function distToSamples(x, z, samples) {
    let best = Infinity
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i]
        const d = (s.x - x) ** 2 + (s.z - z) ** 2
        if (d < best) best = d
    }
    return Math.sqrt(best)
}

/* ================================================================= */

export class CityOverview {
    constructor(theme) {
        seed = 1234567
        this.theme = theme
        this.group = new THREE.Group()
        this.group.name = 'city'
        this.zones = new Map()
        this.hovered = null
        this.selected = null
        this.exclusions = []
        this.aidRings = []
        this.ready = false
        this.riverScale = theme?.cues.city.includes('highRiver') ? 1.3 : 1
        this.riverSamples = RIVERS.map((r) => ({ ...r, width: r.width * this.riverScale, samples: sampleCurve(curveFrom(r.points), 2) }))
        this.roadSamples = ROADS.map((pts) => sampleCurve(curveFrom(pts), 2))
    }

    /**
     * Build in small steps, yielding a frame between them, so the intro keeps
     * animating smoothly while the city assembles behind the clouds.
     */
    async build(onStep) {
        const steps = [
            () => this.#terrain(),
            () => this.#water(),
            () => this.#roads(),
            () => this.#landmarks(),
            () => this.#zones(),
            () => this.#blocks(),
            () => this.#vegetation(),
            () => this.#aidPoints(),
            () => this.#themeCues(),
        ]
        for (let i = 0; i < steps.length; i++) {
            steps[i]()
            onStep?.((i + 1) / steps.length)
            await new Promise((r) => setTimeout(r, 0))
        }
        this.ready = true
    }

    #themeCues() {
        if (!this.theme) return
        const cues = buildCityCues(this.theme, { parks: this.parks, heightAt })
        this.group.add(cues.group)
        this.cueUpdate = cues.update
    }

    /* ---------------- zones ---------------- */

    zoneAt(x, z) {
        if (urbanMask(x, z) < 0.5) return null
        const wx = x + 9 * Math.sin(z * 0.045 + 1.3)
        const wz = z + 9 * Math.sin(x * 0.04 + 0.4)
        let best = null
        let bestD = Infinity
        for (const zone of ZONES) {
            const w = zone.id === 'centro' ? 1.32 : 1
            const d = Math.hypot(wx - zone.seed[0], wz - zone.seed[1]) * w
            if (d < bestD) {
                bestD = d
                best = zone.id
            }
        }
        return best
    }

    labelAnchor(zoneId, out = new THREE.Vector3()) {
        const z = ZONES.find((zz) => zz.id === zoneId)
        return out.set(z.label[0], 15, z.label[1])
    }

    focusPoint(zoneId, out = new THREE.Vector3()) {
        const z = ZONES.find((zz) => zz.id === zoneId)
        return out.set(z.label[0], 0, z.label[1])
    }

    /** Ground-plane pick (the city is flat, no need to raycast thousands of triangles). */
    pick(raycaster) {
        const hit = new THREE.Vector3()
        if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null
        return this.zoneAt(hit.x, hit.z)
    }

    setHover(id) {
        this.hovered = id
    }

    setSelected(id) {
        this.selected = id
    }

    update(dt, t) {
        for (const [id, z] of this.zones) {
            const isSel = id === this.selected
            const isHover = id === this.hovered && !isSel
            const fillTarget = isSel ? 0.26 : isHover ? 0.14 : 0
            const lineTarget = isSel ? 1 : this.selected ? 0.12 : isHover ? 0.5 : 0.26
            const glowTarget = isSel ? 0.55 : 0
            const k = 1 - Math.exp(-dt * 5)
            z.fill.material.opacity = lerp(z.fill.material.opacity, fillTarget, k)
            z.line.material.opacity = lerp(z.line.material.opacity, lineTarget, k)
            z.glow.material.opacity = lerp(z.glow.material.opacity, glowTarget, k)
            z.line.material.color.lerp(isSel ? this._red : this._navy, k)
            z.fill.visible = z.fill.material.opacity > 0.005
            z.glow.visible = z.glow.material.opacity > 0.005
        }
        this.cueUpdate?.(dt)
        // Aid points breathe very slowly
        for (const m of this.aidRings) {
            const s = 1 + 0.08 * Math.sin(t * 1.2 + m.userData.phase)
            m.scale.set(s, s, s)
        }
    }

    #zones() {
        this._red = new THREE.Color('#F5333F')
        this._navy = new THREE.Color('#011E41')
        const glowTex = canvasTexture(4, 64, (ctx, w, h) => {
            const g = ctx.createLinearGradient(0, 0, 0, h)
            g.addColorStop(0, 'rgba(255,255,255,0)')
            g.addColorStop(0.5, 'rgba(255,255,255,1)')
            g.addColorStop(1, 'rgba(255,255,255,0)')
            ctx.fillStyle = g
            ctx.fillRect(0, 0, w, h)
        })

        for (const zone of ZONES) {
            const N = 140
            let [sx, sz] = zone.seed
            if (this.zoneAt(sx, sz) !== zone.id) [sx, sz] = zone.label
            const radii = []
            for (let i = 0; i < N; i++) {
                const a = (i / N) * Math.PI * 2
                const dx = Math.cos(a), dz = Math.sin(a)
                let r = 0
                while (r < 260 && this.zoneAt(sx + dx * (r + 0.75), sz + dz * (r + 0.75)) === zone.id) r += 0.75
                radii.push(r)
            }
            const sm = radii.map((_, i) => (radii[(i - 1 + N) % N] + radii[i] * 2 + radii[(i + 1) % N]) / 4)
            const pts = sm.map((r, i) => {
                const a = (i / N) * Math.PI * 2
                return new THREE.Vector3(sx + Math.cos(a) * (r - 0.6), 0, sz + Math.sin(a) * (r - 0.6))
            })

            const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)))
            const fillGeo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2)
            const fill = new THREE.Mesh(
                fillGeo,
                new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
            )
            fill.position.y = 0.55
            fill.renderOrder = 2

            const line = new THREE.Mesh(
                ribbonGeometry(pts, 0.9, 0.7, true),
                new THREE.MeshBasicMaterial({ color: '#011E41', transparent: true, opacity: 0.26, depthWrite: false })
            )
            line.renderOrder = 3
            const glow = new THREE.Mesh(
                ribbonGeometry(pts, 7, 0.65, true),
                new THREE.MeshBasicMaterial({ color: '#F5333F', alphaMap: glowTex, transparent: true, opacity: 0, depthWrite: false })
            )
            glow.renderOrder = 3

            this.group.add(fill, glow, line)
            this.zones.set(zone.id, { zone, fill, line, glow, pts })
        }
    }

    /* ---------------- terrain ---------------- */

    #terrain() {
        const size = 1100
        const seg = 220
        const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2)
        geo.translate(10, 0, 0)
        const pos = geo.attributes.position
        const colors = new Float32Array(pos.count * 3)
        const cGrass = new THREE.Color(WORLD.grass)
        const cField = new THREE.Color(WORLD.field)
        const cGrassDark = new THREE.Color(WORLD.grassDark)
        const cUrban = new THREE.Color(WORLD.urban)
        const cMount = new THREE.Color(WORLD.mountain)
        const cMountHigh = new THREE.Color(WORLD.mountainHigh)
        const c = new THREE.Color()
        const caliSamples = this.riverSamples[0].samples

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i)
            const h = heightAt(x, z)
            pos.setY(i, h)

            // farmland parcels in the valley
            const parcel = vnoise(Math.floor(x / 26) + 0.5, Math.floor(z / 22) + 0.5)
            c.copy(cGrass).lerp(cField, parcel * 0.8)
            c.lerp(cGrassDark, (fbm(x * 0.02, z * 0.02) - 0.4) * 0.6)

            const u = urbanMask(x, z)
            if (u > 0) c.lerp(cUrban, u * 0.92)

            const m = mountainFactor(x, z)
            if (m > 0) {
                c.lerp(cMount, Math.min(1, m * 1.3))
                c.lerp(cMountHigh, smooth(h, 30, 70) * 0.6)
            }

            // greener river banks
            if (Math.abs(x) < 200 && Math.abs(z) < 140) {
                const d = distToSamples(x, z, caliSamples)
                if (d < 12) c.lerp(cGrassDark, (1 - d / 12) * 0.75)
            }
            c.toArray(colors, i * 3)
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        geo.computeVertexNormals()

        const terrain = new THREE.Mesh(geo, stylize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), { ao: 0, rim: 0.06 }))
        terrain.receiveShadow = true
        terrain.name = 'terrain'
        this.terrain = terrain
        this.group.add(terrain)
    }

    #water() {
        const mat = stylizeWater(new THREE.MeshStandardMaterial({ color: WORLD.river, roughness: 0.25, metalness: 0.05, envMapIntensity: 1.3 }), { scale: 0.35 })
        const bank = new THREE.MeshStandardMaterial({ color: '#C9C2AF', roughness: 1 })
        for (const r of this.riverSamples) {
            const pts = r.samples.map((p) => new THREE.Vector3(p.x, 0, p.z))
            const water = new THREE.Mesh(ribbonGeometry(pts, r.width, 0.16), mat)
            water.receiveShadow = true
            const edge = new THREE.Mesh(ribbonGeometry(pts, r.width + 1.4, 0.1), bank)
            edge.receiveShadow = true
            this.group.add(edge, water)
        }
    }

    #roads() {
        const mat = new THREE.MeshStandardMaterial({ color: WORLD.road, roughness: 0.95 })
        const centre = new THREE.MeshBasicMaterial({ color: '#F4F1EA' })
        for (const samples of this.roadSamples) {
            const pts = samples.map((p) => new THREE.Vector3(p.x, 0, p.z))
            const road = new THREE.Mesh(ribbonGeometry(pts, 2.6, 0.12), mat)
            road.receiveShadow = true
            const line = new THREE.Mesh(ribbonGeometry(pts, 0.22, 0.14), centre)
            this.group.add(road, line)
        }
    }

    /* ---------------- landmarks ---------------- */

    #landmarks() {
        const white = sharedMaterial('lm:white', { color: '#F2EFE9', roughness: 0.7 })
        const slate = sharedMaterial('lm:slate', { color: '#7C8896', roughness: 0.7 })
        const glass = sharedMaterial('lm:glass', { color: '#8197AA', roughness: 0.3, metalness: 0.25 })
        const stone = sharedMaterial('lm:stone', { color: '#CFC6B5', roughness: 0.9 })
        const pitch = sharedMaterial('lm:pitch', { color: '#8FB07A', roughness: 1 })

        // Cristo Rey on its hill
        {
            const g = new THREE.Group()
            const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 3, 8), stone)
            pedestal.position.y = 1.5
            const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.35, 7.5, 12), white)
            robe.position.y = 6.75
            const arms = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.9, 0.9), white)
            arms.position.y = 9.4
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), white)
            head.position.y = 11.2
            g.add(pedestal, robe, arms, head)
            g.position.set(-132, heightAt(-132, 10) - 0.5, 10)
            g.rotation.y = -0.5
            g.scale.setScalar(1.15)
            this.group.add(g)
        }
        // Tres Cruces
        {
            for (const [dx, dz, s] of [[-4, 0, 0.8], [0, -1, 1], [4, 0, 0.8]]) {
                const x = -116 + dx, z = -72 + dz
                const cross = new THREE.Group()
                const v = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), white)
                v.position.y = 3.5
                const h = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.6, 0.6), white)
                h.position.y = 5
                cross.add(v, h)
                cross.scale.setScalar(s)
                cross.position.set(x, heightAt(x, z) - 0.3, z)
                cross.rotation.y = 0.3
                this.group.add(cross)
            }
        }
        // La Ermita — small white gothic church by the river
        {
            const g = new THREE.Group()
            const nave = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 9), white)
            nave.position.y = 2.5
            const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.4, 2.6, 4, 1), slate)
            roof.rotation.y = Math.PI / 4
            roof.scale.set(1, 1, 1.8)
            roof.position.y = 6.3
            const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 9, 2.6), white)
            tower.position.set(0, 4.5, 4.8)
            const spire = new THREE.Mesh(new THREE.ConeGeometry(1.7, 6.5, 8), slate)
            spire.position.set(0, 12.2, 4.8)
            g.add(nave, roof, tower, spire)
            for (const sx of [-1.9, 1.9]) {
                const p = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.4, 6), slate)
                p.position.set(sx, 6.6, 4.8)
                g.add(p)
            }
            g.position.set(-8, 0, -6)
            g.rotation.y = 0.35
            this.group.add(g)
            this.exclusions.push({ x: -8, z: -6, r: 9 })
        }
        // Torre de Cali
        {
            const g = new THREE.Group()
            const body = new THREE.Mesh(new THREE.BoxGeometry(6.5, 38, 6.5), glass)
            body.position.y = 19
            const crown = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, 7), white)
            crown.position.y = 39.2
            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), white)
            mast.position.y = 43
            g.add(body, crown, mast)
            g.position.set(24, 0, -12)
            g.rotation.y = 0.22
            this.group.add(g)
            this.exclusions.push({ x: 24, z: -12, r: 7 })
        }
        // Estadio Pascual Guerrero
        {
            const g = new THREE.Group()
            const ring = new THREE.Mesh(new THREE.CylinderGeometry(15, 13, 3.6, 40, 1, true), white)
            ring.material = sharedMaterial('lm:stadium', { color: '#E8E4DC', roughness: 0.8, side: THREE.DoubleSide })
            ring.position.y = 1.8
            const field = new THREE.Mesh(new THREE.CircleGeometry(12.8, 40).rotateX(-Math.PI / 2), pitch)
            field.position.y = 0.3
            const lines = new THREE.Mesh(
                new THREE.RingGeometry(3, 3.3, 32).rotateX(-Math.PI / 2),
                new THREE.MeshBasicMaterial({ color: '#E9F0E2' })
            )
            lines.position.y = 0.35
            g.add(ring, field, lines)
            g.scale.set(1, 1, 0.72)
            g.position.set(-26, 0, 58)
            g.rotation.y = 0.3
            this.group.add(g)
            this.exclusions.push({ x: -26, z: 58, r: 17 })
        }
        // Keep each zone's aid point clear of buildings
        for (const zone of ZONES) this.exclusions.push({ x: zone.label[0], z: zone.label[1], r: 7 })

        // Parks (open green squares)
        this.parks = [
            { x: 52, z: 72, r: 12 },
            { x: -46, z: 20, r: 8 },
            { x: 40, z: -70, r: 9 },
            { x: 100, z: 40, r: 9 },
            { x: 6, z: -2, r: 5 }, // plaza
        ]
        for (const p of this.parks) {
            const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r, 28).rotateX(-Math.PI / 2), sharedMaterial('city:park', { color: '#9FB98A', roughness: 1 }))
            disc.position.set(p.x, 0.09, p.z)
            disc.receiveShadow = true
            this.group.add(disc)
            this.exclusions.push({ ...p })
        }
    }

    /* ---------------- buildings ---------------- */

    #isFree(x, z, clearance = 0) {
        for (const e of this.exclusions) if ((x - e.x) ** 2 + (z - e.z) ** 2 < (e.r + clearance) ** 2) return false
        for (const r of this.riverSamples) if (distToSamples(x, z, r.samples) < r.clear + clearance) return false
        for (const s of this.roadSamples) if (distToSamples(x, z, s) < 3 + clearance) return false
        return true
    }

    #blocks() {
        const gridAngle = { centro: 0.18, norte: -0.22, sur: 0.36, oriente: 0.58, oeste: 0.05 }
        const towerChance = { centro: 0.24, norte: 0.12, sur: 0.04, oriente: 0.0, oeste: 0.0 }
        const fill = { centro: 0.86, norte: 0.84, sur: 0.7, oriente: 0.95, oeste: 0.82 }
        const houses = []
        const towers = []
        const step = 3.7

        for (const zone of ZONES) {
            const a = gridAngle[zone.id]
            const ca = Math.cos(a), sa = Math.sin(a)
            const [cx, cz] = zone.seed
            for (let i = -42; i <= 42; i++) {
                for (let j = -42; j <= 42; j++) {
                    // streets between blocks
                    if (((i % 5) + 5) % 5 === 4 || ((j % 4) + 4) % 4 === 3) continue
                    const lx = i * step, lz = j * step
                    const x = cx + lx * ca - lz * sa + (rnd() - 0.5) * 0.5
                    const z = cz + lx * sa + lz * ca + (rnd() - 0.5) * 0.5
                    if (this.zoneAt(x, z) !== zone.id) continue
                    if (urbanMask(x, z) < 0.85) continue
                    if (!this.#isFree(x, z)) continue
                    if (rnd() > fill[zone.id]) continue
                    const isTower = rnd() < towerChance[zone.id] * (1 - Math.min(1, Math.hypot(x - 20, z + 10) / 120))
                    ;(isTower ? towers : houses).push({ x, z, a: a + (rnd() - 0.5) * 0.06, zone: zone.id })
                }
            }
        }

        // Houses: body + pitched roof (or flat roof) — two instanced meshes
        const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
        const roofShape = new THREE.Shape()
        roofShape.moveTo(-0.5, 0)
        roofShape.lineTo(0.5, 0)
        roofShape.lineTo(0, 1)
        roofShape.closePath()
        const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5)
        roofGeo.computeVertexNormals()

        const bodyMesh = new THREE.InstancedMesh(body, stylize(sharedMaterial('city:body', { color: '#FFFFFF', roughness: 0.95 }), { ao: 0.35, aoHeight: 2.2, rim: 0.1 }), houses.length)
        const pitched = houses.filter(() => rnd() < 0.72)
        const roofMesh = new THREE.InstancedMesh(roofGeo, stylize(sharedMaterial('city:roof', { color: '#FFFFFF', roughness: 0.85 }), { ao: 0, rim: 0.12 }), houses.length)
        const walls = Object.values(HOUSE_SCHEMES).map((s) => new THREE.Color(s.wall))
        walls.push(new THREE.Color('#F4F2ED'), new THREE.Color('#F4F2ED'))
        const roofs = ['#BE6B4E', '#C77656', '#B5634A', '#C98466', '#A9604A'].map((c) => new THREE.Color(c))
        const flatRoof = new THREE.Color('#E4DDD2')

        const m = new THREE.Matrix4()
        const q = new THREE.Quaternion()
        const sc = new THREE.Vector3()
        const p = new THREE.Vector3()
        const up = new THREE.Vector3(0, 1, 0)
        const pitchedSet = new Set(pitched)
        let r = 0
        houses.forEach((h, i) => {
            const w = 2.3 + rnd() * 0.6
            const d = 2.5 + rnd() * 0.6
            const ht = h.zone === 'oriente' ? 1.5 + rnd() * 0.6 : 1.7 + rnd() * 1.0
            q.setFromAxisAngle(up, -h.a)
            m.compose(p.set(h.x, 0, h.z), q, sc.set(w, ht, d))
            bodyMesh.setMatrixAt(i, m)
            bodyMesh.setColorAt(i, pick(walls))
            if (pitchedSet.has(h)) {
                m.compose(p.set(h.x, ht, h.z), q, sc.set(w * 1.12, 0.9 + rnd() * 0.3, d * 1.08))
                roofMesh.setMatrixAt(r, m)
                roofMesh.setColorAt(r, pick(roofs))
                r++
            } else {
                // flat roof: a thin slab
                m.compose(p.set(h.x, ht, h.z), q, sc.set(w * 1.04, 0.05, d * 1.04))
                roofMesh.setMatrixAt(r, m)
                roofMesh.setColorAt(r, flatRoof)
                r++
            }
        })
        roofMesh.count = r
        for (const im of [bodyMesh, roofMesh]) {
            im.castShadow = true
            im.receiveShadow = true
            im.instanceMatrix.needsUpdate = true
            if (im.instanceColor) im.instanceColor.needsUpdate = true
            im.computeBoundingSphere()
            this.group.add(im)
        }

        // Towers
        const bandTex = canvasTexture(64, 256, (ctx, w, h) => {
            ctx.fillStyle = '#FFFFFF'
            ctx.fillRect(0, 0, w, h)
            ctx.fillStyle = 'rgba(80,100,120,0.32)'
            for (let k = 0; k < 10; k++) ctx.fillRect(0, k * (h / 10) + 6, w, h / 10 - 12)
        })
        const towerMesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
            stylize(sharedMaterial('city:tower', { color: '#FFFFFF', map: bandTex, roughness: 0.75 }), { ao: 0.3, aoHeight: 8, rim: 0.12 }),
            towers.length
        )
        const towerColors = ['#F1F0EC', '#E6E8EA', '#DDE3E8', '#ECE6DC'].map((c) => new THREE.Color(c))
        towers.forEach((t, i) => {
            const w = 4 + rnd() * 2.5
            const ht = 8 + rnd() * 16 * (t.zone === 'centro' ? 1.2 : 0.8)
            q.setFromAxisAngle(up, -t.a)
            m.compose(p.set(t.x, 0, t.z), q, sc.set(w, ht, w * (0.8 + rnd() * 0.4)))
            towerMesh.setMatrixAt(i, m)
            towerMesh.setColorAt(i, pick(towerColors))
        })
        towerMesh.castShadow = true
        towerMesh.receiveShadow = true
        towerMesh.computeBoundingSphere()
        this.group.add(towerMesh)

        this.stats = { houses: houses.length, towers: towers.length }
    }

    /* ---------------- vegetation ---------------- */

    #vegetation() {
        const trees = []
        const palms = []

        // Forest on the western hills
        for (let i = 0; i < 2600 && trees.length < 760; i++) {
            const x = -250 + rnd() * 165
            const z = -260 + rnd() * 520
            const mf = mountainFactor(x, z)
            if (mf < 0.15 || rnd() > mf * 0.95) continue
            if (Math.hypot(x + 132, z - 10) < 7 || Math.hypot(x + 116, z + 72) < 7) continue
            trees.push({ x, z, y: heightAt(x, z), s: 2.1 + rnd() * 1.4, dark: true })
        }
        // River banks
        for (const r of this.riverSamples.slice(0, 2)) {
            r.samples.forEach((p, i) => {
                if (i % 2) return
                const next = r.samples[Math.min(i + 1, r.samples.length - 1)]
                const dx = next.x - p.x, dz = next.z - p.z
                const l = Math.hypot(dx, dz) || 1
                for (const side of [-1, 1]) {
                    if (rnd() < 0.35) continue
                    const off = r.clear + 0.8 + rnd() * 1.5
                    const x = p.x + (-dz / l) * off * side
                    const z = p.z + (dx / l) * off * side
                    if (mountainFactor(x, z) > 0.1) continue
                    trees.push({ x, z, y: heightAt(x, z), s: 1.3 + rnd() * 0.7 })
                }
            })
        }
        // Parks
        for (const p of this.parks) {
            const n = Math.round(p.r * 1.4)
            for (let i = 0; i < n; i++) {
                const a = rnd() * Math.PI * 2
                const rr = Math.sqrt(rnd()) * (p.r - 1.5)
                trees.push({ x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr, y: 0, s: 1.3 + rnd() * 0.8 })
            }
        }
        // Scattered street trees + countryside
        for (let i = 0; i < 4000 && trees.length < 1450; i++) {
            const x = -90 + rnd() * 330
            const z = -200 + rnd() * 400
            const u = urbanMask(x, z)
            if (mountainFactor(x, z) > 0.05) continue
            if (u > 0.5 && rnd() > 0.32) continue
            if (u > 0.2 && !this.#isFree(x, z, -1.2)) continue
            if (u <= 0.2 && rnd() > 0.5) continue
            trees.push({ x, z, y: 0, s: 1.2 + rnd() * 0.9 })
        }
        // Palms along the avenues (a Cali signature)
        this.roadSamples.forEach((samples) => {
            samples.forEach((p, i) => {
                if (i % 4) return
                if (urbanMask(p.x, p.z) < 0.6) return
                const next = samples[Math.min(i + 1, samples.length - 1)]
                const dx = next.x - p.x, dz = next.z - p.z
                const l = Math.hypot(dx, dz) || 1
                const side = i % 8 ? 1 : -1
                palms.push({ x: p.x + (-dz / l) * 2.4 * side, z: p.z + (dx / l) * 2.4 * side, s: 1.1 + rnd() * 0.3 })
            })
        })

        const canopy = new THREE.InstancedMesh(canopyGeometry(0), stylize(sharedMaterial('city:leaf', { color: '#FFFFFF', roughness: 0.95 }), { ao: 0.4, aoHeight: 2.4, rim: 0.18, sway: 0.12 }), trees.length)
        const trunk = new THREE.InstancedMesh(trunkGeometry(), sharedMaterial('city:trunk', { color: WORLD.trunk, roughness: 1 }), trees.length)
        const leafColors = WORLD.leaf.map((c) => new THREE.Color(c))
        const darkLeaf = ['#6B8A5C', '#62805A', '#75925F'].map((c) => new THREE.Color(c))
        const m = new THREE.Matrix4()
        const q = new THREE.Quaternion()
        const sc = new THREE.Vector3()
        const p = new THREE.Vector3()
        const e = new THREE.Euler()
        trees.forEach((t, i) => {
            q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0))
            m.compose(p.set(t.x, t.y + t.s * 0.9, t.z), q, sc.set(t.s, t.s * (0.9 + rnd() * 0.25), t.s))
            canopy.setMatrixAt(i, m)
            canopy.setColorAt(i, pick(t.dark ? darkLeaf : leafColors))
            m.compose(p.set(t.x, t.y - 0.2, t.z), q, sc.set(t.s, t.s * 0.95, t.s))
            trunk.setMatrixAt(i, m)
        })

        const palmMesh = new THREE.InstancedMesh(palmGeometry(), stylize(sharedMaterial('city:palm', { vertexColors: true, roughness: 0.95 }), { sway: 0.06 }), palms.length)
        palms.forEach((t, i) => {
            q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0))
            m.compose(p.set(t.x, 0, t.z), q, sc.set(t.s, t.s * 1.15, t.s))
            palmMesh.setMatrixAt(i, m)
        })

        for (const im of [canopy, trunk, palmMesh]) {
            im.castShadow = true
            im.receiveShadow = im !== canopy
            im.computeBoundingSphere()
            this.group.add(im)
        }
    }

    /* ---------------- humanitarian points ---------------- */

    #aidPoints() {
        this.aidRings = []
        const ringMat = new THREE.MeshBasicMaterial({
            color: '#F5333F',
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            alphaMap: canvasTexture(128, 128, (ctx, w) => {
                const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
                g.addColorStop(0, 'rgba(255,255,255,0.25)')
                g.addColorStop(0.62, 'rgba(255,255,255,0.18)')
                g.addColorStop(0.8, 'rgba(255,255,255,1)')
                g.addColorStop(0.9, 'rgba(255,255,255,0.2)')
                g.addColorStop(1, 'rgba(255,255,255,0)')
                ctx.fillStyle = g
                ctx.fillRect(0, 0, w, w)
            }, { srgb: false }),
        })
        const canvas = sharedMaterial('aid:tent', { color: '#F7F6F2', roughness: 0.8 })
        const flagMat = new THREE.MeshStandardMaterial({ map: crossTexture({ scale: 0.6 }), roughness: 0.8, side: THREE.DoubleSide })
        const tentShape = new THREE.Shape()
        tentShape.moveTo(-1.6, 0)
        tentShape.lineTo(1.6, 0)
        tentShape.lineTo(0, 2.2)
        tentShape.closePath()
        const tentGeo = new THREE.ExtrudeGeometry(tentShape, { depth: 3.4, bevelEnabled: false }).translate(0, 0, -1.7)

        for (const zone of ZONES) {
            const [x, z] = zone.label
            const g = new THREE.Group()
            const ring = new THREE.Mesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), ringMat)
            ring.position.y = 0.8
            ring.renderOrder = 4
            ring.userData.phase = rnd() * 6
            this.aidRings.push(ring)
            const tent = new THREE.Mesh(tentGeo, canvas)
            tent.castShadow = true
            tent.position.set(-1.2, 0.2, 0)
            tent.rotation.y = 0.4
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.6, 6), sharedMaterial('aid:pole', { color: '#3B4552' }))
            pole.position.set(2.2, 2.3, 0.6)
            const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), flagMat)
            flag.position.set(3.1, 3.9, 0.6)
            g.add(ring, tent, pole, flag)
            g.position.set(x, 0, z)
            this.group.add(g)
        }
    }
}
