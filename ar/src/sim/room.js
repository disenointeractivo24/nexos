/**
 * The real room, as flat numbers: which surfaces the headset found, which of them are one
 * work surface, and where on them something actually fits. No 3D in it, so the rules of
 * "this box belongs on that table" can be read (and tested) without a headset.
 *
 * Everything here speaks of oriented rectangles on the horizontal plane: a centre, a width
 * and a depth, and the yaw they are turned by. A real desk is never quite axis-aligned, and
 * a run of desks pushed together is one rectangle, not five.
 */

/** What the headset calls things. Meta's scene model uses these, and only these. */
export const SURFACE = 'table'
export const FLOOR = 'floor'
/** Neither a place to put things nor a thing to dodge: the shell of the room. */
const SHELL = new Set(['floor', 'ceiling', 'wall', 'global mesh'])

/** Two surfaces are the same work surface if their tops are within this (m) of each other. */
const SAME_HEIGHT = 0.03
/** And if they are turned the same way, within this (rad) — about 6 degrees. */
const SAME_YAW = 0.1
/** And if the gap between them is no wider than this (m): desks pushed together leave one. */
const TOUCHING = 0.12

/** Nothing is placed nearer than this (m) to the edge of a surface: it would look like falling. */
export const EDGE_INSET = 0.07
/** Nor nearer than this (m) to anything real standing on it. */
export const OBSTACLE_CLEARANCE = 0.05

const TAU = Math.PI * 2

/** The same angle, brought into [-PI, PI). */
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI

/** How far apart two yaws are, treating a rectangle's half-turn as the same rectangle. */
export const yawGap = (a, b) => Math.abs(wrap(wrap(a - b) % Math.PI > Math.PI / 2 ? a - b + Math.PI : a - b))

/** A point turned into the frame of `yaw`, so a rectangle at that yaw becomes axis-aligned. */
function intoFrame(x, z, yaw) {
    const c = Math.cos(-yaw)
    const s = Math.sin(-yaw)
    return { x: x * c - z * s, z: x * s + z * c }
}

/** And back out of it. */
function outOfFrame(x, z, yaw) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    return { x: x * c - z * s, z: x * s + z * c }
}

/**
 * A rectangle as the extents it covers in its own frame, which is what makes two of them
 * easy to compare and to join.
 * @param {{ cx: number, cz: number, w: number, d: number, yaw: number }} rect
 */
function extentsOf(rect, yaw = rect.yaw) {
    const c = intoFrame(rect.cx, rect.cz, yaw)
    // a rectangle turned away from this frame covers the box its corners span
    const turn = rect.yaw - yaw
    const ax = Math.abs(Math.cos(turn))
    const az = Math.abs(Math.sin(turn))
    const halfW = (rect.w * ax + rect.d * az) / 2
    const halfD = (rect.w * az + rect.d * ax) / 2
    return { minX: c.x - halfW, maxX: c.x + halfW, minZ: c.z - halfD, maxZ: c.z + halfD }
}

/** The rectangle those extents describe, back in world terms. */
function rectOf(e, yaw, top) {
    const c = outOfFrame((e.minX + e.maxX) / 2, (e.minZ + e.maxZ) / 2, yaw)
    return { cx: c.x, cz: c.z, w: e.maxX - e.minX, d: e.maxZ - e.minZ, yaw, top }
}

/** Do these two extents touch, allowing for the gap two pushed-together desks leave? */
function adjacent(a, b, gap = TOUCHING) {
    return a.minX - gap <= b.maxX && b.minX - gap <= a.maxX && a.minZ - gap <= b.maxZ && b.minZ - gap <= a.maxZ
}

/**
 * The desks of one run, joined. The headset reports a table per desk, so a classroom row
 * comes back as five separate surfaces; the shift needs the counter they make together.
 * Surfaces at different heights, or turned differently, stay apart.
 * @param {{ cx: number, cz: number, w: number, d: number, yaw: number, top: number }[]} tables
 * @returns the same shape, one per run, largest first
 */
export function mergeSurfaces(tables) {
    let runs = tables.map((t) => ({ ...t, parts: 1 }))
    // joining makes runs grow, and a grown run can reach one it did not touch before
    for (let pass = 0; pass < 6; pass++) {
        const next = mergeOnce(runs)
        if (next.length === runs.length) break
        runs = next
    }
    return runs.sort((a, b) => b.w * b.d - a.w * a.d)
}

function mergeOnce(runs) {
    const out = []
    for (const run of runs) {
        const into = out.find(
            (r) => Math.abs(r.top - run.top) <= SAME_HEIGHT && yawGap(r.yaw, run.yaw) <= SAME_YAW && adjacent(extentsOf(r, r.yaw), extentsOf(run, r.yaw))
        )
        if (!into) {
            out.push({ ...run })
            continue
        }
        const a = extentsOf(into, into.yaw)
        const b = extentsOf(run, into.yaw)
        Object.assign(
            into,
            rectOf(
                { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) },
                into.yaw,
                Math.max(into.top, run.top)
            ),
            { parts: into.parts + run.parts }
        )
    }
    return out
}

