import * as THREE from 'three'

const EYE = 1.6
const SPEED = 1.8 // m/s, a calm walk
const BODY = 0.22 // how close to furniture the person can get
const DRAG_PX = 5 // less than this between press and release is a click, not a look around

/**
 * Being there with no headset: drag to look around, keys to walk, the camera at a person's
 * height. It also offers views from outside, to check how the whole thing is laid out.
 */
export class DesktopView {
    constructor({ camera, canvas, solids, bounds, roof }) {
        this.camera = camera
        this.canvas = canvas
        this.solids = solids
        this.bounds = bounds
        this.roof = roof
        this.yaw = 0
        this.pitch = -0.28
        this.keys = new Set()
        this.walking = true
        this.down = false
        this.moved = false
        this.onClick = null
        this.forward = new THREE.Vector3()
        this.side = new THREE.Vector3()
        this.bind()
    }

    bind() {
        const { canvas } = this
        canvas.style.touchAction = 'none'
        let startX = 0
        let startY = 0
        let lastX = 0
        let lastY = 0
        canvas.addEventListener('pointerdown', (e) => {
            this.down = true
            this.moved = false
            startX = lastX = e.clientX
            startY = lastY = e.clientY
            canvas.setPointerCapture?.(e.pointerId)
        })
        canvas.addEventListener('pointermove', (e) => {
            if (!this.down) return
            if (Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_PX) this.moved = true
            if (this.moved && this.walking) {
                this.yaw -= (e.clientX - lastX) * 0.0035
                this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - lastY) * 0.0035, -1.3, 1.1)
                this.#aim()
            }
            lastX = e.clientX
            lastY = e.clientY
        })
        const end = () => {
            if (!this.down) return
            this.down = false
            const click = this.onClick
            this.onClick = null
            if (click && !this.moved) click()
        }
        canvas.addEventListener('pointerup', end)
        canvas.addEventListener('pointercancel', () => {
            this.down = false
            this.onClick = null
        })
        window.addEventListener('keydown', (e) => this.keys.add(e.code))
        window.addEventListener('keyup', (e) => this.keys.delete(e.code))
        window.addEventListener('blur', () => this.keys.clear())
    }

    #aim() {
        this.camera.rotation.order = 'YXZ'
        this.camera.rotation.set(this.pitch, this.yaw, 0)
    }

    /** Back to a person's eyes, at the given spot on the floor. */
    stand(x, z, yaw = 0, pitch = -0.28) {
        this.walking = true
        this.roof(true)
        this.camera.position.set(x, EYE, z)
        this.yaw = yaw
        this.pitch = pitch
        this.#aim()
    }

    /** A fixed view from outside. `noRoof` takes the tent's roof off to see in. */
    lookFrom(position, target, noRoof = false) {
        this.walking = false
        this.roof(!noRoof)
        this.camera.position.copy(position)
        this.camera.lookAt(target)
    }

    #blocked(x, z) {
        const { bounds } = this
        if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return true
        return this.solids.some((s) => x > s.minX - BODY && x < s.maxX + BODY && z > s.minZ - BODY && z < s.maxZ + BODY)
    }

    update(dt) {
        if (!this.walking) return
        const k = this.keys
        const ahead = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
        const across = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
        if (!ahead && !across) return
        this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
        this.side.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
        const step = SPEED * dt
        const dx = (this.forward.x * ahead + this.side.x * across) * step
        const dz = (this.forward.z * ahead + this.side.z * across) * step
        const p = this.camera.position
        // one axis at a time, so walking into the counter slides along it
        if (!this.#blocked(p.x + dx, p.z)) p.x += dx
        if (!this.#blocked(p.x, p.z + dz)) p.z += dz
    }
}
