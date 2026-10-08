import gsap from 'gsap'
import { icon, hydrateIcons } from './icons.js'
import { CATEGORIES, SUPPLIES, money, perBox, basketBoxes, BOX } from '../data/catalog.js'
import { stockCap, stockState, stockRatio } from '../data/inventory.js'
import { ZONES, zoneNeeds, zoneLevel, NEED_WORD, barrioNeeds } from '../data/zones.js'
import { pointForZone, mapEmbedUrl, directionsUrl } from '../data/collectionPoints.js'
import { session } from '../app/session.js'
import { cloneMaterials } from '../three/GuideCharacter.js'

const isNarrow = () => window.matchMedia('(max-width: 760px), (max-height: 560px) and (max-width: 1000px)').matches
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Calm reveal for side panels; exposes `alpha` for the 3D item layer. */
class Panel {
    constructor(el, { reducedMotion, audio }) {
        this.el = el
        this.reducedMotion = reducedMotion
        this.audio = audio ?? { play() {} }
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
        // the zone card slides in from the right edge, the supply panel from the left,
        // and the inventory board, docked along the bottom, rises from below
        const side = this.el.classList.contains('supply-panel') ? -1 : 1
        const rises = narrow || this.el.classList.contains('is-board')
        this.el.style.transform = rises ? `translateY(${d}px)` : `translateX(${side * d}px) scale(${0.985 + 0.015 * a})`
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
/** Still pictures of each supply, made once and shared by every panel. */
const pictures = new Map()

function tile3D(panel, tileEl, itemId, clipEl) {
    const stage = tileEl.querySelector('.tile-stage')
    const tpl = panel.loader.templates.get(SUPPLIES[itemId].asset)
    tpl?.then((t) => {
        if (!stage.isConnected) return
        // on a phone the panel scrolls under a finger: a picture moves with it, a live overlay lags
        if (isNarrow()) {
            if (!pictures.has(itemId)) pictures.set(itemId, panel.items.snapshot(cloneMaterials(panel.loader.instanceSync(t))))
            stage.style.backgroundImage = `url(${pictures.get(itemId)})`
            stage.classList.add('is-picture')
            return
        }
        const obj = cloneMaterials(panel.loader.instanceSync(t))
        panel.items.add(`tile:${itemId}`, stage, obj, { clipEl, getAlpha: () => panel.state.alpha })
    })
}

/** Phones count with one pair of buttons: this switch says whether they move a unit or a box. */
function stepToggle(byBox) {
    return `
        <div class="step-toggle" role="radiogroup" aria-label="Los botones suman o quitan">
            <button type="button" role="radio" data-by="unit" aria-checked="${!byBox}">Unidad</button>
            <button type="button" role="radio" data-by="box" aria-checked="${!!byBox}">Caja</button>
        </div>`
}

function bindStepToggle(root, onChange) {
    root.querySelectorAll('.step-toggle button').forEach((b) =>
        b.addEventListener('click', () => {
            const byBox = b.dataset.by === 'box'
            root.querySelectorAll('.step-toggle button').forEach((o) => o.setAttribute('aria-checked', String(o === b)))
            onChange(byBox)
        })
    )
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

/** "3 cajas y 2 sueltas": how a volunteer counts a shelf. */
function boxesLabel(qty, per) {
    const boxes = Math.floor(qty / per)
    const loose = qty - boxes * per
    if (!boxes) return loose ? `${loose} ${loose === 1 ? 'suelta' : 'sueltas'}` : 'Vacío'
    return `${boxes} ${boxes === 1 ? 'caja' : 'cajas'}${loose ? ` + ${loose}` : ''}`
}

const refCode = () => `NX-${Math.floor(1000 + Math.random() * 9000)}`

/**
 * Donor panel, opened at the barrio's collection point.
 *
 * Aid is no longer chosen house by house. A person leaves supplies at the
 * stand and the families come to collect them, so this panel works from the
 * barrio's totals: every category at once, each shown by its icon alone, with
 * the supplies of whichever category is open.
 *
 * Steps (one primary action each):
 *   supplies → method → (details → summary) | (payment → paying) → done
 */
export class DonorPanel extends Panel {
    constructor(el, opts, { items, loader, onClose, onStep, onConfirm, onExitMap, onBasket }) {
        super(el, opts)
        Object.assign(this, { items, loader, onClose, onStep, onConfirm, onExitMap, onBasket })
        this.step = 'supplies'
        this.details = { name: '', phone: '', email: '', window: '', notes: '' }
    }

    get basket() {
        return session.basket(this.barrio.id)
    }

    /** How many of an item the whole barrio still needs. */
    #max(item) {
        return this.flat.get(item)?.qty ?? 0
    }

    async openFor(barrio) {
        this.barrio = barrio
        this.point = pointForZone(barrio.zone.id)
        this.groups = barrioNeeds(barrio)
        this.flat = new Map()
        for (const g of this.groups) for (const it of g.items) this.flat.set(it.item, it)
        this.category = this.groups[0]?.category ?? null
        this.step = 'supplies'
        this.mode = null
        // a basket kept from earlier never holds more than the families still need
        for (const [id, q] of this.basket) {
            const max = this.#max(id)
            if (max <= 0) this.basket.delete(id)
            else if (q > max) this.basket.set(id, max)
        }
        await Promise.all([...this.flat.keys()].map((id) => this.loader.load(SUPPLIES[id].asset)))
        this.render(false)
        this.show()
        // a basket kept from an earlier visit is already waiting on the counter
        this.onBasket?.(this.basket)
    }

    close() {
        this.items.removeWhere('tile:')
        return this.hide().then(() => {
            if (!this.open) this.el.innerHTML = ''
        })
    }

    /**
     * The point's stock moved while the donor is choosing (another device, the
     * sheet, another donation): show the new needs. The basket stays, but never
     * above what is still needed.
     */
    refreshNeeds() {
        if (!this.open || !this.barrio) return
        this.groups = barrioNeeds(this.barrio)
        this.flat = new Map()
        for (const g of this.groups) for (const it of g.items) this.flat.set(it.item, it)
        for (const [id, q] of this.basket) {
            const max = this.#max(id)
            if (max <= 0) this.basket.delete(id)
            else if (q > max) this.basket.set(id, max)
        }
        if (!this.groups.some((g) => g.category === this.category)) this.category = this.groups[0]?.category ?? null
        if (this.step === 'supplies') this.render(false)
        this.onBasket?.(this.basket)
    }

    go(step) {
        this.audio.play(step === 'done' ? 'confirm' : 'step')
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
                method: this.#method,
                details: this.#detailsForm,
                summary: this.#summary,
                payment: this.#payment,
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
                <span class="wlabel-icon" style="background:#011E41">${icon('box')}</span>
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
        // how much of a real box this fills, from the size and weight of each thing
        const fill = basketBoxes(this.basket)
        return { kinds: this.basket.size, units, value, fill, boxes: Math.max(1, Math.ceil(fill)) }
    }

    /** "media caja" / "1 caja" / "3 cajas" — the space a basket actually takes. */
    #boxWord(t) {
        if (!t.kinds) return ''
        if (t.fill < 0.18) return 'cabe de sobra en una caja'
        if (t.fill < 0.62) return 'llena media caja'
        if (t.fill <= 1) return 'llena una caja'
        return `ocupa ${t.boxes} cajas`
    }

    /** Icon-only tabs, one per category the barrio still needs. */
    #categoryStrip() {
        const key = this.barrio.id
        return `
            <div class="cat-strip" role="tablist" aria-label="Tipos de ayuda">
                ${this.groups
                    .map((g) => {
                        const c = CATEGORIES[g.category]
                        const urgent = g.items.some((it) => session.isUrgent(key, it.item))
                        const on = g.category === this.category
                        return `
                        <button class="cat-tab ${on ? 'is-on' : ''}" type="button" role="tab" aria-selected="${on}"
                            data-cat="${g.category}" title="${c.label}" aria-label="${c.label}">
                            <span class="cat-icon" style="background:${c.color}">${icon(c.icon)}</span>
                            ${urgent ? '<span class="cat-dot"></span>' : ''}
                        </button>`
                    })
                    .join('')}
            </div>`
    }

