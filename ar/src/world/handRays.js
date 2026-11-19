import * as THREE from 'three'

/**
 * A ray from each hand (or controller), always shown, not only over a button: a line to where it
 * points and a target where it meets a surface. Also whether each hand is pinching, and where.
 * Everything in scene coordinates (the reference space through the player's matrix).
 *
 * Surfaces are rectangles: { center: Vector3, ax, az: Vector3 (unit, horizontal), ex, ez, top }.
 */
const RAY_COLOR = '#3EE0C5'
const TARGET_COLOR = '#E5242B'
const PINCH_ON = 0.022
const PINCH_OFF = 0.04
const MAX_LENGTH = 3

function target() {
    const g = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ color: TARGET_COLOR, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide })
    g.add(new THREE.Mesh(new THREE.RingGeometry(0.05, 0.058, 40), mat))
    g.add(new THREE.Mesh(new THREE.RingGeometry(0.025, 0.032, 32), mat))
    g.add(new THREE.Mesh(new THREE.CircleGeometry(0.009, 16), mat))
    g.children.forEach((m) => m.geometry.rotateX(-Math.PI / 2))
    g.renderOrder = 30
    g.children.forEach((m) => (m.renderOrder = 30))
    return g
}

function line() {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)])
    const l = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: RAY_COLOR, transparent: true, opacity: 0.9, depthTest: false }))
    l.renderOrder = 29
    l.frustumCulled = false
    return l
}

/** Where a ray meets a rectangle's top, or null. */
export function rayOnRect(origin, dir, r) {
    if (Math.abs(dir.y) < 1e-4) return null
    const t = (r.top - origin.y) / dir.y
    if (t <= 0) return null
    const p = origin.clone().addScaledVector(dir, t)
    const d = p.clone().sub(r.center)
    if (Math.abs(d.dot(r.ax)) > r.ex / 2 || Math.abs(d.dot(r.az)) > r.ez / 2) return null
    return { t, point: p }
}

export class HandRays {
    constructor(scene) {
        this.scene = scene
        this.hands = {}
        this.visible = true
    }

    #hand(side) {
        if (!this.hands[side]) {
            const h = { line: line(), target: target(), pinching: false, pinch: new THREE.Vector3(), origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), hit: null, seen: false }
            this.scene.add(h.line, h.target)
            this.hands[side] = h
        }
        return this.hands[side]
    }

    /** Each frame, with the surfaces the rays may land on. */
    update(frame, space, player, surfaces = []) {
        for (const h of Object.values(this.hands)) h.seen = false
        if (!frame || !space) return this.#hide()
        const toScene = player?.matrixWorld ?? new THREE.Matrix4()
        const q = new THREE.Quaternion()
        const sceneQ = new THREE.Quaternion().setFromRotationMatrix(toScene)
        for (const source of frame.session.inputSources) {
            const side = source.handedness
            if (side !== 'left' && side !== 'right') continue
            const pose = source.targetRaySpace && frame.getPose(source.targetRaySpace, space)
            if (!pose) continue
            const h = this.#hand(side)
            h.seen = true
            const { position: p, orientation: o } = pose.transform
            h.origin.set(p.x, p.y, p.z).applyMatrix4(toScene)
            h.dir.set(0, 0, -1).applyQuaternion(q.set(o.x, o.y, o.z, o.w)).applyQuaternion(sceneQ).normalize()
            // pinching: thumb and index tips together (with a margin to let go), or a controller's trigger
            if (source.hand) {
                const tip = (name) => {
                    const joint = source.hand.get(name)
                    const jp = joint && frame.getJointPose?.(joint, space)
                    return jp ? new THREE.Vector3(jp.transform.position.x, jp.transform.position.y, jp.transform.position.z).applyMatrix4(toScene) : null
                }
                const a = tip('thumb-tip')
                const b = tip('index-finger-tip')
                if (a && b) {
                    const d = a.distanceTo(b)
                    h.pinching = h.pinching ? d < PINCH_OFF : d < PINCH_ON
                    h.pinch.addVectors(a, b).multiplyScalar(0.5)
                } else h.pinching = false
            } else {
                h.pinching = !!source.gamepad?.buttons?.[0]?.pressed
                h.pinch.copy(h.origin)
            }
            let best = null
            for (const r of surfaces) {
                const hit = rayOnRect(h.origin, h.dir, r)
                if (hit && (!best || hit.t < best.t)) best = { ...hit, surface: r }
            }
            h.hit = best
            const length = best ? best.t : MAX_LENGTH
            const pos = h.line.geometry.attributes.position
            pos.setXYZ(0, h.origin.x, h.origin.y, h.origin.z)
            pos.setXYZ(1, h.origin.x + h.dir.x * length, h.origin.y + h.dir.y * length, h.origin.z + h.dir.z * length)
            pos.needsUpdate = true
            h.line.geometry.computeBoundingSphere()
            h.line.visible = this.visible
            h.target.visible = this.visible && !!best
            if (best) h.target.position.copy(best.point).setY(best.point.y + 0.002)
        }
        for (const h of Object.values(this.hands)) {
            if (h.seen) continue
            h.line.visible = h.target.visible = false
            h.pinching = false
            h.hit = null
        }
    }

    #hide() {
        for (const h of Object.values(this.hands)) h.line.visible = h.target.visible = false
    }

    get(side) {
        return this.hands[side]
    }
}

