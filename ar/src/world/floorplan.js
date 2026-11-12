import * as THREE from 'three'

/** Heights over the floor (m) at which something is in the way of someone standing or walking. */
const BODY_LOW = 0.12
const BODY_HIGH = 1.85

const SQRT2 = Math.SQRT2

/**
 * The floor of the room as the headset scanned it, in the work frame (x right, z towards the
 * person, metres), as a grid: what is taken by walls, furniture and whatever else is there, and
 * what can be reached walking from where the person stands. Everything that stands on the floor
 * (people, piles, the shelf) is placed only where this says there is room, and people walk around
 * what is in the way.
 */
export class FloorPlan {
    constructor({ cell = 0.1, minX = -4.5, maxX = 4.5, minZ = -6, maxZ = 3 } = {}) {
        this.cell = cell
        this.minX = minX
        this.minZ = minZ
        this.cols = Math.ceil((maxX - minX) / cell)
        this.rows = Math.ceil((maxZ - minZ) / cell)
        this.blocked = new Uint8Array(this.cols * this.rows)
        this.clearance = null
        this.reachable = null
    }

    #index(x, z) {
        const c = Math.floor((x - this.minX) / this.cell)
        const r = Math.floor((z - this.minZ) / this.cell)
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1
        return r * this.cols + c
    }

    #center(i, out = new THREE.Vector2()) {
        return out.set(this.minX + ((i % this.cols) + 0.5) * this.cell, this.minZ + (Math.floor(i / this.cols) + 0.5) * this.cell)
    }

    /** Something at a point of the floor. */
    blockPoint(x, z) {
        const i = this.#index(x, z)
        if (i >= 0) this.blocked[i] = 1
    }

    /** A wall or anything thin, from one point to another, with some thickness. */
    blockSegment(a, b, thickness = this.cell) {
        const steps = Math.max(1, Math.ceil(a.distanceTo(b) / (this.cell / 2)))
        for (let s = 0; s <= steps; s++) {
            const x = a.x + ((b.x - a.x) * s) / steps
            const y = a.y + ((b.y - a.y) * s) / steps
            for (let dx = -thickness / 2; dx <= thickness / 2; dx += this.cell / 2) {
                for (let dz = -thickness / 2; dz <= thickness / 2; dz += this.cell / 2) this.blockPoint(x + dx, y + dz)
            }
        }
    }

    /** A footprint: any convex polygon of floor points (x, z as Vector2). */
    blockPolygon(points) {
        if (points.length < 3) return points.forEach((p) => this.blockPoint(p.x, p.y))
        const xs = points.map((p) => p.x)
        const zs = points.map((p) => p.y)
        const p = new THREE.Vector2()
        for (let x = Math.min(...xs); x <= Math.max(...xs) + 1e-6; x += this.cell / 2) {
            for (let z = Math.min(...zs); z <= Math.max(...zs) + 1e-6; z += this.cell / 2) {
                p.set(x, z)
                if (inside(points, p)) this.blockPoint(x, z)
            }
        }
        // the outline itself, so nothing thin slips between the samples
        points.forEach((a, i) => this.blockSegment(a, points[(i + 1) % points.length], this.cell / 2))
    }

    /** A rectangle centred at (x, z), with half sizes and a turn (yaw, radians) in the frame. */
    blockRect(x, z, hw, hd, yaw = 0) {
        const c = Math.cos(yaw)
        const s = Math.sin(yaw)
        const corner = (u, v) => new THREE.Vector2(x + u * c + v * s, z - u * s + v * c)
        this.blockPolygon([corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)])
    }

    /**
     * Done adding: what can be reached walking from `start`, and how far each free spot is from
     * the nearest thing in the way (which is how much room it has).
     */
    finalize(start) {
        const n = this.blocked.length
        // how far from anything in the way, in metres: a two-pass chamfer distance
        const d = new Float32Array(n).fill(1e6)
        for (let i = 0; i < n; i++) if (this.blocked[i]) d[i] = 0
        const { cols, rows, cell } = this
        const at = (c, r) => r * cols + c
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const i = at(c, r)
                if (c > 0) d[i] = Math.min(d[i], d[at(c - 1, r)] + cell)
                if (r > 0) d[i] = Math.min(d[i], d[at(c, r - 1)] + cell)
                if (c > 0 && r > 0) d[i] = Math.min(d[i], d[at(c - 1, r - 1)] + cell * SQRT2)
                if (c < cols - 1 && r > 0) d[i] = Math.min(d[i], d[at(c + 1, r - 1)] + cell * SQRT2)
            }
        }
        for (let r = rows - 1; r >= 0; r--) {
            for (let c = cols - 1; c >= 0; c--) {
                const i = at(c, r)
                if (c < cols - 1) d[i] = Math.min(d[i], d[at(c + 1, r)] + cell)
                if (r < rows - 1) d[i] = Math.min(d[i], d[at(c, r + 1)] + cell)
                if (c < cols - 1 && r < rows - 1) d[i] = Math.min(d[i], d[at(c + 1, r + 1)] + cell * SQRT2)
                if (c > 0 && r < rows - 1) d[i] = Math.min(d[i], d[at(c - 1, r + 1)] + cell * SQRT2)
            }
        }
        this.clearance = d
        // the room's limit: only what can be walked to from where the person stands
        this.reachable = new Uint8Array(n)
        let s = this.#index(start.x, start.y ?? start.z)
        if (s < 0) return
        if (this.blocked[s]) s = this.#nearestOpen(s)
        if (s < 0) return
        const queue = [s]
        this.reachable[s] = 1
        while (queue.length) {
            const i = queue.pop()
            const c = i % cols
            const r = Math.floor(i / cols)
            for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nc = c + dc
                const nr = r + dr
                if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
                const j = at(nc, nr)
                // a gap narrower than a body does not lead anywhere
                if (this.reachable[j] || this.blocked[j] || d[j] < 0.15) continue
                this.reachable[j] = 1
                queue.push(j)
            }
        }
    }

    #nearestOpen(i) {
        const p = this.#center(i)
        let best = -1
        let bestD = Infinity
        const q = new THREE.Vector2()
        for (let j = 0; j < this.blocked.length; j++) {
            if (this.blocked[j]) continue
            const dd = this.#center(j, q).distanceToSquared(p)
            if (dd < bestD) {
                bestD = dd
                best = j
            }
        }
        return best
    }

    /** Whether something of this radius can stand at (x, z): within the room and with room around it. */
    free(x, z, radius = 0.3) {
        const i = this.#index(x, z)
        if (i < 0 || !this.clearance) return false
        return !!this.reachable[i] && this.clearance[i] >= radius
    }

    /** The free spot of this radius nearest to (x, z) that also passes `accept`, within `reach`. */
    nearestFree(x, z, radius, { reach = 2, accept = () => true } = {}) {
        let best = null
        let bestD = reach * reach
        for (let i = 0; i < this.blocked.length; i++) {
            if (!this.reachable?.[i] || this.clearance[i] < radius) continue
            const p = this.#center(i)
            const dd = (p.x - x) ** 2 + (p.y - z) ** 2
            if (dd < bestD && accept(p.x, p.y)) {
                bestD = dd
                best = { x: p.x, z: p.y }
            }
        }
        return best
    }

    /**
     * A way on foot from one point to another for someone of this radius, around what is in the
     * way: the corners of the way, the last one the destination. Straight when there is no way.
     */
    path(from, to, radius = 0.22, avoid = [], keep = 0) {
        const s = this.#index(from.x, from.z)
        const t = this.#index(to.x, to.z)
        const direct = [new THREE.Vector3(to.x, 0, to.z)]
        if (s < 0 || t < 0 || !this.clearance) return direct
        // people standing about are in the way too, for this walk: none closer than `keep`
        const near = new Uint8Array(this.blocked.length)
        if (avoid.length && keep > 0) {
            const q = new THREE.Vector2()
            for (let i = 0; i < near.length; i++) {
                this.#center(i, q)
                if (avoid.some((a) => (a.x - q.x) ** 2 + (a.z - q.y) ** 2 < keep * keep)) near[i] = 1
            }
        }
        const ok = (i) => ((this.clearance[i] >= radius && !near[i]) || i === s || i === t)
        const { cols, rows, cell } = this
        const g = new Float32Array(this.blocked.length).fill(Infinity)
        const came = new Int32Array(this.blocked.length).fill(-1)
        const goal = this.#center(t)
        const h = (i) => this.#center(i).distanceTo(goal)
        // a small binary heap on f = g + h
        const heap = []
        const push = (i, f) => {
            heap.push([f, i])
            let k = heap.length - 1
            while (k > 0) {
                const p = (k - 1) >> 1
                if (heap[p][0] <= heap[k][0]) break
                ;[heap[p], heap[k]] = [heap[k], heap[p]]
                k = p
            }
        }
        const pop = () => {
            const top = heap[0]
            const last = heap.pop()
            if (heap.length) {
                heap[0] = last
                let k = 0
                for (;;) {
                    const l = 2 * k + 1
                    const r = l + 1
                    let m = k
                    if (l < heap.length && heap[l][0] < heap[m][0]) m = l
                    if (r < heap.length && heap[r][0] < heap[m][0]) m = r
                    if (m === k) break
                    ;[heap[m], heap[k]] = [heap[k], heap[m]]
                    k = m
                }
            }
            return top[1]
        }
        g[s] = 0
        push(s, h(s))
        let found = false
        let guard = 0
        while (heap.length && guard++ < 40000) {
            const i = pop()
            if (i === t) {
                found = true
                break
            }
            const c = i % cols
            const r = Math.floor(i / cols)
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (!dc && !dr) continue
                    const nc = c + dc
                    const nr = r + dr
                    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
                    const j = nr * cols + nc
                    if (!ok(j)) continue
                    const cost = g[i] + (dc && dr ? cell * SQRT2 : cell)
                    if (cost < g[j]) {
                        g[j] = cost
                        came[j] = i
                        push(j, cost + h(j))
                    }
                }
            }
        }
        if (!found) return direct
        const cells = []
        for (let i = t; i !== -1; i = came[i]) cells.unshift(i)
        // only the corners: a point is kept when the straight line past it would cut a corner
        const points = cells.map((i) => this.#center(i))
        const corners = []
        let anchor = new THREE.Vector2(from.x, from.z)
        for (let k = 1; k < points.length; k++) {
            if (!this.#clearLine(anchor, points[k], radius, near)) {
                corners.push(points[k - 1])
                anchor = points[k - 1]
            }
        }
        corners.push(new THREE.Vector2(to.x, to.z))
        return corners.map((p) => new THREE.Vector3(p.x, 0, p.y))
    }

    #clearLine(a, b, radius, near = null) {
        const steps = Math.max(1, Math.ceil(a.distanceTo(b) / (this.cell / 2)))
        for (let s = 1; s < steps; s++) {
            const i = this.#index(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps)
            if (i < 0 || this.clearance[i] < radius || near?.[i]) return false
        }
        return true
    }
}

/** Whether a point is inside a convex or simple polygon. */
function inside(points, p) {
    let isIn = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]
        const b = points[j]
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) isIn = !isIn
    }
    return isIn
}

export { BODY_HIGH, BODY_LOW }
