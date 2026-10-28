import gsap from 'gsap'
import { icon, hydrateIcons } from './icons.js'
import { pointMenu, POINT_TITLES } from './pointMenu.js'
import { transferSheet } from './transferSheet.js'
import { receiveWays, receiveLists, sentList } from './receiveView.js'
import { inventoryFilter, updateFilterCounts, applyFilter } from './inventoryView.js'
import { CATEGORIES, SUPPLIES, money, perBox, basketBoxes, BOX } from '../data/catalog.js'
import { stockCap, stockState, stockRatio } from '../data/inventory.js'
import { ZONES, zoneNeeds, zoneLevel, NEED_WORD, barrioNeeds } from '../data/zones.js'
import { pointForZone, mapEmbedUrl, directionsUrl } from '../data/collectionPoints.js'
import { session } from '../app/session.js'
import { cloneMaterials } from '../three/GuideCharacter.js'
import { helpList, busyButton } from './feedback.js'
import { deliveryWindows, findWindow } from '../data/delivery.js'
import { newCode, trackUrl, ledger, readCode } from '../app/donations.js'
import { qrSvg, scanQr } from './qr.js'
import { COLLECTION_POINTS } from '../data/collectionPoints.js'

const isNarrow = () => window.matchMedia('(max-width: 760px), (max-height: 560px) and (max-width: 1000px)').matches
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Calm reveal for side panels; exposes `alpha` for the 3D item layer. */
class Panel {
    constructor(el, { reducedMotion, audio, toast, dialog }) {
        this.el = el
        this.reducedMotion = reducedMotion
        this.audio = audio ?? { play() {} }
        this.toast = toast
        this.dialog = dialog
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
    return `<span class="wlabel-icon is-category ${extra}" style="background:${c.tint};color:${c.color}">${icon(c.icon)}</span>`
}

/* ================================================================= */

export class ZoneCard extends Panel {
    constructor(el, opts, { onEnter, onClose }) {
        super(el, opts)
        this.onEnter = onEnter
        this.onClose = onClose
    }