    /* ---------- 1 · supplies, at the collection point ---------- */
    #supplies() {
        const key = this.barrio.id
        const group = this.groups.find((g) => g.category === this.category) ?? this.groups[0]
        const tiles = [...(group?.items ?? [])]
            .sort((a, b) => session.isUrgent(key, b.item) - session.isUrgent(key, a.item))
            .map((n) => {
                const s = SUPPLIES[n.item]
                const q = this.basket.get(n.item) ?? 0
                const urgent = session.isUrgent(key, n.item)
                return `
                <div class="tile ${q ? 'is-selected' : ''} ${urgent ? 'is-urgent' : ''}" data-item="${n.item}">
                    <button class="tile-toggle" type="button"
                        aria-label="${s.label}. Se necesitan ${n.qty}. Valor de referencia ${money(s.value)} cada uno. Agregar uno">
                        <span class="tile-stage" aria-hidden="true"></span>
                        <span class="tile-name">${s.label}</span>
                    </button>
                    <p class="tile-meta">${urgent ? `<span class="tile-flag">${icon('urgent')} Urgente</span>` : ''}<span>${n.qty === 1 ? 'Se necesita' : 'Se necesitan'} <b>${n.qty}</b></span><span class="tile-value">${money(s.value)} c/u</span><span class="tile-pack">${icon('box')} ${perBox(n.item)} por caja</span></p>
                    ${this.#stepper(n.item, q, n.qty)}
                    <div class="box-step">
                        <button type="button" class="js-box-minus" aria-label="Quitar una caja de ${s.label}" ${q <= 0 ? 'disabled' : ''}>${icon('minus')} caja</button>
                        <button type="button" class="js-box-plus" aria-label="Agregar una caja de ${s.label} (${perBox(n.item)} unidades)" ${q >= n.qty ? 'disabled' : ''}>${icon('plus')} caja</button>
                    </div>
                </div>`
            })
            .join('')

