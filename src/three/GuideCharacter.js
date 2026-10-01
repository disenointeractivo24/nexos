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
        this.gesture = { arm: 0 }
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

    /** Walk along waypoints at a calm pace. Resolves on arrival. */
    walk(points, { speed = 3.3 } = {}) {
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
        const head = this.parts.head
        if (!head || this.reducedMotion) return
        gsap.timeline()
            .to(head.rotation, { x: 0.16, duration: 0.35, ease: 'sine.out' })
            .to(head.rotation, { x: 0, duration: 0.5, ease: 'sine.inOut' })
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
        this.yaw += diff * (1 - Math.exp(-dt * 7))
        this.root.rotation.y = this.yaw

        const k = 1 - Math.exp(-dt * 8)
        this.walkAmt += ((moving ? 1 : 0) - this.walkAmt) * k

        if (this.mixer) {
            this.#blendClips(moving)
            this.mixer.update(dt)
            return
        }

        const P = this.parts
        this.phase += dt * (2.2 + this.speed * 3.1)
        const w = this.walkAmt
        const sw = Math.sin(this.phase)
        P.legL.rotation.x = sw * 0.55 * w
        P.legR.rotation.x = -sw * 0.55 * w
        P.armL.rotation.x = -sw * 0.38 * w
        P.armR.rotation.x = sw * 0.38 * w - this.gesture.arm * 1.35
        P.armL.rotation.z = this.armRest.L * (1 - 0.35 * w)
        P.armR.rotation.z = this.armRest.R * (1 - 0.35 * w) - this.gesture.arm * 0.2
        const breathe = this.reducedMotion ? 0 : Math.sin(t * 1.7) * 0.012 * (1 - w)
        P.body.position.y = Math.abs(sw) * 0.05 * w + breathe
        P.body.rotation.z = Math.sin(this.phase) * 0.03 * w
        P.body.rotation.x = 0.06 * w
        if (!this.reducedMotion) P.head.rotation.y = Math.sin(t * 0.45) * 0.1 * (1 - w)
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
