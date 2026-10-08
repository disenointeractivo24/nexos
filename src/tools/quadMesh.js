import * as THREE from 'three'

/**
 * Turn the experience's three.js geometries into quad-only meshes, keeping
 * their exact vertices.
 *
 * Every three.js primitive used here is a grid in which each cell is written as
 * two consecutive triangles; those pairs are joined back into the original
 * quads. The only places that are not grids are the triangle fans: cylinder
 * caps, circle discs, and the poles of spheres, cones and lathes. Those fans
 * are removed and the ring around them is filled with a quad-only patch (an
 * inner rectangle plus one ring of quads, like Blender's grid fill), flat for
 * caps and domed toward the pole or apex so the silhouette does not change.
 * Extruded shapes are rebuilt as prisms with quad caps.
 *
 * Output (in the mesh's own space, with any geometry translate/rotate applied):
 *   { positions: [x,y,z,...], faces: [a,b,c,d,...], uvs: [u,v ×4 per face], mats: [i per face], smooth }
 */

const EPS = 1e-5

class QMesh {
    constructor() {
        this.v = [] // THREE.Vector3
        this.f = [] // [a, b, c, d]
        this.uv = [] // [[u, v] ×4]
        this.mat = []
        this.keys = new Map()
    }

    /** Add a vertex, sharing it with any existing vertex at the same place. */
    vert(p) {
        const k = `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)},${Math.round(p.z / EPS)}`
        let i = this.keys.get(k)
        if (i === undefined) {
            i = this.v.length
            this.v.push(p.clone())
            this.keys.set(k, i)
        }
        return i
    }

    face(idx, uvs, mat = 0) {
        this.f.push(idx)
        this.uv.push(uvs)
        this.mat.push(mat)
    }

    normalOf(idx) {
        // Newell's method: robust for slightly non-planar quads
        const n = new THREE.Vector3()
        for (let i = 0; i < idx.length; i++) {
            const a = this.v[idx[i]], b = this.v[idx[(i + 1) % idx.length]]
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        }
        return n
    }

    centroid() {
        const c = new THREE.Vector3()
        for (const p of this.v) c.add(p)
        return c.divideScalar(Math.max(1, this.v.length))
    }

    out(smooth) {
        // drop vertices no face uses (fan centres, removed pole points)
        const used = new Map()
        const positions = []
        const remap = (i) => {
            if (!used.has(i)) {
                used.set(i, positions.length / 3)
                positions.push(+this.v[i].x.toFixed(6), +this.v[i].y.toFixed(6), +this.v[i].z.toFixed(6))
            }
            return used.get(i)
        }
        const faces = []
        for (const q of this.f) faces.push(...q.map(remap))
        return {
            positions,
            faces,
            uvs: this.uv.flat(2).map((x) => +x.toFixed(5)),
            mats: this.mat,
            smooth,
        }
    }
}

/* ------------------------------------------------------------------ */

const pos = (geo, i) => new THREE.Vector3().fromBufferAttribute(geo.attributes.position, i)
const uvAt = (geo, i) => (geo.attributes.uv ? [geo.attributes.uv.getX(i), geo.attributes.uv.getY(i)] : [0, 0])

function triangles(geo, start = 0, count = Infinity) {
    const index = geo.index
    const n = index ? index.count : geo.attributes.position.count
    const end = Math.min(n, start + count)
    const tris = []
    for (let i = start; i + 2 < end; i += 3) {
        tris.push(index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2])
    }
    return tris
}

function groupOf(geo, firstIndex) {
    for (let g = 0; g < geo.groups.length; g++) {
        const gr = geo.groups[g]
        if (firstIndex >= gr.start && firstIndex < gr.start + gr.count) return gr.materialIndex ?? 0
    }
    return 0
}

/**
 * Join consecutive triangle pairs into quads. Pairs that collapse to a single
 * triangle (a cell whose corners meet at a pole) are returned as `fans` so the
 * pole can be capped afterwards.
 */
