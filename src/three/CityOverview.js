import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ZONES } from '../data/zones.js'
import { WORLD, HOUSE_SCHEMES, sharedMaterial } from './materials.js'
import { canopyGeometry, trunkGeometry, palmGeometry } from './procedural/nature.js'
import { canvasTexture, crossTexture } from './procedural/textures.js'
import { stylize, stylizeWater } from './stylize.js'
import { buildCityCues } from './ThemeCues.js'
import * as props from './props.js'

/**
 * An abstracted, readable Cali: Farallones hills to the west with Cristo Rey
 * and Tres Cruces on their summits, the Río Cauca to the east,
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

/**
 * Only the Río Cauca, along the eastern edge. The rivers that used to cross
 * the city did not follow their real courses and made the map harder to read.
 */
const RIVERS = [
    {
        id: 'cauca',
        width: 10,
        clear: 12,
        points: [[150, -460], [160, -300], [150, -170], [162, -70], [152, 30], [166, 130], [152, 250], [162, 460]],
    },
]

/** The highest ground within `radius` of (x0, z0): where a landmark on a hill belongs. */
function summit(x0, z0, radius) {
    let best = { x: x0, z: z0, y: heightAt(x0, z0) }
    for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
            if (dx * dx + dz * dz > radius * radius) continue
            const y = heightAt(x0 + dx, z0 + dz)
            if (y > best.y) best = { x: x0 + dx, z: z0 + dz, y }
        }
    }
    return best
}
const CRISTO_REY = summit(-132, 10, 20)
const TRES_CRUCES = summit(-116, -72, 20)

/**
 * The focus mask around a zone in play: how far past its outline it keeps its
 * full colour (so the glowing border itself is never dimmed), and how many
 * metres the shade takes to fade in. Only the rest of the city is shaded;
 * hills, river and fields stay as they are.
 */
const FOCUS_EDGE = 5
const FOCUS_FEATHER = 6

/**
 * The light the zone in play gives off along its border: a low band in the
 * zone's own marker colour, so the border and the marker read as one thing.
 */
const BORDER_LIGHT_HEIGHT = 1.2

const ROADS = [
    [[-86, 44], [-50, 38], [-10, 32], [30, 34], [70, 44], [128, 62]], // Calle 5 / Autopista Sur
    [[2, -14], [8, -50], [18, -88], [30, -128]], // Avenida 3 Norte
    [[46, 122], [62, 60], [70, 4], [62, -56], [44, -112]], // Autopista Simón Bolívar / Oriental
    [[-80, -64], [-72, -22], [-74, 26], [-62, 84]], // Circunvalar
    [[-30, 10], [12, 4], [52, -2], [118, -18]], // Calle 25
]

/** Open green squares on the map. */
const PARKS = [
    { x: 52, z: 72, r: 12 },
    { x: -46, z: 20, r: 8 },
    { x: 40, z: -70, r: 9 },
    { x: 100, z: 40, r: 9 },
    { x: 6, z: -2, r: 5 }, // plaza
]
/** Landmarks with the ground they stand on: La Ermita, Torre de Cali, Estadio Pascual Guerrero. */
const LANDMARK_GROUNDS = [
    { x: -8, z: -6, r: 9 },
    { x: 24, z: -12, r: 7 },
    { x: -26, z: 58, r: 17 },
]
/**
 * What an avenue must go round and never cross: the parks, the landmarks and
 * each zone's aid point.
 */
const ROAD_HALF_WIDTH = 1.3
const ROAD_KEEP_OUT = mergeKeepOut([...PARKS, ...LANDMARK_GROUNDS, ...ZONES.map((z) => ({ x: z.label[0], z: z.label[1], r: 7 }))])

/**
 * Places too close for a road to pass between them (the plaza and the centre's
 * aid point) become one circle round both, so the road goes round the pair
 * instead of being pushed from one into the other.
 */
