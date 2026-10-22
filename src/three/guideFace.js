import * as THREE from 'three'
import { canvasTexture, drawCross } from './procedural/textures.js'

/**
 * The muñequito's face, drawn in the app so it can move: two tall, plain dark
 * eyes, a smile, and the Red Cross badge on the helmet.
 *
 * Everything is laid on the head's own surface, found by casting rays at it, so
 * it follows the model whatever its size; and it hangs from the head joint, so
 * it turns with it. The face blinks by itself; `look` moves the eyes and `mood`
 * changes the expression. Expressions are separate faces, swapped outright (like changing a
 * drawing), never blended: two mouths or two kinds of eyes are never seen at once. The new one
 * pops in with a short squash so the swap reads as a change, not a glitch.
 *   calm  · a smile
 *   happy · a wide open grin
 *   joy   · eyes closed in two arcs and the grin (stretching, celebrating)
 *   wow   · a small round mouth and wide eyes
 */

/* where the features go, as fractions of the head (x from the centre, y from the chin) */
const EYE = { x: 0.21, y: 0.38, w: 0.12, h: 0.21 }
const MOUTH = { y: 0.23, w: 0.085 }
const BADGE = { y: 0.6, r: 0.15 }

const ink = () => new THREE.MeshStandardMaterial({ name: 'guia_ojos', color: '#14161A', roughness: 0.85, metalness: 0 })
const tongue = () => new THREE.MeshStandardMaterial({ name: 'guia_lengua', color: '#E2575F', roughness: 0.5 })

export class GuideFace {
    /** A face for a model with a `head` joint, or null when there is nothing to lay it on. */
    static attach(model, head) {
        if (!head) return null
        model.updateMatrixWorld(true)
        const skin = []
        let helmet = null
        head.traverse((o) => {
            if (!o.isMesh) return
            // the face goes on the skin of the head: not on the hair or the ears (by material or by piece)
            const name = `${[o.material].flat()[0]?.name ?? ''} ${o.name}`
            if (/casco/i.test(name)) helmet = o
            else if (!/ojos|lengua|emblema|pelo|oreja/i.test(name)) skin.push(o)
        })
        if (!skin.length) return null
        return new GuideFace(head, skin, helmet)
    }