function pairs(q, geo, tris, triBase = 0) {
    const fans = []
    for (let k = 0; k + 1 < tris.length; k += 2) {
        const t0 = tris[k], t1 = tris[k + 1]
        const w0 = t0.map((i) => q.vert(pos(geo, i)))
        const w1 = t1.map((i) => q.vert(pos(geo, i)))
        const mat = groupOf(geo, (triBase + k) * 3)
        const cornerUv = new Map()
        t0.forEach((i, j) => cornerUv.set(w0[j], uvAt(geo, i)))
        t1.forEach((i, j) => cornerUv.has(w1[j]) || cornerUv.set(w1[j], uvAt(geo, i)))
        const uniq = [...new Set([...w0, ...w1])]
        if (uniq.length === 4) {
            const shared = w0.filter((i) => w1.includes(i))
            const u0 = w0.find((i) => !w1.includes(i))
            const u1 = w1.find((i) => !w0.includes(i))
            if (shared.length !== 2 || u0 === undefined || u1 === undefined) {
                throw new Error('triangle pair is not a quad')
            }
            // keep t0's winding: u0, s1, u1, s2
            const r = w0.indexOf(u0)
            const s1 = w0[(r + 1) % 3], s2 = w0[(r + 2) % 3]
            const quad = [u0, s1, u1, s2]
            q.face(quad, quad.map((i) => cornerUv.get(i)), mat)
        } else if (uniq.length === 3) {
            // a cell squeezed to a point: part of a fan around a pole
            const tri = new Set(w0).size === 3 ? w0 : w1
            fans.push(tri)
        }
    }
    return fans
}

/** Group fan triangles by their shared centre and order each fan's outer edge into a loop. */
function fanLoops(q, fans) {
    const count = new Map()
    for (const t of fans) for (const i of t) count.set(i, (count.get(i) ?? 0) + 1)
    const byCentre = new Map()
    for (const t of fans) {
        const c = t.reduce((best, i) => ((count.get(i) ?? 0) > (count.get(best) ?? 0) ? i : best), t[0])
        if (!byCentre.has(c)) byCentre.set(c, [])
        const r = t.indexOf(c)
        byCentre.get(c).push([t[(r + 1) % 3], t[(r + 2) % 3]]) // the edge opposite the centre, in winding order
    }
    const loops = []
    for (const [centre, edges] of byCentre) {
        const loop = chain(edges)
        if (loop) loops.push({ centre, loop })
    }
    return loops
}

function chain(edges) {
    if (!edges.length) return null
    const next = new Map(edges.map(([a, b]) => [a, b]))
    const loop = [edges[0][0]]
    let cur = edges[0][1]
    for (let guard = 0; cur !== loop[0] && guard < edges.length + 2; guard++) {
        loop.push(cur)
        cur = next.get(cur)
        if (cur === undefined) return null
    }
    return loop.length === edges.length ? loop : null
}

/** Ordered boundary loops (edges used by exactly one face). */
function boundaryLoops(q) {
    const edgeCount = new Map()
    const dir = new Map()
    for (const f of q.f) {
        for (let i = 0; i < f.length; i++) {
            const a = f[i], b = f[(i + 1) % f.length]
            const k = a < b ? `${a}_${b}` : `${b}_${a}`
            edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1)
            dir.set(k, [a, b])
        }
    }
    const edges = []
    for (const [k, n] of edgeCount) if (n === 1) edges.push(dir.get(k))
    const loops = []
    const remaining = new Map(edges.map(([a, b]) => [a, b]))
    while (remaining.size) {
        const [start] = remaining.keys()
        const loop = [start]
        let cur = remaining.get(start)
        remaining.delete(start)
        while (cur !== undefined && cur !== start) {
            loop.push(cur)
            const nx = remaining.get(cur)
            remaining.delete(cur)
            cur = nx
        }
        if (cur === start && loop.length >= 3) loops.push(loop)
    }
    return loops
}

/**
 * Fill a closed ring of vertices with quads: an inner a×b grid whose border
 * has as many vertices as the ring, plus one ring of quads joining the two.
 *
 * shape: { kind: 'flat' } | { kind: 'linear', apex } | { kind: 'sphere', centre, radius }
 *   'linear' rises straight to an apex (cone tips, lathe poles), 'sphere'
 *   follows the sphere the pole belonged to.
 * outward: the direction the new faces must face.
 */
