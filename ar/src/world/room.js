import * as THREE from 'three'

/** Heights (m over the floor) at which a flat surface can be worked on standing up. */
const MIN_TOP = 0.45
const MAX_TOP = 1.25
/** Surfaces too small to set a carton on are left out. */
const MIN_SIDE = 0.35
/** What the headset may call a surface one works on. */
const WORKTOPS = /table|desk|counter|mesa|other|storage|shelf/i
const NOT_WORKTOPS = /floor|ceiling|wall|door|window|bed|couch|screen|lamp|plant/i

const up = new THREE.Vector3(0, 1, 0)
const tmp = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()

/**
 * A flat horizontal rectangle in the room: its centre on the top, its own two horizontal axes
 * and how far it reaches along each (half sizes).
 * @typedef {{ center: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, hu: number, hv: number, top: number, label: string, real: boolean }} Surface
 */

/** Yaw only: whatever a plane's pose says, a worktop is taken as level. */
function axesOf(quaternion) {
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion)
    u.y = 0
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0)
    u.normalize()
    const v = new THREE.Vector3().crossVectors(u, up).negate().normalize()
    return { u, v }
}

/** A detected plane, if it is one to work on. */
export function surfaceFromPlane(entity, plane) {
    const object = entity.object3D
    if (!object || plane?.orientation !== 'horizontal') return null
    const label = plane.semanticLabel ?? ''
    if (NOT_WORKTOPS.test(label)) return null
    const params = object.geometry?.parameters
    if (!params) return null
    const top = object.position.y
    const { u, v } = axesOf(object.quaternion)
    return { center: object.position.clone(), u, v, hu: params.width / 2, hv: params.depth / 2, top, label, real: true }
}