/** The same rectangle, shrunk by `inset` on every side: the band along the edge is not for standing things on. */
export function usableArea(rect, inset = EDGE_INSET) {
    return { ...rect, w: Math.max(0, rect.w - inset * 2), d: Math.max(0, rect.d - inset * 2) }
}

/** Is this point inside the rectangle? */
export function contains(rect, x, z, margin = 0) {
    const p = intoFrame(x - rect.cx, z - rect.cz, rect.yaw)
    return Math.abs(p.x) <= rect.w / 2 + margin && Math.abs(p.z) <= rect.d / 2 + margin
}

/**
 * Does a thing of this footprint, standing at this spot, sit wholly on the surface and clear
 * of everything real on it? This is the check that keeps a carton from hanging over an edge
 * or sharing its place with a monitor.
 * @param {{ x: number, z: number, w: number, d: number }} what footprint and where
 * @param {object} area the usable rectangle
 * @param {{ cx: number, cz: number, w: number, d: number, yaw: number }[]} obstacles
 */
export function fits(what, area, obstacles = [], clearance = OBSTACLE_CLEARANCE) {
    const half = Math.hypot(what.w, what.d) / 2
    // its own corners, in the surface's frame, must all be inside it
    const p = intoFrame(what.x - area.cx, what.z - area.cz, area.yaw)
    if (Math.abs(p.x) + what.w / 2 > area.w / 2 || Math.abs(p.z) + what.d / 2 > area.d / 2) return false
    return !obstacles.some((o) => {
        const d = intoFrame(what.x - o.cx, what.z - o.cz, o.yaw)
        const reach = Math.hypot(o.w, o.d) / 2 + half + clearance
        if (Math.hypot(what.x - o.cx, what.z - o.cz) > reach) return false
        return Math.abs(d.x) <= o.w / 2 + what.w / 2 + clearance && Math.abs(d.z) <= o.d / 2 + what.d / 2 + clearance
    })
}

/**
 * Where on a surface a row of things can stand: spots along it, in order, each one clear.
 * Walks the surface in its own frame, so a run of desks fills from one end to the other.
 * @returns {{ x: number, z: number }[]} as many spots as were asked for, or fewer
 */
export function spotsAlong(area, footprint, count, obstacles = [], step = 0.06) {
    const spots = []
    if (count <= 0 || area.w <= footprint.w || area.d <= footprint.d) return spots
    const halfW = (area.w - footprint.w) / 2
    const halfD = (area.d - footprint.d) / 2
    // across the surface: the middle first, then nearer the person, then further in
    const lanes = [0, halfD / 2, -halfD / 2].filter((z, i, all) => all.indexOf(z) === i)
    const apart = Math.max(footprint.w, footprint.d) + 0.04
    const place = (x, lane) => {
        const at = outOfFrame(x, lane, area.yaw)
        const spot = { x: area.cx + at.x, z: area.cz + at.z }
        if (spots.some((s) => Math.hypot(s.x - spot.x, s.z - spot.z) < apart)) return null
        return fits({ ...spot, ...footprint }, area, obstacles) ? spot : null
    }
    // each one gets its own share of the run, and is looked for outward from the middle of it
    const share = (2 * halfW) / count
    for (let i = 0; i < count; i++) {
        const want = -halfW + share * (i + 0.5)
        let found = null
        for (let away = 0; away <= share / 2 + halfW && !found; away += step) {
            for (const x of away ? [want - away, want + away] : [want]) {
                if (Math.abs(x) > halfW) continue
                for (const lane of lanes) {
                    found = place(x, lane)
                    if (found) break
                }
                if (found) break
            }
        }
        if (found) spots.push(found)
    }
    return spots
}

/**
 * The room as the shift needs it, read from what the headset reports.
 * @param {{ semanticLabel: string, cx: number, cz: number, w: number, d: number, yaw: number, top: number, bottom?: number }[]} found
 */
export function readRoom(found) {
    const tables = found.filter((m) => m.semanticLabel === SURFACE)
    const floors = found.filter((m) => m.semanticLabel === FLOOR)
    const runs = mergeSurfaces(tables)
    const surface = runs[0] ?? null
    const obstacles = found.filter((m) => !SHELL.has(m.semanticLabel) && m.semanticLabel !== SURFACE)
    return {
        surface,
        runs,
        /** Everything standing on the work surface: monitors, keyboards, whatever was traced. */
        onSurface: surface ? obstacles.filter((o) => (o.bottom ?? o.top) >= surface.top - 0.12 && contains(surface, o.cx, o.cz, 0.25)) : [],
        obstacles,
        floorY: floors.length ? Math.min(...floors.map((f) => f.top)) : 0,
        floor: floors.length ? mergeSurfaces(floors)[0] : null,
    }
}
