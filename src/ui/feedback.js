import gsap from 'gsap'
import { icon, hydrateIcons } from './icons.js'

/**
 * A short message at the bottom of the screen, with one optional action
 * ("Deshacer"). It says what just happened without stopping anybody.
 */
export class Toast {
    constructor(el, { reducedMotion = false } = {}) {
        this.el = el
        this.reducedMotion = reducedMotion
        this.timer = null
    }

    /** @param {string} text @param {{action?: string, onAction?: () => void, duration?: number}} opts */
    show(text, { action, onAction, duration = 5000 } = {}) {
        clearTimeout(this.timer)
        this.el.innerHTML = `<span class="toast-text">${text}</span>${action ? `<button type="button" class="toast-action">${icon('undo')}${action}</button>` : ''}`
        hydrateIcons(this.el)
        this.el.querySelector('.toast-action')?.addEventListener('click', () => {
            this.hide()
            onAction?.()
        })
        if (this.el.hidden) {
            this.el.hidden = false
            gsap.fromTo(this.el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: this.reducedMotion ? 0.01 : 0.3, ease: 'power2.out' })
        }
        this.timer = setTimeout(() => this.hide(), duration)
    }

    get visible() {
        return !this.el.hidden
    }

    hide() {
        clearTimeout(this.timer)
        if (this.el.hidden) return
        gsap.to(this.el, {
            opacity: 0,
            y: 10,
            duration: this.reducedMotion ? 0.01 : 0.25,
            ease: 'power2.in',
            onComplete: () => (this.el.hidden = true),
        })
    }
}

/**
 * A small modal: a question before something that cannot be taken back, or a
 * few lines of help. Resolves with the value of the button pressed (Escape,
 * or a tap outside, is the first "cancel" action).
 */
export class Dialog {
    constructor(backdrop, { reducedMotion = false } = {}) {
        this.backdrop = backdrop
        this.el = backdrop.querySelector('.dialog')
        this.reducedMotion = reducedMotion
        backdrop.addEventListener('pointerdown', (e) => e.target === backdrop && this.#close(this.cancelValue))
        backdrop.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                this.#close(this.cancelValue)
            }
            if (e.key === 'Tab') this.#trap(e)
        })
    }

    get open() {
        return !this.backdrop.hidden
    }

    /**
     * @param {{title: string, body: string, icon?: string, actions: {label: string, value: any, kind?: 'primary'|'secondary'|'danger'}[]}} spec
     */
    ask({ title, body, icon: ic = 'info', actions }) {
        this.returnFocus = document.activeElement
        const cancel = actions.find((a) => a.kind !== 'primary' && a.kind !== 'danger') ?? actions[0]
        this.cancelValue = cancel.value
        this.el.innerHTML = `
            <div class="dialog-head">
                <span class="dialog-icon">${icon(ic)}</span>
                <h2 id="dialog-title">${title}</h2>
            </div>
            <div class="dialog-body">${body}</div>
            <div class="dialog-actions">
                ${actions.map((a, i) => `<button type="button" class="btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-secondary'}" data-i="${i}">${a.label}</button>`).join('')}
            </div>`
        hydrateIcons(this.el)
        this.backdrop.hidden = false
        gsap.fromTo(this.el, { opacity: 0, y: 12, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: this.reducedMotion ? 0.01 : 0.3, ease: 'power2.out' })
        gsap.fromTo(this.backdrop, { opacity: 0 }, { opacity: 1, duration: this.reducedMotion ? 0.01 : 0.25 })
        return new Promise((resolve) => {
            this.resolve = resolve
            this.el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => this.#close(actions[+b.dataset.i].value)))
            // the safe choice has the focus, so Enter never confirms something by accident
            this.el.querySelector(`[data-i="${actions.indexOf(cancel)}"]`).focus()
        })
    }

    #trap(e) {
        const items = [...this.el.querySelectorAll('button')]
        const i = items.indexOf(document.activeElement)
        if (e.shiftKey && i <= 0) {
            e.preventDefault()
            items.at(-1).focus()
        } else if (!e.shiftKey && i === items.length - 1) {
            e.preventDefault()
            items[0].focus()
        }
    }

    #close(value) {
        if (!this.resolve) return
        const resolve = this.resolve
        this.resolve = null
        gsap.to(this.backdrop, {
            opacity: 0,
            duration: this.reducedMotion ? 0.01 : 0.2,
            onComplete: () => {
                this.backdrop.hidden = true
                this.returnFocus?.focus?.({ preventScroll: true })
            },
        })
        resolve(value)
    }
}

/** Help as a short list of concrete steps. */
export const helpList = (steps) => `<ol class="help-steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>`
