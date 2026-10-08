import * as THREE from 'three'
import { hydrateIcons } from './icons.js'

/**
 * Real buttons that float over 3D positions (zones, houses).
 * Being DOM elements they stay crisp, large, keyboard-focusable and readable.
 */
export class Labels {
    constructor(container, camera) {
        this.container = container
        this.camera = camera
        this.items = new Map()
        this._v = new THREE.Vector3()
    }

    add(id, { html, ariaLabel, anchor, onClick, className = '' }) {
        this.remove(id)
        const el = document.createElement('button')
        el.type = 'button'
        el.className = `wlabel glass ${className}`
        el.innerHTML = html
        if (ariaLabel) el.setAttribute('aria-label', ariaLabel)
        el.addEventListener('click', (e) => {
            e.stopPropagation()
            onClick?.()
        })
        el.style.opacity = '0'
        el.dataset.id = id
        hydrateIcons(el)
        this.container.appendChild(el)
        requestAnimationFrame(() => (el.style.opacity = ''))
        this.items.set(id, { el, anchor })
        return el
    }

    get(id) {
        return this.items.get(id)?.el
    }

    update(id, html, ariaLabel) {
        const el = this.get(id)
        if (!el) return
        el.innerHTML = html
        if (ariaLabel) el.setAttribute('aria-label', ariaLabel)
        hydrateIcons(el)
        const it = this.items.get(id)
        it.w = it.h = 0
    }

    remove(id) {
        const it = this.items.get(id)
        if (!it) return
        it.el.remove()
        this.items.delete(id)
    }

    clear() {
        for (const id of [...this.items.keys()]) this.remove(id)
    }

    setClass(id, cls, on) {
        this.get(id)?.classList.toggle(cls, on)
    }

    setAll(cls, on, except) {
        for (const [id, it] of this.items) it.el.classList.toggle(cls, id === except ? !on : on)
    }

    /** Project each anchor to the screen. `avoid` = screen rects labels must not slide under. */
    project(width, height, avoid = []) {
        // The camera was moved this frame but the renderer has not refreshed its
        // matrices yet; without this the labels trail one frame behind the world.
        this.camera.updateMatrixWorld()
        const placed = []
        for (const it of this.items.values()) {
            const p = this._v.copy(it.anchor()).project(this.camera)
            const behind = p.z > 1 || p.z < -1
            const x = (p.x * 0.5 + 0.5) * width
            let y = (-p.y * 0.5 + 0.5) * height
            const lh = it.h || (it.h = it.el.offsetHeight || 56)
            const lw = it.w || (it.w = it.el.offsetWidth || 180)
            for (const r of avoid) {
                const overlapsX = x + lw / 2 > r.left - 8 && x - lw / 2 < r.right + 8
                if (overlapsX && y - lh - 12 < r.bottom + 8) y = r.bottom + 8 + lh + 12
            }
            const off = behind || x < -200 || x > width + 200 || y < -100 || y > height + 200
            it.el.style.visibility = off ? 'hidden' : ''
            if (!off && !it.el.classList.contains('is-hidden')) placed.push({ it, x, y, w: lw, h: lh })
        }
        // Gently separate labels that would overlap (horizontal nudge only)
        for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < placed.length; i++) {
                for (let j = i + 1; j < placed.length; j++) {
                    const a = placed[i], b = placed[j]
                    if (Math.abs(a.y - b.y) > (a.h + b.h) / 2 + 4) continue
                    const need = (a.w + b.w) / 2 + 10 - Math.abs(a.x - b.x)
                    if (need <= 0) continue
                    const dir = a.x <= b.x ? -1 : 1
                    a.x += (dir * need) / 2
                    b.x -= (dir * need) / 2
                }
            }
        }
        for (const p of placed) p.x = Math.min(Math.max(p.x, p.w / 2 + 8), width - p.w / 2 - 8)
        // If the screen edge prevented a sideways fix, lift the farther label instead
        placed.sort((a, b) => b.y - a.y)
        for (let i = 0; i < placed.length; i++) {
            for (let j = 0; j < i; j++) {
                const a = placed[j], b = placed[i]
                const overlapX = (a.w + b.w) / 2 + 6 - Math.abs(a.x - b.x)
                const overlapY = (a.h + b.h) / 2 + 6 - Math.abs(a.y - b.y)
                if (overlapX > 0 && overlapY > 0) b.y = a.y - a.h - 6
            }
        }
        for (const p of placed) {
            p.it.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, calc(-100% - 12px))`
        }
    }
}

/** Guide speech: short, calm, one idea at a time. */
export class Bubble {
    constructor(el) {
        this.el = el
        this.current = ''
    }

    say(lead, action) {
        const html = `<span class="bubble-in">${lead ? `${lead}` : ''}${action ? `<strong>${action}</strong>` : ''}</span>`
        if (html === this.current) return
        this.current = html
        this.el.innerHTML = html
        this.el.hidden = false
    }

    hide() {
        this.el.hidden = true
        this.current = ''
    }
}
