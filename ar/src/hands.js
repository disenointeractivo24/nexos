import * as THREE from 'three'

/** How long a pose has to be held before it counts, and how long it may be lost before it stops counting. */
const HOLD_IN = 0.3
const HOLD_OUT = 0.45
/** How much the palm must face up (1 = straight up) for the hand to count as open to the sky. */
const PALM_UP = 0.62
/** How squarely the inside of the wrist must face the eyes to count as looking at it. */
const WATCH = 0.55
/** Fingertip to thumb tip, in metres: under this it is a pinch, and past the second it is let go. */
const PINCH = 0.02
const PINCH_OPEN = 0.035

const JOINTS = ['wrist', 'thumb-tip', 'index-finger-tip', 'index-finger-metacarpal', 'middle-finger-metacarpal', 'pinky-finger-metacarpal']

/**
 * What the bare hands are doing, read from their joints each frame. Only the poses this
 * experience answers to: the inside of the wrist turned up or to the eyes, as when looking at a
 * watch (it opens the list along that forearm), and a pinch.
 * Controllers and computers have no joints: nothing here is ever on for them.
 */
export class Hands {
    constructor() {
        this.sides = {
            left: this.#side(),
            right: this.#side(),
        }
        this.tracked = false
    }

    #side() {
        return {
            seen: false,
            joints: Object.fromEntries(JOINTS.map((j) => [j, new THREE.Vector3()])),
            palm: new THREE.Vector3(),
            palmUpFor: 0,
            palmDownFor: 0,
            palmUp: false,
            pinching: false,
            /** Over the forearm, where the list shows. */
            over: new THREE.Vector3(),
            /** Between the thumb and the index fingertips: where a pinch takes hold. */
            pinchPoint: new THREE.Vector3(),
            /** The hand as a rigid frame at the pinch point: what is held keeps its pose in it. */
            frame: new THREE.Matrix4(),
            /** Where the hand points, as the headset reports it. */
            ray: new THREE.Ray(),
            hasRay: false,
        }
    }

    /** One frame: the joints of every tracked hand, in the space the scene is drawn in. */
    read(frame, space, dt, head = null) {
        this.head = head
        this.tracked = false
        for (const s of Object.values(this.sides)) {
            s.seen = false
            s.hasRay = false
        }
        if (!frame || !space) return this.#settle(dt)
        for (const source of frame.session.inputSources) {
            const hand = source.hand
            const side = this.sides[source.handedness]
            if (!hand || !side) continue
            let ok = true
            for (const name of JOINTS) {
                const joint = hand.get(name)
                const pose = joint && frame.getJointPose?.(joint, space)
                if (!pose) {
                    ok = false
                    break
                }
                const p = pose.transform.position
                side.joints[name].set(p.x, p.y, p.z)
            }
            if (!ok) continue
            side.seen = true
            this.tracked = true
            const j = side.joints
            // the palm's normal: across the knuckles crossed with along the hand, pointing out of the palm
            const across = new THREE.Vector3().subVectors(j['pinky-finger-metacarpal'], j['index-finger-metacarpal'])
            const along = new THREE.Vector3().subVectors(j['middle-finger-metacarpal'], j.wrist)
            side.palm.crossVectors(along, across).normalize()
            // for the left hand the same cross product points out of the back of the hand
            if (source.handedness === 'left') side.palm.negate()
            // a pinch closes under 2 cm and only opens past 3.5: no flicker at the edge
            const gap = j['thumb-tip'].distanceTo(j['index-finger-tip'])
            side.pinching = side.pinching ? gap < PINCH_OPEN : gap < PINCH
            side.pinchPoint.addVectors(j['thumb-tip'], j['index-finger-tip']).multiplyScalar(0.5)
            // a right-handed frame from the knuckles and the length of the hand, at the pinch point
            const z = along.clone().normalize()
            const x = across.clone().addScaledVector(z, -across.dot(z)).normalize()
            const y = new THREE.Vector3().crossVectors(z, x)
            side.frame.makeBasis(x, y, z).setPosition(side.pinchPoint)
            const rayPose = source.targetRaySpace && frame.getPose?.(source.targetRaySpace, space)
            side.hasRay = !!rayPose
            if (rayPose) {
                const { position: o, orientation: q } = rayPose.transform
                side.ray.origin.set(o.x, o.y, o.z)
                side.ray.direction.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w))
            }
            // along the forearm, a hand's width back from the wrist and a little off the skin
            const back = new THREE.Vector3().subVectors(j.wrist, j['middle-finger-metacarpal']).normalize()
            side.over.copy(j.wrist).addScaledVector(back, 0.1).addScaledVector(side.palm, 0.05)
        }
        this.#settle(dt)
    }

    #settle(dt) {
        for (const s of Object.values(this.sides)) {
            // the palm to the sky, or the inside of the wrist turned to the eyes, as one looks at a watch
            let watching = false
            if (s.seen && this.head) {
                const toHead = new THREE.Vector3().subVectors(this.head, s.joints.wrist)
                const far = toHead.length()
                watching = far < 0.7 && s.joints.wrist.y < this.head.y - 0.05 && toHead.normalize().dot(s.palm) > WATCH
            }
            const up = s.seen && !s.pinching && (s.palm.y > PALM_UP || watching)
            if (up) {
                s.palmUpFor += dt
                s.palmDownFor = 0
            } else {
                s.palmDownFor += dt
                s.palmUpFor = 0
            }
            if (!s.palmUp && s.palmUpFor > HOLD_IN) s.palmUp = true
            if (s.palmUp && s.palmDownFor > HOLD_OUT) s.palmUp = false
        }
    }

    /** The hand that is showing its palm, if any: the left one first, as on the headset's own menu. */
    get openPalm() {
        const { left, right } = this.sides
        if (left.palmUp) return left
        if (right.palmUp) return right
        return null
    }
}
