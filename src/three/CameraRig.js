import * as THREE from 'three'
import gsap from 'gsap'

/**
 * System-controlled camera. Two modes:
 *  - flyTo: slow eased interpolation of position + look target
 *  - follow: damped tracking of a moving object with a fixed offset
 * There is no user-driven orbit or rotation by design.
 */
export class CameraRig {
    constructor(camera, { reducedMotion = false } = {}) {
        this.camera = camera
        this.pos = new THREE.Vector3(0, 600, 60)
        this.target = new THREE.Vector3()
        this.reducedMotion = reducedMotion
        this.followState = null
        this.tween = null
        this._v = new THREE.Vector3()
    }

    set(pos, target) {
        this.kill()
        this.pos.copy(pos)
        this.target.copy(target)
        this.apply()
    }

    kill() {
        this.tween?.kill()
        this.tween = null
    }

    /**
     * Interpolate along a soft arc: position eases, the look target eases a
     * bit ahead so the view never swings.
     */
    flyTo(pos, target, { duration = 2.2, ease = 'sine.inOut', arc = 0 } = {}) {
        this.kill()
        this.followState = null
        const d = this.reducedMotion ? Math.min(duration, 0.6) : duration
        const p0 = this.pos.clone()
        const t0 = this.target.clone()
        const p1 = pos.clone()
        const t1 = target.clone()
        const state = { k: 0 }
        return new Promise((resolve) => {
            this.tween = gsap.to(state, {
                k: 1,
                duration: d,
                ease,
                onUpdate: () => {
                    const k = state.k
                    this.pos.lerpVectors(p0, p1, k)
                    if (arc) this.pos.y += Math.sin(k * Math.PI) * arc
                    const kt = 1 - Math.pow(1 - k, 1.35)
                    this.target.lerpVectors(t0, t1, kt)
                    this.apply()
                },
                onComplete: resolve,
                onInterrupt: resolve,
            })
        })
    }

    /** Track an object: camera = object + offset, looking at object + lookOffset. */
    follow(object, offset, lookOffset, { stiffness = 2.6 } = {}) {
        this.kill()
        // ease in: stiffness ramps up so the hand-off from a flight never jolts
        this.followState = { object, offset: offset.clone(), lookOffset: lookOffset.clone(), stiffness, ramp: 0 }
    }

    stopFollow() {
        this.followState = null
    }

    update(dt) {
        const f = this.followState
        if (!f) return
        f.ramp = Math.min(1, f.ramp + dt / 1.2)
        const ease = f.ramp * f.ramp * (3 - 2 * f.ramp)
        const k = 1 - Math.exp(-f.stiffness * (0.15 + 0.85 * ease) * dt)
        const p = f.object.position
        this._v.copy(p).add(f.offset)
        this.pos.lerp(this._v, k)
        this._v.copy(p).add(f.lookOffset)
        this.target.lerp(this._v, k)
        this.apply()
    }

    apply() {
        this.camera.position.copy(this.pos)
        this.camera.lookAt(this.target)
    }
}
