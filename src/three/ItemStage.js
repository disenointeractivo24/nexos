import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * Draws small 3D objects inside DOM elements (supply tiles, the guide portrait)
 * using ONE transparent canvas layered above the interface. Each element gets
 * its own viewport + scissor, so there is a single extra WebGL context no
 * matter how many tiles are on screen.
 */
export class ItemStage {
    constructor(canvas, { reducedMotion = false } = {}) {
        this.canvas = canvas
        this.reducedMotion = reducedMotion
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        this.renderer.toneMapping = THREE.NeutralToneMapping
        this.renderer.setClearColor(0x000000, 0)
        this.renderer.autoClear = false

        this.scene = new THREE.Scene()
        const pmrem = new THREE.PMREMGenerator(this.renderer)
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
        this.scene.environmentIntensity = 0.55
        pmrem.dispose()

        this.scene.add(new THREE.HemisphereLight('#FFFFFF', '#C9C3B8', 1.3))
        const key = new THREE.DirectionalLight('#FFF6EA', 2.1)
        key.position.set(-2.5, 4, 3.5)
        const rim = new THREE.DirectionalLight('#DDE8F5', 1.1)
        rim.position.set(3, 2, -3)
        this.scene.add(key, rim)

        this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
        this.views = new Map()
        this.size = { w: 0, h: 0 }
        this.wasEmpty = false
    }

    /**
     * @param {string} id
     * @param {HTMLElement} el      element whose box is the viewport
     * @param {THREE.Object3D} object  normalised object (min y = 0)
     * @param {{clipEl?: HTMLElement, kind?: 'item'|'guide', getAlpha?: () => number, update?: (dt:number,t:number)=>void}} opts
     */
    add(id, el, object, opts = {}) {
        this.remove(id)
        const pivot = new THREE.Group()
        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3())
        if (opts.kind !== 'guide') object.position.y -= box.min.y + size.y / 2
        pivot.add(object)
        pivot.visible = false
        this.scene.add(pivot)

        const mats = []
        object.traverse((o) => {
            if (!o.isMesh) return
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                if (!mats.find((r) => r.m === m)) mats.push({ m, transparent: m.transparent, opacity: m.opacity })
            }
        })

        this.views.set(id, {
            id,
            el,
            pivot,
            object,
            mats,
            kind: opts.kind ?? 'item',
            clipEl: opts.clipEl,
            getAlpha: opts.getAlpha,
            update: opts.update,
            phase: Math.random() * Math.PI * 2,
            spin: -0.5 + Math.random() * 0.3,
            selected: false,
            scale: 1,
            lastAlpha: 1,
        })
    }

    remove(id) {
        const v = this.views.get(id)
        if (!v) return
        this.scene.remove(v.pivot)
        this.views.delete(id)
    }

    removeWhere(prefix) {
        for (const id of [...this.views.keys()]) if (id.startsWith(prefix)) this.remove(id)
    }

    setSelected(id, on) {
        const v = this.views.get(id)
        if (v) v.selected = on
    }

    #resize() {
        const w = window.innerWidth
        const h = window.innerHeight
        if (w === this.size.w && h === this.size.h) return
        this.size = { w, h }
        this.renderer.setSize(w, h, false)
    }

    render(dt, t) {
        this.#resize()
        const { w: W, h: H } = this.size
        const r = this.renderer
        r.setScissorTest(false)
        r.setViewport(0, 0, W, H)

        if (!this.views.size) {
            if (!this.wasEmpty) r.clear()
            this.wasEmpty = true
            return
        }
        this.wasEmpty = false
        r.clear()
        r.setScissorTest(true)

        for (const v of this.views.values()) {
            v.update?.(dt, t)
            // Animate: very slow turn, slight float, gentle lift when selected
            if (v.kind === 'item') {
                if (!this.reducedMotion) {
                    v.pivot.rotation.y = v.spin + Math.sin(t * 0.32 + v.phase) * 0.55
                    v.pivot.position.y = Math.sin(t * 0.9 + v.phase) * 0.035
                }
                const target = v.selected ? 1.08 : 1
                v.scale += (target - v.scale) * (1 - Math.exp(-dt * 6))
                v.pivot.scale.setScalar(v.scale)
                v.pivot.rotation.x = 0.1
            }
        }

        for (const v of this.views.values()) {
            const el = v.el
            if (!el.isConnected) continue
            const rect = el.getBoundingClientRect()
            if (rect.width < 4 || rect.height < 4) continue
            if (rect.bottom < 0 || rect.top > H || rect.right < 0 || rect.left > W) continue

            let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom
            if (v.clipEl) {
                const c = v.clipEl.getBoundingClientRect()
                left = Math.max(left, c.left)
                top = Math.max(top, c.top)
                right = Math.min(right, c.right)
                bottom = Math.min(bottom, c.bottom)
                if (right - left < 1 || bottom - top < 1) continue
            }

            const alpha = v.getAlpha ? v.getAlpha() : 1
            if (alpha < 0.01) continue
            if (alpha !== v.lastAlpha) {
                for (const rec of v.mats) {
                    rec.m.transparent = alpha < 0.999 ? true : rec.transparent
                    rec.m.opacity = rec.opacity * alpha
                }
                v.lastAlpha = alpha
            }

            this.#frameCamera(v, rect.width / rect.height)
            r.setViewport(rect.left, H - rect.bottom, rect.width, rect.height)
            r.setScissor(left, H - bottom, right - left, bottom - top)
            v.pivot.visible = true
            r.render(this.scene, this.camera)
            v.pivot.visible = false
        }
    }

    #frameCamera(v, aspect) {
        const c = this.camera
        c.aspect = aspect
        if (v.kind === 'guide') {
            c.fov = 26
            c.position.set(0, 1.05, 5.4)
            c.lookAt(0, 0.86, 0)
        } else {
            c.fov = 30
            c.position.set(0, 0.55, 3.85)
            c.lookAt(0, -0.02, 0)
        }
        c.updateProjectionMatrix()
    }
}