        this.el.innerHTML = `
            ${this.#head('Punto de acopio', `${this.barrio.name} · Elige qué dejar aquí.`)}
            <div class="supply-body step-enter">
                <div class="cat-row">${this.#categoryStrip()}${stepToggle(this.byBox)}</div>
                <div class="supply-grid" role="group" aria-label="Suministros que necesita el barrio">${tiles}</div>
                <section class="basket-inline" aria-label="Tu cesta de apoyo" hidden>
                    <p class="section-title">Tu cesta de apoyo</p>
                    <ul class="basket-list js-basket-list"></ul>
                    <div class="total-line"><span>Valor equivalente</span><b class="js-total"></b></div>
                    <p class="hint js-pack-hint">${icon('box')} <span></span></p>
                    <p class="hint">${icon('info')} Es un valor de referencia: así sabes cuánto representa tu aporte.</p>
                </section>
            </div>
            <div class="supply-foot">
                <div class="basket-bar" aria-live="polite"></div>
                <button class="btn btn-primary js-primary js-next" type="button">Continuar ${icon('chevron-right')}</button>
            </div>`

        const body = this.el.querySelector('.supply-body')
        bindStepToggle(this.el, (byBox) => {
            this.byBox = byBox
            this.audio.play('tap')
        })
        this.el.querySelectorAll('.cat-tab').forEach((tab) =>
            tab.addEventListener('click', () => {
                if (tab.dataset.cat === this.category) return
                this.category = tab.dataset.cat
                this.audio.play('tap')
                this.render(true)
            })
        )
        this.el.querySelectorAll('.tile').forEach((tile) => {
            const id = tile.dataset.item
            const max = this.#max(id)
            tile3D(this, tile, id, body)
            tile.querySelector('.tile-toggle').addEventListener('click', () => {
                const q = this.basket.get(id) ?? 0
                if (q < max) this.#setQty(id, q + 1, max)
            })
            this.#bindStepper(tile, id, max)
            // a whole box at a time; the last one only fills up to what is still needed
            const per = perBox(id)
            tile.querySelector('.js-box-minus')?.addEventListener('click', () => this.#setQty(id, (this.basket.get(id) ?? 0) - per, max))
            tile.querySelector('.js-box-plus')?.addEventListener('click', () => this.#setQty(id, (this.basket.get(id) ?? 0) + per, max))
        })
        this.#syncBasketRows()
        this.el.querySelector('.js-next').addEventListener('click', () => {
            if (!this.basket.size) {
                this.el.querySelector('.tile .tile-toggle')?.focus()
                this.audio.play('error')
                this.#nudge()
                return
            }
            this.go('method')
        })
        this.#syncBasketBar()
        this.#syncTotal()
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
        // on a phone the same buttons move a whole box when the switch says so
        const step = () => (this.byBox && isNarrow() && scope.classList.contains('tile') ? perBox(id) : 1)
        scope.querySelector('.js-minus')?.addEventListener('click', () => this.#setQty(id, (this.basket.get(id) ?? 0) - step(), max))
        scope.querySelector('.js-plus')?.addEventListener('click', () => this.#setQty(id, (this.basket.get(id) ?? 0) + step(), max))
    }

    #setQty(id, q, max) {
        q = Math.max(0, Math.min(max, q))
        const before = this.basket.get(id) ?? 0
        if (q !== before) this.audio.play(q > before ? 'add' : 'remove')
        if (q) this.basket.set(id, q)
        else this.basket.delete(id)
        this.el.querySelectorAll(`[data-item="${id}"]`).forEach((scope) => {
            scope.classList.toggle('is-selected', q > 0)
            const out = scope.querySelector('output')
            if (out) out.textContent = q
            for (const b of scope.querySelectorAll('.js-minus, .js-box-minus')) b.disabled = q <= 0
            for (const b of scope.querySelectorAll('.js-plus, .js-box-plus')) b.disabled = q >= max
            const sub = scope.querySelector('.row-subtotal')
            if (sub) sub.textContent = money(q * SUPPLIES[id].value)
        })
        this.items.setSelected(`tile:${id}`, q > 0)
        if (q !== before) this.onBasket?.(this.basket)
        if (this.step === 'supplies' && (before === 0 || q === 0)) this.#syncBasketRows()
        this.#syncBasketBar()
        this.#syncTotal()
    }

    /** Rows inside the in-place basket review, rebuilt whenever an item joins or leaves. */
    #syncBasketRows() {
        const list = this.el.querySelector('.js-basket-list')
        if (!list) return
        list.innerHTML = [...this.basket]
            .map(([id, q]) => {
                const sup = SUPPLIES[id]
                return `
                <li class="basket-row" data-item="${id}">
                    <span class="row-name"><b>${sup.label}</b><span>${money(sup.value)} por ${sup.unit}</span></span>
                    ${this.#stepper(id, q, this.#max(id))}
                    <span class="row-subtotal">${money(q * sup.value)}</span>
                </li>`
            })
            .join('')
        hydrateIcons(list)
        list.querySelectorAll('.basket-row').forEach((row) => this.#bindStepper(row, row.dataset.item, this.#max(row.dataset.item)))
    }

    #syncBasketBar() {
        const bar = this.el.querySelector('.basket-bar')
        const next = this.el.querySelector('.js-next')
        if (!bar) return
        const t = this.#totals()
        bar.innerHTML = t.kinds
            ? `<span class="basket-icon">${icon('basket')}</span><span class="basket-text"><b>Cesta de apoyo</b><span>${t.units} ${t.units === 1 ? 'unidad' : 'unidades'} · ${money(t.value)} · ${this.#boxWord(t)}</span></span>`
            : `<span class="basket-icon is-empty">${icon('basket')}</span><span class="basket-text"><b>Tu cesta está vacía</b><span>Toca un suministro para agregarlo.</span></span>`
        hydrateIcons(bar)
        const inline = this.el.querySelector('.basket-inline')
        if (inline) inline.hidden = !t.kinds
        next?.setAttribute('aria-disabled', String(!t.kinds))
    }

    #nudge() {
        if (this.reducedMotion) return
        const bar = this.el.querySelector('.basket-bar')
        gsap.fromTo(bar, { x: -6 }, { x: 0, duration: 0.45, ease: 'sine.out' })
    }

