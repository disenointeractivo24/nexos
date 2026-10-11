import * as THREE from 'three'
import gsap from 'gsap'
import { radialTexture } from './procedural/textures.js'
import { GuideFace } from './guideFace.js'

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))
/** 0 → 1 → 0 over [a, b] of an action's 0–1 time, eased at both ends. */
const bump = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(((u - a) / (b - a)) * Math.PI))
/** Rises over the first `edge` of the action, holds, falls over the last `edge`. */
const hold = (u, edge = 0.25) => smooth(u / edge) * smooth((1 - u) / edge)

/**
 * Little things a character does while it waits, so it never stands like a statue.
 * Each returns the offsets it adds to the pose at time u (0–1), and how long it lasts.
 * `side` is ±1, picked each time. Only the guide (`lively`) waves and stretches.
 */
const IDLE = {
    // a look to one side, eyes first, a little tilt, then back
    glance: { weight: 3, seconds: 2.6, pose: (u, side) => {
        const k = hold(u, 0.22)
        return { headY: side * 0.75 * k, headZ: side * 0.08 * k, bodyY: side * 0.12 * k, eyeX: side * smooth(u / 0.1) * smooth((0.9 - u) / 0.1) }
    } },
    // a look around, from one side to the other
    lookAround: { weight: 2, seconds: 3.4, pose: (u, side) => {
        const s = Math.sin(u * Math.PI * 2) * side * hold(u, 0.15)
        return { headY: 0.7 * s, headX: -0.06 * hold(u), bodyY: 0.1 * s, eyeX: Math.sign(s) * Math.min(1, Math.abs(s) * 3), eyeY: 0.3 * hold(u) }
    } },
    // a little step in place: one foot, then the other
    step: { weight: 2, seconds: 1.5, pose: (u, side) => {
        const a = bump(u, 0.05, 0.45), b = bump(u, 0.45, 0.85)
        const first = side > 0 ? 'legR' : 'legL', second = side > 0 ? 'legL' : 'legR'
        return { [first]: -0.5 * a, [second]: -0.5 * b, hop: 0.045 * (a + b), bodyZ: 0.06 * (a - b) * side, armSwing: 0.35 * (a - b) }
    } },
    // settling: a shrug that lifts the backpack, then a small shake to let it drop into place
    settle: { weight: 2, seconds: 1.8, pose: (u) => {
        const up = bump(u, 0.05, 0.55)
        const shake = Math.sin(u * Math.PI * 9) * bump(u, 0.5, 1)
        return { hop: 0.03 * up, arms: 0.4 * up, armsOut: 0.12 * up, headX: 0.12 * up, bodyZ: 0.05 * shake, headZ: -0.06 * shake, blink: up > 0.9 }
    } },
    // a wave with the right hand, smiling
    wave: { weight: 1, lively: true, seconds: 2.6, pose: (u) => {
        const k = hold(u, 0.2)
        return { armRUp: 2.4 * k, armRWave: Math.sin(u * Math.PI * 10) * 0.35 * k, headZ: 0.12 * k, headY: 0.15 * k, mood: k > 0.4 ? 'happy' : null, bodyZ: -0.05 * k }
    } },
    // a stretch: arms up, up on tiptoe, eyes shut, then a happy little shake
    stretch: { weight: 1, lively: true, seconds: 2.8, pose: (u) => {
        const k = hold(u, 0.3)
        return { armsUp: 2.5 * k, hop: 0.05 * k, headX: -0.18 * k, bodyX: -0.08 * k, mood: k > 0.5 ? 'joy' : null }
    } },
    // a happy little hop
    hop: { weight: 1, seconds: 1.1, pose: (u) => {
        const h = Math.abs(Math.sin(u * Math.PI * 2)) * (1 - u * 0.4)
        return { hop: 0.12 * h, armsOut: 0.25 * h, legL: 0.15 * h, legR: 0.15 * h, mood: 'happy' }
    } },
}
const IDLE_NAMES = Object.keys(IDLE)
const _target = new THREE.Vector3()

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
    /**
     * @param {{reducedMotion?: boolean, face?: boolean, lively?: boolean}} opts
     *   face: draw an expressive face on the head (the muñequito); lively: the larger idle
     *   gestures too (waving, stretching), for the guide rather than the neighbours
     */
    /** @param idle  names from IDLE this character may play (all of them if not given) */
    /** @param stoop  forward lean of the body, in radians (older people) */
    constructor(model, animations = [], { reducedMotion = false, face = false, lively = false, idle = null, stoop = 0 } = {}) {
        this.reducedMotion = reducedMotion
        this.lively = lively
        this.idleNames = idle ?? IDLE_NAMES
        this.stoop = stoop
        /** Someone this character keeps beside (a child with their parent), see follow(). */
        this.leader = null
        /** 0–1, set from outside each frame: how freely the way ahead is clear (1 = walk on). */
        this.hold = 1
        /** Metres to keep to the right (+) or left (−) of the path, to pass someone; set from outside. */
        this.sideWant = 0
        this.side = 0
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
        this.face = face ? GuideFace.attach(this.model, this.parts.head) : null

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
        this.gesture = { arm: 0, nod: 0, cheer: 0 }
        this.idle = { name: null, t: 0, wait: 1.5 + Math.random() * 2.5, side: 1 }
        this.hopY = 0
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

    /**
     * Keep beside someone wherever they go, as a child does with a parent. `standing` is
     * where to be in their frame (x across, z ahead) when they stand, `walking` when they
     * walk (a little behind, in their footsteps, as if holding their hand). Walks when
     * they walk, catches up when left behind, turns before setting off, and stands
     * facing the way they face.
     */
    follow(leader, standing, walking = standing) {
        this.leader = leader
        this.followOffset = { standing, walking }
    }

    /** Where this character keeps beside its leader, for the leader at `pos` facing `yaw`. */
    besideAt(pos, yaw, out = new THREE.Vector3(), walking = 0) {
        const { standing: a, walking: b } = this.followOffset
        const x = a.x + (b.x - a.x) * walking, z = a.z + (b.z - a.z) * walking
        const c = Math.cos(yaw), s = Math.sin(yaw)
        return out.set(pos.x + c * x + s * z, pos.y, pos.z - s * x + c * z)
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

    /** Joy: two hops with the arms up and a big grin (a donation arrived). */
    celebrate() {
        if (!this.procedural || this.reducedMotion) return
        gsap.killTweensOf(this.gesture, 'cheer')
        gsap.timeline()
            .to(this.gesture, { cheer: 1, duration: 0.25, ease: 'power2.out' })
            .to(this.gesture, { cheer: 0, duration: 0.5, ease: 'sine.inOut' }, '+=1.4')
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
            const tan = p.curve.getTangentAt(Math.min(p.s / p.length, 0.999))
            this.targetYaw = Math.atan2(tan.x, tan.z)
            // facing away from the way to go, a person turns where they stand before setting
            // off, rather than sliding sideways or backwards into the first steps
            const align = THREE.MathUtils.clamp((Math.cos(wrapAngle(this.targetYaw - this.yaw)) - 0.35) / 0.5, 0, 1)
            const remaining = p.length - p.s
            const ramp = Math.min(1, (p.s + 0.4) / 1.4) * Math.min(1, remaining / 1.6 + 0.15)
            this.speed = p.maxSpeed * ramp * align * this.hold
            p.s = Math.min(p.length, p.s + this.speed * dt)
            p.curve.getPointAt(p.s / p.length, this.root.position)
            // stepping out a little to pass someone, and back onto the path before arriving
            const room = Math.min(1, (p.length - p.s) / 1.5, p.s / 0.8)
            this.side += (this.sideWant * room - this.side) * (1 - Math.exp(-dt * 4))
            if (Math.abs(this.side) > 1e-3) {
                this.root.position.x += Math.cos(this.targetYaw) * this.side
                this.root.position.z -= Math.sin(this.targetYaw) * this.side
            }
            moving = true
            if (p.s >= p.length - 1e-3) {
                this.side = 0
                this.path = null
                this.speed = 0
                p.resolve(true)
            }
        } else if (this.leader) {
            const L = this.leader
            // in their footsteps on a real walk; beside them for a step or two (moving up a line)
            const target = this.besideAt(L.position, L.yaw, _target, L.walkAmt * THREE.MathUtils.clamp((L.speed - 2) / 1.5, 0, 1))
            const dx = target.x - this.root.position.x
            const dz = target.z - this.root.position.z
            const d = Math.hypot(dx, dz)
            // as fast as the leader, a little faster to catch up; slowing into place. More than
            // a hand's breadth away, they turn to face the way first, as anyone does
            const ahead = d > 0.1 ? THREE.MathUtils.clamp((Math.cos(wrapAngle(Math.atan2(dx, dz) - this.yaw)) - 0.35) / 0.5, 0, 1) : 1
            const pace = Math.min(d * 3.2, Math.max(L.speed * 1.3, 1.4)) * ahead
            const step = Math.min(d, pace * dt)
            if (d > 0.01) {
                this.root.position.x += (dx / d) * step
                this.root.position.z += (dz / d) * step
            }
            this.speed += (step / Math.max(dt, 1e-4) - this.speed) * (1 - Math.exp(-dt * 10))
            moving = this.speed > 0.3 || d > 0.1
            this.targetYaw = d > 0.1 ? Math.atan2(dx, dz) : L.yaw
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

        // idle: breathing, a slow weight shift, and now and then one of the little things in IDLE
        const amb = this.reducedMotion ? 0 : 1 - w
        const ti = t + this.idleSeed
        const breath = Math.sin(ti * 1.9)
        const shift = Math.sin(ti * 0.55)
        const drift = Math.sin(ti * 0.37) * 0.12 + Math.sin(ti * 0.91 + 1.3) * 0.05
        const o = this.#idleStep(dt, amb)
        const cheer = this.gesture.cheer
        const jump = Math.abs(Math.sin(t * 9)) * cheer

        // walking: a full stride, arms swinging against the legs, the body twisting a little
        P.legL.rotation.x = sw * 0.62 * w + (o.legL ?? 0) - 0.2 * jump
        P.legR.rotation.x = -sw * 0.62 * w + (o.legR ?? 0) - 0.2 * jump
        P.legL.rotation.z = shift * 0.035 * amb
        P.legR.rotation.z = shift * 0.035 * amb
        if (P.armL && P.armR) {
            const swing = 0.62 * w
            const idleArms = Math.sin(ti * 1.9 + 0.5) * 0.05 * amb
            const back = o.arms ?? 0
            const sway = o.armSwing ?? 0
            P.armL.rotation.x = -sw * swing + idleArms + back - sway
            P.armR.rotation.x = sw * swing + idleArms + back + sway - this.gesture.arm * 1.0 - (o.armRUp ? 0.25 * Math.min(1, o.armRUp) : 0)
            const out = (o.armsOut ?? 0) + (o.armsUp ?? 0) + 2.6 * cheer
            P.armL.rotation.z = this.armRest.L * (1 - 0.35 * w) + (breath * 0.035 - shift * 0.03) * amb - out
            P.armR.rotation.z = this.armRest.R * (1 - 0.35 * w) - (breath * 0.035 + shift * 0.03) * amb + out + (o.armRUp ?? 0) + (o.armRWave ?? 0) - this.gesture.arm * 0.2
        }
        const B = this.bodyBase
        P.body.position.y = B.y + bob * 0.06 * w + (breath * 0.5 + 0.5) * 0.022 * amb
        // a little squash as each foot lands, and stretch in between
        const squash = (bob - 0.5) * 0.03 * w
        P.body.scale.set(B.scale.x * (1 - breath * 0.008 * amb + squash), B.scale.y * (1 + breath * 0.012 * amb - squash), B.scale.z * (1 - breath * 0.008 * amb + squash))
        P.body.rotation.z = sw * 0.045 * w + shift * 0.03 * amb + (o.bodyZ ?? 0)
        P.body.rotation.x = (0.06 + Math.min(this.speed, 7) * 0.014) * w + (o.bodyX ?? 0) + this.stoop
        P.body.rotation.y = sw * 0.09 * w + (o.bodyY ?? 0)
        P.head.rotation.y = drift * amb + (o.headY ?? 0) - sw * 0.06 * w
        P.head.rotation.x = this.gesture.nod * 0.2 + Math.sin(ti * 0.7) * 0.035 * amb - bob * 0.04 * w + (o.headX ?? 0) - 0.15 * cheer - this.stoop * 0.7
        P.head.rotation.z = -shift * 0.04 * amb + (o.headZ ?? 0) + Math.sin(t * 6) * 0.06 * cheer
        // hops lift the whole figure; the root stays on the ground for the app
        this.model.position.y = (o.hop ?? 0) * amb + 0.22 * jump

        if (this.face) {
            // the eyes lead where the head is going; walking, they look ahead and a little down
            this.face.lookAt(((o.eyeX ?? drift * 2) * amb) || 0, ((o.eyeY ?? 0) * amb - 0.25 * w) || 0)
            if (o.blink) this.face.blinkNow()
            this.face.setMood(cheer > 0.01 ? 'joy' : o.mood ?? (this.gesture.arm > 0.3 ? 'happy' : 'calm'))
            this.face.update(dt)
        }
    }

    /**
     * Picks and plays the idle actions: after a few seconds of standing, one of IDLE, then a
     * pause, then another (never the same twice in a row). Walking interrupts it at once.
     */
    #idleStep(dt, amb) {
        const s = this.idle
        if (amb < 0.6 || this.gesture.arm > 0.05) {
            s.name = null
            s.wait = Math.max(s.wait, 1.2)
            return {}
        }
        if (!s.name) {
            s.wait -= dt
            if (s.wait > 0) return {}
            const allowed = this.idleNames.filter((n) => this.lively || !IDLE[n].lively)
            const names = allowed.length > 1 ? allowed.filter((n) => n !== s.last) : allowed
            if (!names.length) return {}
            let r = Math.random() * names.reduce((n, k) => n + IDLE[k].weight, 0)
            s.name = names.find((k) => (r -= IDLE[k].weight) < 0) ?? names[0]
            s.t = 0
            s.side = Math.random() < 0.5 ? -1 : 1
        }
        const act = IDLE[s.name]
        s.t += dt / act.seconds
        if (s.t >= 1) {
            s.last = s.name
            s.name = null
            s.wait = 1.8 + Math.random() * 3.5
            return {}
        }
        return act.pose(s.t, s.side)
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
