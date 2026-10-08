import { icon, hydrateIcons } from './icons.js'
import { WEATHER } from '../app/caliSky.js'

/**
 * A test panel for the time and the weather: drag through the day, pick a
 * weather, and go back to Cali's real ones. Meant for development and demos,
 * so it only opens on the dev server or with ?debug in the address: by
 * clicking the clock in the top bar, or with Shift + D.
 */

const QUICK = [
    ['Amanecer', 6 * 60],
    ['Mediodía', 12 * 60],
    ['Atardecer', 17 * 60 + 55],
    ['Noche', 21 * 60],
    ['Madrugada', 2 * 60 + 30],
]

const fmt = (min) => {
    const h = Math.floor(min / 60)
    const m = min % 60
    const h12 = ((h + 11) % 12) + 1
    return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

export const skyDebugEnabled = () => !!import.meta.env?.DEV || new URLSearchParams(location.search).has('debug')

export class SkyDebug {
    constructor(root, sky) {
        this.sky = sky
        this.el = document.createElement('section')
        this.el.className = 'sky-debug glass'
        this.el.hidden = true
        this.el.setAttribute('aria-label', 'Prueba de hora y clima')
        this.el.innerHTML = `
            <div class="sky-debug-head">
                <span data-icon="clock" aria-hidden="true"></span>
                <b>Prueba de hora y clima</b>
                <button class="icon-btn js-close" type="button" aria-label="Cerrar la prueba">${icon('x')}</button>
            </div>
            <label class="sky-debug-row">
                <span>Hora</span>
                <output class="js-time">--</output>
            </label>
            <input class="js-range" type="range" min="0" max="1435" step="5" aria-label="Hora del día">
            <div class="sky-debug-quick">
                ${QUICK.map(([label, min]) => `<button type="button" data-min="${min}">${label}</button>`).join('')}
            </div>
            <label class="sky-debug-row">
                <span>Clima</span>
                <select class="js-kind">
                    <option value="">El real de Cali</option>
                    ${Object.entries(WEATHER).map(([id, w]) => `<option value="${id}">${w.label}</option>`).join('')}
                </select>
            </label>
            <button class="btn btn-secondary js-live" type="button">Volver a la hora y el clima reales</button>`
        root.appendChild(this.el)
        hydrateIcons(this.el)

        this.range = this.el.querySelector('.js-range')
        this.time = this.el.querySelector('.js-time')
        this.kind = this.el.querySelector('.js-kind')

        this.range.addEventListener('input', () => this.#setTime(+this.range.value))
        this.el.querySelectorAll('.sky-debug-quick button').forEach((b) => b.addEventListener('click', () => this.#setTime(+b.dataset.min)))
        this.kind.addEventListener('change', () => this.sky.setOverride({ kind: this.kind.value || null }))
        this.el.querySelector('.js-live').addEventListener('click', () => {
            this.sky.setOverride({ minutes: null, kind: null })
            this.#sync()
        })
        this.el.querySelector('.js-close').addEventListener('click', () => this.toggle(false))
        this.sky.on(() => this.#sync())
    }

    #setTime(min) {
        this.sky.setOverride({ minutes: min })
        this.#sync()
    }

    #sync() {
        const s = this.sky.state
        this.range.value = s.minutes
        this.time.textContent = `${fmt(s.minutes)}${s.manual ? '' : ' · en vivo'}`
        if (document.activeElement !== this.kind) this.kind.value = this.sky.fixedKind ?? ''
    }

    toggle(open = this.el.hidden) {
        this.el.hidden = !open
        if (open) {
            this.#sync()
            this.range.focus({ preventScroll: true })
        }
    }
}
