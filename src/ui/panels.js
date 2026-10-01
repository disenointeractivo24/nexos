import gsap from 'gsap'
import { icon, hydrateIcons } from './icons.js'
import { CATEGORIES, SUPPLIES, money } from '../data/catalog.js'
import { zoneNeeds, zoneLevel, NEED_WORD } from '../data/zones.js'
import { pointForZone } from '../data/collectionPoints.js'
import { session } from '../app/session.js'
import { cloneMaterials } from '../three/GuideCharacter.js'

const isNarrow = () => window.matchMedia('(max-width: 760px), (max-height: 560px) and (max-width: 1000px)').matches
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Calm reveal for side panels; exposes `alpha` for the 3D item layer. */
class Panel {
    constructor(el, { reducedMotion }) {
        this.el = el
        this.reducedMotion = reducedMotion
        this.state = { alpha: 0 }
        this.open = false
    }

    show() {
        this.open = true
        this.el.hidden = false
        gsap.killTweensOf(this.state)
        const narrow = isNarrow()
        gsap.to(this.state, {
            alpha: 1,
            duration: this.reducedMotion ? 0.01 : 0.6,
            ease: 'power3.out',
            onUpdate: () => this.#apply(narrow),
        })
    }

    hide() {
        this.open = false
        gsap.killTweensOf(this.state)
        const narrow = isNarrow()
        return new Promise((resolve) => {
            gsap.to(this.state, {
                alpha: 0,
                duration: this.reducedMotion ? 0.01 : 0.35,
                ease: 'power2.in',
                onUpdate: () => this.#apply(narrow),
                onComplete: () => {
                    if (!this.open) this.el.hidden = true
                    resolve()
                },
            })
        })
    }

    #apply(narrow) {
        const a = this.state.alpha
        const d = (1 - a) * 18
        this.el.style.opacity = a
        this.el.style.transform = narrow ? `translateY(${d}px)` : `translateX(${d}px) scale(${0.985 + 0.015 * a})`
    }

    /** Re-render with a smooth height change instead of a jump. */
    morph(render) {
        const h0 = this.el.offsetHeight
        render()
        hydrateIcons(this.el)
        if (this.reducedMotion || !h0) return
        const h1 = this.el.offsetHeight
        if (Math.abs(h1 - h0) < 4) return
        gsap.fromTo(this.el, { height: h0 }, { height: h1, duration: 0.45, ease: 'power2.out', onComplete: () => (this.el.style.height = '') })
    }

    footprint() {
        const r = this.el.getBoundingClientRect()
        return { w: r.width, h: r.height }
    }
}

export const catIcon = (catId, extra = '') => {
    const c = CATEGORIES[catId]
    return `<span class="wlabel-icon ${extra}" style="background:${c.color}">${icon(c.icon)}</span>`
}

/* ================================================================= */

export class ZoneCard extends Panel {
    constructor(el, opts, { onEnter, onClose }) {
        super(el, opts)
        this.onEnter = onEnter
        this.onClose = onClose
    }

    render(zone) {
        const theme = session.theme
        const collector = session.role === 'collector'
        const level = zoneLevel(zone, theme)
        const point = pointForZone(zone.id)
        const urgent = session.zoneHasUrgent(zone.id)
        const needs = zoneNeeds(zone, theme)
            .map(
                ([cat, lvl]) => `
            <li class="need-row">
                ${catIcon(cat)}
                <span>${CATEGORIES[cat].label}</span>
                <span class="need-level ${lvl === 'alta' ? 'is-high' : ''}">${lvl === 'alta' ? 'Alta' : lvl === 'media' ? 'Media' : 'Baja'}</span>
            </li>`
            )
            .join('')

        this.el.innerHTML = `
            <div class="panel-head">
                <div>
                    <h2 id="zone-title">${zone.name}</h2>
                    <p class="sub">${esc(theme.title)}</p>
                </div>
                <button class="icon-btn js-close" type="button" aria-label="Cerrar y volver al mapa">${icon('x')}</button>
            </div>
            <p class="status-pill">${icon(collector ? 'box' : 'shield')} ${collector ? esc(point.name) : 'Punto de ayuda activo'}</p>
            ${urgent ? `<p class="status-pill is-urgent">${icon('urgent')} Hay faltantes urgentes en esta zona</p>` : ''}
            <p class="section-title">Lo que más se necesita</p>
            <ul class="need-list">${needs}</ul>
            <p class="barrio-line">${collector ? 'Barrio a revisar' : 'Barrio con más necesidad'}<strong>${zone.barrio}</strong></p>
            <button class="btn btn-primary btn-block btn-lg js-enter" type="button">
                ${collector ? 'Revisar el barrio' : 'Ir al barrio'} ${icon('chevron-right')}
            </button>`
        hydrateIcons(this.el)
        this.el.querySelector('.js-close').addEventListener('click', () => this.onClose())
        this.el.querySelector('.js-enter').addEventListener('click', () => this.onEnter(zone))
        this.el.setAttribute('aria-label', `${zone.name}. ${NEED_WORD[level]}.`)
    }

