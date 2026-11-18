/**
 * Where the shift may put things, decided by this app and not by the headset: the area the
 * experience happens in, the tables the cartons go on and the patch of floor the shelves stand on.
 *
 * Everything here is in the work frame of the chosen table (see WorkFrame in room.js): metres, x to
 * the person's right, z towards the person (the table is at z < 0, the person stands near z = 0.35),
 * y up from the floor. Being relative to the real table, a layout saved once applies again in any
 * later session, wherever the headset puts its own origin that time.
 *
 * Plain numbers and functions only (no Three.js, no DOM): the rules are tested in Node.
 *
 * @typedef {{ x: number, z: number }} P2
 * @typedef {{ id: string, label: string, cx: number, cz: number, hw: number, hd: number, yaw: number, top: number, source: string }} TableRect
 * @typedef {{ area: P2[], shelfZone: P2[], tables: TableRect[], source: string }} Layout
 */

export const LAYOUT_KEY = 'nexos-ar1-layout-v1'

/** Where the person stands, in the frame. */
export const PERSON_SPOT = { x: 0, z: 0.35 }

/**
 * The four corners of a rectangle centred at (cx, cz), half sizes hw (along x) and hd (along z),
 * turned by yaw as Three.js turns about +Y (the same as FloorPlan.blockRect and object.rotation.y).
 */
export function rectPoly(cx, cz, hw, hd, yaw = 0) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const corner = (u, v) => ({ x: cx + u * c + v * s, z: cz - u * s + v * c })
    return [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)]
}

/** An axis-aligned rectangle (in the frame) from two opposite corners. */
export function rectFromCorners(a, b) {
    return rectPoly((a.x + b.x) / 2, (a.z + b.z) / 2, Math.abs(a.x - b.x) / 2, Math.abs(a.z - b.z) / 2)
}

export function tablePoly(t, grow = 0) {
    return rectPoly(t.cx, t.cz, t.hw + grow, t.hd + grow, t.yaw)
}

/** Whether a point is inside a simple polygon (ray casting). On the edge counts as inside. */
export function pointInPolygon(p, poly) {
    if (!poly || poly.length < 3) return false
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]
        const b = poly[j]
        if (onSegment(p, a, b)) return true
        if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
    }
    return inside
}

function onSegment(p, a, b, eps = 1e-9) {
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)
    if (Math.abs(cross) > eps) return false
    return p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps && p.z >= Math.min(a.z, b.z) - eps && p.z <= Math.max(a.z, b.z) + eps
}

function segmentsCross(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x))
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

/** Whether the whole of `inner` lies within `outer`: every corner inside and no edge crossing out. */
export function polygonInside(inner, outer) {
    if (!inner.every((p) => pointInPolygon(p, outer))) return false
    for (let i = 0; i < inner.length; i++) {
        const a = inner[i]
        const b = inner[(i + 1) % inner.length]
        for (let j = 0; j < outer.length; j++) if (segmentsCross(a, b, outer[j], outer[(j + 1) % outer.length])) return false
    }
    return true
}

/** Whether two convex polygons overlap (separating axis test); touching edges do not count. */
export function polygonsOverlap(a, b) {
    for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i++) {
            const p = poly[i]
            const q = poly[(i + 1) % poly.length]
            const nx = -(q.z - p.z)
            const nz = q.x - p.x
            const project = (pts) => pts.map((v) => v.x * nx + v.z * nz)
            const pa = project(a)
            const pb = project(b)
            if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false
        }
    }
    return true
}

