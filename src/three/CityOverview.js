import * as THREE from 'three'
import gsap from 'gsap'
import { COLLECTION_POINTS } from '../data/collectionPoints.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ZONES } from '../data/zones.js'
import { CALI_ZONES, CALI_FRAME } from '../data/caliMap.js'
import { AVENUES, STREETS } from '../data/caliRoads.js'
import { WORLD, HOUSE_SCHEMES, sharedMaterial } from './materials.js'
import { canopyGeometry, trunkGeometry, palmGeometry } from './procedural/nature.js'
import { canvasTexture, crossTexture } from './procedural/textures.js'
import { stylize, stylizeWater, stylizeRiver } from './stylize.js'
import { buildCityCues } from './ThemeCues.js'
import * as props from './props.js'
import { PHONE } from './Stage.js'

/** Live map colours: a donation on its way, in the point, handed out; a transfer. */
const LIVE_COLOURS = { aporte: '#F5333F', recibido: '#1F8A4C', entregado: '#E39B1B', traslado: '#1E6FD9', 'traslado-recibido': '#1E6FD9' }
const LIVE_RING = new THREE.RingGeometry(0.86, 1, 72).rotateX(-Math.PI / 2)
const LIVE_DOT = new THREE.SphereGeometry(2.6, 20, 14)

/**
 * An abstracted, readable Cali: Farallones hills to the west with Cristo Rey
 * and Tres Cruces on their summits, the Río Cauca to the east,
 * a few main avenues, low-rise blocks, and five territorial zones.
 * Not a digital twin — a calm miniature.
 */

/* ---------------- deterministic helpers ---------------- */
let seed = 1234567
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

/** The barrio houses each zone of the map is built with (light copies, see useHouseModels). */
const MAP_HOUSES = {
    oriente: ['house-estrato2', 'house-zinc', 'house-tile', 'house-estrato2', 'house-zinc'],
    sur: ['house-tile', 'house-estrato2', 'house-estrato3', 'house-two-story', 'house-zinc'],
    centro: ['house-two-story', 'house-estrato3', 'house-tile', 'house-estrato4'],
    norte: ['house-estrato4', 'house-estrato5', 'house-two-story', 'house-estrato3'],
    oeste: ['house-estrato5', 'house-estrato4', 'house-estrato3', 'house-two-story'],
}
/** How wide a house is on the map (its lot is LOT wide). */
const MAP_LOT = 2.6