    focusPrimary() {
        this.el.querySelector('.js-enter')?.focus({ preventScroll: true })
    }
}

/* ================================================================= */

/** Shared supply tile pieces */
function tile3D(panel, tileEl, itemId, clipEl) {
    const stage = tileEl.querySelector('.tile-stage')
    const tpl = panel.loader.templates.get(SUPPLIES[itemId].asset)
    tpl?.then((t) => {
        if (!stage.isConnected) return
        const obj = cloneMaterials(panel.loader.instanceSync(t))
        panel.items.add(`tile:${itemId}`, stage, obj, { clipEl, getAlpha: () => panel.state.alpha })
    })
}

function deliveryWindows(now = new Date()) {
    const day = (offset) => {
        const d = new Date(now)
        d.setDate(d.getDate() + offset)
        return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
    }
    const list = []
    if (now.getHours() < 12) list.push({ id: 'hoy-tarde', label: 'Hoy en la tarde', detail: `${day(0)}, de 2:00 a 6:00 p. m.` })
    list.push({ id: 'manana-am', label: 'Mañana en la mañana', detail: `${day(1)}, de 8:00 a. m. a 12:00 m.` })
    list.push({ id: 'manana-pm', label: 'Mañana en la tarde', detail: `${day(1)}, de 2:00 a 6:00 p. m.` })
    list.push({ id: 'pasado-am', label: 'Pasado mañana', detail: `${day(2)}, de 8:00 a. m. a 12:00 m.` })
    return list
}

const refCode = () => `NX-${Math.floor(1000 + Math.random() * 9000)}`

/**
 * Donor panel. Steps (one primary action each):
 *   supplies → basket → method → (details → summary) | (payment → gateway → paying) → done
 */
export class DonorPanel extends Panel {
    constructor(el, opts, { items, loader, onClose, onStep, onConfirm, onExitMap }) {
        super(el, opts)
        Object.assign(this, { items, loader, onClose, onStep, onConfirm, onExitMap })
        this.step = 'supplies'
        this.details = { name: '', phone: '', email: '', window: '', notes: '' }
    }

    get basket() {
        return session.basket(this.house.id)
    }

    async openFor(house, barrio) {
        this.house = house
        this.barrio = barrio
        this.point = pointForZone(barrio.zone.id)
        this.step = 'supplies'
        this.mode = null
        await Promise.all(house.needs.map((n) => this.loader.load(SUPPLIES[n.item].asset)))
        this.render(false)
        this.show()
    }

    close() {
        this.items.removeWhere('tile:')
        return this.hide().then(() => {
            if (!this.open) this.el.innerHTML = ''
        })
    }

    go(step) {
        this.step = step
        this.render(true)
        this.onStep?.(step)
        this.el.querySelector('.supply-body')?.scrollTo({ top: 0 })
        const target = this.el.querySelector('[data-autofocus]') ?? this.el.querySelector('.js-primary')
        target?.focus({ preventScroll: true })
    }

    render(animate = true) {
        this.items.removeWhere('tile:')
        const draw = () => {
            this.el.dataset.step = this.step
            const fn = {
                supplies: this.#supplies,
                basket: this.#basket,
                method: this.#method,
                details: this.#detailsForm,
                summary: this.#summary,
                payment: this.#payment,
                gateway: this.#gateway,
                paying: this.#paying,
                done: this.#done,
            }[this.step]
            fn.call(this)
            this.el.querySelector('.js-close')?.addEventListener('click', () => this.onClose())
        }
        if (animate) this.morph(draw)
        else {
            draw()
            hydrateIcons(this.el)
        }
    }