function mergeKeepOut(list) {
    const out = list.map((c) => ({ ...c }))
    for (let merged = true; merged; ) {
        merged = false
        for (let i = 0; i < out.length && !merged; i++) {
            for (let j = i + 1; j < out.length && !merged; j++) {
                const a = out[i], b = out[j]
                const d = Math.hypot(b.x - a.x, b.z - a.z)
                if (d >= a.r + b.r + 2 * (ROAD_HALF_WIDTH + 1) + 2) continue
                // the smallest circle holding both
                const r = Math.max(a.r, b.r, (d + a.r + b.r) / 2)
                const k = d > 1e-6 ? (r - a.r) / d : 0
                out[i] = r === a.r ? a : r === b.r ? b : { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, r }
                out.splice(j, 1)
                merged = true
            }
        }
    }
    return out
}

/**
 * Bend a road round the places it must not cross. Where it would enter one,
 * the stretch inside is laid on a half circle round its edge (on the side the
 * road already passes), with a metre to spare; then the line is relaxed so the
 * detour reads as a gentle curve, and laid out again at even spacing.
 */
function detour(samples, keepOut = ROAD_KEEP_OUT) {
    let pts = samples.map((p) => new THREE.Vector3(p.x, 0, p.z))
    const clearOf = (o) => o.r + ROAD_HALF_WIDTH + 1
    const bend = () => {
        for (const o of keepOut) {
            const R = clearOf(o)
            let bi = -1
            let bd = Infinity
            pts.forEach((p, i) => {
                const d = Math.hypot(p.x - o.x, p.z - o.z)
                if (d < bd) {
                    bd = d
                    bi = i
                }
            })
            if (bd >= R) continue
            const a = pts[Math.max(bi - 2, 0)]
            const b = pts[Math.min(bi + 2, pts.length - 1)]
            let ux = b.x - a.x, uz = b.z - a.z
            const l = Math.hypot(ux, uz) || 1
            ux /= l
            uz /= l
            let vx = -uz, vz = ux
            if ((pts[bi].x - o.x) * vx + (pts[bi].z - o.z) * vz < 0) {
                vx = -vx
                vz = -vz
            }
            for (const p of pts) {
                const dx = p.x - o.x, dz = p.z - o.z
                if (Math.hypot(dx, dz) >= R) continue
                const along = Math.max(-R, Math.min(R, dx * ux + dz * uz))
                const side = Math.sqrt(Math.max(0, R * R - along * along))
                p.x = o.x + ux * along + vx * side
                p.z = o.z + uz * along + vz * side
            }
        }
    }
    const push = () => {
        for (const p of pts) {
            for (const o of keepOut) {
                const R = clearOf(o)
                const dx = p.x - o.x, dz = p.z - o.z
                const d = Math.hypot(dx, dz)
                if (d < R && d > 1e-4) {
                    p.x = o.x + (dx / d) * R
                    p.z = o.z + (dz / d) * R
                }
            }
        }
    }
    bend()
    for (let k = 0; k < 6; k++) {
        pts = pts.map((p, i) =>
            i === 0 || i === pts.length - 1 ? p.clone() : new THREE.Vector3((pts[i - 1].x + p.x * 2 + pts[i + 1].x) / 4, 0, (pts[i - 1].z + p.z * 2 + pts[i + 1].z) / 4)
        )
        push()
    }
    return sampleCurve(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 2)
}

function curveFrom(points, y = 0) {
    return new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal')
}

function sampleCurve(curve, spacing) {
    const n = Math.max(2, Math.ceil(curve.getLength() / spacing))
    return curve.getSpacedPoints(n)
}

/** One pass of a box blur over a square grid of size S, along rows or columns. */
function boxBlur(src, S, r, horizontal) {
    const out = new Float32Array(src.length)
    const n = 2 * r + 1
    for (let line = 0; line < S; line++) {
        const at = horizontal ? (i) => line * S + i : (i) => i * S + line
        let sum = 0
        for (let i = -r; i <= r; i++) sum += src[at(Math.min(S - 1, Math.max(0, i)))]
        for (let i = 0; i < S; i++) {
            out[at(i)] = sum / n
            sum += src[at(Math.min(S - 1, i + r + 1))] - src[at(Math.max(0, i - r))]
        }
    }
    return out
}