/** A steady number in [0, 1) for a lot, so the houses do not take from the city's random sequence. */
function lotHash(i, j, zone) {
    let h = 2166136261
    for (const c of `${i},${j},${zone}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
    return ((h >>> 0) % 100000) / 100000
}

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

/**
 * Cali drawn into a square grid a metre a side (see caliMap.js): `inside` is the city with
 * its edges softened over a few metres (what urbanMask reads), `zone` the zone of each cell
 * (an index into ZONES, -1 outside). Built once, the first time it is needed.
 */
const SHAPE = { x0: -180, z0: -180, size: 360 }
let shape = null
function caliShape() {
    if (shape) return shape
    const S = SHAPE.size
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(S, S) : Object.assign(document.createElement('canvas'), { width: S, height: S })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const F = CALI_FRAME
    const zone = new Int8Array(S * S).fill(-1)
    let inside = new Float32Array(S * S)
    ZONES.forEach((z, k) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, S, S)
        // drawing → map → grid
        ctx.setTransform(F.SCALE, 0, 0, F.SCALE, F.OX - F.X0 * F.SCALE - SHAPE.x0, F.OZ - F.Y0 * F.SCALE - SHAPE.z0)
        ctx.fillStyle = ctx.strokeStyle = '#fff'
        // a thin stroke too, so neighbouring zones meet without a seam
        ctx.lineWidth = 3
        for (const p of CALI_ZONES.filter((p) => p.zone === z.id)) {
            const path = new Path2D(p.d)
            ctx.fill(path)
            ctx.stroke(path)
        }
        const px = ctx.getImageData(0, 0, S, S).data
        for (let i = 0; i < S * S; i++) {
            const a = px[i * 4 + 3] / 255
            if (a > 0.5 && zone[i] < 0) zone[i] = k
            if (a > inside[i]) inside[i] = a
        }
    })
    // soft edges: the city thins out over some eight metres instead of stopping at a line
    for (let pass = 0; pass < 2; pass++) inside = boxBlur(boxBlur(inside, S, 4, true), S, 4, false)
    // the softened edge reaches a little past the drawn one: those cells take their neighbour's zone
    for (let pass = 0; pass < 8; pass++) {
        const next = zone.slice()
        for (let i = 0; i < S * S; i++) {
            if (zone[i] >= 0) continue
            const x = i % S
            const n = [x > 0 ? zone[i - 1] : -1, x < S - 1 ? zone[i + 1] : -1, i >= S ? zone[i - S] : -1, i < S * S - S ? zone[i + S] : -1].find((v) => v >= 0)
            if (n !== undefined) next[i] = n
        }
        zone.set(next)
    }
    shape = { inside, zone }
    return shape
}

/** The softened outline of Cali at (x, z): 1 well inside the city, 0 outside. */
function caliInside(x, z) {
    const { inside } = caliShape()
    const S = SHAPE.size
    const gx = x - SHAPE.x0 - 0.5, gz = z - SHAPE.z0 - 0.5
    const i = Math.floor(gx), j = Math.floor(gz)
    if (i < 0 || j < 0 || i >= S - 1 || j >= S - 1) return 0
    const fx = gx - i, fz = gz - j
    const at = (a, b) => inside[b * S + a]
    return lerp(lerp(at(i, j), at(i + 1, j), fx), lerp(at(i, j + 1), at(i + 1, j + 1), fx), fz)
}
const WEST_EDGE = (z) => -86 + 5 * Math.sin(z * 0.035 + 0.5)

function urbanMask(x, z) {
    // the city stops at the foot of the hills, whatever the drawing says
    const west = smooth(x, WEST_EDGE(z) - 2, WEST_EDGE(z) + 8)
    return smooth(caliInside(x, z), 0.08, 0.92) * west
}

function mountainFactor(x, z) {
    return smooth(-(x + 6 * Math.sin(z * 0.03)), 92, 150)
}

export function heightAt(x, z) {
    const m = mountainFactor(x, z)
    if (m <= 0) return 0
    let h = m * (52 + 20 * Math.sin(z * 0.022 + 1) + 10 * Math.sin(z * 0.061))
    h += m * (fbm(x * 0.035, z * 0.035) - 0.5) * 34
    h += 30 * Math.exp(-((x + 132) ** 2 + (z + 46) ** 2) / (2 * 15 ** 2)) // Cerro de Cristo Rey, west of the centre
    h += 22 * Math.exp(-((x + 116) ** 2 + (z + 104) ** 2) / (2 * 14 ** 2)) // Cerro de las Tres Cruces, to the north-west
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
        points: [[118, -460], [126, -300], [112, -170], [122, -70], [120, 30], [128, 130], [116, 250], [124, 460]],
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
const CRISTO_REY = summit(-132, -46, 20)
const TRES_CRUCES = summit(-116, -104, 20)

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

/**
 * The avenues and main streets are Cali's own (caliRoads.js). Between them each zone lays out
 * its blocks on its own street grid, turned the way the streets run there in Cali (measured
 * on OpenStreetMap): north–south in the centre, the west and the south, on the diagonal in
 * the north, at 45° in Aguablanca. Blocks are `bu` by `bv` from one street to the next,
 * counted from the zone's aid point.
 */
const ZONE_GRID = { centro: 0.087, norte: -0.305, oeste: 0.044, oriente: 0.785, sur: 0.044 }
const BLOCK = { bu: 15.6, bv: 12.6, reach: 17 }
const STREET_W = 1.7
const MAIN_STREET_W = 2
const AVENUE_W = 3
/** Pavement between the street and the first lot. */
const SIDEWALK = 0.5
/** How wide a lot is, at most: a block holds as many as fit. */
const LOT = 3
/** Yumbo, on the horizon to the north (where the same map puts it). */
const YUMBO = [44, -259]

/** A zone's grid: from (u, v), along and across its streets, to the map. */
function zoneGrid(id) {
    const zone = ZONES.find((z) => z.id === id)
    const a = ZONE_GRID[id], c = Math.cos(a), s = Math.sin(a)
    const [ox, oz] = zone.label
    return { angle: a, from: (u, v) => [ox + u * c - v * s, oz + u * s + v * c] }
}

/**
 * Clear ground round the Estadio Pascual Guerrero: the model is 36 long, so houses and
 * avenues keep a few metres of open space from it on every side.
 */
const STADIUM_CLEAR = 24

/** Open green squares on the map. */
const PARKS = [
    { x: -12, z: 84, r: 11 }, // the south
    { x: -60, z: 30, r: 8 }, // the west
    { x: 22, z: -92, r: 9 }, // the north
    { x: 76, z: 6, r: 9 }, // the east
    { x: -8, z: -40, r: 5 }, // Plaza de Caycedo, in the centre
]
/** Landmarks with the ground they stand on: La Ermita, Torre de Cali, Estadio Pascual Guerrero. */
const LANDMARK_GROUNDS = [
    { x: -20, z: -49, r: 9 }, // La Ermita
    { x: -31, z: -57, r: 7 }, // Torre de Cali, just west of it
    { x: -39, z: -19, r: STADIUM_CLEAR }, // Estadio Pascual Guerrero, in the north of Cañaveralejo
]
/** What a street stops short of: the parks, the landmarks and each zone's aid point. */
const STREET_KEEP_OUT = [...PARKS, ...LANDMARK_GROUNDS, ...ZONES.map((z) => ({ x: z.label[0], z: z.label[1], r: 6 }))]

/**
 * Cali's roads as lists of points, cut where they would climb into the hills, and (with
 * `inCity`) where they leave the city (or Yumbo): the avenues run on out to the horizon, the streets stop.
 */
function roadLines(list, inCity = false) {
    const out = []
    for (const flat of list) {
        let run = []
        for (let i = 0; i < flat.length; i += 2) {
            const x = flat[i], z = flat[i + 1]
            if (heightAt(x, z) > 0.2 || (inCity && urbanMask(x, z) < 0.3 && Math.hypot(x - YUMBO[0], z - YUMBO[1]) > 42)) {
                if (run.length > 1) out.push(run)
                run = []
            } else run.push({ x, z })
        }
        if (run.length > 1) out.push(run)
    }
    return out
}

/** A line laid out again with a point every `step` metres. */
function resample(pts, step) {
    const out = [pts[0]]
    let carry = 0
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        const L = Math.hypot(b.x - a.x, b.z - a.z)
        let t = step - carry
        for (; t <= L; t += step) out.push({ x: a.x + ((b.x - a.x) * t) / L, z: a.z + ((b.z - a.z) * t) / L })
        carry = L - (t - step)
    }
    return out
}

/** The grid the roads are measured on: a metre a side, wide enough to take in Yumbo. */
const ROADS_GRID = { x0: -160, z0: -310, w: 420, h: 620 }

/**
 * How far each cell of ROADS_GRID is from the nearest road (in metres, 0 on the road), given
 * the roads as [lines, width] pairs: drawn into a picture, then a chamfer distance pass.
 */
function roadDistance(sets) {
    const { w: W, h: H } = ROADS_GRID
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.setTransform(1, 0, 0, 1, -ROADS_GRID.x0, -ROADS_GRID.z0)
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.strokeStyle = '#fff'
    for (const [lines, width] of sets) {
        ctx.lineWidth = width
        for (const l of lines) {
            ctx.beginPath()
            l.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)))
            ctx.stroke()
        }
    }
    const px = ctx.getImageData(0, 0, W, H).data
    const d = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) d[i] = px[i * 4 + 3] > 127 ? 0 : 1e6
    const D = Math.SQRT2
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x
            let v = d[i]
            if (x > 0) v = Math.min(v, d[i - 1] + 1)
            if (y > 0) {
                v = Math.min(v, d[i - W] + 1)
                if (x > 0) v = Math.min(v, d[i - W - 1] + D)
                if (x < W - 1) v = Math.min(v, d[i - W + 1] + D)
            }
            d[i] = v
        }
    }
    for (let y = H - 1; y >= 0; y--) {
        for (let x = W - 1; x >= 0; x--) {
            const i = y * W + x
            let v = d[i]
            if (x < W - 1) v = Math.min(v, d[i + 1] + 1)
            if (y < H - 1) {
                v = Math.min(v, d[i + W] + 1)
                if (x < W - 1) v = Math.min(v, d[i + W + 1] + D)
                if (x > 0) v = Math.min(v, d[i + W - 1] + D)
            }
            d[i] = v
        }
    }
    return d
}

/** A distance from roadDistance at (x, z); far away outside its grid. */
function roadDistanceAt(d, x, z) {
    const i = Math.floor(x - ROADS_GRID.x0), j = Math.floor(z - ROADS_GRID.z0)
    if (i < 0 || j < 0 || i >= ROADS_GRID.w || j >= ROADS_GRID.h) return 1e6
    return d[j * ROADS_GRID.w + i]
}

/** The zone at (x, z), as Cali's MIO zones group into the app's five (see caliMap.js). */
function zoneIdAt(x, z) {
    if (urbanMask(x, z) < 0.5) return null
    const S = SHAPE.size
    const i = Math.round(x - SHAPE.x0 - 0.5), j = Math.round(z - SHAPE.z0 - 0.5)
    if (i < 0 || j < 0 || i >= S || j >= S) return null
    const k = caliShape().zone[j * S + i]
    return k >= 0 ? ZONES[k].id : null
}

/**
 * The outline of a zone as Cali's map draws it: the edge of its cells in the shape grid traced
 * as one loop (the longest, if the zone comes in pieces), thinned out and rounded off, and laid
 * `inset` metres inside, so two neighbours' outlines run side by side instead of on top of
 * each other.
 */
function zoneOutline(id, inset = 0.9) {
    const S = SHAPE.size
    const inZone = (i, j) => i >= 0 && j >= 0 && i < S && j < S && zoneIdAt(SHAPE.x0 + i + 0.5, SHAPE.z0 + j + 0.5) === id
    // every cell side between the zone and the rest, all turning the same way round
    const next = new Map()
    const key = (x, y) => y * (S + 2) + x
    const edge = (ax, ay, bx, by) => {
        const k = key(ax, ay)
        if (!next.has(k)) next.set(k, [])
        next.get(k).push([bx, by])
    }
    for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
            if (!inZone(i, j)) continue
            if (!inZone(i, j - 1)) edge(i, j, i + 1, j)
            if (!inZone(i + 1, j)) edge(i + 1, j, i + 1, j + 1)
            if (!inZone(i, j + 1)) edge(i + 1, j + 1, i, j + 1)
            if (!inZone(i - 1, j)) edge(i, j + 1, i, j)
        }
    }
    // chained into loops; the longest is the zone
    let best = []
    for (const [k0, outs] of next) {
        while (outs.length) {
            const loop = []
            let [x, y] = [k0 % (S + 2), Math.floor(k0 / (S + 2))]
            for (let guard = 0; guard < S * S; guard++) {
                loop.push([x, y])
                const list = next.get(key(x, y))
                if (!list?.length) break
                ;[x, y] = list.pop()
                if (key(x, y) === k0) break
            }
            if (loop.length > best.length) best = loop
        }
    }
    // the steps of the grid smoothed away: every third corner, then rounded off twice
    let pts = best.filter((_, i) => i % 3 === 0).map(([x, y]) => [SHAPE.x0 + x, SHAPE.z0 + y])
    for (let pass = 0; pass < 2; pass++) {
        const out = []
        for (let i = 0; i < pts.length; i++) {
            const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length]
            out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75])
        }
        pts = out
    }
    // the zone lies to the right of the way the loop runs
    return pts.map(([x, z], i) => {
        const [px, pz] = pts[(i - 1 + pts.length) % pts.length], [nx, nz] = pts[(i + 1) % pts.length]
        const dx = nx - px, dz = nz - pz
        const l = Math.hypot(dx, dz) || 1
        return new THREE.Vector3(x + (-dz / l) * inset, 0, z + (dx / l) * inset)
    })
}

/**
 * Each zone's local streets, as straight stretches of its own grid: each line is walked a
 * metre at a time and kept only inside its zone, off the hills and the river, short of the
 * parks, landmarks and aid points, and off Cali's own roads (`mainAt`: distance to them).
 */
function localStreets(rivers, mainAt) {
    const runs = []
    for (const zone of ZONES) {
        const g = zoneGrid(zone.id)
        for (const dir of ['u', 'v']) {
            const period = dir === 'u' ? BLOCK.bu : BLOCK.bv
            for (let k = -BLOCK.reach; k <= BLOCK.reach; k++) {
                let run = []
                const flush = () => {
                    if (run.length >= 6) runs.push({ dir, pts: run })
                    run = []
                }
                for (let t = -270; t <= 270; t += 1) {
                    const [x, z] = dir === 'u' ? g.from(k * period, t) : g.from(t, k * period)
                    const ok =
                        zoneIdAt(x, z) === zone.id &&
                        urbanMask(x, z) >= 0.8 &&
                        mountainFactor(x, z) < 0.02 &&
                        mainAt(x, z) > 0.6 &&
                        !STREET_KEEP_OUT.some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + STREET_W / 2 + 0.5) ** 2) &&
                        !(x > 95 && rivers.some((r) => distToSamples(x, z, r.samples) < r.clear))
                    if (ok) run.push({ x, z })
                    else flush()
                }
                flush()
            }
        }
    }
    return runs
}

/**
 * The turn that points a house (facing +Z) at the nearest street of its block, from where
 * it stands in the block (lot a of nu along it, b of nv across).
 */
function facingStreet(a, b, nu, nv) {
    const sides = [
        [nv - 1 - b, 0], // +v
        [b, Math.PI], // -v
        [nu - 1 - a, Math.PI / 2], // +u
        [a, -Math.PI / 2], // -u
    ]
    return sides.reduce((best, s) => (s[0] < best[0] ? s : best))[1]
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

/**
 * The map's ground painted in Substance Painter on fuentes_3d/terrenos/terreno_cali.fbx:
 * one BaseColor per part, in static/assets/city/. Only the colour is used (matte); a part
 * without its picture keeps the colours drawn here. Set to {} to go back to those.
 */
const GROUND_TEXTURES = {
    terreno: 'assets/city/cali_piso.png', // Piso_Cali: the floor painted on its own, without baked shadows
    avenidas: 'assets/city/cali_avenidas.jpg',
    lineas_centrales: 'assets/city/cali_lineas_centrales.jpg',
    parques: 'assets/city/cali_parques.jpg',
    rio_orillas: 'assets/city/cali_rio_orillas.jpg',
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
        // Cali's own avenues and main streets; each zone's local streets fill in between them
        this.avenues = roadLines(AVENUES)
        this.mainStreets = roadLines(STREETS, true)
        const main = roadDistance([[this.avenues, AVENUE_W], [this.mainStreets, MAIN_STREET_W]])
        this.localStreets = localStreets(this.riverSamples, (x, z) => roadDistanceAt(main, x, z))
        // how far each place is from any road (what lots and trees keep off) and from an avenue
        this.roadDist = roadDistance([[this.avenues, AVENUE_W], [this.mainStreets, MAIN_STREET_W], [this.localStreets.map((r) => r.pts), STREET_W]])
        this.avenueDist = roadDistance([[this.avenues, AVENUE_W]])
        // the avenues every two metres: what palms line, and what the stadium lies along
        this.roadSamples = this.avenues.map((l) => resample(l, 2))
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
            () => this.#yumbo(),
            () => this.#aidPoints(),
            () => this.#themeCues(),
            () => this.#groundTextures(),
        ]
        for (let i = 0; i < steps.length; i++) {
            steps[i]()
            onStep?.((i + 1) / steps.length)
            await new Promise((r) => setTimeout(r, 0))
        }
        this.ready = true
    }

    /** Lay the painted textures on the parts of the ground that have one (see GROUND_TEXTURES). */
    #groundTextures() {
        const loader = new THREE.TextureLoader()
        const parts = new Map()
        this.group.traverse((o) => {
            const k = o.userData.ground
            if (k && GROUND_TEXTURES[k]) parts.set(k, [...(parts.get(k) ?? []), o])
        })
        for (const [k, meshes] of parts) {
            loader.load(new URL(GROUND_TEXTURES[k], document.baseURI).href, (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace
                // painted on the exported FBX, whose UVs run upside down from the ones built here
                // (glTF and Blender count v from the other edge), so the picture is read unflipped
                tex.flipY = false
                // the avenues and the river measure their length in metres along the strip
                tex.wrapS = tex.wrapT = k === 'terreno' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
                tex.anisotropy = 8
                for (const mats of new Set(meshes.map((m) => m.material))) {
                    for (const m of [mats].flat()) {
                        m.map = tex
                        m.vertexColors = false
                        m.color?.set('#FFFFFF')
                        if ('roughness' in m) {
                            m.roughness = 1
                            m.metalness = 0
                        }
                        m.needsUpdate = true
                    }
                }
            })
        }
    }

    /**
     * Swap the drawn Torre de Cali and stadium for the textured models, in the same place
     * and turned the same way. Called once the city is built; a model that fails to load
     * leaves the drawn one standing.
     */
    async useLandmarkModels(loader) {
        await Promise.all(
            Object.entries(this.landmarks ?? {}).map(async ([id, drawn]) => {
                const t = await loader.load(id)
                if (t.source !== 'glb') return
                const model = loader.instanceSync(t)
                model.position.copy(drawn.position)
                model.rotation.copy(drawn.rotation)
                // the stadium lies along the avenue that passes it, its length running beside the road;
                // its pitch is its lowest face, so it stands a few centimetres over the ground
                // instead of flickering against it
                if (id === 'estadio') {
                    model.rotation.y = this.#alongNearestRoad(model.position.x, model.position.z)
                    model.position.y = 0.12
                }
                this.group.add(model)
                this.group.remove(drawn)
                this.landmarks[id] = model
            })
        )
    }

    /**
     * Swap the drawn box houses for the barrio's own houses (their light map copies), one
     * instanced mesh per piece of each model. Each zone gets the houses that suit it: the
     * simple ones in the east, the larger ones north and west. If the models fail to load,
     * the drawn houses stay.
     */
    async useHouseModels(loader) {
        const spots = this.houseSpots
        if (!spots?.length) return
        const templates = new Map()
        await Promise.all(
            Object.values(MAP_HOUSES)
                .flat()
                .filter((id, i, all) => all.indexOf(id) === i)
                .map(async (id) => {
                    const t = await loader.load(`map-${id}`).catch(() => null)
                    if (t?.source === 'glb') templates.set(id, t)
                })
        )
        if (!templates.size) return
        const byModel = new Map()
        for (const h of spots) {
            const choices = MAP_HOUSES[h.zone].filter((id) => templates.has(id))
            const id = choices.length ? choices[Math.floor(h.mix * choices.length) % choices.length] : [...templates.keys()][0]
            byModel.set(id, [...(byModel.get(id) ?? []), h])
        }
        const m = new THREE.Matrix4()
        const place = new THREE.Matrix4()
        const q = new THREE.Quaternion()
        const sc = new THREE.Vector3()
        const p = new THREE.Vector3()
        const up = new THREE.Vector3(0, 1, 0)
        for (const [id, list] of byModel) {
            const t = templates.get(id)
            // each house fills its lot: the widest side of the model (with its yard) is MAP_LOT
            const k = MAP_LOT / Math.max(t.size.x, t.size.z)
            const placements = list.map((h) => {
                q.setFromAxisAngle(up, -h.a + h.face)
                const s = k * (0.92 + ((h.mix * 7.31) % 1) * 0.12)
                return place.compose(p.set(h.x, 0, h.z), q, sc.set(s, s, s)).clone()
            })
            t.object.updateMatrixWorld(true)
            t.object.traverse((o) => {
                if (!o.isMesh) return
                const im = new THREE.InstancedMesh(o.geometry, o.material, placements.length)
                placements.forEach((pl, i) => im.setMatrixAt(i, m.multiplyMatrices(pl, o.matrixWorld)))
                // on a phone the thousand houses skip the shadow pass: from up here it hardly shows
                im.castShadow = !PHONE
                im.receiveShadow = true
                im.instanceMatrix.needsUpdate = true
                im.computeBoundingSphere()
                im.name = `casa-mapa:${id}`
                this.group.add(im)
            })
        }
        for (const im of this.drawnHouses ?? []) {
            this.group.remove(im)
            im.dispose()
        }
        this.drawnHouses = []
    }

    /** Yaw that lays a model's length (its local Z) along the avenue closest to (x, z). */
    #alongNearestRoad(x, z) {
        let best = Infinity, dir = [1, 0]
        for (const samples of this.roadSamples) {
            for (let i = 1; i < samples.length; i++) {
                const p = samples[i], q = samples[i - 1]
                const d = (p.x - x) ** 2 + (p.z - z) ** 2
                if (d < best) {
                    best = d
                    dir = [p.x - q.x, p.z - q.z]
                }
            }
        }
        return Math.atan2(dir[0], dir[1])
    }

    #themeCues() {
        if (!this.theme) return
        const cues = buildCityCues(this.theme, { parks: this.parks, heightAt })
        this.group.add(cues.group)
        this.cueUpdate = cues.update
    }

    /* ---------------- zones ---------------- */

    /** The zone at (x, z), as Cali's MIO zones group into the app's five (see caliMap.js). */
    zoneAt(x, z) {
        return zoneIdAt(x, z)
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
     * Live map: something just happened at a collection point, on this device or any other.
     * A ring spreads over its zone (a donation scheduled, received, handed out), or a light
     * travels from one point to the other (a transfer). Calm and brief: it says "this is
     * happening now" without pulling the eye away from what the person is doing.
     */
    pulse(e) {
        const zoneOf = (pointId) => COLLECTION_POINTS.find((p) => p.id === pointId)?.zone
        const from = zoneOf(e.point)
        if (!from || !ZONES.some((z) => z.id === from)) return
        const colour = LIVE_COLOURS[e.kind] ?? LIVE_COLOURS.aporte
        const to = e.kind === 'traslado' ? zoneOf(e.to) : null
        if (to && to !== from) this.#travel(from, to, colour)
        else this.#rings(from, colour)
    }

    #rings(zoneId, colour, delay = 0) {
        const at = this.focusPoint(zoneId)
        for (let i = 0; i < 3; i++) {
            const ring = new THREE.Mesh(
                LIVE_RING,
                new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthWrite: false, depthTest: false })
            )
            ring.position.set(at.x, 1.2, at.z)
            ring.renderOrder = 20
            ring.scale.setScalar(3)
            this.group.add(ring)
            const d = delay + i * 0.45
            gsap.to(ring.material, { opacity: 0.85, duration: 0.25, delay: d })
            gsap.to(ring.scale, { x: 34, y: 34, z: 34, duration: 2.4, delay: d, ease: 'power2.out' })
            gsap.to(ring.material, {
                opacity: 0,
                duration: 1.6,
                delay: d + 0.8,
                ease: 'sine.in',
                onComplete: () => {
                    this.group.remove(ring)
                    ring.material.dispose()
                },
            })
        }
    }

    #travel(fromZone, toZone, colour) {
        const a = this.focusPoint(fromZone).setY(2)
        const b = this.focusPoint(toZone).setY(2)
        const mid = a.clone().lerp(b, 0.5).setY(2 + a.distanceTo(b) * 0.28)
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
        const light = new THREE.Mesh(LIVE_DOT, new THREE.MeshBasicMaterial({ color: colour, transparent: true, depthTest: false }))
        light.renderOrder = 21
        const trail = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
            new THREE.LineDashedMaterial({ color: colour, dashSize: 6, gapSize: 4, transparent: true, opacity: 0, depthTest: false })
        )
        trail.computeLineDistances()
        trail.renderOrder = 20
        this.group.add(trail, light)
        this.#rings(fromZone, colour)
        const s = { u: 0 }
        gsap.to(trail.material, { opacity: 0.7, duration: 0.4 })
        gsap.to(s, {
            u: 1,
            duration: 2.6,
            delay: 0.3,
            ease: 'power1.inOut',
            onUpdate: () => curve.getPoint(s.u, light.position),
            onComplete: () => {
                this.#rings(toZone, colour)
                gsap.to(trail.material, {
                    opacity: 0,
                    duration: 0.8,
                    onComplete: () => {
                        this.group.remove(trail, light)
                        trail.geometry.dispose()
                        trail.material.dispose()
                        light.material.dispose()
                    },
                })
            },
        })
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

            // at rest every zone shows: its outline in its colour and a light wash of it inside;
            // the one pointed at or picked stands out, the others step back
            let fillTarget = isSel ? 0.32 : isHover ? 0.24 : this.selected ? 0.05 : 0.15
            let lineTarget = isSel ? 1 : this.selected ? 0.3 : isHover ? 1 : 0.95
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
            z.line.material.color.lerp(z.colour, k)
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
            // the zone's own edge, as the map of Cali draws it
            const pts = zoneOutline(zone.id)

            const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)))
            const fillGeo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2)

            const fill = new THREE.Mesh(
                fillGeo,
                new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
            )
            fill.position.y = 0.55
            fill.renderOrder = 2

            // each zone outlined in its own colour (the colour of its marker and of its row in the
            // phone's list), so the city reads as its five parts at a glance
            const line = new THREE.Mesh(
                ribbonGeometry(pts, 1.6, 0.7, true),
                new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0.85, depthWrite: false })
            )
            line.renderOrder = 3
            const glow = new THREE.Mesh(
                ribbonGeometry(pts, 2.6, 0.65, true),
                new THREE.MeshBasicMaterial({ color: zone.color, alphaMap: glowTex, transparent: true, opacity: 0, depthWrite: false })
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
        // the ground runs out to the horizon, so its edge never shows, whatever the screen: some
        // 7 m a cell round the city and on the hills behind it, growing from there to the far
        // edge, 4 km out
        const seg = 240
        const reach = 4000
        const near = 840
        const stretch = (u) => near * u + (reach - near) * Math.sign(u) * Math.abs(u) ** 6
        const geo = new THREE.PlaneGeometry(2, 2, seg, seg).rotateX(-Math.PI / 2)
        const pos = geo.attributes.position
        const uv = geo.attributes.uv
        for (let i = 0; i < pos.count; i++) {
            const x = stretch(pos.getX(i)) + 10, z = stretch(pos.getZ(i))
            pos.setX(i, x)
            pos.setZ(i, z)
            // the painted floor (cali_piso) was painted on the 1100 m square the ground used to
            // be: it keeps its place, and its edges carry on outwards (see #groundTextures)
            uv.setXY(i, (x - 10 + 550) / 1100, (550 - z) / 1100)
        }
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
        terrain.userData.ground = 'terreno'
        this.terrain = terrain
        this.group.add(terrain)
    }

    #water() {
        const rock = stylize(new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.9, flatShading: true }), { ao: 0.2, aoHeight: 1, rim: 0.12 })
        const rockColors = ['#8C8F93', '#A3A6A8', '#9C6A4E', '#B8B4AE'].map((c) => new THREE.Color(c))
        // its own random sequence, so the rocks do not move the houses and trees placed after them
        let rs = 4242
        const rand = () => ((rs = (rs * 16807) % 2147483647) / 2147483647)
        const bank = new THREE.MeshStandardMaterial({ color: '#C9C2AF', roughness: 1 })
        for (const r of this.riverSamples) {
            const pts = r.samples.map((p) => new THREE.Vector3(p.x, 0, p.z))
            // each river its own material: the foam and the ripples are sized to its width
            const mat = stylizeRiver(new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.6, metalness: 0 }), { width: r.width })
            const water = new THREE.Mesh(ribbonGeometry(pts, r.width, 0.16), mat)
            water.receiveShadow = true
            water.userData.ground = 'rio_agua'
            const edge = new THREE.Mesh(ribbonGeometry(pts, r.width + 1.4, 0.1), bank)
            edge.receiveShadow = true
            edge.userData.ground = 'rio_orillas'
            this.group.add(edge, water)

            // a few rocks breaking the surface, never in the middle of the stream
            const stones = []
            for (let i = 6; i < pts.length - 6; i += 9 + Math.floor(rand() * 9)) {
                const a = pts[i - 1], b = pts[i + 1]
                const dx = b.x - a.x, dz = b.z - a.z
                const l = Math.hypot(dx, dz) || 1
                const side = (rand() < 0.5 ? -1 : 1) * (0.18 + rand() * 0.24) * r.width
                stones.push([pts[i].x - (dz / l) * side, pts[i].z + (dx / l) * side, r.width * (0.05 + rand() * 0.05)])
            }
            const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rock, stones.length)
            const q = new THREE.Quaternion()
            const mtx = new THREE.Matrix4()
            stones.forEach(([x, z, s], i) => {
                q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3))
                mtx.compose(new THREE.Vector3(x, 0.12, z), q, new THREE.Vector3(s * 1.3, s * 0.45, s))
                rocks.setMatrixAt(i, mtx)
                rocks.setColorAt(i, rockColors[Math.floor(rand() * rockColors.length)])
            })
            rocks.castShadow = true
            rocks.receiveShadow = true
            this.group.add(rocks)
        }
    }

    #roads() {
        // the local streets in one mesh, Cali's main streets in another, the avenues (with the
        // painted asphalt) in a third and their centre lines in a fourth. Seen from a few hundred
        // metres, layers a few millimetres apart fight over every pixel where they cross (the
        // textures seem to flicker over each other): each kind sits centimetres above the one
        // below, the avenues alternate between three heights, and each kind is also drawn with
        // its own depth offset, so the order holds at any distance
        const v3 = (p) => new THREE.Vector3(p.x, 0, p.z)
        const streets = this.localStreets.map((r) => ribbonGeometry([r.pts[0], r.pts[r.pts.length - 1]].map(v3), STREET_W, 0.12))
        const mains = this.mainStreets.map((l) => ribbonGeometry(l.map(v3), MAIN_STREET_W, 0.16))
        const avenues = [], lines = []
        this.avenues.forEach((l, i) => {
            const lift = (i % 3) * 0.015
            avenues.push(ribbonGeometry(l.map(v3), AVENUE_W, 0.2 + lift))
            lines.push(ribbonGeometry(l.map(v3), 0.18, 0.27 + lift))
        })
        const add = (list, mat, ground) => {
            if (!list.length) return
            const mesh = new THREE.Mesh(mergeGeometries(list), mat)
            mesh.receiveShadow = true
            if (ground) mesh.userData.ground = ground
            this.group.add(mesh)
        }
        const layer = (k) => ({ polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k * 2 })
        add(streets, new THREE.MeshStandardMaterial({ color: WORLD.road, roughness: 0.95, ...layer(1) }), null)
        add(mains, new THREE.MeshStandardMaterial({ color: WORLD.road, roughness: 0.95, ...layer(2) }), null)
        add(avenues, new THREE.MeshStandardMaterial({ color: WORLD.road, roughness: 0.95, ...layer(3) }), 'avenidas')
        add(lines, new THREE.MeshBasicMaterial({ color: '#F4F1EA', ...layer(4) }), 'lineas_centrales')
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
        // the landmarks are drawn here until their models arrive (see useLandmarkModels)
        this.landmarks = {}
        const [ermita, torre, estadio] = LANDMARK_GROUNDS
        // La Ermita — small white gothic church by the river in the centre, its front (bell tower
        // and doors) turned to where the map's camera rests (App's CITY_VIEW, towards x -50,
        // z 304), so it is seen face on
        {
            const g = props.ermita()
            g.position.set(ermita.x, 0, ermita.z)
            g.rotation.y = Math.atan2(-50 - ermita.x, 304 - ermita.z)
            this.group.add(g)
            this.landmarks.ermita = g
            this.exclusions.push({ x: ermita.x, z: ermita.z, r: 9 })
        }
        // Torre de Cali, a few blocks west of it
        {
            const g = props.torreDeCali()
            g.position.set(torre.x, 0, torre.z)
            g.rotation.y = 0.22
            this.group.add(g)
            this.landmarks['torre-de-cali'] = g
            this.exclusions.push({ x: torre.x, z: torre.z, r: 9 })
        }
        // Estadio Pascual Guerrero, south of the centre
        {
            const g = props.estadio()
            g.position.set(estadio.x, 0, estadio.z)
            g.rotation.y = 0.3
            this.group.add(g)
            this.landmarks.estadio = g
            this.exclusions.push({ x: estadio.x, z: estadio.z, r: STADIUM_CLEAR })
        }
        // Keep each zone's aid point clear of buildings
        for (const zone of ZONES) this.exclusions.push({ x: zone.label[0], z: zone.label[1], r: 7 })

        // Parks (open green squares)
        this.parks = PARKS.map((p) => ({ ...p }))
        for (const p of this.parks) {
            const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r, 28).rotateX(-Math.PI / 2), sharedMaterial('city:park', { color: '#9FB98A', roughness: 1 }))
            disc.position.set(p.x, 0.09, p.z)
            disc.receiveShadow = true
            disc.userData.ground = 'parques'
            this.group.add(disc)
            this.exclusions.push({ ...p })
        }
    }

    /* ---------------- buildings ---------------- */

    #isFree(x, z, clearance = 0) {
        for (const e of this.exclusions) if ((x - e.x) ** 2 + (z - e.z) ** 2 < (e.r + clearance) ** 2) return false
        for (const r of this.riverSamples) if (distToSamples(x, z, r.samples) < r.clear + clearance) return false
        if (roadDistanceAt(this.roadDist, x, z) < 1.35 + clearance) return false
        return true
    }

    /** True when (x, z) is within `margin` metres of an avenue's centre line. */
    #onRoad(x, z, margin) {
        return roadDistanceAt(this.avenueDist, x, z) < margin - AVENUE_W / 2
    }

    #blocks() {
        // how many lots are built on, and how often a block has a tower on one corner (more
        // often on an avenue). Towers stand all over the city, but not in the east.
        const fill = { centro: 0.97, norte: 0.96, sur: 0.93, oriente: 0.98, oeste: 0.95 }
        const towerChance = { centro: 0.3, norte: 0.22, sur: 0.2, oriente: 0, oeste: 0.2 }
        const houses = []
        const towers = []
        const edge = STREET_W / 2 + SIDEWALK

        for (const zone of ZONES) {
            const g = zoneGrid(zone.id)
            for (let i = -BLOCK.reach; i < BLOCK.reach; i++) {
                for (let j = -BLOCK.reach; j < BLOCK.reach; j++) {
                    const u0 = i * BLOCK.bu + edge, u1 = (i + 1) * BLOCK.bu - edge
                    const v0 = j * BLOCK.bv + edge, v1 = (j + 1) * BLOCK.bv - edge
                    const nu = Math.floor((u1 - u0) / LOT), nv = Math.floor((v1 - v0) / LOT)
                    const su = (u1 - u0) / nu, sv = (v1 - v0) / nv
                    const centre = g.from((u0 + u1) / 2, (v0 + v1) / 2)
                    if (zoneIdAt(...centre) !== zone.id) continue
                    let tower = null
                    const onAvenue = roadDistanceAt(this.avenueDist, ...centre) < Math.max(u1 - u0, v1 - v0) / 2 + 2
                    if (rnd() < towerChance[zone.id] * (onAvenue ? 1.6 : 0.5)) {
                        // of the corners with room for it, the one nearest an avenue
                        const corners = [[0, 0], [nu - 2, 0], [0, nv - 2], [nu - 2, nv - 2]]
                            .map(([cu, cv]) => {
                                const at = g.from(u0 + (cu + 1) * su, v0 + (cv + 1) * sv)
                                return { cu, cv, at, d: roadDistanceAt(this.avenueDist, ...at) }
                            })
                            .filter((c) => urbanMask(...c.at) >= 0.85 && zoneIdAt(...c.at) === zone.id && this.#isFree(...c.at, 1.6))
                        const c = corners.length ? corners.reduce((a, b) => (b.d < a.d ? b : a)) : null
                        if (c) {
                            tower = c
                            towers.push({ x: c.at[0], z: c.at[1], a: g.angle, zone: zone.id, w: 2 * Math.min(su, sv) - 1.2 })
                        }
                    }
                    for (let a = 0; a < nu; a++) {
                        for (let b = 0; b < nv; b++) {
                            if (tower && a >= tower.cu && a < tower.cu + 2 && b >= tower.cv && b < tower.cv + 2) continue
                            const [x, z] = g.from(u0 + (a + 0.5) * su + (rnd() - 0.5) * 0.2, v0 + (b + 0.5) * sv + (rnd() - 0.5) * 0.2)
                            if (urbanMask(x, z) < 0.85 || zoneIdAt(x, z) !== zone.id || !this.#isFree(x, z)) continue
                            if (rnd() > fill[zone.id]) continue
                            houses.push({ x, z, a: g.angle + (rnd() - 0.5) * 0.04, zone: zone.id, face: facingStreet(a, b, nu, nv), mix: lotHash(i * 8 + a, j * 8 + b, zone.id) })
                        }
                    }
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
        // drawn houses until the barrio models arrive (see useHouseModels)
        this.houseSpots = houses
        this.drawnHouses = [bodyMesh, roofMesh]
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
            const w = t.w * (0.88 + rnd() * 0.12)
            const ht = 8 + rnd() * 14 * (t.zone === 'centro' ? 1.25 : 0.9)
            q.setFromAxisAngle(up, -t.a)
            m.compose(p.set(t.x, 0, t.z), q, sc.set(w, ht, w * (0.85 + rnd() * 0.15)))
            towerMesh.setMatrixAt(i, m)
            towerMesh.setColorAt(i, pick(towerColors))
        })
        towerMesh.castShadow = true
        towerMesh.receiveShadow = true
        towerMesh.computeBoundingSphere()
        this.group.add(towerMesh)

        this.stats = { houses: houses.length, towers: towers.length }
    }

    /* ---------------- Yumbo ---------------- */

    /**
     * Yumbo, on the horizon to the north: its houses (its roads are drawn with Cali's, from the
     * same map) and a few industrial sheds on the way to Cali, in muted greys, inside a dashed
     * boundary and named in grey, with no marker: part of the view, not of the app. It is not a
     * zone, so nothing there can be picked.
     */
    #yumbo() {
        const [cx, cz] = YUMBO
        const a = -0.3, ca = Math.cos(a), sa = Math.sin(a)
        const spots = []
        for (let i = -9; i <= 9; i++) {
            for (let j = -7; j <= 7; j++) {
                const u = i * 4.2, v = j * 4.2
                const x = cx + u * ca - v * sa + (rnd() - 0.5) * 0.6
                const z = cz + u * sa + v * ca + (rnd() - 0.5) * 0.6
                const r = Math.hypot(u / 34, v / 24) + (vnoise(x * 0.08, z * 0.08) - 0.5) * 0.5
                if (r > 1 || heightAt(x, z) > 0.3 || roadDistanceAt(this.roadDist, x, z) < 1.6 || rnd() < 0.18) continue
                spots.push({ x, z, a: a + (rnd() - 0.5) * 0.1, w: 2.2 + rnd() * 0.8, d: 2.4 + rnd() * 0.8, h: 1.6 + rnd() * 1.2 })
            }
        }
        // sheds along the road down to Cali (the industrial strip between the two)
        for (let k = 0; k < 14; k++) {
            const t = k / 13
            const x = lerp(cx - 6, 26, t) + (rnd() - 0.5) * 14, z = lerp(cz + 26, -166, t) + (rnd() - 0.5) * 8
            if (heightAt(x, z) > 0.3 || roadDistanceAt(this.roadDist, x, z) < 4) continue
            spots.push({ x, z, a: a + (rnd() - 0.5) * 0.3, w: 6 + rnd() * 5, d: 4 + rnd() * 3, h: 1.6 + rnd() * 0.8, shed: true })
        }
        const { body, roof } = props.cityBlockGeometries()
        const haze = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 })
        const bodies = new THREE.InstancedMesh(body, haze('#FFFFFF'), spots.length)
        const roofs = new THREE.InstancedMesh(roof, haze('#FFFFFF'), spots.length)
        const walls = ['#C9CDD2', '#D3D5D8', '#BFC4CA'].map((c) => new THREE.Color(c))
        const tops = ['#A9AEB5', '#B3B0AC', '#9FA5AD'].map((c) => new THREE.Color(c))
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
        spots.forEach((h, i) => {
            q.setFromAxisAngle(up, -h.a)
            bodies.setMatrixAt(i, m.compose(p.set(h.x, 0, h.z), q, sc.set(h.w, h.h, h.d)))
            bodies.setColorAt(i, pick(walls))
            roofs.setMatrixAt(i, m.compose(p.set(h.x, h.h, h.z), q, sc.set(h.w * 1.1, h.shed ? 0.5 : 0.8, h.d * 1.08)))
            roofs.setColorAt(i, pick(tops))
        })
        for (const im of [bodies, roofs]) {
            im.receiveShadow = true
            im.computeBoundingSphere()
            this.group.add(im)
        }

        // its boundary, dashed, a little out from the houses
        const dashes = []
        const N = 96
        for (let k = 0; k < N; k += 2) {
            const pt = (t) => {
                const ang = (t / N) * Math.PI * 2
                const u = Math.cos(ang) * 41, v = Math.sin(ang) * 30
                return new THREE.Vector3(cx + u * ca - v * sa, 0, cz + u * sa + v * ca)
            }
            dashes.push(ribbonGeometry([pt(k), pt(k + 1)], 0.5, 0.25))
        }
        const edge = new THREE.Mesh(mergeGeometries(dashes), new THREE.MeshBasicMaterial({ color: '#7C8591', transparent: true, opacity: 0.75, depthWrite: false }))
        edge.renderOrder = 3
        this.group.add(edge)

        // and its name, in grey
        const label = canvasTexture(512, 128, (ctx, w, h) => {
            ctx.clearRect(0, 0, w, h)
            ctx.font = '600 64px system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = 'rgba(70, 78, 92, 0.75)'
            ctx.fillText('Yumbo', w / 2, h / 2)
        })
        const name = new THREE.Sprite(new THREE.SpriteMaterial({ map: label, transparent: true, depthWrite: false, opacity: 0.8 }))
        name.position.set(cx, 18, cz)
        name.scale.set(28, 7, 1)
        name.renderOrder = 7
        this.group.add(name)
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
            if (u > 0.2 && roadDistanceAt(this.roadDist, x, z) < 0.6) continue
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
        // a white ring under each aid point: its tent and flag carry the red cross, the ring only
        // says "here", without the alarm a red one would sound
        const ringMat = new THREE.MeshBasicMaterial({
            color: '#FFFFFF',
            transparent: true,
            opacity: 0.8,
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