    #head(title, sub) {
        return `
            <div class="supply-head">
                ${catIcon(this.house.category)}
                <div>
                    <h2 id="supply-title">${title}</h2>
                    <p class="sub">${sub}</p>
                </div>
                <button class="icon-btn js-close" type="button" aria-label="Cerrar y volver al barrio">${icon('x')}</button>
            </div>`
    }

    #totals() {
        let units = 0, value = 0
        for (const [id, q] of this.basket) {
            units += q
            value += q * SUPPLIES[id].value
        }
        return { kinds: this.basket.size, units, value }
    }

    #sortedNeeds() {
        return [...this.house.needs].sort((a, b) => session.isUrgent(this.house.id, b.item) - session.isUrgent(this.house.id, a.item))
    }

    /* ---------- 1 · supplies ---------- */
    #supplies() {
        const h = this.house
        const tiles = this.#sortedNeeds()
            .map((n) => {
                const s = SUPPLIES[n.item]
                const q = this.basket.get(n.item) ?? 0
                const urgent = session.isUrgent(h.id, n.item)
                const covered = n.qty <= 0
                return `
                <div class="tile ${q ? 'is-selected' : ''} ${urgent ? 'is-urgent' : ''} ${covered ? 'is-covered' : ''}" data-item="${n.item}">
                    <button class="tile-toggle" type="button" ${covered ? 'disabled' : ''}
                        aria-label="${s.label}. ${covered ? 'Ya está cubierto' : `Se necesitan ${n.qty}. Valor de referencia ${money(s.value)} cada uno. Agregar uno`}">
                        <span class="tile-stage" aria-hidden="true"></span>
                        <span class="tile-name">${s.label}</span>
                    </button>
                    <p class="tile-meta">${urgent ? `<span class="tile-flag">${icon('urgent')} Urgente</span>` : ''}<span>${covered ? 'Ya está cubierto' : `${n.qty === 1 ? 'Se necesita' : 'Se necesitan'} <b>${n.qty}</b>`}</span><span class="tile-value">${money(s.value)} c/u</span></p>
                    ${covered ? '' : this.#stepper(n.item, q, n.qty)}
                </div>`
            })
            .join('')

        this.el.innerHTML = `
            ${this.#head('Suministros necesarios', `Casa ${h.number} · Elige qué y cuánto aportar.`)}
            <div class="supply-body step-enter">
                <div class="supply-grid" role="group" aria-label="Suministros que necesita esta casa">${tiles}</div>
            </div>
            <div class="supply-foot">
                <div class="basket-bar" aria-live="polite"></div>
                <button class="btn btn-primary js-primary js-next" type="button">Ver mi cesta ${icon('chevron-right')}</button>
            </div>`

        const body = this.el.querySelector('.supply-body')
        this.el.querySelectorAll('.tile').forEach((tile) => {
            const id = tile.dataset.item
            const need = h.needs.find((n) => n.item === id)
            tile3D(this, tile, id, body)
            tile.querySelector('.tile-toggle').addEventListener('click', () => {
                const q = this.basket.get(id) ?? 0
                if (q < need.qty) this.#setQty(id, q + 1, need.qty)
            })
            this.#bindStepper(tile, id, need.qty)
        })
        this.el.querySelector('.js-next').addEventListener('click', () => {
            if (!this.basket.size) {
                this.el.querySelector('.tile:not(.is-covered) .tile-toggle')?.focus()
                this.#nudge()
                return
            }
            this.go('basket')
        })
        this.#syncBasketBar()
    }

    #stepper(id, q, max, label = SUPPLIES[id].label) {
        return `
            <div class="stepper" role="group" aria-label="Cantidad de ${label}">
                <button type="button" class="js-minus" aria-label="Quitar uno" ${q <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
                <output aria-live="polite">${q}</output>
                <button type="button" class="js-plus" aria-label="Agregar uno" ${q >= max ? 'disabled' : ''}>${icon('plus')}</button>
            </div>`
    }

    #bindStepper(scope, id, max) {
        scope.querySelector('.js-minus')?.addEventListener('click', () => this.#setQty(id, (this.basket.get(id) ?? 0) - 1, max))
        scope.querySelector('.js-plus')?.addEventListener('click', () => this.#setQty(id, (this.basket.get(id) ?? 0) + 1, max))
    }

    #setQty(id, q, max) {
        q = Math.max(0, Math.min(max, q))
        if (q) this.basket.set(id, q)
        else this.basket.delete(id)
        // update every view of this item in place (tile or basket row)
        this.el.querySelectorAll(`[data-item="${id}"]`).forEach((scope) => {
            scope.classList.toggle('is-selected', q > 0)
            const out = scope.querySelector('output')
            if (out) out.textContent = q
            const minus = scope.querySelector('.js-minus')
            const plus = scope.querySelector('.js-plus')
            if (minus) minus.disabled = q <= 0
            if (plus) plus.disabled = q >= max
            const sub = scope.querySelector('.row-subtotal')
            if (sub) sub.textContent = money(q * SUPPLIES[id].value)
        })
        this.items.setSelected(`tile:${id}`, q > 0)
        this.#syncBasketBar()
        this.#syncTotal()
    }

    #syncBasketBar() {
        const bar = this.el.querySelector('.basket-bar')
        const next = this.el.querySelector('.js-next')
        if (!bar) return
        const t = this.#totals()
        bar.innerHTML = t.kinds
            ? `<span class="basket-icon">${icon('basket')}</span><span class="basket-text"><b>Cesta de apoyo</b><span>${t.units} ${t.units === 1 ? 'unidad' : 'unidades'} · ${money(t.value)}</span></span>`
            : `<span class="basket-icon is-empty">${icon('basket')}</span><span class="basket-text"><b>Tu cesta está vacía</b><span>Toca un suministro para agregarlo.</span></span>`
        hydrateIcons(bar)
        next?.setAttribute('aria-disabled', String(!t.kinds))
    }

    #nudge() {
        if (this.reducedMotion) return
        const bar = this.el.querySelector('.basket-bar')
        gsap.fromTo(bar, { x: -6 }, { x: 0, duration: 0.45, ease: 'sine.out' })
    }

    /* ---------- 2 · basket ---------- */
    #basket() {
        const rows = [...this.basket]
            .map(([id, q]) => {
                const s = SUPPLIES[id]
                const need = this.house.needs.find((n) => n.item === id)
                return `
                <li class="basket-row" data-item="${id}">
                    <span class="row-name"><b>${s.label}</b><span>${money(s.value)} por ${s.unit}</span></span>
                    ${this.#stepper(id, q, need.qty)}
                    <span class="row-subtotal">${money(q * s.value)}</span>
                </li>`
            })
            .join('')
        this.el.innerHTML = `
            ${this.#head('Tu cesta de apoyo', `Casa ${this.house.number} · ${this.barrio.name}`)}
            <div class="supply-body step-enter">
                <ul class="basket-list">${rows}</ul>
                <div class="total-line"><span>Valor equivalente</span><b class="js-total"></b></div>
                <p class="hint">${icon('info')} Es un valor de referencia: así sabes cuánto representa tu aporte.</p>
            </div>
            <div class="supply-foot">
                <button class="btn btn-secondary js-more" type="button">${icon('chevron-left')} Agregar más</button>
                <span class="foot-spacer"></span>
                <button class="btn btn-primary js-primary js-next" type="button">Continuar ${icon('chevron-right')}</button>
            </div>`
        this.el.querySelectorAll('.basket-row').forEach((row) => {
            const id = row.dataset.item
            this.#bindStepper(row, id, this.house.needs.find((n) => n.item === id).qty)
        })
        this.el.querySelector('.js-more').addEventListener('click', () => this.go('supplies'))
        this.el.querySelector('.js-next').addEventListener('click', () => (this.basket.size ? this.go('method') : this.go('supplies')))
        this.#syncTotal()
    }

    #syncTotal() {
        const el = this.el.querySelector('.js-total')
        if (el) el.textContent = money(this.#totals().value)
        const next = this.step === 'basket' && this.el.querySelector('.js-next')
        if (next) next.setAttribute('aria-disabled', String(!this.basket.size))
    }

    /* ---------- 3 · method ---------- */
    #method() {
        const t = this.#totals()
        this.el.innerHTML = `
            ${this.#head('¿Cómo quieres aportar?', `Tu cesta: ${t.units} ${t.units === 1 ? 'unidad' : 'unidades'} · ${money(t.value)}`)}
            <div class="supply-body step-enter">
                <div class="choice-list">
                    <button class="choice js-physical" type="button" data-autofocus>
                        <span class="choice-icon">${icon('box')}</span>
                        <span class="choice-text"><b>Entregar los suministros</b><span>Llevas los productos a un punto de acopio cercano.</span></span>
                        ${icon('chevron-right')}
                    </button>
                    <button class="choice js-money" type="button">
                        <span class="choice-icon">${icon('hands')}</span>
                        <span class="choice-text"><b>Aportar el valor en dinero</b><span>El equipo de la Cruz Roja compra y entrega por ti.</span></span>
                        ${icon('chevron-right')}
                    </button>
                </div>
            </div>
            <div class="supply-foot">
                <button class="btn btn-secondary js-back" type="button">${icon('chevron-left')} Volver a la cesta</button>
            </div>`
        this.el.querySelector('.js-physical').addEventListener('click', () => {
            this.mode = 'physical'
            this.go('details')
        })
        this.el.querySelector('.js-money').addEventListener('click', () => {
            this.mode = 'money'
            this.go('payment')
        })
        this.el.querySelector('.js-back').addEventListener('click', () => this.go('basket'))
    }

    /* ---------- 4a · physical: details ---------- */
    #detailsForm() {
        const d = this.details
        const windows = deliveryWindows()
        if (!windows.some((w) => w.id === d.window)) d.window = ''
        this.el.innerHTML = `
            ${this.#head('Tus datos para la entrega', 'Solo lo necesario para coordinar.')}
            <form class="supply-body step-enter donor-form" novalidate>
                <label class="field">
                    <span class="field-label">Nombre completo</span>
                    <input name="name" type="text" autocomplete="name" value="${esc(d.name)}" required data-autofocus>
                    <span class="field-error" data-for="name" hidden></span>
                </label>
                <label class="field">
                    <span class="field-label">Teléfono</span>
                    <input name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(d.phone)}" required>
                    <span class="field-error" data-for="phone" hidden></span>
                </label>
                <label class="field">
                    <span class="field-label">Correo <span class="optional">(opcional)</span></span>
                    <input name="email" type="email" autocomplete="email" value="${esc(d.email)}">
                    <span class="field-error" data-for="email" hidden></span>
                </label>
                <fieldset class="field">
                    <legend class="field-label">¿Cuándo puedes llevarlo?</legend>
                    <div class="chips">
                        ${windows
                            .map(
                                (w) => `
                            <label class="chip">
                                <input type="radio" name="window" value="${w.id}" ${d.window === w.id ? 'checked' : ''}>
                                <span><b>${w.label}</b><small>${w.detail}</small></span>
                            </label>`
                            )
                            .join('')}
                    </div>
                    <span class="field-error" data-for="window" hidden></span>
                </fieldset>
                <label class="field">
                    <span class="field-label">Observaciones <span class="optional">(opcional)</span></span>
                    <textarea name="notes" rows="2">${esc(d.notes)}</textarea>
                </label>
            </form>
            <div class="supply-foot">
                <button class="btn btn-secondary js-back" type="button">${icon('chevron-left')} Volver</button>
                <span class="foot-spacer"></span>
                <button class="btn btn-primary js-primary js-next" type="button">Ver resumen ${icon('chevron-right')}</button>
            </div>`
        const form = this.el.querySelector('form')
        const read = () => {
            const f = new FormData(form)
            Object.assign(d, {
                name: String(f.get('name') ?? '').trim(),
                phone: String(f.get('phone') ?? '').trim(),
                email: String(f.get('email') ?? '').trim(),
                window: String(f.get('window') ?? ''),
                notes: String(f.get('notes') ?? '').trim(),
            })
        }
        form.addEventListener('input', read)
        const submit = () => {
            read()
            const problems = []
            if (d.name.length < 3) problems.push(['name', 'Escribe tu nombre.'])
            if (d.phone.replace(/\D/g, '').length < 7) problems.push(['phone', 'Escribe un teléfono de al menos 7 números.'])
            if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) problems.push(['email', 'Revisa el correo, o déjalo en blanco.'])
            if (!d.window) problems.push(['window', 'Elige cuándo puedes llevarlo.'])
            form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'))
            form.querySelectorAll('.field-error').forEach((e) => (e.hidden = true))
            if (problems.length) {
                for (const [n, msg] of problems) {
                    form.querySelectorAll(`[name="${n}"]`).forEach((i) => {
                        i.setAttribute('aria-invalid', 'true')
                        i.setAttribute('aria-describedby', `err-${n}`)
                    })
                    const e = form.querySelector(`.field-error[data-for="${n}"]`)
                    e.id = `err-${n}`
                    e.textContent = msg
                    e.hidden = false
                }
                const first = form.querySelector(`[name="${problems[0][0]}"]`)
                first?.focus()
                first?.closest('.field')?.scrollIntoView({ block: 'center', behavior: this.reducedMotion ? 'auto' : 'smooth' })
                return
            }
            this.go('summary')
        }
        form.addEventListener('submit', (e) => {
            e.preventDefault()
            submit()
        })
        this.el.querySelector('.js-next').addEventListener('click', submit)
        this.el.querySelector('.js-back').addEventListener('click', () => this.go('method'))
    }

    #itemsSummary() {
        const rows = [...this.basket]
            .map(([id, q]) => {
                const s = SUPPLIES[id]
                return `<li><span>${q} × ${s.label}</span><span>${money(q * s.value)}</span></li>`
            })
            .join('')
        return `<ul class="mini-list">${rows}</ul><div class="total-line"><span>Valor equivalente</span><b>${money(this.#totals().value)}</b></div>`
    }

    /* ---------- 4a · physical: summary ---------- */
    #summary() {
        const p = this.point
        const w = deliveryWindows().find((x) => x.id === this.details.window)
        this.code = this.code ?? refCode()
        this.el.innerHTML = `
            ${this.#head('Resumen del aporte', 'Revisa los datos y confirma.')}
            <div class="supply-body step-enter">
                ${this.#itemsSummary()}
                <div class="info-block">${icon('pin')}<div><span class="info-label">Dónde entregar</span><b>${esc(p.name)}</b><span>${esc(p.address)}</span><span>Atención ${esc(p.hours)}</span></div></div>
                <div class="info-block">${icon('calendar')}<div><span class="info-label">Cuándo</span><b>${esc(w?.label ?? '')}</b><span>${esc(w?.detail ?? '')}</span></div></div>
                <div class="info-block">${icon('home')}<div><span class="info-label">Para quién</span><b>Casa ${this.house.number} · ${this.barrio.name}</b><span>Llegará a la familia entre 24 y 48 horas después de tu entrega.</span></div></div>
                <div class="steps-block">
                    <span class="info-label">Siguientes pasos</span>
                    <ol>
                        <li>Empaca los suministros en una bolsa o caja.</li>
                        <li>En el punto, di tu nombre o muestra el código <b>${this.code}</b>.</li>
                        <li>Si algo cambia, te llamaremos al ${esc(this.details.phone)}.</li>
                    </ol>
                </div>
            </div>
            <div class="supply-foot">
                <button class="btn btn-secondary js-back" type="button">${icon('chevron-left')} Cambiar</button>
                <span class="foot-spacer"></span>
                <button class="btn btn-primary js-primary js-confirm" type="button">Confirmar entrega</button>
            </div>`
        this.el.querySelector('.js-back').addEventListener('click', () => this.go('details'))
        this.el.querySelector('.js-confirm').addEventListener('click', () => this.#finish())
    }

    /* ---------- 4b · money ---------- */
    #payment() {
        const t = this.#totals()
        this.el.innerHTML = `
            ${this.#head('Aporte en dinero', `Casa ${this.house.number} · ${this.barrio.name}`)}
            <div class="supply-body step-enter">
                ${this.#itemsSummary()}
                <p class="hint">${icon('info')} Con este valor, la Cruz Roja compra y entrega estos suministros a esta casa.</p>
            </div>
            <div class="supply-foot">
                <button class="btn btn-secondary js-back" type="button">${icon('chevron-left')} Volver</button>
                <span class="foot-spacer"></span>
                <button class="btn btn-primary js-primary js-pay" type="button">${icon('lock')} Ir a pagar ${money(t.value)}</button>
            </div>`
        this.el.querySelector('.js-back').addEventListener('click', () => this.go('method'))
        this.el.querySelector('.js-pay').addEventListener('click', () => this.go('gateway'))
    }

    /** Prototype payment gateway — clearly labelled, collects no payment data. */
    #gateway() {
        const t = this.#totals()
        const methods = [
            ['pse', 'bank', 'PSE', 'Débito desde tu cuenta bancaria'],
            ['card', 'card', 'Tarjeta', 'Crédito o débito'],
            ['wallet', 'phone', 'Nequi o Daviplata', 'Desde tu celular'],
        ]
        this.el.innerHTML = `
            ${this.#head('Pasarela de pago', 'Conexión segura')}
            <div class="supply-body step-enter">
                <div class="gateway">
                    <div class="gateway-bar">${icon('lock')}<span>Pago seguro · Demostración</span></div>
                    <p class="gateway-amount"><span>Valor a aportar</span><b>${money(t.value)}</b></p>
                    <p class="gateway-demo">${icon('info')} Esto es un prototipo: no se realizará ningún cobro ni se piden datos bancarios.</p>
                    <fieldset class="choice-list" aria-label="Medio de pago">
                        ${methods
                            .map(
                                ([id, ic, label, sub], i) => `
                            <label class="choice is-radio">
                                <input type="radio" name="pay" value="${id}" ${i === 0 ? 'data-autofocus' : ''}>
                                <span class="choice-icon">${icon(ic)}</span>
                                <span class="choice-text"><b>${label}</b><span>${sub}</span></span>
                            </label>`
                            )
                            .join('')}
                    </fieldset>
                </div>
            </div>
            <div class="supply-foot">
                <button class="btn btn-secondary js-back" type="button">Cancelar</button>
                <span class="foot-spacer"></span>
                <button class="btn btn-primary js-primary js-pay" type="button" aria-disabled="true">Pagar ${money(t.value)}</button>
            </div>`
        const pay = this.el.querySelector('.js-pay')
        this.el.querySelectorAll('input[name="pay"]').forEach((r) => r.addEventListener('change', () => pay.setAttribute('aria-disabled', 'false')))
        pay.addEventListener('click', () => {
            const m = this.el.querySelector('input[name="pay"]:checked')
            if (!m) {
                this.el.querySelector('input[name="pay"]')?.focus()
                return
            }
            this.payMethod = m.value
            this.go('paying')
        })
        this.el.querySelector('.js-back').addEventListener('click', () => this.go('payment'))
    }

    #paying() {
        this.el.innerHTML = `
            ${this.#head('Procesando tu aporte', 'Un momento, por favor.')}
            <div class="supply-body step-enter">
                <div class="processing" role="status">
                    <div class="processing-bar"><span></span></div>
                    <p>Confirmando con la pasarela…</p>
                </div>
            </div>`
        const bar = this.el.querySelector('.processing-bar span')
        gsap.fromTo(bar, { width: '0%' }, { width: '100%', duration: this.reducedMotion ? 0.3 : 1.8, ease: 'power1.inOut', onComplete: () => this.#finish() })
    }

    #finish() {
        this.code = this.code ?? refCode()
        const record = {
            code: this.code,
            mode: this.mode,
            house: this.house.id,
            items: Object.fromEntries(this.basket),
            value: this.#totals().value,
            window: this.details.window,
            at: new Date().toISOString(),
        }
        this.onConfirm?.(this.house, new Map(this.basket), record)
        this.lastRecord = { ...record, totals: this.#totals(), lines: [...this.basket] }
        session.clearBasket(this.house.id)
        this.go('done')
    }

    /* ---------- 5 · done ---------- */
    #done() {
        const r = this.lastRecord
        const physical = r.mode === 'physical'
        const w = deliveryWindows().find((x) => x.id === r.window)
        this.el.innerHTML = `
            ${this.#head(physical ? 'Entrega programada' : 'Aporte recibido', `Casa ${this.house.number} · ${this.barrio.name}`)}
            <div class="supply-body step-enter">
                <div class="done">
                    <span class="done-mark">${icon('check')}</span>
                    <h3>Gracias por tu apoyo</h3>
                    <p>${physical ? `Te esperamos en <b>${esc(this.point.name)}</b>, ${esc((w?.detail ?? '').replace(/\.$/, ''))}.` : 'Con tu aporte, el equipo comprará y entregará estos suministros a esta casa.'}</p>
                    <p class="done-code">${physical ? 'Código de entrega' : 'Referencia'}<b>${r.code}</b></p>
                    <p class="done-small">Valor equivalente: ${money(r.totals.value)}${physical ? '' : ' · Pago de demostración'}</p>
                </div>
            </div>
            <div class="supply-foot">
                <button class="btn btn-secondary js-map" type="button">${icon('map')} Volver al mapa</button>
                <span class="foot-spacer"></span>
                <button class="btn btn-primary js-primary js-done" type="button">Ver otras casas</button>
            </div>`
        this.code = null
        this.el.querySelector('.js-done').addEventListener('click', () => this.onClose())
        this.el.querySelector('.js-map').addEventListener('click', () => this.onExitMap?.())
    }
}

