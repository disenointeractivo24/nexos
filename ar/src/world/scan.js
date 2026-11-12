import * as THREE from 'three'
import { XRMesh, XRPlane } from '@iwsdk/core'
import { readRoom } from '../sim/room.js'

/**
 * What the headset says is around the person, turned into the flat rectangles the shift's
 * rules read. The Quest reports the room the person traced in Space Setup: a mesh per piece
 * of furniture with a label on it, and a plane per flat face.
 *
 * Nothing here decides anything: it measures. What belongs where is in sim/room.js.
 */

const temp = new THREE.Vector3()
const size = new THREE.Vector3()
const quat = new THREE.Quaternion()
const scale = new THREE.Vector3()
const euler = new THREE.Euler()

/** The yaw an object is turned by in the world, with any lean ignored: rooms are upright. */
function yawOf(object) {
    object.getWorldQuaternion(quat)
    euler.setFromQuaternion(quat, 'YXZ')
    return euler.y
}

/**
 * One labelled thing, as a rectangle on the floor plan with a top and a bottom.
 * A mesh's min/max are in its own space, so the centre has to travel through its transform.
 */
function fromMesh(entity) {
    const object = entity.object3D
    if (!object) return null
    const min = entity.getVectorView(XRMesh, 'min')
    const max = entity.getVectorView(XRMesh, 'max')
    object.updateWorldMatrix(true, false)
    object.matrixWorld.decompose(temp, quat, scale)
    size.set((max[0] - min[0]) * Math.abs(scale.x), (max[1] - min[1]) * Math.abs(scale.y), (max[2] - min[2]) * Math.abs(scale.z))
    // the middle of the box, carried out of the mesh's own space into the room
    const centre = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2).applyMatrix4(object.matrixWorld)
    return {
        semanticLabel: entity.getValue(XRMesh, 'semanticLabel') || 'other',
        cx: centre.x,
        cz: centre.z,
        w: size.x,
        d: size.z,
        yaw: yawOf(object),
        top: centre.y + size.y / 2,
        bottom: centre.y - size.y / 2,
    }
}

/**
 * A plane is a flat face with no thickness. Only the horizontal ones can be stood on, and
 * only those the runtime put a label on can be told apart.
 */
function fromPlane(entity) {
    const object = entity.object3D
    const plane = entity.getValue(XRPlane, '_plane')
    if (!object || !plane || plane.orientation !== 'horizontal') return null
    const polygon = plane.polygon ?? []
    if (polygon.length < 3) return null
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const p of polygon) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z)
        maxZ = Math.max(maxZ, p.z)
    }
    object.updateWorldMatrix(true, false)
    const centre = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2).applyMatrix4(object.matrixWorld)
    return {
        semanticLabel: plane.semanticLabel || 'other',
        cx: centre.x,
        cz: centre.z,
        w: maxX - minX,
        d: maxZ - minZ,
        yaw: yawOf(object),
        top: centre.y,
        bottom: centre.y,
    }
}

/**
 * Everything the headset currently reports. Meshes come first: they carry the labels and a
 * real thickness. Planes only fill in a surface no mesh covered.
 * @returns the flat list, ready for {@link readRoom}
 */
export function measure(queries) {
    const found = []
    for (const entity of queries.meshes.entities) {
        const rect = fromMesh(entity)
        if (rect && rect.w > 0.05 && rect.d > 0.05) found.push(rect)
    }
    for (const entity of queries.planes.entities) {
        const rect = fromPlane(entity)
        if (!rect || rect.w < 0.05 || rect.d < 0.05) continue
        // a plane sitting on top of a mesh already counted is the same piece of furniture
        const already = found.some((m) => Math.abs(m.top - rect.top) < 0.06 && Math.hypot(m.cx - rect.cx, m.cz - rect.cz) < Math.max(m.w, m.d) / 2)
        if (!already) found.push(rect)
    }
    return found
}

/** The room as the shift needs it, or null while the headset has reported nothing yet. */
export function scan(queries) {
    const found = measure(queries)
    if (!found.length) return null
    const room = readRoom(found)
    return room.surface ? room : { ...room, found }
}

/**
 * What was found, drawn where it was found: a wire box per label with its name on it, so the
 * person in the headset can see what the room model actually says. Only for looking at.
 */
export function debugRoom(found, scene) {
    const group = new THREE.Group()
    group.name = 'nexos-debug-room'
    const colours = { table: 0x3bd16f, floor: 0xffd23b, screen: 0xff5252, wall: 0x4a6b8a, ceiling: 0x4a6b8a }
    for (const m of found) {
        const height = Math.max(0.01, (m.top ?? 0) - (m.bottom ?? m.top ?? 0))
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(m.w, height, m.d),
            new THREE.MeshBasicMaterial({ color: colours[m.semanticLabel] ?? 0xbbbbbb, wireframe: true, transparent: true, opacity: 0.85 })
        )
        mesh.position.set(m.cx, (m.top + (m.bottom ?? m.top)) / 2, m.cz)
        mesh.rotation.y = m.yaw
        group.add(mesh)
        group.add(labelAt(m.semanticLabel, m.cx, m.top + 0.04, m.cz))
    }
    scene.add(group)
    return group
}

/** The label's name, floating just over what it names. */
function labelAt(text, x, y, z) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.fillRect(0, 0, 256, 64)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 34px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 128, 32)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }))
    sprite.scale.set(0.3, 0.075, 1)
    sprite.position.set(x, y, z)
    return sprite
}