    constructor(head, skin, helmet) {
        this.head = head
        this.root = new THREE.Group()
        this.root.name = 'cara'
        head.add(this.root)
        this.ray = new THREE.Raycaster()
        this.toLocal = new THREE.Matrix4().copy(head.matrixWorld).invert()

        // the head's size, in the head's own space
        const box = new THREE.Box3()
        for (const m of skin) {
            m.geometry.computeBoundingBox()
            box.union(m.geometry.boundingBox.clone().applyMatrix4(this.toLocal.clone().multiply(m.matrixWorld)))
        }
        const size = box.getSize(new THREE.Vector3())
        const H = Math.max(size.x, size.y)
        this.H = H
        const at = (fx, fy, meshes = skin) => this.#surface(box.getCenter(new THREE.Vector3()).x + fx * size.x, box.min.y + fy * size.y, meshes, box.max.z + H)

        this.mats = { ink: ink(), tongue: tongue() }

        /* eyes: a tall dark oval; the lid group squashes to blink */
        this.eyes = [-1, 1].map((side) => {
            const s = at(side * EYE.x, EYE.y)
            const holder = this.#place(s)
            const lid = new THREE.Group()
            holder.add(lid)
            const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), this.mats.ink)
            ball.scale.set(EYE.w * H * 0.5, EYE.h * H * 0.5, EYE.w * H * 0.3)
            lid.add(ball)
            // closed and content: an arc like the top of a "^"
            const arc = new THREE.Mesh(new THREE.TorusGeometry(EYE.w * H * 0.5, EYE.w * H * 0.13, 8, 20, Math.PI), this.mats.ink)
            arc.position.y = -EYE.h * H * 0.12
            arc.position.z = EYE.w * H * 0.05
            arc.visible = false
            holder.add(arc)
            return { holder, lid, arc, base: holder.position.clone() }
        })

        /* mouth: a smile, a grin and a round "o", one shown at a time */
        const m = at(0, MOUTH.y)
        this.mouth = this.#place(m, 0.015)
        const R = MOUTH.w * H
        const smileArc = Math.PI * 0.7
        this.smile = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.17, 8, 24, smileArc), this.mats.ink)
        this.smile.rotation.z = -Math.PI / 2 - smileArc / 2
        this.smile.position.y = R * 0.55
        const grin = new THREE.Group()
        const lip = new THREE.Mesh(new THREE.CircleGeometry(R * 1.05, 28, Math.PI, Math.PI), this.mats.ink)
        const tip = new THREE.Mesh(new THREE.CircleGeometry(R * 0.5, 20, Math.PI, Math.PI), this.mats.tongue)
        tip.position.set(0, -R * 0.45, 0.002)
        tip.scale.y = 0.8
        grin.add(lip, tip)
        grin.position.y = R * 0.25
        this.grin = grin
        this.wow = new THREE.Mesh(new THREE.TorusGeometry(R * 0.38, R * 0.16, 8, 20), this.mats.ink)
        this.wow.scale.y = 1.25
        this.mouth.add(this.smile, grin, this.wow)

        /* the Red Cross badge on the front of the helmet */
        // (a textured helmet brings its own badge, painted in Substance)
        if (helmet && ![helmet.material].flat()[0]?.map) {
            const hb = new THREE.Box3()
            helmet.geometry.computeBoundingBox()
            hb.copy(helmet.geometry.boundingBox).applyMatrix4(this.toLocal.clone().multiply(helmet.matrixWorld))
            const hs = hb.getSize(new THREE.Vector3())
            const b = this.#surface(hb.getCenter(new THREE.Vector3()).x, hb.min.y + BADGE.y * hs.y, [helmet], hb.max.z + H)
            if (b) {
                const badge = this.#place(b, 0.015)
                const tex = canvasTexture(256, 256, (ctx, w) => {
                    ctx.clearRect(0, 0, w, w)
                    ctx.fillStyle = '#FFFFFF'
                    ctx.beginPath()
                    ctx.arc(w / 2, w / 2, w * 0.47, 0, Math.PI * 2)
                    ctx.fill()
                    drawCross(ctx, w / 2, w / 2, w * 0.58, '#E5333B')
                })
                badge.add(
                    new THREE.Mesh(
                        new THREE.CircleGeometry(BADGE.r * H, 32),
                        new THREE.MeshStandardMaterial({ name: 'guia_emblema', map: tex, transparent: true, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -3 })
                    )
                )
            }
        }

        this.root.traverse((o) => {
            if (o.isMesh) o.castShadow = o.receiveShadow = false
        })

        this.blink = 0
        this.nextBlink = 1.5 + Math.random() * 2
        this.blinkT = -1
        this.look = new THREE.Vector2()
        this.lookTarget = new THREE.Vector2()
        this.mood = 'calm'
        this.shown = null
        this.pop = 1
    }

    /** Where a ray from the front meets the head: the point and its outward normal, in head space. */
    #surface(x, y, meshes, zFrom) {
        const origin = new THREE.Vector3(x, y, zFrom).applyMatrix4(this.head.matrixWorld)
        const dir = new THREE.Vector3(0, 0, -1).transformDirection(this.head.matrixWorld)
        this.ray.set(origin, dir)
        const hit = this.ray.intersectObjects(meshes, false)[0]
        if (!hit) return { p: new THREE.Vector3(x, y, 0), n: new THREE.Vector3(0, 0, 1) }
        const p = hit.point.clone().applyMatrix4(this.toLocal)
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(this.toLocal)
        if (n.z < 0) n.negate()
        return { p, n }
    }

    /** A group on the surface, facing out of it, a little in front of it. */
    #place({ p, n }, lift = 0) {
        const g = new THREE.Group()
        g.position.copy(p).addScaledVector(n, lift)
        g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
        this.root.add(g)
        return g
    }

    /** Where the eyes look: x and y from -1 to 1 (right/up positive). */
    lookAt(x, y = 0) {
        this.lookTarget.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1))
    }

    setMood(mood) {
        this.mood = mood
    }

    /** Blink now (twice, sometimes). */
    blinkNow(double = false) {
        this.blinkT = 0
        this.doubleBlink = double
    }

    update(dt) {
        // blinking, on its own clock, now and then twice
        this.nextBlink -= dt
        if (this.nextBlink <= 0 && this.blinkT < 0) {
            this.blinkNow(Math.random() < 0.2)
            this.nextBlink = 2.2 + Math.random() * 3.5
        }
        let lid = 1
        if (this.blinkT >= 0) {
            this.blinkT += dt
            const d = 0.16
            const u = this.blinkT / d
            lid = u < 1 ? Math.abs(1 - 2 * u) : 1
            if (u >= 1) {
                if (this.doubleBlink) {
                    this.doubleBlink = false
                    this.blinkT = 0
                } else this.blinkT = -1
            }
        }
        lid = Math.max(0.08, lid)

        // the eyes lead, quickly
        this.look.lerp(this.lookTarget, 1 - Math.exp(-dt * 14))

        // a new mood swaps the face at once, and the new one pops in (0.85 → 1, easing out)
        if (this.mood !== this.shown) {
            this.shown = this.mood
            this.pop = 0
        }
        this.pop = Math.min(1, this.pop + dt / 0.14)
        const pop = 1 - 0.15 * (1 - this.pop) ** 2
        const mood = this.shown

        const H = this.H
        const closed = mood === 'joy'
        const wide = mood === 'wow' ? 1.12 : 1
        for (const e of this.eyes) {
            e.lid.position.set(this.look.x * H * 0.035, this.look.y * H * 0.025, 0)
            e.lid.visible = !closed
            e.lid.scale.set(wide, Math.max(0.001, lid * wide), 1)
            e.arc.visible = closed
            e.arc.scale.setScalar(pop)
        }
        this.smile.visible = mood === 'calm'
        this.grin.visible = mood === 'happy' || mood === 'joy'
        this.wow.visible = mood === 'wow'
        this.smile.scale.setScalar(pop)
        this.grin.scale.set(pop, pop, 1)
        this.wow.scale.set(pop, pop * 1.25, 1)
    }
}
