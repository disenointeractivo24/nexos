import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Geometry builders for vegetation. They return plain geometries meant for
 * InstancedMesh (one draw call per kind, colour varied per instance).
 */

/** Indexed, smooth-shaded icosphere (position + normal only). */
function blob(r, detail) {
    const g = new THREE.IcosahedronGeometry(r, detail)
    g.deleteAttribute('uv')
    g.deleteAttribute('normal')
    const m = mergeVertices(g)
    m.computeVertexNormals()
    return m
}

function jitter(geo, amount, seed = 1) {
    let s = seed
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const pos = geo.attributes.position
    const map = new Map()
    for (let i = 0; i < pos.count; i++) {
        const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`
        if (!map.has(key)) map.set(key, [(rnd() - 0.5) * amount, (rnd() - 0.5) * amount, (rnd() - 0.5) * amount])
        const d = map.get(key)
        pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2])
    }
    geo.computeVertexNormals()
    return geo
}

/**
 * The shapes below are described by these tables, which the FBX exporter
 * (tools/export-models) reads too, so exported vegetation matches the scene.
 *   blobs   [x, y, z, radius] soft spheres merged into one canopy or bush
 *   jitter  how far each vertex is nudged, and the seed that drives it
 */
export const CANOPY = {
    blobs: [
        [0, 0.95, 0, 1.0],
        [0.55, 0.7, 0.2, 0.72],
        [-0.45, 0.65, -0.25, 0.75],
        [0.05, 1.55, -0.05, 0.66],
    ],
    jitter: 0.12,
    seed: 7,
}
export const TRUNK = { radiusTop: 0.11, radiusBottom: 0.16, height: 1.2, segments: 7 }
export const BUSH = {
    blobs: [
        [0, 0.42, 0, 0.55],
        [0.42, 0.32, 0.1, 0.4],
        [-0.38, 0.3, -0.05, 0.42],
    ],
    jitter: 0.08,
    seed: 3,
}
/** Palm: a slim curved trunk through `spine`, and fronds that droop by `droop` toward their tips. */
export const PALM = {
    spine: [[0, 0, 0], [0.08, 1.4, 0], [0.25, 2.8, 0], [0.4, 3.9, 0]],
    trunk: { radius: 0.11, tubular: 8, radial: 6, color: '#8C7A64' },
    frond: { count: 7, radius: 0.5, scale: [1.4, 0.12, 0.32], offset: 0.7, droop: 0.55, turn: 0.3, color: '#7E9F69' },
}

/** Rounded canopy: three soft blobs. Base at y=0 (sits on the trunk top). */
export function canopyGeometry(detail = 1) {
    const parts = CANOPY.blobs.map(([x, y, z, r]) => blob(r, detail).translate(x, y, z))
    return jitter(mergeGeometries(parts), CANOPY.jitter, CANOPY.seed)
}

export function trunkGeometry() {
    const g = new THREE.CylinderGeometry(TRUNK.radiusTop, TRUNK.radiusBottom, TRUNK.height, TRUNK.segments)
    g.translate(0, TRUNK.height / 2, 0)
    return g
}

export function bushGeometry(detail = 1) {
    const parts = BUSH.blobs.map(([x, y, z, r]) => blob(r, detail).translate(x, y, z))
    return jitter(mergeGeometries(parts), BUSH.jitter, BUSH.seed)
}

/** Palm (Cali streets): slim curved trunk + drooping fronds, one geometry with vertex colours. */
export function palmGeometry() {
    const trunkColor = new THREE.Color(PALM.trunk.color)
    const leafColor = new THREE.Color(PALM.frond.color)
    const parts = []
    const F = PALM.frond

    const curve = new THREE.CatmullRomCurve3(PALM.spine.map((p) => new THREE.Vector3(...p)))
    const trunk = new THREE.TubeGeometry(curve, PALM.trunk.tubular, PALM.trunk.radius, PALM.trunk.radial, false)
    paint(trunk, trunkColor)
    parts.push(trunk.toNonIndexed())

    const top = curve.getPoint(1)
    for (let i = 0; i < F.count; i++) {
        const leaf = new THREE.SphereGeometry(F.radius, 8, 4)
        leaf.scale(...F.scale)
        leaf.translate(F.offset, 0, 0)
        // droop
        const p = leaf.attributes.position
        for (let k = 0; k < p.count; k++) {
            const x = p.getX(k)
            p.setY(k, p.getY(k) - Math.pow(Math.max(x, 0) / F.scale[0], 2) * F.droop)
        }
        leaf.rotateY((i / F.count) * Math.PI * 2 + F.turn)
        leaf.translate(top.x, top.y, top.z)
        leaf.computeVertexNormals()
        paint(leaf, leafColor)
        parts.push(leaf.toNonIndexed())
    }
    return mergeGeometries(parts)
}

function paint(geo, color) {
    const n = geo.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) color.toArray(arr, i * 3)
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
}
