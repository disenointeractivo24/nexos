import * as THREE from 'three'
import { cloudTexture } from './procedural/textures.js'

/**
 * Soft billboard clouds.
 *  - a high layer the camera descends through at the start
 *  - a low ring that frames the edges of the city
 * Clouds fade as the camera gets close, so nothing ever "pops" or clips.
 */
export class CloudLayer {
    constructor({ reducedMotion = false } = {}) {
        this.group = new THREE.Group()
        this.group.name = 'clouds'
        this.reducedMotion = reducedMotion
        this.textures = [1, 2, 3, 4].map((s) => cloudTexture(s))
        this.items = []
        let seed = 11
        this.rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

        // High layer (descent): spread over a wide disc
        for (let i = 0; i < 64; i++) {
            const a = this.rnd() * Math.PI * 2
            const r = Math.sqrt(this.rnd()) * 380
            this.#add(
                new THREE.Vector3(Math.cos(a) * r, 190 + this.rnd() * 230, Math.sin(a) * r + 60),
                150 + this.rnd() * 160,
                0.95,
                { near: 60, far: 170 }
            )
        }
        // A soft deck just below the starting viewpoint: the first view is "above the clouds",
        // and it hides the city while it assembles in the background
        for (let i = 0; i < 18; i++) {
            const a = this.rnd() * Math.PI * 2
            const r = Math.sqrt(this.rnd()) * 210
            this.#add(new THREE.Vector3(Math.cos(a) * r + 10, 540 + this.rnd() * 90, Math.sin(a) * r + 80), 190 + this.rnd() * 140, 0.92, { near: 50, far: 150 })
        }
        // Framing ring around the city edges
        for (let i = 0; i < 42; i++) {
            const a = (i / 42) * Math.PI * 2 + this.rnd() * 0.12
            const r = 205 + this.rnd() * 90
            this.#add(
                new THREE.Vector3(Math.cos(a) * r + 25, 18 + this.rnd() * 50, Math.sin(a) * r * 0.9 + 15),
                130 + this.rnd() * 120,
                0.82,
                { near: 40, far: 110 }
            )
        }
    }

    #add(position, size, opacity, fade) {
        const mat = new THREE.SpriteMaterial({
            map: this.textures[Math.floor(this.rnd() * this.textures.length)],
            transparent: true,
            depthWrite: false,
            opacity,
            fog: false,
            rotation: (this.rnd() - 0.5) * 0.3,
        })
        const s = new THREE.Sprite(mat)
        s.position.copy(position)
        s.scale.set(size, size * 0.62, 1)
        s.userData = {
            base: opacity,
            fade,
            drift: 1.2 + this.rnd() * 1.6, // units per second: slow, steady
            span: 150, // distance travelled before softly recycling
            travel: this.rnd() * 150,
            origin: position.x,
            phase: this.rnd() * Math.PI * 2,
            size,
        }
        this.group.add(s)
        this.items.push(s)
    }

    /** `presence` (0..1) lets the scene thin the clouds out after landing. */
    update(dt, camera, presence = 1) {
        const cp = camera.position
        this.t = (this.t ?? 0) + dt
        for (const s of this.items) {
            const u = s.userData
            let life = 1
            if (!this.reducedMotion) {
                // continuous drift; each cloud fades out before it recycles, so nothing pops
                u.travel = (u.travel + u.drift * dt) % u.span
                s.position.x = u.origin - u.span / 2 + u.travel
                const e = u.travel / u.span
                life = THREE.MathUtils.smoothstep(e, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(e, 0.9, 1))
                // very slow "breathing" of the puff
                const b = 1 + Math.sin(this.t * 0.12 + u.phase) * 0.04
                s.scale.set(u.size * b, u.size * 0.62 * b, 1)
                s.material.rotation += dt * 0.004 * (u.phase > Math.PI ? 1 : -1)
            }
            const d = s.position.distanceTo(cp)
            const k = THREE.MathUtils.smoothstep(d, u.fade.near, u.fade.far)
            s.material.opacity = u.base * k * presence * life
            s.visible = s.material.opacity > 0.01
        }
    }
}