    /**
     * A zone at a glance, read like a sheet of facts: nothing on it looks tappable except the
     * close button and the one way in, the barrio. How much it needs and what is urgent go in
     * a line each; the kinds of help as a plain list with a level bar; then the point.
     */
    render(zone) {
        const theme = session.theme
        const collector = session.role === 'collector'
        const level = zoneLevel(zone, theme)
        const point = pointForZone(zone.id)
        const urgent = Object.values(SUPPLIES).filter((s) => session.isUrgent(zone.id, s.id))
        // three names are enough to read at a glance; the rest is a count
        const names = urgent.slice(0, 3).map((s) => esc(s.label))
        const urgentLine = urgent.length
            ? `${names.join(', ')}${urgent.length > 3 ? ` y ${urgent.length - 3} más` : ''}`
            : ''
        const word = { alta: 'Alta', media: 'Media', baja: 'Baja' }
        const needs = zoneNeeds(zone, theme)
            .map(
                ([cat, lvl]) => `
            <li class="zc-need">
                ${catIcon(cat)}
                <span class="zc-need-name">${CATEGORIES[cat].label}</span>
                <span class="zc-bars" data-level="${lvl}" aria-hidden="true"><i></i><i></i><i></i></span>
                <span class="zc-need-level" data-level="${lvl}">${word[lvl]}</span>
            </li>`
            )
            .join('')

        this.el.innerHTML = `
            <div class="zc-head">
                <span class="zc-mark" style="background:${zone.color}" aria-hidden="true">${icon('home')}</span>
                <div class="zc-title">
                    <h2 id="zone-title">${zone.name}</h2>
                    <p class="sub">${esc(theme.title)}</p>
                </div>
                <button class="icon-btn js-close" type="button" aria-label="Cerrar y volver al mapa">${icon('x')}</button>
            </div>
            <ul class="zc-facts">
                <li data-level="${level}"><i aria-hidden="true"></i>${esc(NEED_WORD[level])} en la zona</li>
                ${urgent.length ? `<li class="is-urgent"><i aria-hidden="true"></i><span><b>${urgent.length} ${urgent.length === 1 ? 'insumo urgente' : 'insumos urgentes'}:</b> ${urgentLine}</span></li>` : ''}
            </ul>
            <section class="zc-section" aria-labelledby="zc-needs-title">
                <h3 id="zc-needs-title">Lo que más se necesita</h3>
                <ul class="zc-needs">${needs}</ul>
            </section>
            <p class="zc-point">${icon('pin')}<span><b>${esc(point?.name ?? '')}</b>${collector ? ' · tu punto' : ''}<small>${esc(point?.address ?? '')} · Atiende ${esc(point?.hours ?? '')}</small></span></p>
            <button class="btn btn-primary btn-block btn-lg js-enter" type="button">
                <span class="zc-go"><small>${collector ? 'Revisar el barrio' : 'Ir al barrio'}</small>${esc(zone.barrio)}</span> ${icon('chevron-right')}
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
        panel.items.add(`tile:${itemId}`, stage, obj, { clipEl, owner: tileEl, getAlpha: () => (tileEl.offsetParent ? panel.state.alpha : 0) })
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


/** "3 cajas y 2 sueltas": how a volunteer counts a shelf. */
function boxesLabel(qty, per) {
    const boxes = Math.floor(qty / per)
    const loose = qty - boxes * per
    if (!boxes) return loose ? `${loose} ${loose === 1 ? 'suelta' : 'sueltas'}` : 'Vacío'
    return `${boxes} ${boxes === 1 ? 'caja' : 'cajas'}${loose ? ` + ${loose}` : ''}`
}

const refCode = () => newCode('NX')

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
    constructor(el, opts, { items, loader, onClose, onStep, onConfirm, onExitMap, onBasket, onTrack }) {
        super(el, opts)
        Object.assign(this, { items, loader, onClose, onStep, onConfirm, onExitMap, onBasket, onTrack })
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
            this.el.querySelector('.js-help')?.addEventListener('click', () => this.showHelp())
        }
        if (animate) this.morph(draw)
        else {
            draw()
            hydrateIcons(this.el)
        }
    }

    #head(title, sub, step = 0) {
        return `
            <div class="supply-head">
                <span class="wlabel-icon" style="background:#011E41">${icon(step ? 'basket' : 'check')}</span>
                <div class="dn-title">
                    ${step ? `<span class="dn-step">Paso ${step} de 4</span>` : ''}
                    <h2 id="supply-title">${title}</h2>
                    <p class="sub">${sub}</p>
                </div>
                <button class="icon-btn help-btn js-help" type="button" aria-label="Ayuda: cómo donar" title="Ayuda">${icon('help')}</button>
                <button class="icon-btn js-close" type="button" aria-label="Cerrar y volver al barrio" title="Cerrar">${icon('x')}</button>
            </div>`
    }

    /** How donating works, in four steps, where the person is when they wonder. */
    showHelp() {
        this.audio.play('tap')
        return this.dialog?.ask({
            icon: 'help',
            title: 'Cómo donar',
            body: helpList([
                'Arriba eliges el <b>tipo de ayuda</b>; abajo aparece lo que el barrio necesita de ese tipo.',
                'Suma con <b>+</b> lo que quieras dejar, o <b>toca el número y escribe la cantidad</b>. Con <b>+1 caja</b> (o <b>Caja</b> arriba, en el celular) sumas una caja completa.',
                'Lo marcado como <b>Urgente</b> es lo que más falta en este barrio.',
                'Toca <b>Continuar</b>: entregas los productos en el punto o aportas su valor. Puedes volver atrás en cualquier paso.',
            ]),
            actions: [{ label: 'Entendido', value: true, kind: 'primary' }],
        })
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
                            <span class="cat-icon" style="background:${c.tint};color:${c.color}">${icon(c.icon)}</span>
                            <span class="cat-label">${c.label}</span>
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
                // what it is (a tap on it adds one), how much the barrio needs, then the count
                return `
                <div class="dn-card ${q ? 'is-selected' : ''} ${urgent ? 'is-urgent' : ''}" data-item="${n.item}">
                    <button class="dn-add" type="button"
                        aria-label="${s.label}. Se necesitan ${n.qty}. Valor de referencia ${money(s.value)} cada uno. Agregar uno">
                        <span class="tile-stage dn-pic" aria-hidden="true"></span>
                        <span class="dn-name"><b>${s.label}</b><small>${money(s.value)} c/u · ${perBox(n.item)} por caja</small></span>
                    </button>
                    <p class="dn-need">${urgent ? `<span class="dn-urgent">${icon('urgent')} Urgente</span>` : ''}<span>${n.qty === 1 ? 'Se necesita' : 'Se necesitan'} <b>${n.qty}</b></span></p>
                    ${this.#stepper(n.item, q, n.qty)}
                    <div class="inv-boxbtns">
                        <button type="button" class="js-box-minus" aria-label="Quitar una caja de ${s.label}" ${q <= 0 ? 'disabled' : ''}>${icon('minus')} 1 caja</button>
                        <button type="button" class="js-box-plus" aria-label="Agregar una caja de ${s.label} (${perBox(n.item)} unidades)" ${q >= n.qty ? 'disabled' : ''}>${icon('plus')} 1 caja</button>
                    </div>
                </div>`
            })
            .join('')

        this.el.innerHTML = `
            ${this.#head('¿Qué quieres donar?', `${this.barrio.name} · Punto de acopio`, 1)}
            <div class="supply-body step-enter">
                <div class="cat-row">${this.#categoryStrip()}${stepToggle(this.byBox)}</div>
                <p class="cat-title">${CATEGORIES[group?.category]?.label ?? ''}<span>${tiles ? ` · ${group.items.length} ${group.items.length === 1 ? 'insumo' : 'insumos'}` : ''}</span></p>
                <div class="supply-grid" role="group" aria-label="Suministros que necesita el barrio">${tiles}</div>
                <section class="basket-inline" aria-label="Tu cesta de apoyo" hidden>
                    <p class="section-title">Tu cesta de apoyo</p>
                    <ul class="basket-list js-basket-list"></ul>
                    <div class="total-line"><span>Valor equivalente</span><b class="js-total"></b></div>
                    <p class="hint js-pack-hint">${icon('box')} <span class="js-pack-text"></span></p>
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
        this.el.querySelectorAll('.dn-card').forEach((tile) => {
            const id = tile.dataset.item
            const max = this.#max(id)
            tile3D(this, tile, id, body)
            tile.querySelector('.dn-add').addEventListener('click', () => {
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
                this.el.querySelector('.dn-card .dn-add')?.focus()
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
                <input class="qty-input js-qty" type="number" inputmode="numeric" min="0" max="${max}" step="1" value="${q}"
                    aria-label="Cantidad de ${label}, hasta ${max}" title="Toca para escribir la cantidad">
                <button type="button" class="js-plus" aria-label="Agregar uno" ${q >= max ? 'disabled' : ''}>${icon('plus')}</button>
            </div>`
    }

    #bindStepper(scope, id, max) {
        // on a phone the same buttons move a whole box when the switch says so
        const step = () => (this.byBox && isNarrow() && scope.classList.contains('dn-card') ? perBox(id) : 1)
        scope.querySelector('.js-minus')?.addEventListener('click', () => this.#setQty(id, (this.basket.get(id) ?? 0) - step(), max))
        scope.querySelector('.js-plus')?.addEventListener('click', () => this.#setQty(id, (this.basket.get(id) ?? 0) + step(), max))
        // whoever already knows how many can type it; more than the barrio needs is capped
        const input = scope.querySelector('.js-qty')
        if (!input) return
        input.addEventListener('focus', () => input.select())
        input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur())
        input.addEventListener('change', () => {
            const n = Math.round(Number(input.value))
            const q = this.basket.get(id) ?? 0
            if (input.value === '' || !Number.isFinite(n)) return (input.value = q)
            this.#setQty(id, n, max)
            // capped (or unchanged): the field shows what is really in the basket
            input.value = this.basket.get(id) ?? 0
        })
    }

    #setQty(id, q, max) {
        q = Math.max(0, Math.min(max, q))
        const before = this.basket.get(id) ?? 0
        if (q !== before) this.audio.play(q > before ? 'add' : 'remove')
        if (q) this.basket.set(id, q)
        else this.basket.delete(id)
        this.el.querySelectorAll(`[data-item="${id}"]`).forEach((scope) => {
            scope.classList.toggle('is-selected', q > 0)
            const out = scope.querySelector('.js-qty')
            if (out && document.activeElement !== out) out.value = q
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
        const pack = this.el.querySelector('.js-pack-text')
        if (pack) pack.textContent = t.kinds ? `Por tamaño y peso, lo que llevas ${this.#boxWord(t)} (${BOX.label}).` : ''
        const next = this.step === 'supplies' && this.el.querySelector('.js-next')
        if (next) next.setAttribute('aria-disabled', String(!this.basket.size))
    }

    /* ---------- 2 · method ---------- */
    #method() {
        const t = this.#totals()
        this.el.innerHTML = `
            ${this.#head('¿Cómo quieres aportar?', `Tu cesta: ${t.units} ${t.units === 1 ? 'unidad' : 'unidades'} · ${money(t.value)} · ${this.#boxWord(t)}`, 2)}
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
        const windows = deliveryWindows(this.point)
        if (!windows.some((w) => w.id === d.window)) d.window = ''
        this.el.innerHTML = `
            ${this.#head('Tus datos para la entrega', 'Solo lo necesario para coordinar.', 3)}
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
                    <legend class="field-label">¿Cuándo puedes llevarlo? <span class="optional">El punto atiende ${esc(this.point.hours)}</span></legend>
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
        const w = findWindow(this.point, this.details.window)
        this.code = this.code ?? refCode()
        this.el.innerHTML = `
            ${this.#head('Resumen del aporte', 'Revisa los datos y confirma.', 4)}
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
            ${this.#head('Aporte en dinero', `${this.barrio.name} · Punto de acopio`, 3)}
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
        const w = findWindow(this.point, this.details.window)
        const record = {
            code: this.code,
            mode: this.mode,
            point: this.point.id,
            barrio: this.barrio.id,
            items: Object.fromEntries(this.basket),
            value: this.#totals().value,
            window: this.details.window,
            // when it will be brought, written out: the window's id only means something today
            slot: this.mode === 'physical' && w ? `${w.label}: ${w.detail}` : '',
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
        const w = findWindow(this.point, r.window)
        this.el.innerHTML = `
            ${this.#head(physical ? 'Entrega programada' : 'Aporte recibido', `${this.barrio.name} · Punto de acopio`)}
            <div class="supply-body step-enter">
                <div class="done">
                    <span class="done-mark">${icon('check')}</span>
                    <h3>Gracias por tu apoyo</h3>
                    <p>${physical ? `Te esperamos en <b>${esc(this.point.name)}</b>, ${esc((w?.detail ?? '').replace(/\.$/, ''))}.` : 'Con tu aporte, el equipo comprará y dejará estos suministros en el punto de acopio.'}</p>
                    <p class="done-note">${physical ? 'Así recogerán tu aporte las familias cuando lo lleves al punto.' : 'Las familias ya salieron a recogerlos.'}</p>
                    ${session.stock?.status === 'error'
                        ? `<p class="done-offline">${icon('info')} Sin conexión en este momento: tu aporte quedó guardado en este dispositivo y se suma al inventario apenas vuelva la conexión.</p>`
                        : ''}
                    <p class="done-code">${physical ? 'Código de entrega' : 'Referencia'}<b>${r.code}</b></p>
                    ${physical ? `<div class="done-qr"><div class="qr-img js-qr" role="img" aria-label="Código QR del aporte ${r.code}"></div><span>Muestra este QR en el punto: al escanearlo, tu aporte queda recibido. También lo encuentras en «Sigue tu aporte».</span></div>` : ''}
                    <p class="done-small">Valor equivalente: ${money(r.totals.value)}${physical ? '' : ' · Pago de demostración'}</p>
                    <button class="btn btn-secondary js-track" type="button">${icon('search')} Seguir mi aporte</button>
                </div>
            </div>
            <div class="supply-foot">
                <button class="btn btn-secondary js-map" type="button">${icon('map')} Volver al mapa</button>
                <span class="foot-spacer"></span>
                <button class="btn btn-primary js-primary js-done" type="button">Seguir en el barrio</button>
            </div>`
        this.code = null
        if (physical) qrSvg(trackUrl(r.code)).then((svg) => {
            const box = this.el.querySelector('.js-qr')
            if (box) box.innerHTML = svg
        })
        this.el.querySelector('.js-track').addEventListener('click', () => this.onTrack?.(r.code))
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
        // every visit starts on the three options
        this.tab = null
        this.filter = 'all'
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
        this.toast?.hide()
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

    /**
     * One supply: what it is and its state at the top, the count large (it can be typed over),
     * the bar against the cap, then one unit at a time and, below, a whole box at a time.
     */
    #card(s) {
        const qty = this.store.get(s.id)
        const cap = stockCap(s.id)
        const st = stockState(s.id, qty)
        const per = perBox(s.id)
        return `
        <div class="inv-card is-${st.id}" data-item="${s.id}">
            <div class="inv-head">
                <span class="tile-stage inv-pic" aria-hidden="true"></span>
                <span class="inv-name"><b>${esc(s.label)}</b><small>${per} por caja</small></span>
            </div>
            <div class="inv-main">
                <div class="inv-count">
                    <label class="inv-qty"><input class="js-qty" type="number" inputmode="numeric" min="0" max="${cap}" step="1" value="${qty}"
                        aria-label="Cantidad de ${esc(s.label)}, de ${cap}" title="Toca para escribir la cantidad"></label>
                    <span class="inv-sub">de ${cap} · <span class="js-boxes">${boxesLabel(qty, per)}</span></span>
                </div>
                <div class="inv-pm" role="group" aria-label="Unidades de ${esc(s.label)}">
                    <button type="button" class="js-minus" aria-label="Quitar una unidad de ${esc(s.label)}" ${qty <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
                    <button type="button" class="js-plus" aria-label="Agregar una unidad de ${esc(s.label)}" ${qty >= cap ? 'disabled' : ''}>${icon('plus')}</button>
                </div>
            </div>
            <div class="inv-status">
                <span class="inv-state" data-state="${st.id}">${st.label}</span>
                <span class="inv-meter" role="img" aria-label="${qty} de ${cap} ${esc(s.units)}. ${st.label}."><span class="inv-fill" style="width:${Math.round(stockRatio(s.id, qty) * 100)}%"></span></span>
            </div>
            <div class="inv-boxbtns">
                <button type="button" class="js-box-minus" aria-label="Quitar una caja (${per}) de ${esc(s.label)}" ${qty <= 0 ? 'disabled' : ''}>${icon('minus')} 1 caja</button>
                <button type="button" class="js-box-plus" aria-label="Agregar una caja (${per}) de ${esc(s.label)}" ${qty >= cap ? 'disabled' : ''}>${icon('plus')} 1 caja</button>
            </div>
        </div>`
    }

    render() {
        this.items.removeWhere('tile:')
        const zone = ZONES.find((z) => z.id === this.point.zone)
        this.el.dataset.step = 'inventario'
        this.el.innerHTML = `
            <div class="supply-head board-head">
                <button class="icon-btn point-back js-back" type="button" aria-label="Volver a las opciones del punto" title="Volver" hidden>${icon('chevron-left')}</button>
                <span class="wlabel-icon js-head-mark" style="background:${zone?.color ?? '#011E41'}">${icon('box')}</span>
                <div class="board-title">
                    <h2 id="supply-title" tabindex="-1">Punto de acopio</h2>
                    <p class="sub">${esc(this.point.name)} · ${esc(zone?.name ?? '')}</p>
                </div>
                ${stepToggle(this.byBox)}
                <button class="icon-btn help-btn js-help" type="button" aria-label="Ayuda" title="Ayuda">${icon('help')}</button>
                <button class="icon-btn js-close" type="button" aria-label="Cerrar el punto de acopio" title="Cerrar">${icon('x')}</button>
            </div>
            <div class="supply-body step-enter">
                <section class="board-view" id="view-home">${pointMenu()}</section>
                <section class="board-view" id="view-stock" aria-labelledby="supply-title" hidden>
                    <div class="inv-tools">
                        ${inventoryFilter(this.filter)}
                        <p class="inv-hint">Toca <b>−</b> y <b>+</b> o escribe el número. Se guarda solo.</p>
                    </div>
                    <div class="inv-grid" role="group" aria-label="Inventario del punto de acopio">
                        ${this.supplies.map((s) => this.#card(s)).join('')}
                    </div>
                    <p class="rcv-empty js-filter-empty" hidden>${icon('check')}<span>Ningún insumo en ese estado.</span></p>
                </section>
                <section class="board-view" id="view-receive" aria-labelledby="supply-title" hidden>
                    <p class="rcv-intro">¿Llegó un donante o un traslado? Recíbelo aquí: lo que llega se suma solo al inventario.</p>
                    ${receiveWays('receive-code')}
                    <div class="rcv-lists js-pending-lists"></div>
                </section>
                <section class="board-view" id="view-send" aria-labelledby="supply-title" hidden>
                    <div class="receive-card">
                        <h3>Enviar insumos a otro punto</h3>
                        <p>Elige el punto y qué le mandas. Te sugerimos cuánto según lo que te sobra y lo que le falta; lo revisas antes de confirmar.</p>
                        <button class="btn btn-primary receive-scan js-transfer" type="button">${icon('truck')} Nuevo envío</button>
                    </div>
                    <div class="rcv-lists js-sent-lists"></div>
                </section>
            </div>
            <div class="board-foot">
                <p class="sync-chip js-sync" role="status" aria-live="polite"></p>
                <p class="summary js-summary" aria-live="polite"></p>
            </div>`
        hydrateIcons(this.el)
        const body = this.el.querySelector('.supply-body')
        this.el.querySelectorAll('.inv-card').forEach((card) => {
            const id = card.dataset.item
            tile3D(this, card, id, body)
            const per = perBox(id)
            card.querySelector('.js-minus').addEventListener('click', () => this.#bump(id, -1))
            card.querySelector('.js-plus').addEventListener('click', () => this.#bump(id, 1))
            card.querySelector('.js-box-minus').addEventListener('click', () => this.#bump(id, -per))
            card.querySelector('.js-box-plus').addEventListener('click', () => this.#bump(id, per))
            // a faster way for whoever already knows the count: type it
            const input = card.querySelector('.js-qty')
            input.addEventListener('focus', () => input.select())
            input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur())
            input.addEventListener('change', () => {
                const n = Math.round(Number(input.value))
                if (input.value === '' || !Number.isFinite(n)) return this.#sync()
                this.#setTo(id, n)
            })
        })
        this.el.querySelectorAll('.js-filter').forEach((b) =>
            b.addEventListener('click', () => {
                this.audio.play('tap')
                this.filter = applyFilter(this.el, this.store, b.dataset.filter, '.inv-card')
            })
        )
        this.el.querySelector('.js-help').addEventListener('click', () => this.#help())
        this.el.querySelector('.js-close').addEventListener('click', () => this.onClose())
        this.queueKey = null
        this.el.querySelectorAll('.js-option').forEach((b) => b.addEventListener('click', () => this.#showTab(b.dataset.tab, { focus: true })))
        this.el.querySelector('.js-back').addEventListener('click', () => this.#showTab('home', { focus: true }))
        this.#showTab(this.tab ?? 'home', { quiet: true })
        const form = this.el.querySelector('.js-receive-form')
        form.addEventListener('submit', (e) => {
            e.preventDefault()
            this.#receive(form.querySelector('input').value, { button: form.querySelector('[type="submit"]') })
        })
        this.el.querySelector('.js-scan').addEventListener('click', () => this.#scan())
        this.el.querySelector('.js-transfer').addEventListener('click', () => this.#transferSheet())
        this.el.querySelector('.js-pending-lists').addEventListener('click', (e) => {
            const b = e.target.closest('[data-action]')
            if (!b) return
            if (b.dataset.action === 'deliver') this.#deliver(b.dataset.code, b)
            else this.#receive(b.dataset.code, { confirm: true, button: b })
        })
        bindStepToggle(this.el, (byBox) => {
            this.byBox = byBox
            this.audio.play('tap')
        })
        this.#sync()
    }

    #bump(id, delta) {
        // phones have one pair of buttons; the switch makes them count boxes
        if (this.byBox && isNarrow() && Math.abs(delta) === 1) delta *= perBox(id)
        this.#setTo(id, this.store.get(id) + delta)
    }

    /**
     * Every change says what it did and can be taken back for a few seconds. Taps in a row on
     * the same supply count as one change, so "Deshacer" returns to where the count started.
     */
    #setTo(id, qty) {
        if (!this.store.ready) return this.audio.play('error')
        const before = this.store.get(id)
        const after = this.store.set(id, qty)
        if (after === before) {
            this.audio.play('error')
            return this.#sync()
        }
        this.audio.play(after > before ? 'add' : 'remove')
        const from = this.undo?.id === id && this.toast?.visible ? this.undo.from : before
        this.undo = { id, from }
        const s = SUPPLIES[id]
        this.toast?.show(`<b>${esc(s.label)}</b>: ${from} → ${after} ${esc(s.units)}`, {
            action: from !== after ? 'Deshacer' : null,
            onAction: () => {
                this.store.set(id, from)
                this.undo = null
                this.audio.play('remove')
                this.toast.show(`<b>${esc(s.label)}</b> volvió a ${from}.`, { duration: 2500 })
            },
        })
    }

    #help() {
        this.audio.play('tap')
        this.dialog?.ask({
            icon: 'help',
            title: { home: 'Qué puedes hacer en el punto', receive: 'Cómo recibir y entregar', send: 'Cómo enviar a otro punto' }[this.tab] ?? 'Cómo usar el inventario',
            body:
                this.tab === 'home'
                    ? helpList([
                          '<b>Gestionar inventario</b>: cuenta lo que hay en el punto. Lo que quede en rojo es lo primero que ven los donantes.',
                          '<b>Recibir donaciones</b>: escanea el QR del donante o escribe su código, recibe los traslados de otros puntos y marca lo que ya se entregó a las familias.',
                          '<b>Enviar a otros puntos</b>: manda lo que te sobra a un punto al que le falta.',
                          'Con la flecha de arriba a la izquierda vuelves a estas tres opciones.',
                      ])
                    : this.tab === 'send'
                    ? helpList([
                          'Toca <b>Nuevo envío</b>. Te proponemos el punto que más lo necesita; puedes elegir otro.',
                          'Te sugerimos cuánto mandar de cada insumo según lo que te sobra y lo que le falta. Cambia los números si quieres.',
                          'Revisa el resumen y toca <b>Confirmar envío</b>: sale de tu inventario y entra en el del otro punto cuando lo reciba.',
                          'Abajo ves los traslados en camino. Si te equivocas, toca <b>Deshacer</b> en el aviso.',
                      ])
                    : this.tab === 'receive'
                    ? helpList([
                          'Cuando llegue un donante, toca <b>Escanear QR</b> y apunta a su código: el aporte queda recibido y se suma solo al inventario.',
                          'Si no trae el QR, escribe su código (empieza por <b>NX-</b>) y toca <b>Recibir</b>. Los traslados de otros puntos empiezan por <b>TR-</b>.',
                          'En <b>Por recibir</b> están los aportes agendados y los traslados en camino. Al tocar <b>Recibir</b> te pedimos confirmar qué llegó.',
                          'Cuando las familias recojan un aporte, tócalo en <b>Por entregar a las familias</b> y elige <b>Entregado</b>.',
                          'Si te equivocas, toca <b>Deshacer</b> en el aviso de abajo: el inventario vuelve a como estaba.',
                      ])
                    : helpList([
                          'Cada tarjeta es un insumo. Usa <b>−</b> y <b>+</b> para contar unidades; con <b>1 caja</b> (o <b>Caja</b> arriba, en el celular) cuentas cajas completas.',
                          'Arriba, toca <b>Críticos</b>, <b>Estables</b> o <b>Abastecidos</b> para ver solo esos insumos.',
                          'Si ya sabes el número, <b>toca la cantidad y escríbela</b>.',
                          'Colores: <b class="t-critico">rojo</b> es crítico (menos del 30 %), <b class="t-estable">amarillo</b> estable y <b class="t-abastecido">verde</b> abastecido.',
                          'Para recibir donaciones o enviar a otro punto, vuelve a las opciones con la flecha de arriba.',
                          'Todo se guarda solo en la hoja de Google; abajo ves si ya quedó guardado. Si te equivocas, toca <b>Deshacer</b> en el aviso.',
                      ]),
            actions: [{ label: 'Entendido', value: true, kind: 'primary' }],
        })
    }

    /**
     * Whether the count is safe, always in view: loading, saving, saved (and when),
     * or offline with the changes kept here and a way to try again now. A single failed
     * call is retried quietly; it only shows as offline after the second.
     */
    #syncChip() {
        const chip = this.el.querySelector('.js-sync')
        if (!chip) return
        const st = this.store
        const time = st.lastSync ? new Date(st.lastSync).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : ''
        let state, html
        if (st.status !== 'sync') this.retrying = false
        if (!st.ready) [state, html] = ['loading', '<span class="sync-spin"></span>Cargando inventario…']
        else if (this.retrying) [state, html] = ['saving', '<span class="sync-spin"></span>Reintentando…']
        else if (st.status === 'local') [state, html] = ['saved', `${icon('check')}Guardado en este dispositivo`]
        // while offline the store keeps retrying; a retry in flight must not flash "Guardando…"
        else if (st.failures >= 2)
            [state, html] = ['error', `${icon('alert')}Sin conexión${st.unsaved ? ` · ${st.unsaved} sin enviar` : ''}<button type="button" class="link-btn js-retry">Reintentar</button>`]
        else if (st.unsaved || st.status === 'sync') [state, html] = ['saving', '<span class="sync-spin"></span>Guardando…']
        else [state, html] = ['saved', `${icon('check')}Guardado${time ? ` · ${time}` : ''}`]
        if (chip.dataset.state === state && chip.dataset.time === time) return
        chip.dataset.state = state
        chip.dataset.time = time
        chip.innerHTML = html
        chip.title = st.status === 'error' ? st.sourceLine() : ''
        hydrateIcons(chip)
        chip.querySelector('.js-retry')?.addEventListener('click', () => {
            this.audio.play('tap')
            this.retrying = true
            st.retry()
        })
    }

    /** Redraw the numbers in place — the sheet may also have moved them. */
    #sync() {
        if (!this.el.isConnected || !this.point) return
        for (const card of this.el.querySelectorAll('.inv-card')) {
            const id = card.dataset.item
            const qty = this.store.get(id)
            const cap = stockCap(id)
            const st = stockState(id, qty)
            card.className = `inv-card is-${st.id}`
            const input = card.querySelector('.js-qty')
            // never type over what the person is writing
            if (document.activeElement !== input) input.value = qty
            input.disabled = !this.store.ready
            card.querySelector('.js-boxes').textContent = boxesLabel(qty, perBox(id))
            card.querySelector('.inv-fill').style.width = `${Math.round(stockRatio(id, qty) * 100)}%`
            const chip = card.querySelector('.inv-state')
            chip.textContent = st.label
            chip.dataset.state = st.id
            card.querySelector('.inv-meter').setAttribute('aria-label', `${qty} de ${cap} ${SUPPLIES[id].units}. ${st.label}.`)
            // until the sheet has answered once, the numbers are only this device's guess: no edits
            for (const b of card.querySelectorAll('.js-minus, .js-box-minus')) b.disabled = !this.store.ready || qty <= 0
            for (const b of card.querySelectorAll('.js-plus, .js-box-plus')) b.disabled = !this.store.ready || qty >= cap
            this.items.setSelected(`tile:${id}`, st.id === 'critico')
        }
        updateFilterCounts(this.el, this.store, Object.keys(SUPPLIES))
        const short = this.store.shortages()
        const sum = this.el.querySelector('.js-summary')
        if (sum) {
            sum.classList.toggle('is-critical', short.length > 0)
            sum.innerHTML = short.length
                ? `<b>${short.length} ${short.length === 1 ? 'insumo crítico' : 'insumos críticos'}:</b> ${short.map((id) => esc(SUPPLIES[id].label)).join(', ')}`
                : '<b>Sin faltantes críticos</b>'
        }
        this.#syncChip()
        this.#pending()
        this.onShortages?.(short)
    }

    /**
     * One job at a time: the three options first (home), then counting the stock, taking in
     * what arrives (donations and transfers, and handing them out to the families), or
     * sending to another point. The arrow in the header goes back to the options.
     */
    #showTab(tab, { quiet = false, focus = false } = {}) {
        const from = this.tab
        this.tab = tab
        // the panel is as wide as the view needs: the options and the forms narrow, the stock wide
        this.el.dataset.view = tab
        if (!quiet) this.audio.play('tap')
        for (const v of ['home', 'stock', 'receive', 'send']) this.el.querySelector(`#view-${v}`).hidden = tab !== v
        const home = tab === 'home'
        this.el.querySelector('.js-back').hidden = home
        this.el.querySelector('.js-head-mark').hidden = !home
        // units or boxes only matters while counting
        const toggle = this.el.querySelector('.step-toggle')
        if (toggle) toggle.hidden = tab !== 'stock'
        const title = this.el.querySelector('#supply-title')
        const [short, more] = POINT_TITLES[tab]
        if (title) title.innerHTML = `${short}${more ? `<span class="board-title-more">${more}</span>` : ''}`
        const body = this.el.querySelector('.supply-body')
        body.scrollTop = 0
        // the view slides in again, so the change of screen reads as one
        body.classList.remove('step-enter')
        void body.offsetWidth
        body.classList.add('step-enter')
        if (!focus) return
        // keyboard and screen readers land on the new view, and back on the option they came from
        if (home) this.el.querySelector(`.js-option[data-tab="${from}"]`)?.focus()
        else title?.focus()
    }

    /* ---------------- donations and transfers waiting for this point ---------------- */

    /** The lists, redrawn only when they change (the form above them is left alone). */
    #pending() {
        const q = this.store.queue ?? {}
        const key = JSON.stringify(q)
        if (key === this.queueKey) return
        this.queueKey = key
        const toReceive = [...(q.scheduled ?? []), ...(q.incoming ?? [])]
        const toDeliver = q.toDeliver ?? []
        // the Recibir option says how much waits there, so it is seen from the start
        const badge = this.el.querySelector('.js-receive-badge')
        const waiting = toReceive.length + toDeliver.length
        if (badge) {
            badge.hidden = !waiting
            badge.textContent = waiting
            badge.setAttribute('aria-label', [toReceive.length && `${toReceive.length} por recibir`, toDeliver.length && `${toDeliver.length} por entregar`].filter(Boolean).join(', '))
        }
        const lists = this.el.querySelector('.js-pending-lists')
        if (!lists) return
        lists.innerHTML = receiveLists(q)
        hydrateIcons(lists)
        const sent = this.el.querySelector('.js-sent-lists')
        sent.innerHTML = sentList(q)
        hydrateIcons(sent)
    }

    /** A donation or a transfer arrived (typed, tapped or scanned): into the stock it goes. */
    /**
     * A donation or a transfer arrived (typed, tapped or scanned): into the stock it goes.
     * Tapped on the list, it first asks whether that is really what arrived (a scan is proof
     * enough). While the sheet answers the button says so; afterwards it can be undone.
     */
    async #receive(text, { confirm = false, button = null } = {}) {
        const err = this.el.querySelector('.js-receive-error')
        const input = this.el.querySelector('.js-receive-form input')
        const code = readCode(text)
        if (err) err.hidden = true
        if (!code) {
            this.audio.play('error')
            if (err) {
                err.textContent = 'Escribe el código del aporte (NX-…) o del traslado (TR-…).'
                err.hidden = false
            }
            input?.focus()
            return
        }
        if (confirm) {
            const q = this.store.queue ?? {}
            const it = [...(q.scheduled ?? []), ...(q.incoming ?? [])].find((x) => x.code === code)
            const yes = await this.dialog?.ask({
                icon: 'box',
                title: '¿Llegó esto al punto?',
                body: `<p><b>${esc(code)}</b>${it?.from ? ` · traslado desde ${esc(COLLECTION_POINTS.find((p) => p.id === it.from)?.name ?? '')}` : ''}</p>
                       <ul class="dialog-items">${Object.entries(it?.items ?? {})
                           .filter(([id]) => SUPPLIES[id])
                           .map(([id, n]) => `<li><b>${n}</b> × ${esc(SUPPLIES[id].label)}</li>`)
                           .join('')}</ul>
                       <p>Revisa que esté completo: al confirmar se suma al inventario.</p>`,
                actions: [
                    { label: 'Todavía no', value: false },
                    { label: 'Sí, recibir', value: true, kind: 'primary' },
                ],
            })
            if (!yes) return
        }
        const busy = busyButton(button, 'Recibiendo…')
        const out = code.startsWith('TR-') ? await ledger.transferReceive(code, this.point.id) : await ledger.receive(code, this.point.id)
        busy()
        if (!out.ok) {
            this.audio.play('error')
            if (err) {
                err.textContent = out.error
                err.hidden = false
            }
            return
        }
        if (input) input.value = ''
        const what = out.record ?? out.transfer
        const list = Object.entries(what.items ?? {})
            .filter(([id]) => SUPPLIES[id])
            .map(([id, n]) => `${n} × ${esc(SUPPLIES[id].label)}`)
            .join(', ')
        if (out.already) {
            this.audio.play('tap')
            this.toast?.show(`<b>${code}</b> ya se había recibido. No se sumó otra vez.`, { duration: 4000 })
        } else {
            this.audio.play('confirm')
            this.toast?.show(`<b>${code}</b> recibido: ${list} se sumaron al inventario.`, {
                duration: 7000,
                action: 'Deshacer',
                onAction: async () => {
                    const back = code.startsWith('TR-') ? await ledger.transferUnreceive(code, this.point.id) : await ledger.unreceive(code, this.point.id)
                    if (!back.ok) return this.toast.show(esc(back.error), { duration: 4500 })
                    this.audio.play('remove')
                    this.toast.show(`Se deshizo: <b>${code}</b> volvió a Por recibir y salió del inventario.`, { duration: 3500 })
                    if (back.rows) this.store.take(back.rows)
                },
            })
        }
        if (out.rows) this.store.take(out.rows)
    }

    async #deliver(code, button = null) {
        const busy = busyButton(button, 'Guardando…')
        const out = await ledger.deliver(code, this.point.id)
        busy()
        if (!out.ok) {
            this.audio.play('error')
            this.toast?.show(esc(out.error), { duration: 4000 })
            return
        }
        this.audio.play('confirm')
        this.toast?.show(`<b>${esc(code)}</b> entregado a las familias.`, {
            duration: 7000,
            action: 'Deshacer',
            onAction: async () => {
                const back = await ledger.undeliver(code, this.point.id)
                if (!back.ok) return this.toast.show(esc(back.error), { duration: 4500 })
                this.audio.play('remove')
                this.toast.show(`Se deshizo: <b>${esc(code)}</b> volvió a Por entregar.`, { duration: 3500 })
                this.store.take([])
            },
        })
        this.store.take([])
    }

    /** Send supplies to another point (see transferSheet.js). */
    #transferSheet() {
        transferSheet({
            host: this.el,
            point: this.point,
            store: this.store,
            board: session.stock,
            toast: this.toast,
            audio: this.audio,
            onClose: () => this.el.querySelector('.js-transfer')?.focus(),
        })
    }

    /** The camera reads a donation's QR; whatever it finds is received like a typed code. */
    async #scan() {
        this.audio.play('tap')
        const sheet = document.createElement('div')
        sheet.className = 'scan-sheet'
        sheet.setAttribute('role', 'dialog')
        sheet.setAttribute('aria-label', 'Escanear el código QR de un aporte')
        sheet.innerHTML = `
            <div class="scan-box">
                <video class="scan-video" playsinline muted></video>
                <span class="scan-frame" aria-hidden="true"></span>
            </div>
            <p class="scan-hint">Apunta la cámara al código QR del aporte.</p>
            <button class="btn btn-secondary js-scan-cancel" type="button">Cancelar</button>`
        this.el.appendChild(sheet)
        const scan = scanQr(sheet.querySelector('video'))
        const close = () => {
            scan.stop()
            sheet.remove()
            this.el.querySelector('.js-scan')?.focus()
        }
        sheet.querySelector('.js-scan-cancel').addEventListener('click', close)
        sheet.querySelector('.js-scan-cancel').focus()
        sheet.addEventListener('keydown', (e) => e.key === 'Escape' && close())
        let text = null
        try {
            text = await scan.result
        } catch {
            close()
            this.audio.play('error')
            this.toast?.show('No pudimos usar la cámara. Escribe el código del aporte en el campo de arriba.', { duration: 5000 })
            return
        }
        close()
        if (text) this.#receive(text)
    }
}

export { isNarrow }