    #syncTotal() {
        const t = this.#totals()
        const el = this.el.querySelector('.js-total')
        if (el) el.textContent = money(t.value)
        const pack = this.el.querySelector('.js-pack-hint span')
        if (pack) pack.textContent = t.kinds ? `Por tamaño y peso, lo que llevas ${this.#boxWord(t)} (${BOX.label}).` : ''
        const next = this.step === 'supplies' && this.el.querySelector('.js-next')
        if (next) next.setAttribute('aria-disabled', String(!this.basket.size))
    }

    /* ---------- 2 · method ---------- */
    #method() {
        const t = this.#totals()
        this.el.innerHTML = `
            ${this.#head('¿Cómo quieres aportar?', `Tu cesta: ${t.units} ${t.units === 1 ? 'unidad' : 'unidades'} · ${money(t.value)} · ${this.#boxWord(t)}`)}
            <div class="supply-body step-enter">
                <div class="choice-list">
                    <button class="choice js-physical" type="button" data-autofocus>
                        <span class="choice-icon">${icon('box')}</span>
                        <span class="choice-text"><b>Entregar los suministros</b><span>Llevas los productos al punto de acopio del barrio.</span></span>
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
                <button class="btn btn-secondary js-back" type="button">${icon('chevron-left')} Cambiar suministros</button>
            </div>`
        this.el.querySelector('.js-physical').addEventListener('click', () => {
            this.mode = 'physical'
            this.go('details')
        })
        this.el.querySelector('.js-money').addEventListener('click', () => {
            this.mode = 'money'
            this.go('payment')
        })
        this.el.querySelector('.js-back').addEventListener('click', () => this.go('supplies'))
    }

    /* ---------- 3a · physical: details ---------- */
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
                this.audio.play('error')
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
                <div class="info-block">${icon('pin')}<div><span class="info-label">Dónde entregar</span><b>${esc(p.name)}</b><span>${esc(p.address)}, Cali</span><span>Atención ${esc(p.hours)}</span></div></div>
                <figure class="place-map">
                    <iframe title="Mapa: ${esc(p.name)}" src="${mapEmbedUrl(p)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
                    <figcaption>
                        <span>${icon('pin')} ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>
                        <a href="${directionsUrl(p)}" target="_blank" rel="noopener">Cómo llegar ${icon('chevron-right')}</a>
                    </figcaption>
                </figure>
                <div class="info-block">${icon('calendar')}<div><span class="info-label">Cuándo</span><b>${esc(w?.label ?? '')}</b><span>${esc(w?.detail ?? '')}</span></div></div>
                <div class="info-block">${icon('home')}<div><span class="info-label">Para quién</span><b>Familias del ${esc(this.barrio.name)}</b><span>Las familias recogen los insumos en el punto de acopio del barrio.</span></div></div>
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

    /* ---------- 3b · money ---------- */
    #payment() {
        const t = this.#totals()
        const methods = [
            ['pse', 'bank', 'PSE', 'Débito desde tu cuenta bancaria'],
            ['card', 'card', 'Tarjeta', 'Crédito o débito'],
            ['wallet', 'phone', 'Nequi o Daviplata', 'Desde tu celular'],
        ]
        this.el.innerHTML = `
            ${this.#head('Aporte en dinero', `${this.barrio.name} · Punto de acopio`)}
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
                <details class="basket-peek">
                    <summary class="basket-bar"><span class="basket-icon">${icon('basket')}</span><span class="basket-text"><b>Qué compra tu aporte</b><span>${t.units} ${t.units === 1 ? 'unidad' : 'unidades'} para este barrio</span></span></summary>
                    ${this.#itemsSummary()}
                </details>
                <p class="hint">${icon('info')} Con este valor, la Cruz Roja compra y deja estos suministros en el punto de acopio.</p>
            </div>
            <div class="supply-foot">
                <button class="btn btn-secondary js-back" type="button">${icon('chevron-left')} Volver</button>
                <span class="foot-spacer"></span>
                <button class="btn btn-primary js-primary js-pay" type="button" aria-disabled="true">${icon('lock')} Aportar ${money(t.value)}</button>
            </div>`
        const pay = this.el.querySelector('.js-pay')
        this.el.querySelectorAll('input[name="pay"]').forEach((r) => r.addEventListener('change', () => pay.setAttribute('aria-disabled', 'false')))
        pay.addEventListener('click', () => {
            const m = this.el.querySelector('input[name="pay"]:checked')
            if (!m) {
                this.el.querySelector('input[name="pay"]')?.focus()
                this.audio.play('error')
                return
            }
            this.payMethod = m.value
            this.go('paying')
        })
        this.el.querySelector('.js-back').addEventListener('click', () => this.go('method'))
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
        gsap.fromTo(bar, { width: '0%' }, { width: '100%', duration: this.reducedMotion ? 0.3 : 1.0, ease: 'power1.inOut', onComplete: () => this.#finish() })
    }

    #finish() {
        this.code = this.code ?? refCode()
        const record = {
            code: this.code,
            mode: this.mode,
            barrio: this.barrio.id,
            items: Object.fromEntries(this.basket),
            value: this.#totals().value,
            window: this.details.window,
            at: new Date().toISOString(),
        }
        this.lastRecord = { ...record, totals: this.#totals(), lines: [...this.basket] }
        this.onConfirm?.(this.barrio, new Map(this.basket), record)
        session.clearBasket(this.barrio.id)
        this.go('done')
    }

    /* ---------- 5 · done ---------- */
    #done() {
        const r = this.lastRecord
        const physical = r.mode === 'physical'
        const w = deliveryWindows().find((x) => x.id === r.window)
        this.el.innerHTML = `
            ${this.#head(physical ? 'Entrega programada' : 'Aporte recibido', `${this.barrio.name} · Punto de acopio`)}
            <div class="supply-body step-enter">
                <div class="done">
                    <span class="done-mark">${icon('check')}</span>
                    <h3>Gracias por tu apoyo</h3>
                    <p>${physical ? `Te esperamos en <b>${esc(this.point.name)}</b>, ${esc((w?.detail ?? '').replace(/\.$/, ''))}.` : 'Con tu aporte, el equipo comprará y dejará estos suministros en el punto de acopio.'}</p>
                    <p class="done-note">Las familias ya salieron a recogerlos.</p>
                    <p class="done-code">${physical ? 'Código de entrega' : 'Referencia'}<b>${r.code}</b></p>
                    <p class="done-small">Valor equivalente: ${money(r.totals.value)}${physical ? '' : ' · Pago de demostración'}</p>
                </div>
            </div>
            <div class="supply-foot">
                <button class="btn btn-secondary js-map" type="button">${icon('map')} Volver al mapa</button>
                <span class="foot-spacer"></span>
                <button class="btn btn-primary js-primary js-done" type="button">Seguir en el barrio</button>
            </div>`
        this.code = null
        this.el.querySelector('.js-done').addEventListener('click', () => this.onClose())
        this.el.querySelector('.js-map').addEventListener('click', () => this.onExitMap?.())
    }
}

/* ================================================================= */

/**
 * Collection point view, docked on the left like the donor panel so the stand
 * stays in view beside it.
 *
 * The people who work the stand do not walk the barrio and do not donate. They
 * stand at the counter and keep the list honest, so their panel is a single
 * fixed screen: the categories as icons, the supplies underneath, and one
 * action per item — flag it as urgently missing.
 */
/**
 * The collection point's own board.
 *
 * A point does not walk its barrio and does not hand anything out here: it
 * keeps a count of what is on its shelves. Every supply shows what it holds
 * against the cap it aims for, and reads as crítico, estable or abastecido.
 *
 * Numbers live in a Google Sheet through InventoryStore, so two volunteers on
 * two devices see the same board. Whatever falls under the critical line is
 * what donors are shown first, which is what used to be marked by hand.
 */
export class InventoryPanel extends Panel {
    constructor(el, opts, { items, loader, onClose, onShortages }) {
        super(el, opts)
        Object.assign(this, { items, loader, onClose, onShortages })
        this.step = 'inventario'
        this.store = null
        this.byBox = false
    }

    /** @param {object} point the logged-in collection point @param {InventoryStore} store */
    async openFor(point, store) {
        this.point = point
        this.store = store
        this.el.classList.add('is-board')
        await Promise.all(Object.keys(SUPPLIES).map((id) => this.loader.load(SUPPLIES[id].asset)))
        this.render()
        this.show()
        this.unsubscribe = this.store.on(() => this.#sync())
        this.store.start()
    }

    close() {
        this.unsubscribe?.()
        this.unsubscribe = null
        this.store.stop()
        this.items.removeWhere('tile:')
        this.el.classList.remove('is-board')
        return this.hide().then(() => {
            if (!this.open) this.el.innerHTML = ''
        })
    }

    /**
     * Every supply on one board, ordered by category so related things sit
     * together. A point counts its whole stock in one pass; hiding half of it
     * behind tabs would only make that harder.
     */
    get supplies() {
        const order = Object.keys(CATEGORIES)
        return Object.values(SUPPLIES).sort(
            (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.label.localeCompare(b.label, 'es')
        )
    }

    #card(s) {
        const qty = this.store.get(s.id)
        const cap = stockCap(s.id)
        const st = stockState(s.id, qty)
        const per = perBox(s.id)
        return `
        <div class="stock-card is-${st.id}" data-item="${s.id}">
            <div class="stock-top">
                <span class="tile-stage" aria-hidden="true"></span>
                <span class="stock-name">
                    <b>${esc(s.label)}</b>
                    <span class="stock-unit">${per} por caja</span>
                </span>
            </div>
            <div class="stock-line">
                <span class="stock-state" data-state="${st.id}">${st.label}</span>
                <span class="stock-boxes js-boxes">${boxesLabel(qty, per)}</span>
            </div>
            <div class="stock-meter" role="img" aria-label="${qty} de ${cap} ${esc(s.units)}. ${st.label}.">
                <span class="stock-fill" style="width:${Math.round(stockRatio(s.id, qty) * 100)}%"></span>
            </div>
            <div class="stepper stepper-board" role="group" aria-label="Unidades de ${esc(s.label)}">
                <button type="button" class="js-minus" aria-label="Quitar una unidad de ${esc(s.label)}" ${qty <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
                <output aria-live="polite"><b class="js-qty">${qty}</b><small>de ${cap}</small></output>
                <button type="button" class="js-plus" aria-label="Agregar una unidad de ${esc(s.label)}" ${qty >= cap ? 'disabled' : ''}>${icon('plus')}</button>
            </div>
            <div class="box-step">
                <button type="button" class="js-box-minus" aria-label="Quitar una caja de ${esc(s.label)}" ${qty <= 0 ? 'disabled' : ''}>${icon('minus')} caja</button>
                <button type="button" class="js-box-plus" aria-label="Agregar una caja de ${esc(s.label)}" ${qty >= cap ? 'disabled' : ''}>${icon('plus')} caja</button>
            </div>
        </div>`
    }

    render() {
        this.items.removeWhere('tile:')
        const zone = ZONES.find((z) => z.id === this.point.zone)
        this.el.dataset.step = 'inventario'
        this.el.innerHTML = `
            <div class="supply-head board-head">
                <span class="wlabel-icon" style="background:${zone?.color ?? '#011E41'}">${icon('box')}</span>
                <div class="board-title">
                    <h2 id="supply-title">Inventario<span class="board-title-more"> del punto</span></h2>
                    <p class="sub">${esc(this.point.name)} · ${esc(zone?.name ?? '')}</p>
                </div>
                ${stepToggle(this.byBox)}
                <button class="icon-btn js-close" type="button" aria-label="Cerrar el inventario">${icon('x')}</button>
            </div>
            <div class="supply-body step-enter">
                <div class="stock-grid" role="group" aria-label="Inventario del punto de acopio">
                    ${this.supplies.map((s) => this.#card(s)).join('')}
                </div>
            </div>
            <div class="board-foot">
                <p class="source-line js-source" hidden></p>
                <p class="summary js-summary" aria-live="polite"></p>
            </div>`
        hydrateIcons(this.el)
        const body = this.el.querySelector('.supply-body')
        this.el.querySelectorAll('.stock-card').forEach((card) => {
            const id = card.dataset.item
            tile3D(this, card, id, body)
            const per = perBox(id)
            card.querySelector('.js-minus').addEventListener('click', () => this.#bump(id, -1))
            card.querySelector('.js-plus').addEventListener('click', () => this.#bump(id, 1))
            card.querySelector('.js-box-minus').addEventListener('click', () => this.#bump(id, -per))
            card.querySelector('.js-box-plus').addEventListener('click', () => this.#bump(id, per))
        })
        this.el.querySelector('.js-close').addEventListener('click', () => this.onClose())
        bindStepToggle(this.el, (byBox) => {
            this.byBox = byBox
            this.audio.play('tap')
        })
        this.#sync()
    }

    #bump(id, delta) {
        // phones have one pair of buttons; the switch makes them count boxes
        if (this.byBox && isNarrow() && Math.abs(delta) === 1) delta *= perBox(id)
        const before = this.store.get(id)
        const after = this.store.add(id, delta)
        if (after !== before) this.audio.play(after > before ? 'add' : 'remove')
        else this.audio.play('error')
    }

    /** Redraw the numbers in place — the sheet may also have moved them. */
    #sync() {
        if (!this.el.isConnected || !this.point) return
        for (const card of this.el.querySelectorAll('.stock-card')) {
            const id = card.dataset.item
            const qty = this.store.get(id)
            const cap = stockCap(id)
            const st = stockState(id, qty)
            card.className = `stock-card is-${st.id}`
            card.querySelector('.js-qty').textContent = qty
            card.querySelector('.js-boxes').textContent = boxesLabel(qty, perBox(id))
            card.querySelector('.stock-fill').style.width = `${Math.round(stockRatio(id, qty) * 100)}%`
            const chip = card.querySelector('.stock-state')
            chip.textContent = st.label
            chip.dataset.state = st.id
            card.querySelector('.stock-meter').setAttribute('aria-label', `${qty} de ${cap} ${SUPPLIES[id].units}. ${st.label}.`)
            for (const b of card.querySelectorAll('.js-minus, .js-box-minus')) b.disabled = qty <= 0
            for (const b of card.querySelectorAll('.js-plus, .js-box-plus')) b.disabled = qty >= cap
            this.items.setSelected(`tile:${id}`, st.id === 'critico')
        }
        const short = this.store.shortages()
        const sum = this.el.querySelector('.js-summary')
        if (sum) {
            sum.classList.toggle('is-critical', short.length > 0)
            sum.innerHTML = short.length
                ? `<b>${short.length} ${short.length === 1 ? 'insumo crítico' : 'insumos críticos'}:</b> ${short.map((id) => esc(SUPPLIES[id].label)).join(', ')}`
                : '<b>Sin faltantes críticos</b>'
        }
        // the connection only speaks up when something is really wrong with it:
        // a single failed call is retried quietly a few seconds later
        const src = this.el.querySelector('.js-source')
        if (src) {
            src.hidden = !(this.store.status === 'error' && this.store.failures >= 2)
            src.textContent = src.hidden ? '' : this.store.sourceLine()
            src.dataset.status = this.store.status
        }
        this.onShortages?.(short)
    }
}

export { isNarrow }