/* ================================================================= */

/**
 * Collection point view of an aid point: the same tiles, with one extra
 * permission — marking an item as an urgent shortage.
 */
export class CollectorPanel extends Panel {
    constructor(el, opts, { items, loader, onClose, onAlert }) {
        super(el, opts)
        Object.assign(this, { items, loader, onClose, onAlert })
        this.step = 'review'
    }

    async openFor(house, barrio) {
        this.house = house
        this.barrio = barrio
        await Promise.all(house.needs.map((n) => this.loader.load(SUPPLIES[n.item].asset)))
        this.render()
        this.show()
    }

    close() {
        this.items.removeWhere('tile:')
        return this.hide().then(() => {
            if (!this.open) this.el.innerHTML = ''
        })
    }

    render() {
        this.items.removeWhere('tile:')
        const h = this.house
        this.el.dataset.step = 'review'
        const tiles = h.needs
            .map((n) => {
                const s = SUPPLIES[n.item]
                const on = session.isUrgent(h.id, n.item)
                return `
                <div class="tile ${on ? 'is-urgent is-selected' : ''}" data-item="${n.item}">
                    <div class="tile-toggle is-static">
                        <span class="tile-stage" aria-hidden="true"></span>
                        <span class="tile-name">${s.label}</span>
                    </div>
                    <p class="tile-meta"><span>${n.qty === 1 ? 'Se necesita' : 'Se necesitan'} <b>${n.qty}</b></span></p>
                    <button class="alert-btn ${on ? 'is-on' : ''}" type="button" aria-pressed="${on}">
                        ${icon('urgent')}<span>${on ? 'Faltante urgente' : 'Alertar faltante'}</span>
                    </button>
                </div>`
            })
            .join('')
        this.el.innerHTML = `
            <div class="supply-head">
                ${catIcon(h.category)}
                <div>
                    <h2 id="supply-title">Revisión · Casa ${h.number}</h2>
                    <p class="sub">${CATEGORIES[h.category].label} · Marca lo que falta con urgencia.</p>
                </div>
                <button class="icon-btn js-close" type="button" aria-label="Cerrar y volver al barrio">${icon('x')}</button>
            </div>
            <div class="supply-body step-enter">
                <div class="supply-grid" role="group" aria-label="Suministros de esta casa">${tiles}</div>
            </div>
            <div class="supply-foot">
                <p class="summary" aria-live="polite"></p>
                <button class="btn btn-primary js-primary js-done" type="button">Listo</button>
            </div>`
        hydrateIcons(this.el)
        const body = this.el.querySelector('.supply-body')
        this.el.querySelectorAll('.tile').forEach((tile) => {
            const id = tile.dataset.item
            tile3D(this, tile, id, body)
            tile.querySelector('.alert-btn').addEventListener('click', () => this.#toggle(tile, id))
        })
        this.el.querySelector('.js-close').addEventListener('click', () => this.onClose())
        this.el.querySelector('.js-done').addEventListener('click', () => this.onClose())
        this.#summary()
    }

    #toggle(tile, id) {
        const on = !session.isUrgent(this.house.id, id)
        session.setUrgent(this.house.id, id, on)
        tile.classList.toggle('is-urgent', on)
        tile.classList.toggle('is-selected', on)
        const b = tile.querySelector('.alert-btn')
        b.classList.toggle('is-on', on)
        b.setAttribute('aria-pressed', String(on))
        b.querySelector('span:last-child').textContent = on ? 'Faltante urgente' : 'Alertar faltante'
        this.items.setSelected(`tile:${id}`, on)
        this.#summary()
        this.onAlert?.(this.house, id, on)
    }

    #summary() {
        const n = session.urgentCount(this.house.id)
        this.el.querySelector('.summary').innerHTML = n
            ? `<b>${n} ${n === 1 ? 'alerta activa' : 'alertas activas'}</b> Los donantes verán estos insumos primero.`
            : 'Sin alertas. Toca “Alertar faltante” si algo se necesita con urgencia.'
    }
}

export { isNarrow }
