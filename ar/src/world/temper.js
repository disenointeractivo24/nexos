import * as THREE from 'three'
import { angerFor, moodFor } from '../sim/temper.js'

/** The shared face has no bad moods, and only this experience needs them: they are laid on top of it here. */
const MOUTH_R = 0.085
const EYE = { w: 0.12, h: 0.21 }
const ARC = Math.PI * 0.7
const FLUSH = '#C8281E'

const SKIN_ONLY = /ojos|lengua|emblema|pelo|casco/i

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))

const geometry = {
    frown: new THREE.TorusGeometry(1, 0.17, 8, 24, ARC).rotateZ(Math.PI / 2 - ARC / 2),
    flat: new THREE.CapsuleGeometry(0.17, 1.4, 4, 10).rotateZ(Math.PI / 2),
    shout: new THREE.CircleGeometry(1, 24),
    brow: new THREE.CapsuleGeometry(0.1, 0.8, 4, 8).rotateZ(Math.PI / 2),
}

/** Moods the shared face knows; for the others it shows no mouth, and this one draws its own. */
const STOCK = { happy: 'happy', smile: 'calm' }

/** The little things they do while waiting, by how it is going. */
const IDLE = {
    happy: ['glance', 'lookAround', 'step', 'settle', 'hop'],
    smile: ['glance', 'lookAround', 'step', 'settle'],
    flat: ['glance', 'lookAround', 'step', 'settle'],
    worried: ['lookAround', 'step', 'settle'],
    angry: ['step', 'settle'],
}

/**
 * What one person feels, on their face and in their body, from how much of the wait is left.
 * Set once a frame, right after the person's own update: their pose starts over every frame,
 * so what is added here never builds up.
 */
export class Temper {
    constructor(person) {
        this.person = person
        this.left = 1
        /** How it ended, when it no longer depends on the wait. */
        this.settled = null
        this.talk = 0
        this.talkFor = 0
        const { face } = person
        if (!face) return
        const R = MOUTH_R * face.H
        const ink = face.mats.ink
        const mouthPart = (shape, scale, y) => {
            const mesh = new THREE.Mesh(shape, ink)
            mesh.scale.setScalar(scale)
            mesh.position.y = y
            mesh.visible = false
            face.mouth.add(mesh)
            return mesh
        }
        this.frown = mouthPart(geometry.frown, R, -R * 0.65)
        this.flat = mouthPart(geometry.flat, R * 0.8, 0)
        this.shout = mouthPart(geometry.shout, R, -R * 0.1)
        this.brows = face.eyes.map((eye, i) => {
            const brow = new THREE.Mesh(geometry.brow, ink)
            brow.scale.setScalar(EYE.w * face.H * 1.5)
            brow.position.set(0, EYE.h * face.H * 0.68, face.H * 0.02)
            brow.visible = false
            brow.userData.side = i === 0 ? -1 : 1
            eye.holder.add(brow)
            return brow
        })
        this.skin = []
        person.parts.head?.traverse((o) => {
            if (!o.isMesh || !o.material?.emissive || face.root.getObjectById(o.id)) return
            if (SKIN_ONLY.test(`${o.material.name} ${o.name}`)) return
            o.material.emissive.set(FLUSH)
            this.skin.push(o.material)
        })
        // the face asks for a mood every frame: only a celebration gets past this one
        face.setMood = (asked) => (face.mood = asked === 'joy' ? 'joy' : (STOCK[this.mood] ?? this.mood))
    }

    get mood() {
        return this.settled ?? moodFor(this.left)
    }

    /** They speak up: arm in the air, shaking their head, the mouth going. */
    complain(seconds) {
        this.talk = 0
        this.talkFor = seconds
    }

    update(dt, t) {
        const { person } = this
        if (!person.face) return
        const mood = this.mood
        const anger = mood === 'angry' ? Math.max(0.35, angerFor(this.left)) : angerFor(this.left)
        let talking = 0
        if (this.talkFor > 0) {
            this.talk += dt
            const u = this.talk / this.talkFor
            if (u >= 1) this.talkFor = 0
            else talking = smooth(u / 0.15) * smooth((1 - u) / 0.15)
        }
        if (person.face.mood === 'joy') talking = 0

        // the face
        const open = talking > 0.3
        this.frown.visible = !open && (mood === 'worried' || mood === 'angry')
        this.frown.scale.setScalar(MOUTH_R * person.face.H * (mood === 'angry' ? 1.05 : 0.8))
        this.flat.visible = mood === 'flat'
        this.shout.visible = open
        if (open) {
            const R = MOUTH_R * person.face.H
            this.shout.scale.set(R * 0.9, R * (0.45 + 0.65 * Math.abs(Math.sin(t * 11))), 1)
        }
        const showBrows = mood === 'worried' || mood === 'angry'
        // their inner ends rise with worry, and go down further the angrier they are
        const tilt = mood === 'worried' ? -0.32 : 0.3 + 0.4 * anger
        for (const brow of this.brows) {
            brow.visible = showBrows && person.face.mood !== 'joy'
            brow.rotation.z = brow.userData.side * tilt
        }
        const flush = mood === 'angry' ? 0.42 * anger * anger : 0
        for (const m of this.skin) m.emissiveIntensity = flush
        person.idleNames = IDLE[mood]

        // the body, on top of the pose they already have
        if (!person.procedural) return
        const P = person.parts
        const still = 1 - person.walkAmt
        const restless = mood === 'angry' ? anger * still : 0
        if (restless > 0) {
            // a foot tapping, faster and harder as it goes on
            P.legR.rotation.x -= Math.max(0, Math.sin(t * (6 + 4 * anger))) * 0.22 * restless
            P.body.rotation.x += 0.06 * restless
            P.head.rotation.x += 0.06 * restless
        }
        const k = talking * still
        if (k > 0) {
            P.armR.rotation.z += (1.15 + Math.sin(t * 13) * 0.2) * k
            P.armR.rotation.x -= 0.55 * k
            P.armL.rotation.z -= (0.4 + Math.sin(t * 7) * 0.12) * k
            P.head.rotation.y += Math.sin(t * 8) * 0.24 * k
            P.body.rotation.x += 0.08 * k
            person.model.position.y += Math.abs(Math.sin(t * 7)) * 0.025 * k
        }
    }
}