/** Upright band standing on a closed outline: v runs from the ground (0) to the top (1). */
function wallGeometry(points, height, y = 0) {
    const pos = []
    const uv = []
    const idx = []
    const n = points.length
    let acc = 0
    for (let i = 0; i < n; i++) {
        const p = points[i]
        if (i > 0) acc += p.distanceTo(points[i - 1])
        pos.push(p.x, y, p.z, p.x, y + height, p.z)
        uv.push(acc, 0, acc, 1)
    }
    for (let i = 0; i < n; i++) {
        const a = i * 2, b = ((i + 1) % n) * 2
        idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    return g
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
        this.focusZone = null
        this.focusAmount = 0
        this.focusMask = null
        this.masks = new Map()
        this.exclusions = []
        this.aidRings = []
        this.ready = false
        this.riverScale = theme?.cues.city.includes('highRiver') ? 1.3 : 1
        this.riverSamples = RIVERS.map((r) => ({ ...r, width: r.width * this.riverScale, samples: sampleCurve(curveFrom(r.points), 2) }))
        // the avenues bend round parks, landmarks and aid points instead of running over them
        this.roadSamples = ROADS.map((pts) => detour(sampleCurve(curveFrom(pts), 2)))
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

    /** Where a zone sits and how far it reaches on the ground, for framing it. */
    zoneFrame(zoneId) {
        const z = this.zones.get(zoneId)
        if (!z) return { center: this.focusPoint(zoneId), radius: 60 }
        if (!z.frame) {
            const center = new THREE.Vector3()
            for (const p of z.pts) center.add(p)
            center.divideScalar(z.pts.length)
            let radius = 0
            for (const p of z.pts) radius = Math.max(radius, p.distanceTo(center))
            z.frame = { center, radius }
        }
        return z.frame
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

    /**
     * A collection point only answers for its own zone. That zone keeps its
     * colour and its light; the rest of the city goes out of focus so there is
     * no question about where the work is. The shade itself is drawn by the
     * stage, from `focusMask` and `focusAmount`.
     */
    setFocusZone(id) {
        this.focusZone = id ?? null
    }

    update(dt, t) {
        const focus = this.focusZone
        const k = 1 - Math.exp(-dt * 5)
        if (focus && this.focusMask?.id !== focus && this.zones.has(focus)) this.focusMask = this.#focusMask(focus)
        // the last mask stays while the shade eases out, so it never snaps away
        this.focusAmount = lerp(this.focusAmount, focus && this.focusMask ? 1 : 0, k)
        for (const [id, z] of this.zones) {
            const isSel = id === this.selected
            const isHover = id === this.hovered && !isSel
            const veiled = focus && id !== focus
            const lit = focus && id === focus

            let fillTarget = isSel ? 0.26 : isHover ? 0.14 : 0
            let lineTarget = isSel ? 1 : this.selected ? 0.12 : isHover ? 0.5 : 0.26
            let glowTarget = isSel ? 0.55 : 0
            if (veiled) {
                fillTarget = 0
                lineTarget = 0.06
                glowTarget = 0
            } else if (lit) {
                fillTarget = 0.1
                lineTarget = 1
                glowTarget = 0.7
            }

            z.fill.material.opacity = lerp(z.fill.material.opacity, fillTarget, k)
            z.line.material.opacity = lerp(z.line.material.opacity, lineTarget, k)
            z.glow.material.opacity = lerp(z.glow.material.opacity, glowTarget, k)
            z.line.material.color.lerp(lit ? z.colour : isSel ? this._red : this._navy, k)
            if (lit) z.glow.material.color.lerp(z.colour, k)
            z.fill.visible = z.fill.material.opacity > 0.005
            z.glow.visible = z.glow.material.opacity > 0.005

            // the zone in play gives off light: a band rising from its border and a
            // wide halo on the ground, both breathing very slowly
            const pulse = 0.85 + 0.15 * Math.sin(t * 1.6)
            z.light = lerp(z.light, lit ? 1 : 0, k)
            z.wall.material.opacity = z.light * 0.75 * pulse
            z.halo.material.opacity = z.light * 0.35 * pulse
            z.wall.visible = z.halo.visible = z.light > 0.005
        }
        this.cueUpdate?.(dt)
        // Aid points breathe very slowly
        for (const m of this.aidRings) {
            const s = 1 + 0.08 * Math.sin(t * 1.2 + m.userData.phase)
            m.scale.set(s, s, s)
        }
    }

    /**
     * A top-down picture of where the focus shade goes: 1 over the rest of the
     * city, 0 over the zone in play and over everything outside the city, with
     * edges that soften over a few metres so the shade fades in, not cuts in.
     */
    #focusMask(id) {
        if (this.masks.has(id)) return this.masks.get(id)
        const pad = FOCUS_EDGE + FOCUS_FEATHER * 3
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
        for (const { pts } of this.zones.values()) {
            for (const p of pts) {
                minX = Math.min(minX, p.x)
                maxX = Math.max(maxX, p.x)
                minZ = Math.min(minZ, p.z)
                maxZ = Math.max(maxZ, p.z)
            }
        }
        minX -= pad
        minZ -= pad
        const sizeX = maxX + pad - minX
        const sizeZ = maxZ + pad - minZ
        const S = 384
        const sx = S / sizeX, sz = S / sizeZ
        const ppm = Math.min(sx, sz)

        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = S
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.fillStyle = ctx.strokeStyle = '#FFFFFF'
        ctx.lineJoin = 'round'
        const outline = (pts) => {
            ctx.beginPath()
            pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo']((p.x - minX) * sx, (p.z - minZ) * sz))
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        // the other zones, slightly overdrawn so the seams between them close up
        ctx.lineWidth = 3 * ppm
        for (const [zid, { pts }] of this.zones) if (zid !== id) outline(pts)
        // then the zone in play is cut out, a little wider than its outline
        ctx.globalCompositeOperation = 'destination-out'
        ctx.lineWidth = FOCUS_EDGE * 2 * ppm
        outline(this.zones.get(id).pts)

        const px = ctx.getImageData(0, 0, S, S).data
        let a = new Float32Array(S * S)
        for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3] / 255
        // three box passes each way come out close to a gaussian
        const r = Math.max(1, Math.round((FOCUS_FEATHER / 2) * ppm))
        for (let i = 0; i < 3; i++) a = boxBlur(boxBlur(a, S, r, true), S, r, false)
        const data = new Uint8Array(S * S)
        for (let i = 0; i < a.length; i++) data[i] = Math.round(a[i] * 255)

        const texture = new THREE.DataTexture(data, S, S, THREE.RedFormat)
        texture.minFilter = texture.magFilter = THREE.LinearFilter
        texture.needsUpdate = true
        const mask = { id, texture, bounds: new THREE.Vector4(minX, minZ, sizeX, sizeZ) }
        this.masks.set(id, mask)
        return mask
    }

    #zones() {
        this._red = new THREE.Color('#F5333F')
        this._navy = new THREE.Color('#011E41')
        this._white = new THREE.Color('#FFFFFF')
        // bright at the ground, gone by the top
        const riseTex = canvasTexture(4, 64, (ctx, w, h) => {
            const g = ctx.createLinearGradient(0, h, 0, 0)
            g.addColorStop(0, 'rgba(255,255,255,1)')
            g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
            g.addColorStop(1, 'rgba(255,255,255,0)')
            ctx.fillStyle = g
            ctx.fillRect(0, 0, w, h)
        })
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
                ribbonGeometry(pts, 0.5, 0.7, true),
                new THREE.MeshBasicMaterial({ color: '#011E41', transparent: true, opacity: 0.26, depthWrite: false })
            )
            line.renderOrder = 3
            const glow = new THREE.Mesh(
                ribbonGeometry(pts, 2.6, 0.65, true),
                new THREE.MeshBasicMaterial({ color: '#F5333F', alphaMap: glowTex, transparent: true, opacity: 0, depthWrite: false })
            )
            glow.renderOrder = 3

            // plain (not additive) blending: added onto the pale ground the colour
            // washed out to a light yellow that no longer matched the marker
            const light = { color: zone.color, transparent: true, opacity: 0, depthWrite: false, fog: false }
            const wall = new THREE.Mesh(
                wallGeometry(pts, BORDER_LIGHT_HEIGHT, 0.6),
                new THREE.MeshBasicMaterial({ ...light, alphaMap: riseTex, side: THREE.DoubleSide })
            )
            wall.renderOrder = 5
            wall.visible = false
            const halo = new THREE.Mesh(ribbonGeometry(pts, 5, 0.62, true), new THREE.MeshBasicMaterial({ ...light, alphaMap: glowTex }))
            halo.renderOrder = 3
            halo.visible = false

            this.group.add(fill, glow, line, halo, wall)
            this.zones.set(zone.id, { zone, fill, line, glow, halo, wall, light: 0, pts, colour: new THREE.Color(zone.color) })
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
        // Cristo Rey on the summit of its hill, arms open toward the city
        {
            const { x, z, y } = CRISTO_REY
            const g = props.cristoRey()
            g.position.set(x, y - 0.4, z)
            g.rotation.y = Math.atan2(CITY_C.x - x, CITY_C.y - z)
            g.scale.setScalar(1.6)
            this.group.add(g)
        }
        // Tres Cruces on the summit, turned so the row is seen front-on from the map
        {
            const { x, z, y } = TRES_CRUCES
            const g = props.tresCruces()
            g.position.set(x, y - 0.3, z)
            g.rotation.y = Math.atan2(CITY_C.x + 40 - x, CITY_C.y + 250 - z)
            this.group.add(g)
        }
        // La Ermita — small white gothic church
        {
            const g = props.ermita()
            g.position.set(-8, 0, -6)
            g.rotation.y = 0.35
            this.group.add(g)
            this.exclusions.push({ x: -8, z: -6, r: 9 })
        }
        // Torre de Cali
        {
            const g = props.torreDeCali()
            g.position.set(24, 0, -12)
            g.rotation.y = 0.22
            this.group.add(g)
            this.exclusions.push({ x: 24, z: -12, r: 7 })
        }
        // Estadio Pascual Guerrero
        {
            const g = props.estadio()
            g.position.set(-26, 0, 58)
            g.rotation.y = 0.3
            this.group.add(g)
            this.exclusions.push({ x: -26, z: 58, r: 17 })
        }
        // Keep each zone's aid point clear of buildings
        for (const zone of ZONES) this.exclusions.push({ x: zone.label[0], z: zone.label[1], r: 7 })

        // Parks (open green squares)
        this.parks = PARKS.map((p) => ({ ...p }))
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

    /** True when (x, z) is within `margin` metres of an avenue's centre line. */
    #onRoad(x, z, margin) {
        return this.roadSamples.some((s) => distToSamples(x, z, s) < margin)
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
        const { body, roof: roofGeo } = props.cityBlockGeometries()

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

        // Forest on the western hills. This is where Cali's green belongs, so the
        // Farallones carry most of the vegetation in the whole map.
        const FOREST = 3400
        for (let i = 0; i < 26000 && trees.length < FOREST; i++) {
            const x = -235 + rnd() * 162
            const z = -300 + rnd() * 600
            const mf = mountainFactor(x, z)
            if (mf < 0.035) continue
            if (rnd() > 0.52 + mf * 0.48) continue
            if (Math.hypot(x - CRISTO_REY.x, z - CRISTO_REY.z) < 10 || Math.hypot(x - TRES_CRUCES.x, z - TRES_CRUCES.z) < 16) continue
            if (this.#onRoad(x, z, 3.2)) continue
            trees.push({ x, z, y: heightAt(x, z), s: 1.8 + rnd() * 1.7, dark: true })
        }
        // The river keeps its own banks clear: open water reads better from above
        const forestCount = trees.length
        // Parks
        for (const p of this.parks) {
            const n = Math.round(p.r * 1.4)
            for (let i = 0; i < n; i++) {
                const a = rnd() * Math.PI * 2
                const rr = Math.sqrt(rnd()) * (p.r - 1.5)
                trees.push({ x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr, y: 0, s: 1.3 + rnd() * 0.8 })
            }
        }
        // Scattered street trees + countryside, a thin layer on top of the forest
        for (let i = 0; i < 4000 && trees.length < forestCount + 620; i++) {
            const x = -90 + rnd() * 330
            const z = -200 + rnd() * 400
            const u = urbanMask(x, z)
            if (mountainFactor(x, z) > 0.05) continue
            if (this.riverSamples.some((r) => distToSamples(x, z, r.samples) < r.clear + 6)) continue
            if (u > 0.5 && rnd() > 0.32) continue
            if (u > 0.2 && !this.#isFree(x, z, -1.2)) continue
            if (u <= 0.2 && rnd() > 0.5) continue
            if (this.#onRoad(x, z, 2.8)) continue
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

        const leafMat = () => stylize(sharedMaterial('city:leaf', { color: '#FFFFFF', roughness: 0.95 }), { ao: 0.4, aoHeight: 2.4, rim: 0.18, sway: 0.12 })
        const trunkMat = () => sharedMaterial('city:trunk', { color: WORLD.trunk, roughness: 1 })
        const leafColors = WORLD.leaf.map((c) => new THREE.Color(c))
        const darkLeaf = ['#6B8A5C', '#62805A', '#75925F'].map((c) => new THREE.Color(c))
        const m = new THREE.Matrix4()
        const q = new THREE.Quaternion()
        const sc = new THREE.Vector3()
        const p = new THREE.Vector3()
        const e = new THREE.Euler()

        /**
         * The same tree in two batches. The hillside forest is scenery on the
         * horizon and skips the shadow pass, which is what lets the Farallones
         * carry a forest several times denser than the city's own trees.
         */
        const batch = (list, shadows) => {
            if (!list.length) return []
            const canopy = new THREE.InstancedMesh(canopyGeometry(0), leafMat(), list.length)
            const trunk = new THREE.InstancedMesh(trunkGeometry(), trunkMat(), list.length)
            list.forEach((t, i) => {
                q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0))
                m.compose(p.set(t.x, t.y + t.s * 0.9, t.z), q, sc.set(t.s, t.s * (0.9 + rnd() * 0.25), t.s))
                canopy.setMatrixAt(i, m)
                canopy.setColorAt(i, pick(t.dark ? darkLeaf : leafColors))
                m.compose(p.set(t.x, t.y - 0.2, t.z), q, sc.set(t.s, t.s * 0.95, t.s))
                trunk.setMatrixAt(i, m)
            })
            canopy.castShadow = shadows
            trunk.castShadow = shadows
            trunk.receiveShadow = shadows
            return [canopy, trunk]
        }

        const meshes = [...batch(trees.slice(0, forestCount), false), ...batch(trees.slice(forestCount), true)]

        const palmMesh = new THREE.InstancedMesh(palmGeometry(), stylize(sharedMaterial('city:palm', { vertexColors: true, roughness: 0.95 }), { sway: 0.06 }), palms.length)
        palms.forEach((t, i) => {
            q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0))
            m.compose(p.set(t.x, 0, t.z), q, sc.set(t.s, t.s * 1.15, t.s))
            palmMesh.setMatrixAt(i, m)
        })
        palmMesh.castShadow = true
        palmMesh.receiveShadow = true
        meshes.push(palmMesh)

        for (const im of meshes) {
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
        for (const zone of ZONES) {
            const [x, z] = zone.label
            const g = props.aidPoint()
            const ring = new THREE.Mesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), ringMat)
            ring.position.y = 0.8
            ring.renderOrder = 4
            ring.userData.phase = rnd() * 6
            this.aidRings.push(ring)
            g.add(ring)
            g.position.set(x, 0, z)
            this.group.add(g)
        }
    }
}
