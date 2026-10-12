import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * Draws small 3D objects inside DOM elements (supply tiles, the guide portrait)
 * using ONE transparent canvas layered above the interface. Each element gets
 * its own viewport + scissor, so there is a single extra WebGL context no
 * matter how many tiles are on screen. The canvas only covers the elements it
 * draws in (and hides when there are none): a transparent layer the size of the
 * screen would have to be blended over the scene in every frame.
 */
export class ItemStage {
    constructor(canvas, { reducedMotion = false } = {}) {
        this.canvas = canvas
        this.reducedMotion = reducedMotion
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
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
    }

    /**
     * @param {string} id
     * @param {HTMLElement} el      element whose box is the viewport
     * @param {THREE.Object3D} object  normalised object (min y = 0)
     * @param {{clipEl?: HTMLElement, owner?: HTMLElement, kind?: 'item'|'guide', getAlpha?: () => number, update?: (dt:number,t:number)=>void}} opts
     *   owner: the element the view belongs to (a tile with its name and count over the picture):
     *   what lies inside it does not count as covering the view
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
            owner: opts.owner ?? el,
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

    /** Place the canvas over the screen box (left, top, w, h), in CSS pixels. */
    #place(left, top, w, h) {
        w = Math.max(1, Math.ceil(w))
        h = Math.max(1, Math.ceil(h))
        if (w !== this.size.w || h !== this.size.h) {
            this.size = { w, h }
            this.renderer.setSize(w, h, false)
            this.canvas.style.width = `${w}px`
            this.canvas.style.height = `${h}px`
        }
        if (left !== this.size.left || top !== this.size.top) {
            this.size.left = left
            this.size.top = top
            this.canvas.style.transform = `translate(${left}px, ${top}px)`
        }
    }

    /**
     * True when something of the interface lies over the middle of a view's element (a dialog,
     * the tracking card, a panel that slid over it): this canvas sits above the whole interface,
     * so a covered tile must not be drawn. Checked every few frames; the 3D scene behind (or
     * nothing at all) does not count as covering.
     */
    #covered(v, x, y) {
        if (this.frame % 4 !== 0 && v.covered !== undefined) return v.covered
        const hit = document.elementFromPoint(x, y)
        v.covered = !!hit && hit !== document.body && hit !== document.documentElement && !hit.matches('canvas.webgl') && !v.owner.contains(hit) && !hit.contains(v.owner)
        return v.covered
    }

    render(dt, t) {
        this.frame = (this.frame ?? 0) + 1
        const r = this.renderer
        // where on screen there is something to draw, clipped to the window
        const W = window.innerWidth, H = window.innerHeight
        const boxes = []
        for (const v of this.views.values()) {
            if (!v.el.isConnected) continue
            const rect = v.el.getBoundingClientRect()
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
            const box = { v, rect, left: Math.max(0, left), top: Math.max(0, top), right: Math.min(W, right), bottom: Math.min(H, bottom) }
            if (this.#covered(v, (box.left + box.right) / 2, (box.top + box.bottom) / 2)) continue
            boxes.push(box)
        }
        if (!boxes.length) {
            this.canvas.style.display = 'none'
            return
        }
        this.canvas.style.display = ''
        const L = Math.floor(Math.min(...boxes.map((b) => b.left))), T = Math.floor(Math.min(...boxes.map((b) => b.top)))
        const R = Math.ceil(Math.max(...boxes.map((b) => b.right))), B = Math.ceil(Math.max(...boxes.map((b) => b.bottom)))
        this.#place(L, T, R - L, B - T)
        const ch = this.size.h
        r.setScissorTest(false)
        r.setViewport(0, 0, this.size.w, ch)
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

        for (const { v, rect, left, top, right, bottom } of boxes) {
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
            // the canvas starts at (L, T) on screen, and GL counts y up from its bottom edge
            r.setViewport(rect.left - L, ch - (rect.bottom - T), rect.width, rect.height)
            r.setScissor(left - L, ch - (bottom - T), right - left, bottom - top)
            v.pivot.visible = true
            r.render(this.scene, this.camera)
            v.pivot.visible = false
        }
    }

    /**
     * A still picture of an item, framed as its tile would show it. Phones use
     * these instead of the live overlay: a picture scrolls with the page, while
     * the overlay is redrawn a frame late and seems to jump during a scroll.
     * @returns {string} a PNG data URL
     */
    snapshot(object, px = 112) {
        // drawn in the canvas' bottom-left corner: it must be at least that big
        this.#place(this.size.left ?? 0, this.size.top ?? 0, Math.max(px, this.size.w), Math.max(px, this.size.h))
        const r = this.renderer
        const dpr = r.getPixelRatio()
        const pivot = new THREE.Group()
        const box = new THREE.Box3().setFromObject(object)
        object.position.y -= box.min.y + box.getSize(new THREE.Vector3()).y / 2
        pivot.add(object)
        pivot.rotation.set(0.1, -0.35, 0)
        this.scene.add(pivot)
        for (const v of this.views.values()) v.pivot.visible = false
        this.#frameCamera({ kind: 'item' }, 1)
        r.setScissorTest(true)
        r.setViewport(0, 0, px, px)
        r.setScissor(0, 0, px, px)
        r.clear()
        r.render(this.scene, this.camera)
        const side = Math.round(px * dpr)
        const out = document.createElement('canvas')
        out.width = out.height = side
        // read back in the same task as the render, before the canvas is presented
        out.getContext('2d').drawImage(this.canvas, 0, this.canvas.height - side, side, side, 0, 0, side, side)
        r.clear()
        r.setScissorTest(false)
        this.scene.remove(pivot)
        return out.toDataURL('image/png')
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
