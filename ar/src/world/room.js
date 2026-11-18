import * as THREE from 'three'

/** Heights (m over the floor) at which a flat surface can be worked on standing up. */
const MIN_TOP = 0.45
const MAX_TOP = 1.25
/** Surfaces too small to set a carton on are left out. */
const MIN_SIDE = 0.35
/**
 * The labels a headset gives (Meta Quest takes them from the person's Space Setup; other devices
 * may give none). Only a table, desk or counter is offered as a table: a cabinet, a box marked
 * "other" or a screen's volume can be at table height too, and cartons ended up floating on them.
 * A plane with no label at all is still offered, as the headset may simply not label anything.
 */
const WORKTOPS = /table|desk|counter|mesa/i
const NOT_WORKTOPS = /floor|ceiling|wall|door|window|bed|couch|screen|lamp|plant|other|storage|shelf/i

const up = new THREE.Vector3(0, 1, 0)
const tmp = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpM = new THREE.Matrix4()
const IDENTITY = new THREE.Matrix4()

/**
 * A flat horizontal rectangle in the room: its centre on the top, its own two horizontal axes
 * and how far it reaches along each (half sizes). `id` says where it came from (debug view).
 * @typedef {{ id?: string, center: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, hu: number, hv: number, top: number, label: string, real: boolean, source?: string }} Surface
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

/**
 * A detected plane, if it is one to work on. Its rectangle comes from the plane's own polygon: the
 * SDK draws each plane as a box centred on the plane's origin, but the polygon need not be centred
 * there, and taking the box's centre put the table off by that much.
 * `toScene` takes the headset's space into the scene's (see worldLock.js): identity until it moves.
 */
export function surfaceFromPlane(entity, plane, toScene = IDENTITY) {
    const object = entity.object3D
    if (!object || plane?.orientation !== 'horizontal' || !plane.polygon?.length) return null
    const label = plane.semanticLabel ?? ''
    if (NOT_WORKTOPS.test(label) || (label && !WORKTOPS.test(label))) return null
    object.updateMatrixWorld(true)
    const m = tmpM.multiplyMatrices(toScene, object.matrixWorld)
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const p of plane.polygon) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z)
        maxZ = Math.max(maxZ, p.z)
    }
    const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2).applyMatrix4(m)
    const { u, v } = axesOf(tmpQ.setFromRotationMatrix(m))
    return { id: `plano#${entity.index}`, center, u, v, hu: (maxX - minX) / 2, hv: (maxZ - minZ) / 2, top: center.y, label: label || 'sin etiqueta', real: true, source: 'plano' }
}

/** A detected piece of furniture (a mesh with bounds), if its top is one to work on. */
export function surfaceFromMesh(entity, { semanticLabel, min, max, isBounded3D }, toScene = IDENTITY) {
    const object = entity.object3D
    if (!object || !isBounded3D) return null
    if (NOT_WORKTOPS.test(semanticLabel) || !WORKTOPS.test(semanticLabel)) return null
    object.updateMatrixWorld(true)
    const m = tmpM.multiplyMatrices(toScene, object.matrixWorld)
    // the top face of its box, centred, in the room
    const local = new THREE.Vector3((min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2)
    const center = local.applyMatrix4(m)
    const { u, v } = axesOf(tmpQ.setFromRotationMatrix(m))
    return { id: `volumen#${entity.index}`, center, u, v, hu: (max[0] - min[0]) / 2, hv: (max[2] - min[2]) / 2, top: center.y, label: semanticLabel, real: true, source: 'volumen' }
}

/**
 * One table, one surface. A headset can report the same table twice, as a plane and as the top of
 * a volume: kept twice, the second copy got cartons of its own as if it were another table. Two
 * different tables, even side by side, have centres far apart and stay two.
 */
export function dedupeSurfaces(surfaces) {
    const kept = []
    const planesFirst = [...surfaces].sort((a, b) => (a.source === 'plano' ? 0 : 1) - (b.source === 'plano' ? 0 : 1))
    for (const s of planesFirst) {
        const twin = kept.find((k) => Math.hypot(k.center.x - s.center.x, k.center.z - s.center.z) < Math.max(0.12, Math.min(k.hu, k.hv, s.hu, s.hv) * 0.5) && Math.abs(k.top - s.top) < 0.06)
        if (twin) (twin.merged ??= []).push(s.id)
        else kept.push(s)
    }
    return kept
}

/** Whether two surfaces, found in different frames, are the same table. */
export function sameTable(a, b) {
    if (!a || !b) return false
    if (a.id && b.id) return a.id === b.id
    return Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) < 0.25 && Math.abs(a.top - b.top) < 0.08
}

/**
 * The one table in front of the person. A headset reports every table in the room, and marking them
 * all left the person to pick theirs out of the neighbours': only the one they are facing is
 * offered. What the gaze crosses comes first; failing that, whatever is nearest the middle of the
 * view, within `cone` of it and no further than `reach`. The table offered last (`current`) is held
 * until the head turns well past it (`hold`), so the mark does not jump between two tables side by
 * side. Nothing in front: nothing is offered, and the person shows their table by hand.
 */
export function tableInFront(surfaces, head, forward, current = null, { cone = Math.PI / 3, hold = Math.PI / 2, reach = 5 } = {}) {
    const dir = new THREE.Vector3(forward.x, 0, forward.z)
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1)
    dir.normalize()
    const ray = new THREE.Ray(new THREE.Vector3().copy(head), new THREE.Vector3().copy(forward).normalize())
    let best = null
    let score = Infinity
    for (const s of surfaces) {
        const to = new THREE.Vector3(s.center.x - head.x, 0, s.center.z - head.z)
        const away = to.length()
        if (away > reach) continue
        const angle = away < 1e-3 ? 0 : Math.acos(THREE.MathUtils.clamp(to.divideScalar(away).dot(dir), -1, 1))
        const crossed = Number.isFinite(rayHits(ray, s))
        const mine = sameTable(current, s)
        if (!crossed && angle > (mine ? hold : cone)) continue
        // what the eyes cross first of all, then what is nearest the middle of the view
        const its = (crossed ? 0 : 1) + angle / Math.PI + away / 1000 - (mine ? 0.15 : 0)
        if (its < score) {
            score = its
            best = s
        }
    }
    return best
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