function fillRing(q, loop, shape, outward) {
    const N = loop.length
    if (N % 2) throw new Error(`cannot quad-fill a ring of ${N} vertices`)
    const P = loop.map((i) => q.v[i])
    const c = new THREE.Vector3()
    P.forEach((p) => c.add(p))
    c.divideScalar(N)
    // plane of the ring
    const n = new THREE.Vector3()
    for (let i = 0; i < N; i++) {
        const a = P[i], b = P[(i + 1) % N]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    }
    n.normalize()
    const e1 = P[0].clone().sub(c)
    e1.addScaledVector(n, -e1.dot(n)).normalize()
    const e2 = new THREE.Vector3().crossVectors(n, e1)
    const R = P.reduce((s, p) => s + p.distanceTo(c), 0) / N
    const ang = (p) => Math.atan2(p.clone().sub(c).dot(e2), p.clone().sub(c).dot(e1))

    // ring orientation in (e1, e2): positive = counter-clockwise
    let turn = 0
    for (let i = 0; i < N; i++) {
        let d = ang(P[(i + 1) % N]) - ang(P[i])
        if (d > Math.PI) d -= 2 * Math.PI
        if (d < -Math.PI) d += 2 * Math.PI
        turn += d
    }
    const ccw = turn > 0

    // inner rectangle with a + b + a + b border vertices = N
    const a = Math.max(1, Math.floor(N / 4))
    const b = N / 2 - a
    const m = Math.max(a, b)
    const hu = 0.5 * R * (a / m), hv = 0.5 * R * (b / m)
    const grid = [] // grid[i][j], i along u (0..a), j along v (0..b)
    const surface = (u, v) => {
        const p = c.clone().addScaledVector(e1, u).addScaledVector(e2, v)
        const d = Math.hypot(u, v)
        if (shape.kind === 'linear') {
            const rise = shape.apex.clone().sub(c).dot(n)
            p.addScaledVector(n, rise * (1 - Math.min(1, d / R)))
        } else if (shape.kind === 'sphere') {
            const towards = shape.towards ?? n
            const w = p.clone().sub(shape.centre)
            const wn = w.dot(towards)
            const disc = wn * wn - w.lengthSq() + shape.radius * shape.radius
            p.addScaledVector(towards, -wn + Math.sqrt(Math.max(0, disc)))
        }
        return p
    }
    for (let i = 0; i <= a; i++) {
        grid.push([])
        for (let j = 0; j <= b; j++) {
            const u = -hu + (2 * hu * i) / a
            const v = -hv + (2 * hv * j) / b
            grid[i].push(q.vert(surface(u, v)))
        }
    }
    const planarUv = (idx) => {
        const p = q.v[idx].clone().sub(c)
        return [0.5 + p.dot(e1) / (2 * R), 0.5 + p.dot(e2) / (2 * R)]
    }
    const addFace = (quad) => {
        const nn = q.normalOf(quad)
        const f = nn.dot(outward) < 0 ? [...quad].reverse() : quad
        q.face(f, f.map(planarUv), shape.mat ?? 0)
    }
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) addFace([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])

    // border of the rectangle, counter-clockwise from the (-u, -v) corner
    const border = []
    for (let i = 0; i < a; i++) border.push(grid[i][0])
    for (let j = 0; j < b; j++) border.push(grid[a][j])
    for (let i = a; i > 0; i--) border.push(grid[i][b])
    for (let j = b; j > 0; j--) border.push(grid[0][j])
    if (!ccw) border.reverse()
    // rotate the ring so its vertices line up with the border's directions
    let best = 0, bestErr = Infinity
    for (let s = 0; s < N; s++) {
        let err = 0
        for (let k = 0; k < N; k++) {
            let d = Math.abs(ang(q.v[border[k]]) - ang(P[(k + s) % N]))
            if (d > Math.PI) d = 2 * Math.PI - d
            err += d
        }
        if (err < bestErr) {
            bestErr = err
            best = s
        }
    }
    for (let k = 0; k < N; k++) {
        const r0 = loop[(k + best) % N], r1 = loop[(k + 1 + best) % N]
        addFace([r0, r1, border[(k + 1) % N], border[k]])
    }
}

/* ------------------------------------------------------------------ */

/** Capped ends and poles of a revolved surface (cylinder, cone, lathe, capsule, sphere). */
function capFans(q, fans, domeFor) {
    for (const { centre, loop } of fanLoops(q, fans)) {
        const apex = q.v[centre]
        const ringC = loop.reduce((s, i) => s.add(q.v[i]), new THREE.Vector3()).divideScalar(loop.length)
        const outward = apex.clone().sub(ringC)
        if (outward.lengthSq() < 1e-12) outward.copy(ringC).sub(q.centroid())
        const shape = domeFor(apex, ringC)
        fillRing(q, loop, { ...shape, towards: outward.clone().normalize() }, outward.normalize())
    }
}

function capLoops(q, loops, shouldCap, mat = 0) {
    const centroid = q.centroid()
    for (const loop of loops) {
        const ringC = loop.reduce((s, i) => s.add(q.v[i]), new THREE.Vector3()).divideScalar(loop.length)
        if (!shouldCap(ringC, loop)) continue
        const n = q.normalOf(loop).normalize()
        const outward = ringC.clone().sub(centroid).dot(n) < 0 ? n.negate() : n
        fillRing(q, loop, { kind: 'flat', mat }, outward)
    }
}

