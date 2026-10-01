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

/** Rounded canopy: three soft blobs. Base at y=0 (sits on the trunk top). */
export function canopyGeometry(detail = 1) {
    const parts = [
        [0, 0.95, 0, 1.0],
        [0.55, 0.7, 0.2, 0.72],
        [-0.45, 0.65, -0.25, 0.75],
        [0.05, 1.55, -0.05, 0.66],
    ].map(([x, y, z, r]) => blob(r, detail).translate(x, y, z))
    return jitter(mergeGeometries(parts), 0.12, 7)
}

export function trunkGeometry() {
    const g = new THREE.CylinderGeometry(0.11, 0.16, 1.2, 7)
    g.translate(0, 0.6, 0)
    return g
}

export function bushGeometry(detail = 1) {
    const parts = [
        [0, 0.42, 0, 0.55],
        [0.42, 0.32, 0.1, 0.4],
        [-0.38, 0.3, -0.05, 0.42],
    ].map(([x, y, z, r]) => blob(r, detail).translate(x, y, z))
    return jitter(mergeGeometries(parts), 0.08, 3)
}

/** Palm (Cali streets): slim curved trunk + drooping fronds, one geometry with vertex colours. */
export function palmGeometry() {
    const trunkColor = new THREE.Color('#8C7A64')
    const leafColor = new THREE.Color('#7E9F69')
    const parts = []

    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.08, 1.4, 0),
        new THREE.Vector3(0.25, 2.8, 0),
        new THREE.Vector3(0.4, 3.9, 0),
    ])
    const trunk = new THREE.TubeGeometry(curve, 8, 0.11, 6, false)
    paint(trunk, trunkColor)
    parts.push(trunk.toNonIndexed())

    const top = curve.getPoint(1)
    for (let i = 0; i < 7; i++) {
        const leaf = new THREE.SphereGeometry(0.5, 8, 4)
        leaf.scale(1.4, 0.12, 0.32)
        leaf.translate(0.7, 0, 0)
        // droop
        const p = leaf.attributes.position
        for (let k = 0; k < p.count; k++) {
            const x = p.getX(k)
            p.setY(k, p.getY(k) - Math.pow(Math.max(x, 0) / 1.4, 2) * 0.55)
        }
        leaf.rotateY((i / 7) * Math.PI * 2 + 0.3)
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
