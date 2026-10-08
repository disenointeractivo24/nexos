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
        // Far horizon clouds. They sit well beyond the city, high enough to read as
        // clouds instead of fog, and never over the Farallones to the west — low
        // cloud on the hills looks like haze and hides the forest.
        for (let i = 0; i < 46; i++) {
            const a = (i / 46) * Math.PI * 2 + this.rnd() * 0.1
            const r = 470 + this.rnd() * 170
            const x = Math.cos(a) * r + 25
            const z = Math.sin(a) * r * 0.95 + 15
            if (x < 30) continue // the western half holds the hills: keep that sky clear
            this.#add(
                new THREE.Vector3(x, 150 + this.rnd() * 110, z),
                110 + this.rnd() * 80,
                0.95,
                { near: 110, far: 300 },
                true
            )
        }
        this._toCloud = new THREE.Vector2()
        this._toCam = new THREE.Vector2()
    }

    #add(position, size, opacity, fade, ring = false) {
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
            ring,
        }
        this.group.add(s)
        this.items.push(s)
    }

    /**
     * `presence` (0..1) thins out the clouds the camera descends through.
     * The far horizon clouds keep their own life: they are scenery, not a veil.
     */
    update(dt, camera, presence = 1) {
        const cp = camera.position
        this.t = (this.t ?? 0) + dt
        // The ring frames the city from above. When the view is tilted down toward the
        // horizon (to look at the hills) it would sit right in front of the camera, so it
        // thins out as the camera gets lower, and clears completely on the camera's side.
        const low = 1 - THREE.MathUtils.smoothstep(cp.y, 40, 130)
        const toCam = this._toCam.set(cp.x - 25, cp.z - 15).normalize()
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
            let k = THREE.MathUtils.smoothstep(d, u.fade.near, u.fade.far)
            if (u.ring && low > 0) {
                const facing = this._toCloud.set(s.position.x - 25, s.position.z - 15).normalize().dot(toCam)
                k *= 1 - low * (facing > -0.2 ? 1 : 0.8)
            }
            s.material.opacity = u.base * k * (u.ring ? 1 : presence) * life
            s.visible = s.material.opacity > 0.01
        }
    }
}