/** A detected piece of furniture (a mesh with bounds), if its top is one to work on. */
export function surfaceFromMesh(entity, { semanticLabel, min, max, isBounded3D }) {
    const object = entity.object3D
    if (!object || !isBounded3D) return null
    if (NOT_WORKTOPS.test(semanticLabel) || !WORKTOPS.test(semanticLabel)) return null
    object.updateMatrixWorld(true)
    // the top face of its box, centred, in the room
    const local = new THREE.Vector3((min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2)
    const center = local.applyMatrix4(object.matrixWorld)
    object.getWorldQuaternion(tmpQ)
    const { u, v } = axesOf(tmpQ)
    return { center, u, v, hu: (max[0] - min[0]) / 2, hv: (max[2] - min[2]) / 2, top: center.y, label: semanticLabel, real: true }
}

/** Whether one can stand at it and work. */
export function isWorktop(s, floorY = 0) {
    const h = s.top - floorY
    return h > MIN_TOP && h < MAX_TOP && s.hu * 2 > MIN_SIDE && s.hv * 2 > MIN_SIDE
}

/**
 * What a person of this eye height works at comfortably standing: a little under the elbow.
 * Elbows are at some 0.63 of a person's height, the eyes at 0.94 of it.
 */
export function comfortableTop(eyeHeight) {
    const stature = eyeHeight / 0.936
    return THREE.MathUtils.clamp(stature * 0.54, 0.74, 1.0)
}

/** A surface of a given size at a point, square to where the person is. */
export function surfaceAt(point, head, { width = 1.1, depth = 0.6, label = 'virtual', real = false } = {}) {
    const toward = tmp.set(head.x - point.x, 0, head.z - point.z)
    if (toward.lengthSq() < 1e-4) toward.set(0, 0, 1)
    toward.normalize()
    const v = toward.clone()
    const u = new THREE.Vector3().crossVectors(up, v).normalize()
    // the near edge passes through the point: the table extends away from the person
    const center = point.clone().addScaledVector(v, -depth / 2)
    return { center, u, v, hu: width / 2, hv: depth / 2, top: point.y, label, real }
}

/** How far, along the ray, it crosses a surface's rectangle; Infinity if it does not. */
export function rayHits(ray, s) {
    if (Math.abs(ray.direction.y) < 1e-4) return Infinity
    const t = (s.top - ray.origin.y) / ray.direction.y
    if (t <= 0) return Infinity
    const p = tmp.copy(ray.origin).addScaledVector(ray.direction, t).sub(s.center)
    return Math.abs(p.dot(s.u)) <= s.hu + 0.05 && Math.abs(p.dot(s.v)) <= s.hv + 0.05 ? t : Infinity
}

/**
 * Where everything goes, for a person standing at one side of a table. The frame's origin is
 * on the floor under the middle of the table's near edge, in front of the person; −Z goes
 * into the table and beyond it, where people come from; +X is the person's right.
 */
export class WorkFrame {
    /** @param {Surface} s @param {THREE.Vector3} head @param {number} floorY */
    constructor(s, head, floorY = 0) {
        const rel = tmp.copy(head).sub(s.center)
        const pu = rel.dot(s.u)
        const pv = rel.dot(s.v)
        // the side the person stands at is the one they are furthest out from
        const alongV = Math.abs(pv) / s.hv >= Math.abs(pu) / s.hu
        const sideAxis = alongV ? s.v : s.u
        const lateralAxis = alongV ? s.u : s.v
        const sign = Math.sign(alongV ? pv : pu) || 1
        const halfDepth = alongV ? s.hv : s.hu
        const halfWidth = alongV ? s.hu : s.hv
        const lateral = alongV ? pu : pv
        // the work happens in front of the person, wherever along a long table they stand
        const shift = THREE.MathUtils.clamp(lateral, -halfWidth + 0.35, halfWidth - 0.35) || 0
        this.forward = sideAxis.clone().multiplyScalar(-sign)
        this.right = new THREE.Vector3().crossVectors(this.forward, up).normalize()
        this.origin = s.center
            .clone()
            .addScaledVector(sideAxis, sign * halfDepth)
            .addScaledVector(lateralAxis, shift)
        this.origin.y = floorY
        this.yaw = Math.atan2(-this.forward.x, -this.forward.z)
        this.quaternion = new THREE.Quaternion().setFromAxisAngle(up, this.yaw)
        this.top = s.top - floorY
        // how far the table reaches in front and to each side, in the frame
        this.depth = halfDepth * 2
        const edgeLeft = -halfWidth - shift
        const edgeRight = halfWidth - shift
        // the frame's +X may run against the lateral axis
        const flip = this.right.dot(lateralAxis) < 0
        this.minX = flip ? -edgeRight : edgeLeft
        this.maxX = flip ? -edgeLeft : edgeRight
        this.surface = s
        this.floorY = floorY
    }

    /** A point given in the frame (y over the floor), in the room. */
    at(x, y, z, out = new THREE.Vector3()) {
        return out.copy(this.origin).addScaledVector(this.right, x).addScaledVector(this.forward, -z).setY(this.floorY + y)
    }

    /** A point in the room, in the frame. */
    local(world, out = new THREE.Vector3()) {
        const d = tmp.copy(world).sub(this.origin)
        return out.set(d.dot(this.right), world.y - this.floorY, -d.dot(this.forward))
    }

    /** A yaw given in the frame, in the room. */
    turn(yaw) {
        return this.yaw + yaw
    }
}

/* ---------------- what is seen of a surface while choosing ---------------- */

let tint = null
function tintMaterial() {
    if (tint) return tint
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const c = canvas.getContext('2d')
    c.fillStyle = 'rgba(255,255,255,0.10)'
    c.fillRect(0, 0, 128, 128)
    c.strokeStyle = 'rgba(255,255,255,0.95)'
    c.lineWidth = 6
    c.setLineDash([14, 10])
    c.strokeRect(6, 6, 116, 116)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    tint = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, color: '#9FD3FF' })
    return tint
}

/** A soft outline over a surface, to say it can be chosen. */
export function surfaceMarker(s) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.hu * 2, s.hv * 2).rotateX(-Math.PI / 2), tintMaterial().clone())
    mesh.rotation.y = Math.atan2(-s.u.z, s.u.x)
    mesh.position.copy(s.center).setY(s.top + 0.004)
    mesh.renderOrder = 5
    mesh.pointerEvents = 'none'
    return mesh
}