/**
 * The area two pinching hands mark on a surface: as wide as they are apart, from the line between
 * them (the table's near edge) back as far as the surface goes (between `minDepth` and `maxDepth`).
 * `head` says which side the person is on.
 */
export function areaBetween(a, b, surface, head, { minDepth = 0.35, maxDepth = 0.9 } = {}) {
    const top = surface?.top ?? (a.y + b.y) / 2
    const pa = new THREE.Vector3(a.x, top, a.z)
    const pb = new THREE.Vector3(b.x, top, b.z)
    const along = pb.clone().sub(pa)
    const width = along.length()
    if (width < 1e-3) return null
    along.divideScalar(width)
    const near = pa.clone().add(pb).multiplyScalar(0.5)
    const n = new THREE.Vector3(-along.z, 0, along.x)
    if (n.dot(new THREE.Vector3(head.x - near.x, 0, head.z - near.z)) < 0) n.negate()
    // back from the hands, as far as the surface goes
    let depth = 0.6
    if (surface) {
        let last = 0
        for (let t = 0; t <= maxDepth + 1e-6; t += 0.02) {
            const d = near.clone().addScaledVector(n, -t).sub(surface.center)
            if (Math.abs(d.dot(surface.ax)) <= surface.ex / 2 + 0.02 && Math.abs(d.dot(surface.az)) <= surface.ez / 2 + 0.02) last = t
        }
        depth = last
    }
    depth = Math.min(maxDepth, Math.max(minDepth, depth))
    return { width, depth, top, n, near }
}

/** The area on the surface, drawn as the person marks it: a grey sheet with its edge. */
export function areaMesh() {
    const g = new THREE.Group()
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4A4F57', transparent: true, opacity: 0.5, depthWrite: false }))
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), new THREE.LineBasicMaterial({ color: '#FFFFFF' }))
    g.add(sheet, edge)
    g.renderOrder = 25
    g.show = (area, ok = true) => {
        if (!area) return (g.visible = false)
        g.visible = true
        g.position.copy(area.near).addScaledVector(area.n, -area.depth / 2).setY(area.top + 0.004)
        g.rotation.set(0, Math.atan2(area.n.x, area.n.z), 0)
        g.scale.set(area.width, 1, area.depth)
        sheet.material.color.set(ok ? '#4A4F57' : '#8A2B2B')
    }
    g.visible = false
    return g
}
