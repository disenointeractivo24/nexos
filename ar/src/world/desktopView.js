import * as THREE from 'three'

const EYE = 1.6
const SPEED = 1.8 // m/s, a calm walk
const TURN = 1.5 // rad/s with the keys, or holding something at the edge of the view
const BODY = 0.22 // how close to furniture the person can get
const DRAG_PX = 5 // less than this between press and release is a click, not a look around
const EDGE = 0.72 // from here to the edge of the view, holding something turns the person

/**
 * Being there with no headset: drag to look around, keys to walk, the camera at a person's
 * height. Pressing on something that can be carried holds it instead (see `grab`): it
 * follows the pointer until let go, and going to the edge of the view turns the person, so
 * it can be taken to the shelves behind them.
 */
export class DesktopView {
    /**
     * @param {{ grab?: { pick(ndc: THREE.Vector2): boolean, move(ndc: THREE.Vector2): void, drop(ndc: THREE.Vector2): void } }} opts
     */
    constructor({ camera, canvas, solids, bounds, roof, grab }) {
        this.camera = camera
        this.canvas = canvas
        this.solids = solids
        this.bounds = bounds
        this.roof = roof
        this.grab = grab
        this.yaw = 0
        this.pitch = -0.28
        this.keys = new Set()
        this.walking = true
        this.down = false
        this.moved = false
        this.holding = false
        this.onClick = null
        this.ndc = new THREE.Vector2()
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
        const place = (e) => {
            const r = canvas.getBoundingClientRect()
            this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2)
        }
        canvas.addEventListener('pointerdown', (e) => {
            this.down = true
            this.moved = false
            startX = lastX = e.clientX
            startY = lastY = e.clientY
            place(e)
            this.holding = !!this.grab?.pick(this.ndc)
            canvas.setPointerCapture?.(e.pointerId)
        })
        canvas.addEventListener('pointermove', (e) => {
            place(e)
            if (!this.down) return
            if (Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_PX) this.moved = true
            if (this.holding) this.grab.move(this.ndc)
            else if (this.moved && this.walking) {
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
            if (this.holding) {
                this.holding = false
                this.onClick = null
                this.grab.drop(this.ndc)
                return
            }
            const click = this.onClick
            this.onClick = null
            if (click && !this.moved) click()
        }
        canvas.addEventListener('pointerup', end)
        canvas.addEventListener('pointercancel', end)
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
        // no frame-rate hiccup turns into a leap
        const d = Math.min(dt, 0.1)
        const k = this.keys
        let turn = (k.has('ArrowLeft') || k.has('KeyQ') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyE') ? 1 : 0)
        let pitch = 0
        if (this.holding) {
            const { x, y } = this.ndc
            if (Math.abs(x) > EDGE) turn -= (Math.sign(x) * (Math.abs(x) - EDGE)) / (1 - EDGE)
            if (Math.abs(y) > EDGE) pitch = (Math.sign(y) * (Math.abs(y) - EDGE)) / (1 - EDGE)
        }
        if (turn || pitch) {
            this.yaw += turn * TURN * d
            this.pitch = THREE.MathUtils.clamp(this.pitch + pitch * TURN * 0.6 * d, -1.3, 1.1)
            this.#aim()
        }
        const ahead = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
        const across = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
        if (ahead || across) {
            this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
            this.side.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
            const step = SPEED * d
            const dx = (this.forward.x * ahead + this.side.x * across) * step
            const dz = (this.forward.z * ahead + this.side.z * across) * step
            const p = this.camera.position
            // one axis at a time, so walking into the counter slides along it
            if (!this.#blocked(p.x + dx, p.z)) p.x += dx
            if (!this.#blocked(p.x, p.z + dz)) p.z += dz
        }
        if (this.holding && (turn || pitch || ahead || across)) this.grab.move(this.ndc)
    }
}
