import * as THREE from 'three'
import gsap from 'gsap'
import { radialTexture } from './procedural/textures.js'

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a))

/** Give an instance its own materials (so fading one copy never affects another). */
export function cloneMaterials(obj) {
    const map = new Map()
    obj.traverse((o) => {
        if (!o.isMesh) return
        const swap = (m) => {
            if (!map.has(m)) map.set(m, m.clone())
            return map.get(m)
        }
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material)
    })
    return obj
}

/**
 * The humanitarian guide in the world.
 * Works with the procedural stand-in (named pivots) or a GLB with
 * "idle"/"walk" clips. Movement is always system-driven (click-and-go).
 */
export class GuideCharacter {
    constructor(model, animations = [], { reducedMotion = false } = {}) {
        this.reducedMotion = reducedMotion
        this.root = new THREE.Group()
        this.root.name = 'guide-root'
        this.model = cloneMaterials(model)
        this.root.add(this.model)

        // Soft contact shadow so the character always feels grounded
        this.blob = new THREE.Mesh(
            new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ map: radialTexture({ inner: 'rgba(20,30,40,0.4)' }), transparent: true, depthWrite: false })
        )
        this.blob.position.y = 0.03
        this.blob.renderOrder = 1
        this.root.add(this.blob)

        this.parts = {}
        for (const n of ['body', 'head', 'armL', 'armR', 'legL', 'legR']) this.parts[n] = this.model.getObjectByName(n)
        this.procedural = !!this.parts.body
        this.armRest = { L: this.parts.armL?.rotation.z ?? 0, R: this.parts.armR?.rotation.z ?? 0 }
        // The asset loader bakes the model's size into `body`; every pose is applied on top of
        // this, never in place of it, or the character would jump back to its raw build size.
        this.bodyBase = this.parts.body && { scale: this.parts.body.scale.clone(), y: this.parts.body.position.y }

        this.mixer = null
        if (animations.length) {
            this.mixer = new THREE.AnimationMixer(this.model)
            const find = (re) => animations.find((c) => re.test(c.name))
            const idle = find(/idle|stand|breath/i) ?? animations[0]
            const walk = find(/walk|run|move/i)
            this.actions = {
                idle: idle && this.mixer.clipAction(idle),
                walk: walk && this.mixer.clipAction(walk),
            }
            this.actions.idle?.play()
        }

        this.materials = []
        this.model.traverse((o) => {
            if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => this.materials.push({ m, transparent: m.transparent, opacity: m.opacity }))
        })

        this.yaw = Math.PI
        this.targetYaw = Math.PI
        this.walkAmt = 0
        this.phase = 0
        this.speed = 0
        this.gesture = { arm: 0, nod: 0 }
        // each character idles slightly out of step with the others
        this.idleSeed = Math.random() * 100
        this.path = null
        this.root.visible = false
    }

    get position() {
        return this.root.position
    }

    place(pos, yaw = Math.PI) {
        this.root.position.copy(pos)
        this.yaw = this.targetYaw = yaw
        this.root.rotation.y = yaw
    }

    /** Subtle welcome: soft fade + slight scale, no bounce. */
    appear() {
        this.root.visible = true
        const d = this.reducedMotion ? 0.2 : 0.9
        this.#setOpacity(0)
        this.model.scale.setScalar(0.86)
        const s = { o: 0 }
        gsap.to(this.model.scale, { x: 1, y: 1, z: 1, duration: d, ease: 'power2.out' })
        return new Promise((resolve) =>
            gsap.to(s, {
                o: 1,
                duration: d,
                ease: 'power1.out',
                onUpdate: () => this.#setOpacity(s.o),
                onComplete: () => {
                    this.#restoreMaterials()
                    resolve()
                },
            })
        )
    }

    hide() {
        this.root.visible = false
        this.path = null
    }

    #setOpacity(o) {
        for (const r of this.materials) {
            r.m.transparent = true
            r.m.opacity = r.opacity * o
        }
        this.blob.material.opacity = o
    }

    #restoreMaterials() {
        for (const r of this.materials) {
            r.m.transparent = r.transparent
            r.m.opacity = r.opacity
        }
        this.blob.material.opacity = 1
    }

    /** Walk along waypoints at a brisk pace. Resolves on arrival. */
    walk(points, { speed = 6.2 } = {}) {
        this.path?.resolve?.(false)
        const pts = points.map((p) => p.clone().setY(0))
        if (pts.length < 2 || pts[0].distanceTo(pts[pts.length - 1]) < 0.05) return Promise.resolve(true)
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.35)
        const length = curve.getLength()
        return new Promise((resolve) => {
            this.path = { curve, length, s: 0, maxSpeed: this.reducedMotion ? speed * 1.6 : speed, resolve }
        })
    }

    stop() {
        if (this.path) {
            this.path.resolve(false)
            this.path = null
        }
    }

    faceTowards(point) {
        const dx = point.x - this.root.position.x
        const dz = point.z - this.root.position.z
        if (Math.hypot(dx, dz) > 0.01) this.targetYaw = Math.atan2(dx, dz)
    }

    /** Point an arm toward where the user should look. */
    point(duration = 1.6) {
        if (!this.procedural) return
        gsap.killTweensOf(this.gesture)
        gsap.timeline()
            .to(this.gesture, { arm: 1, duration: 0.6, ease: 'power2.out' })
            .to(this.gesture, { arm: 0, duration: 0.7, ease: 'power2.inOut' }, `+=${duration}`)
    }

    /** Small acknowledgement on arrival. */
    nod() {
        if (!this.parts.head || this.reducedMotion) return
        gsap.killTweensOf(this.gesture, 'nod')
        gsap.timeline()
            .to(this.gesture, { nod: 1, duration: 0.3, ease: 'sine.out' })
            .to(this.gesture, { nod: 0, duration: 0.45, ease: 'sine.inOut' })
    }

    update(dt, t) {
        if (!this.root.visible) return

        // Path following with gentle acceleration / deceleration
        let moving = false
        if (this.path) {
            const p = this.path
            const remaining = p.length - p.s
            const ramp = Math.min(1, (p.s + 0.4) / 1.4) * Math.min(1, remaining / 1.6 + 0.15)
            this.speed = p.maxSpeed * ramp
            p.s = Math.min(p.length, p.s + this.speed * dt)
            const u = p.s / p.length
            p.curve.getPointAt(u, this.root.position)
            const tan = p.curve.getTangentAt(Math.min(u, 0.999))
            this.targetYaw = Math.atan2(tan.x, tan.z)
            moving = true
            if (p.s >= p.length - 1e-3) {
                this.path = null
                this.speed = 0
                p.resolve(true)
            }
        } else {
            this.speed = 0
        }

        // Turn smoothly (never snap)
        const diff = wrapAngle(this.targetYaw - this.yaw)
        this.yaw += diff * (1 - Math.exp(-dt * 8))
        this.root.rotation.y = this.yaw

        // blend between idle and walk over ~0.2 s so starts and stops never pop
        const k = 1 - Math.exp(-dt * 6)
        this.walkAmt += ((moving ? 1 : 0) - this.walkAmt) * k

        if (this.mixer) {
            this.#blendClips(moving)
            this.mixer.update(dt)
            return
        }

        const P = this.parts
        // the stride follows the distance covered, so feet do not slide at any speed
        this.phase += dt * (1.5 + this.speed * 2.3)
        const w = this.walkAmt
        const sw = Math.sin(this.phase)
        const bob = (1 - Math.cos(this.phase * 2)) * 0.5

        // idle: breathing, a slow weight shift, loose arms, a look around now and then
        const amb = this.reducedMotion ? 0 : 1 - w
        const ti = t + this.idleSeed
        const breath = Math.sin(ti * 1.9)
        const shift = Math.sin(ti * 0.55)
        const look = Math.sin(ti * 0.37) * 0.22 + Math.sin(ti * 0.91 + 1.3) * 0.08

        P.legL.rotation.x = sw * 0.6 * w
        P.legR.rotation.x = -sw * 0.6 * w
        P.legL.rotation.z = shift * 0.035 * amb
        P.legR.rotation.z = shift * 0.035 * amb
        P.armL.rotation.x = -sw * 0.45 * w + Math.sin(ti * 1.9 + 0.5) * 0.06 * amb
        P.armR.rotation.x = sw * 0.45 * w + Math.sin(ti * 1.9 + 0.9) * 0.06 * amb - this.gesture.arm * 1.35
        P.armL.rotation.z = this.armRest.L * (1 - 0.35 * w) + (breath * 0.035 - shift * 0.03) * amb
        P.armR.rotation.z = this.armRest.R * (1 - 0.35 * w) - (breath * 0.035 + shift * 0.03) * amb - this.gesture.arm * 0.2
        const B = this.bodyBase
        P.body.position.y = B.y + bob * 0.06 * w + (breath * 0.5 + 0.5) * 0.022 * amb
        P.body.scale.set(B.scale.x * (1 - breath * 0.008 * amb), B.scale.y * (1 + breath * 0.012 * amb), B.scale.z * (1 - breath * 0.008 * amb))
        P.body.rotation.z = sw * 0.035 * w + shift * 0.03 * amb
        P.body.rotation.x = (0.05 + Math.min(this.speed, 7) * 0.012) * w
        P.head.rotation.y = look * amb
        P.head.rotation.x = this.gesture.nod * 0.18 + Math.sin(ti * 0.7) * 0.035 * amb - bob * 0.03 * w
        P.head.rotation.z = -shift * 0.04 * amb
    }

    #blendClips(moving) {
        const { idle, walk } = this.actions
        if (!walk) return
        if (moving && !walk.isRunning()) {
            walk.reset().play()
            walk.crossFadeFrom(idle, 0.3, false)
        } else if (!moving && walk.isRunning() && idle) {
            idle.reset().play()
            idle.crossFadeFrom(walk, 0.35, false)
            setTimeout(() => !this.path && walk.stop(), 400)
        }
    }
}