/* ------------------------------------------------------------------ */

function fromGrid(geo) {
    const q = new QMesh()
    pairs(q, geo, triangles(geo))
    // plain boxes and planes are flat; a rounded box (non-indexed box) is smooth
    const rounded = geo.type === 'BoxGeometry' && !geo.index
    return q.out(rounded || (geo.type !== 'BoxGeometry' && geo.type !== 'PlaneGeometry'))
}

function fromCylinder(geo) {
    const { radiusTop, radiusBottom, height, openEnded } = geo.parameters
    const q = new QMesh()
    const torso = geo.groups[0]
    const fans = pairs(q, geo, triangles(geo, torso.start, torso.count))
    // a cone's apex: its top cells collapse to a point
    capFans(q, fans, (apex) => ({ kind: 'linear', apex }))
    if (!openEnded) {
        const bake = geo.userData.bake ?? new THREE.Matrix4()
        const top = new THREE.Vector3(0, height / 2, 0).applyMatrix4(bake)
        const bottom = new THREE.Vector3(0, -height / 2, 0).applyMatrix4(bake)
        capLoops(q, boundaryLoops(q), (c) => (c.distanceTo(top) < 1e-3 && radiusTop > 0) || (c.distanceTo(bottom) < 1e-3 && radiusBottom > 0), 0)
    }
    return q.out(geo.parameters.radialSegments > 6)
}

function fromSphere(geo, { sphereDome = true } = {}) {
    const { widthSegments: W, heightSegments: H } = geo.parameters
    const q = new QMesh()
    // cell quads straight from the vertex grid (three.js emits single triangles at the poles)
    const fans = []
    const id = (iy, ix) => iy * (W + 1) + ix
    for (let iy = 0; iy < H; iy++) {
        for (let ix = 0; ix < W; ix++) {
            const src = [id(iy, ix + 1), id(iy, ix), id(iy + 1, ix), id(iy + 1, ix + 1)]
            const w = src.map((i) => q.vert(pos(geo, i)))
            const uniq = [...new Set(w)]
            if (uniq.length === 4) q.face(w, src.map((i) => uvAt(geo, i)))
            // a cell that touches a pole is a triangle: keep its three corners in winding order
            else if (uniq.length === 3) fans.push(w.filter((v, i) => v !== w[(i + 1) % 4]))
        }
    }
    const bake = geo.userData.bake ?? new THREE.Matrix4()
    const centre = new THREE.Vector3().applyMatrix4(bake)
    const radius = pos(geo, 0).distanceTo(centre)
    capFans(q, fans, (apex) => (sphereDome ? { kind: 'sphere', centre, radius } : { kind: 'linear', apex }))
    return q.out(true)
}

function fromLathe(geo) {
    const q = new QMesh()
    const fans = pairs(q, geo, triangles(geo))
    if (geo.type === 'CapsuleGeometry') {
        const { radius, length } = geo.parameters
        const bake = geo.userData.bake ?? new THREE.Matrix4()
        const ends = [new THREE.Vector3(0, length / 2, 0), new THREE.Vector3(0, -length / 2, 0)].map((p) => p.applyMatrix4(bake))
        capFans(q, fans, (apex) => {
            const centre = ends[0].distanceTo(apex) < ends[1].distanceTo(apex) ? ends[0] : ends[1]
            return { kind: 'sphere', centre, radius }
        })
    } else {
        capFans(q, fans, (apex) => ({ kind: 'linear', apex }))
    }
    return q.out(true)
}

function fromCircle(geo) {
    const { segments, thetaLength } = geo.parameters
    if (thetaLength < Math.PI * 2 - 1e-6) throw new Error('partial circles are not supported')
    const q = new QMesh()
    const loop = []
    for (let s = 0; s < segments; s++) loop.push(q.vert(pos(geo, s + 1)))
    const bake = geo.userData.bake ?? new THREE.Matrix4()
    const outward = new THREE.Vector3(0, 0, 1).transformDirection(bake)
    fillRing(q, loop, { kind: 'flat' }, outward)
    return q.out(false)
}

function fromTube(geo) {
    const q = new QMesh()
    pairs(q, geo, triangles(geo))
    // three.js leaves tube ends open; close them so the mesh is watertight
    capLoops(q, boundaryLoops(q), () => true)
    return q.out(true)
}

