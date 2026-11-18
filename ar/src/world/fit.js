/**
 * Where the tent goes in the real room: as close as possible to where the person stands and looks,
 * but turned and moved so that what they walk around (the counter, the shelf, their own spot)
 * stays clear of the walls and furniture the headset scanned. Plain numbers only, tested in Node.
 *
 * Obstacles are points on the floor ({ x, z }, world). Footprints are rectangles in the tent's own
 * frame ({ minX, maxX, minZ, maxZ }); the tent is placed at `at` turned by `yaw` (as Three turns
 * about +Y). The person's spot is `worker` in the tent's frame.
 */

/** A point of the tent's frame, in the world. */
export function toWorld(p, at, yaw) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    return { x: at.x + p.x * c + p.z * s, z: at.z - p.x * s + p.z * c }
}

/** A point of the world, in the tent's frame. */
export function toLocal(p, at, yaw) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const dx = p.x - at.x
    const dz = p.z - at.z
    return { x: dx * c - dz * s, z: dx * s + dz * c }
}

/** Distance from a point to a rectangle (0 inside). */
function rectDistance(p, r) {
    const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX)
    const dz = Math.max(r.minZ - p.z, 0, p.z - r.maxZ)
    return Math.hypot(dx, dz)
}

/** The smallest gap between any obstacle and any footprint, with the tent at (at, yaw). */
export function clearance(obstacles, footprints, at, yaw, cap = 2) {
    let best = cap
    for (const o of obstacles) {
        const l = toLocal(o, at, yaw)
        for (const r of footprints) best = Math.min(best, rectDistance(l, r))
        if (best === 0) return 0
    }
    return best
}

/**
 * The tent's place: the person keeps their spot under their feet and their gaze if that is clear
 * by `need` metres; otherwise the smallest turn and step that is, or, failing that, the clearest.
 * Returns { at, yaw, clearance, moved, turned }.
 */
export function fitTent({ head, gazeYaw, worker, footprints, obstacles, need = 0.3, maxStep = 1.0, step = 0.25 }) {
    const placeFor = (px, pz, yaw) => {
        const w = toWorld(worker, { x: 0, z: 0 }, yaw)
        return { x: px - w.x, z: pz - w.z }
    }
    const turns = [0]
    for (let k = 1; k <= 12; k++) turns.push(k * (Math.PI / 12), -k * (Math.PI / 12))
    const steps = [{ x: 0, z: 0 }]
    for (let r = step; r <= maxStep + 1e-9; r += step) {
        for (let a = 0; a < 16; a++) steps.push({ x: r * Math.cos((a * Math.PI) / 8), z: r * Math.sin((a * Math.PI) / 8) })
    }
    let best = null
    // prefer not moving the person over not turning them: a turn is cheaper than a walk
    for (const d of steps) {
        for (const t of turns) {
            const yaw = gazeYaw + t
            const at = placeFor(head.x + d.x, head.z + d.z, yaw)
            const c = clearance(obstacles, footprints, at, yaw)
            const cost = Math.hypot(d.x, d.z) * 2 + Math.abs(t)
            if (c >= need) {
                if (!best || !best.ok || cost < best.cost) best = { at, yaw, clearance: c, cost, ok: true, moved: Math.hypot(d.x, d.z), turned: t }
            } else if (!best || (!best.ok && c > best.clearance)) best = { at, yaw, clearance: c, cost, ok: false, moved: Math.hypot(d.x, d.z), turned: t }
        }
        // the cheapest clear place at this step is better than any at a longer one, unless turning a lot
        if (best?.ok && best.cost <= Math.hypot(d.x, d.z) * 2 + Math.PI / 2) break
    }
    return best
}