export function polygonBounds(poly) {
    const xs = poly.map((p) => p.x)
    const zs = poly.map((p) => p.z)
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

/**
 * The chosen table as a rectangle of the layout. The frame's table always runs along x, from minX
 * to maxX, from its near edge (z = 0) to its far edge (z = -depth).
 */
export function mainTable(frame) {
    return {
        id: 'mesa-1',
        label: 'mesa elegida',
        cx: (frame.minX + frame.maxX) / 2,
        cz: -frame.depth / 2,
        hw: (frame.maxX - frame.minX) / 2,
        hd: frame.depth / 2,
        yaw: 0,
        top: frame.top,
        source: 'elegida',
    }
}

/**
 * The zones, decided by the app alone from the chosen table: nothing is drawn by the person and
 * nothing is saved. The area is the floor around the table, from its far edge back well past where
 * the person stands; what the room's scan knows (walls, furniture, the next desks) takes its floor
 * away and only what can be walked to from the person's spot counts (see FloorPlan.finalize). The
 * cartons go only on this one table. The shelves' zone is chosen afterwards with pickShelfZone.
 */
export function autoLayout(frame) {
    const left = Math.min(frame.minX, -0.6) - 2.4
    const right = Math.max(frame.maxX, 0.6) + 2.4
    const far = -frame.depth - 0.02
    const back = 2.8
    const area = [
        { x: left, z: far },
        { x: right, z: far },
        { x: right, z: back },
        { x: left, z: back },
    ]
    return { area, shelfZone: shelfZoneCandidates(frame)[0], tables: [mainTable(frame)], source: 'automática' }
}

/**
 * Where the shelves may stand, in order of preference: to the person's right and behind (the left
 * is the window and the line), then right behind them, then wider and wider. All on the person's
 * side of the table, never on it.
 */
export function shelfZoneCandidates(frame) {
    const r = Math.max(frame.maxX, 0.6)
    const l = Math.min(frame.minX, -0.6)
    return [
        rectFromCorners({ x: 0.45, z: 0.04 }, { x: r + 1.0, z: 1.5 }),
        rectFromCorners({ x: 0.2, z: 0.04 }, { x: r + 1.8, z: 2.0 }),
        rectFromCorners({ x: -1.2, z: 0.9 }, { x: 1.6, z: 2.6 }),
        rectFromCorners({ x: 0.2, z: 0.04 }, { x: r + 2.3, z: 2.7 }),
        rectFromCorners({ x: l - 2.3, z: 0.6 }, { x: r + 2.3, z: 2.7 }),
    ]
}

/**
 * The first candidate zone where all `count` stands fit on free floor (see packStands); if none
 * holds them all, the one that holds the most. Returns the zone and the spots.
 */
export function pickShelfZone(layout, candidates, count, size, options = {}) {
    let best = null
    for (const zone of candidates) {
        const spots = packStands({ ...layout, shelfZone: zone }, count, size, options)
        if (!best || spots.length > best.spots.length) best = { zone, spots }
        if (spots.length >= count) break
    }
    return best
}

/** What is wrong with a layout before anything is placed with it, in words for the person. */
export function layoutProblems(layout) {
    const problems = []
    if (!pointInPolygon(PERSON_SPOT, layout.area)) problems.push('Tu sitio frente a la mesa queda fuera del área')
    if (!layout.shelfZone.some((p) => pointInPolygon(p, layout.area)) && !layout.area.some((p) => pointInPolygon(p, layout.shelfZone))) problems.push('La zona de estanterías está fuera del área')
    for (const t of layout.tables) if (!polygonInside(tablePoly(t), layout.area)) problems.push(`La ${t.label} no queda entera dentro del área`)
    return problems
}

/**
 * Spots for `count` stands of size w × d on the floor of the shelf zone: each whole footprint inside
 * the zone and the area, clear of whatever `isFree` says is in the way, apart from one another, and
 * turned to face the person. Nearest to the person first. Fewer than asked when they do not fit:
 * nothing is ever put anywhere else.
 */
export function packStands(layout, count, size, { isFree = () => true, gap = 0.04, step = 0.05, person = PERSON_SPOT } = {}) {
    const zone = layout.shelfZone
    const b = polygonBounds(zone)
    const candidates = []
    for (let x = b.minX; x <= b.maxX + 1e-6; x += step) {
        for (let z = b.minZ; z <= b.maxZ + 1e-6; z += step) {
            const yaw = Math.atan2(person.x - x, person.z - z)
            const foot = rectPoly(x, z, size.w / 2, size.d / 2, yaw)
            if (!polygonInside(foot, zone) || !polygonInside(foot, layout.area)) continue
            candidates.push({ x, z, yaw, foot, d: Math.hypot(x - person.x, z - person.z) })
        }
    }
    candidates.sort((a, c) => a.d - c.d)
    const radius = Math.hypot(size.w, size.d) / 2
    const placed = []
    for (const c of candidates) {
        if (placed.length >= count) break
        if (!isFree(c.x, c.z, radius)) continue
        const grown = rectPoly(c.x, c.z, size.w / 2 + gap / 2, size.d / 2 + gap / 2, c.yaw)
        if (placed.some((p) => polygonsOverlap(grown, p.grown))) continue
        placed.push({ ...c, grown })
    }
    return placed.map(({ x, z, yaw, foot }) => ({ x, z, yaw, foot }))
}

/**
 * Places on the tables for `count` cartons of size w × h × d, set down square to each table, each
 * footprint wholly on its own table (two tables side by side are never bridged), clear of what is
 * reserved (where the family's carton and its order go), filling the bottom layer of every table
 * before stacking a second. Fewer than asked when they do not fit.
 */
export function packOnTables(tables, count, size, { reserve = [], levels = 2, gap = 0.03, margin = 0.02 } = {}) {
    const layers = []
    for (const t of tables) {
        const spots = []
        const nx = Math.floor((t.hw * 2 - 2 * margin + gap) / (size.w + gap))
        const nz = Math.floor((t.hd * 2 - 2 * margin + gap) / (size.d + gap))
        if (nx < 1 || nz < 1) continue
        // the rows from the far edge of the table, as far from the person's hands as the table allows
        const usedW = nx * size.w + (nx - 1) * gap
        const usedD = nz * size.d + (nz - 1) * gap
        const c = Math.cos(t.yaw)
        const s = Math.sin(t.yaw)
        for (let i = nx - 1; i >= 0; i--) {
            for (let k = 0; k < nz; k++) {
                const u = -usedW / 2 + size.w / 2 + i * (size.w + gap)
                const v = -usedD / 2 + size.d / 2 + k * (size.d + gap)
                const x = t.cx + u * c + v * s
                const z = t.cz - u * s + v * c
                const foot = rectPoly(x, z, size.w / 2, size.d / 2, t.yaw)
                if (!polygonInside(foot, tablePoly(t))) continue
                if (reserve.some((r) => polygonsOverlap(foot, r))) continue
                spots.push({ x, z, yaw: t.yaw, top: t.top, tableId: t.id, foot })
            }
        }
        layers.push(spots)
    }
    const out = []
    for (let level = 0; level < levels && out.length < count; level++) {
        for (const spots of layers) {
            for (const s of spots) {
                if (out.length >= count) break
                out.push({ ...s, level, y: s.top + level * (size.h + 0.004) })
            }
        }
    }
    return out
}