/**
 * Extruded shapes, rebuilt as prisms: the outline split at each edge's
 * midpoint (small outlines) so the end caps can be made of quads, or filled
 * like a disc (round outlines). Supports three.js's rounded bevel.
 */
function fromExtrude(geo) {
    const { shapes, options } = geo.parameters
    const shape = Array.isArray(shapes) ? shapes[0] : shapes
    let pts = shape.extractPoints(options.curveSegments ?? 12).shape.map((p) => p.clone())
    // a closed outline may repeat its first point at the end (sometimes off by rounding)
    if (pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop()
    const depth = options.depth ?? 1
    const bevel = options.bevelEnabled ?? true
    const bt = bevel ? options.bevelThickness ?? 0.2 : 0
    const bs = bevel ? options.bevelSize ?? bt - 0.1 : 0
    const bseg = bevel ? options.bevelSegments ?? 3 : 0
    const small = pts.length <= 6
    if (small) {
        // split each edge at its midpoint
        const split = []
        pts.forEach((p, i) => split.push(p, p.clone().add(pts[(i + 1) % pts.length]).multiplyScalar(0.5)))
        pts = split
    }
    const N = pts.length
    const centre2 = pts.reduce((s, p) => s.add(p), new THREE.Vector2()).divideScalar(N)
    // outward offset direction per vertex (for the bevel)
    const offsetDir = pts.map((p, i) => {
        const prev = pts[(i - 1 + N) % N], next = pts[(i + 1) % N]
        const t = next.clone().sub(prev).normalize()
        let d = new THREE.Vector2(t.y, -t.x)
        if (d.dot(p.clone().sub(centre2)) < 0) d.negate()
        return d
    })
    // rings along z: front bevel → body → back bevel (three.js layout)
    const rings = []
    if (bevel) {
        for (let k = 0; k <= bseg; k++) {
            const t = k / bseg
            rings.push({ z: -bt * Math.cos((t * Math.PI) / 2), s: bs * Math.sin((t * Math.PI) / 2) })
        }
        for (let k = bseg; k >= 0; k--) {
            const t = k / bseg
            rings.push({ z: depth + bt * Math.cos((t * Math.PI) / 2), s: bs * Math.sin((t * Math.PI) / 2) })
        }
    } else {
        rings.push({ z: 0, s: 0 }, { z: depth, s: 0 })
    }
    const bake = geo.userData.bake ?? new THREE.Matrix4()
    const q = new QMesh()
    const ringIdx = rings.map(({ z, s }) => pts.map((p, i) => q.vert(new THREE.Vector3(p.x + offsetDir[i].x * s, p.y + offsetDir[i].y * s, z).applyMatrix4(bake))))
    const centroid = q.centroid()
    const perim = [0]
    for (let i = 1; i <= N; i++) perim.push(perim[i - 1] + pts[i % N].distanceTo(pts[i - 1]))
    for (let r = 0; r + 1 < rings.length; r++) {
        for (let i = 0; i < N; i++) {
            const quad = [ringIdx[r][i], ringIdx[r][(i + 1) % N], ringIdx[r + 1][(i + 1) % N], ringIdx[r + 1][i]]
            if (new Set(quad).size < 4) continue
            const mid = quad.reduce((s, k) => s.add(q.v[k]), new THREE.Vector3()).divideScalar(4)
            const f = q.normalOf(quad).dot(mid.sub(centroid)) < 0 ? [...quad].reverse() : quad
            const v0 = r / (rings.length - 1), v1 = (r + 1) / (rings.length - 1)
            const uvOf = { [quad[0]]: [perim[i] / perim[N], v0], [quad[1]]: [perim[i + 1] / perim[N], v0], [quad[2]]: [perim[i + 1] / perim[N], v1], [quad[3]]: [perim[i] / perim[N], v1] }
            q.face(f, f.map((k) => uvOf[k]), 1)
        }
    }
    // end caps
    const front = new THREE.Vector3(0, 0, -1).transformDirection(bake)
    const back = new THREE.Vector3(0, 0, 1).transformDirection(bake)
    const caps = [
        [ringIdx[0], front],
        [ringIdx[rings.length - 1], back],
    ]
    for (const [ring, outward] of caps) {
        if (small) {
            // one quad per original corner: corner, next midpoint, centre, previous midpoint
            const centre = ring.reduce((s, k) => s.add(q.v[k]), new THREE.Vector3()).divideScalar(N)
            const ci = q.vert(centre)
            const box = new THREE.Box3().setFromPoints(ring.map((k) => q.v[k]))
            const size = box.getSize(new THREE.Vector3())
            const uvOf = (k) => {
                const p = q.v[k]
                return [(p.x - box.min.x) / (size.x || 1), (p.y - box.min.y) / (size.y || 1)]
            }
            for (let i = 0; i < N; i += 2) {
                const quad = [ring[i], ring[(i + 1) % N], ci, ring[(i - 1 + N) % N]]
                const f = q.normalOf(quad).dot(outward) < 0 ? [...quad].reverse() : quad
                q.face(f, f.map(uvOf), 0)
            }
        } else {
            fillRing(q, ring, { kind: 'flat', mat: 0 }, outward)
        }
    }
    return q.out(bevel)
}

/* ------------------------------------------------------------------ */

/**
 * Quad sphere (a subdivided cube pushed out to a sphere): the quad-only stand-in
 * for three.js's icosahedron blobs in the vegetation.
 */
export function quadSphere(radius, divisions = 4, centre = new THREE.Vector3()) {
    const q = new QMesh()
    const faces = [
        [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
        [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
        [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
        [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
        [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
        [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
    ]
    for (const [nrm, u, v] of faces) {
        const idx = []
        for (let i = 0; i <= divisions; i++) {
            idx.push([])
            for (let j = 0; j <= divisions; j++) {
                const a = -1 + (2 * i) / divisions, b = -1 + (2 * j) / divisions
                const p = nrm.clone().addScaledVector(u, a).addScaledVector(v, b).normalize().multiplyScalar(radius).add(centre)
                idx[i].push(q.vert(p))
            }
        }
        for (let i = 0; i < divisions; i++) {
            for (let j = 0; j < divisions; j++) {
                const quad = [idx[i][j], idx[i + 1][j], idx[i + 1][j + 1], idx[i][j + 1]]
                const mid = quad.reduce((s, k) => s.add(q.v[k]), new THREE.Vector3()).divideScalar(4)
                const f = q.normalOf(quad).dot(mid.sub(centre)) < 0 ? [...quad].reverse() : quad
                q.face(f, f.map((k, n) => [[0, 0], [1, 0], [1, 1], [0, 1]][n]))
            }
        }
    }
    return q
}

/** Merge several quad meshes (raw QMesh) into one, keeping each one's faces. */
export function mergeQ(list, smooth = true) {
    const all = new QMesh()
    for (const q of list) {
        const map = q.v.map((p) => {
            all.v.push(p.clone())
            return all.v.length - 1
        })
        q.f.forEach((f, i) => all.face(f.map((k) => map[k]), q.uv[i], q.mat[i]))
    }
    return all.out(smooth)
}

/** Apply `fn(vector)` to every vertex of a raw QMesh (for deformations done after building). */
export function deformQ(q, fn) {
    q.v.forEach((p) => fn(p))
    return q
}

/** Raw QMesh for a three.js geometry, for callers that deform it afterwards. */
export function rawQ(geometry, opts) {
    const out = toQuadMesh(geometry, opts)
    const q = new QMesh()
    for (let i = 0; i < out.positions.length; i += 3) q.v.push(new THREE.Vector3(out.positions[i], out.positions[i + 1], out.positions[i + 2]))
    for (let f = 0; f < out.faces.length / 4; f++) {
        q.face(out.faces.slice(f * 4, f * 4 + 4), [0, 1, 2, 3].map((k) => [out.uvs[f * 8 + k * 2], out.uvs[f * 8 + k * 2 + 1]]), out.mats[f])
    }
    return q
}

export { QMesh }

/** Convert any supported three.js geometry. */
export function toQuadMesh(geometry, opts = {}) {
    switch (geometry.type) {
        case 'BoxGeometry':
        case 'PlaneGeometry':
        case 'TorusGeometry':
        case 'RingGeometry':
            return fromGrid(geometry)
        case 'CylinderGeometry':
        case 'ConeGeometry':
            return fromCylinder(geometry)
        case 'SphereGeometry':
            return fromSphere(geometry, opts)
        case 'LatheGeometry':
        case 'CapsuleGeometry':
            return fromLathe(geometry)
        case 'CircleGeometry':
            return fromCircle(geometry)
        case 'TubeGeometry':
            return fromTube(geometry)
        case 'ExtrudeGeometry':
            return fromExtrude(geometry)
        default:
            throw new Error(`unsupported geometry: ${geometry.type}`)
    }
}
