import { icon, hydrateIcons } from '../ui/icons.js'
import { Toast, Dialog, helpList, busyButton } from '../ui/feedback.js'
import { TrackView } from '../ui/track.js'
import { qrSvg, scanQr } from '../ui/qr.js'
import { CATEGORIES, SUPPLIES, money, perBox } from '../data/catalog.js'
import { stockCap, stockState } from '../data/inventory.js'
import { ZONES, NEED_WORD, zoneNeeds, zoneLevel, useStock } from '../data/zones.js'
import { COLLECTION_POINTS, pointForZone, validateCredentials, directionsUrl } from '../data/collectionPoints.js'
import { deliveryWindows } from '../data/delivery.js'
import { session } from '../app/session.js'
import { StockBoard } from '../app/stockBoard.js'
import { InventoryStore } from '../app/inventoryStore.js'
import { ledger, localQueue, newCode, trackUrl, readCode } from '../app/donations.js'
import { setLite, liteSuggested } from './detect.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
/** The zone this device donated to last, to mark it in the list. */
const lastZone = () => {
    try {
        return localStorage.getItem('nexos.lite.zone')
    } catch {
        return null
    }
}
const zoneOfPoint = (id) => ZONES.find((z) => z.id === COLLECTION_POINTS.find((p) => p.id === id)?.zone)
const itemsLine = (items) =>
    Object.entries(items ?? {})
        .filter(([id]) => SUPPLIES[id])
        .map(([id, n]) => `${n} × ${SUPPLIES[id].label}`)
        .join(', ')
const LIVE_TEXT = {
    aporte: (e) => `Nuevo aporte agendado · ${zoneOfPoint(e.point)?.name ?? ''}`,
    recibido: (e) => `Llegó un aporte al punto · ${zoneOfPoint(e.point)?.name ?? ''}`,
    entregado: (e) => `Las familias recogieron un aporte · ${zoneOfPoint(e.point)?.name ?? ''}`,
    traslado: (e) => `Traslado en camino · ${zoneOfPoint(e.point)?.name ?? ''} → ${zoneOfPoint(e.to)?.name ?? ''}`,
    'traslado-recibido': (e) => `Traslado recibido · ${zoneOfPoint(e.point)?.name ?? ''}`,
}

/**
 * NEXOS, light version: the whole service as plain lists, without the 3D map.
 *
 * For phones that would struggle with the map, slow connections and data saving. It never
 * downloads the 3D engine or its models. Everything else is the same app underneath: the same
 * sheet, the same donations and transfers, the same tracking and QR codes, so a donation made
 * here is received at a point using the full version, and the other way round.
 *
 *   Donor:  zones and what each point lacks → a basket → in person (with a date) or in money →
 *           a code and a QR to follow it.
 *   Point:  its stock, what waits to be received or handed out (by code, tap or camera),
 *           and transfers to other points.
 */
export class LiteApp {
    constructor() {
        this.theme = session.theme
        this.root = document.createElement('main')
        this.root.className = 'lite'
        document.body.appendChild(this.root)
        // the overlays this version shares with the full one (the full version's own copies sit
        // inside its hidden interface, so these are made here and used directly)
        const track = document.createElement('section')
        track.className = 'track'
        track.hidden = true
        track.setAttribute('aria-labelledby', 'track-title')
        track.innerHTML = '<div class="track-card" role="dialog" aria-modal="true" aria-labelledby="track-title"></div>'
        const toast = document.createElement('div')
        toast.className = 'toast glass lite-toast'
        toast.hidden = true
        toast.setAttribute('role', 'status')
        toast.setAttribute('aria-live', 'polite')
        const dialog = document.createElement('div')
        dialog.className = 'dialog-backdrop'
        dialog.hidden = true
        dialog.innerHTML = '<div class="dialog glass" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title"></div>'
        document.body.append(track, toast, dialog)
        this.track = new TrackView(track, {})
        this.toast = new Toast(toast, {})
        this.dialog = new Dialog(dialog, {})

        this.board = new StockBoard()
        useStock(this.board)
        session.stock = this.board
        this.board.on(() => {
            ledger.flush()
            if (this.screen === 'zones') this.#zonesList()
        })
        this.board.start()
        ledger.flush()
        this.feed = []
        ledger.on((e) => this.board.event({ ...e, id: `${e.kind}:${e.code}`, at: new Date().toISOString() }))
        this.board.onEvent((e) => this.#live(e))

        this.basket = new Map()
        this.details = { name: '', phone: '', window: '' }
        this.go('home')
        const code = new URLSearchParams(location.search).get('aporte')
        if (code) this.track.show(code)
    }

    get state() {
        return this.screen
    }

    go(screen, opts = {}) {
        this.screen = screen
        const view = {
            home: () => this.#home(),
            zones: () => this.#zones(),
            basket: () => this.#basket(),
            method: () => this.#method(),
            details: () => this.#details(),
            summary: () => this.#summary(),
            done: () => this.#done(),
            login: () => this.#login(),
            point: () => this.#point(),
        }[screen]
        this.root.innerHTML = `${this.#header()}<div class="lite-body">${view()}</div>`
        hydrateIcons(this.root)
        this.#bindHeader()
        this[`bind_${screen}`]?.()
        if (!opts.keepScroll) window.scrollTo(0, 0)
        this.root.querySelector('[data-autofocus]')?.focus({ preventScroll: true })
    }

    #header() {
        return `
            <header class="lite-top">
                <button class="lite-brand js-home" type="button" aria-label="NEXOS, inicio">NE<span class="brand-x">X</span>OS</button>
                <span class="lite-tag">Versión ligera</span>
                <button class="lite-link js-track-open" type="button">${icon('search')}<span>Sigue tu aporte</span></button>
                <button class="lite-link js-help" type="button" aria-label="Ayuda" title="Ayuda">${icon('help')}<span>Ayuda</span></button>
                <button class="lite-link js-full" type="button" title="Abrir el mapa en 3D">${icon('map')}<span>Ver en 3D</span></button>
            </header>`
    }

    #bindHeader() {
        this.root.querySelector('.js-home').addEventListener('click', () => this.go(this.point ? 'point' : 'home'))
        this.root.querySelector('.js-track-open').addEventListener('click', () => this.track.show())
        this.root.querySelector('.js-full').addEventListener('click', () => setLite(false))
        this.root.querySelector('.js-help').addEventListener('click', () => this.#help())
    }

    /** Help about what is on screen: donating, or the point's two tabs. */
    #help() {
        const point = this.screen === 'point'
        const receive = point && this.pointTab === 'receive'
        const steps = !point
            ? [
                  'Elige una <b>zona</b>: primero aparecen las que más lo necesitan, con lo que les falta.',
                  'Arma tu <b>cesta</b> con − y +. Solo puedes aportar lo que al punto le falta.',
                  'Elige si lo <b>llevas al punto</b> (eliges cuándo) o si aportas <b>en dinero</b> (demostración).',
                  'Revisa el <b>resumen</b> y confirma. Recibes un código y, si lo llevas, un QR para mostrar en el punto.',
                  'Con <b>Sigue tu aporte</b> ves en qué va tu donación, y puedes cancelar una entrega agendada.',
              ]
            : receive
              ? [
                    'Toca <b>Escanear QR</b> y apunta al código del donante: queda recibido y se suma al inventario.',
                    'Sin QR, escribe su código (<b>NX-</b>…) y toca <b>Recibir</b>. Los traslados empiezan por <b>TR-</b>.',
                    'En <b>Por recibir</b> están los aportes agendados y los traslados; al tocar <b>Recibir</b> confirmas qué llegó.',
                    'Cuando las familias recojan un aporte, toca <b>Entregado</b>.',
                    'Si te equivocas, toca <b>Deshacer</b> en el aviso.',
                ]
              : [
                    'Cuenta lo que hay en el punto con − y +, o escribe la cantidad. Con <b>Caja</b>, los botones cuentan cajas completas.',
                    'Rojo es crítico (menos del 30 %), amarillo estable y verde abastecido.',
                    '<b>Enviar a otro punto</b> manda lo que te sobra a quien le falta: lo revisas antes de confirmar.',
                    'Para recibir donaciones o traslados, abre la pestaña <b>Recibir</b>.',
                ]
        this.dialog.ask({
            icon: 'help',
            title: !point ? 'Cómo donar' : receive ? 'Cómo recibir y entregar' : 'Cómo usar el inventario',
            body: helpList(steps),
            actions: [{ label: 'Entendido', value: true, kind: 'primary' }],
        })
    }

    /** Where the person is in the donation: step n of 3 or 4. */
    #steps(n) {
        const names = this.mode === 'money' ? ['Tu cesta', 'Forma de aporte', 'Resumen'] : ['Tu cesta', 'Forma de aporte', 'Datos de entrega', 'Resumen']
        const i = Math.min(n, names.length) - 1
        return `<p class="lite-steps" aria-label="Paso ${i + 1} de ${names.length}: ${names[i]}">
            ${names.map((_, k) => `<span class="lite-step${k < i ? ' is-done' : k === i ? ' is-now' : ''}"></span>`).join('')}
            <b>Paso ${i + 1} de ${names.length}</b> · ${names[i]}</p>`
    }

    #back(to, label = 'Volver') {
        return `<button class="btn btn-secondary js-back" type="button" data-to="${to}">${icon('chevron-left')} ${label}</button>`
    }

    #bindBack() {
        this.root.querySelectorAll('.js-back').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.to)))
    }

    /* ---------------- live feed ---------------- */

    #live(e) {
        const text = LIVE_TEXT[e.kind]?.(e)
        if (!text) return
        this.feed.unshift({ text, at: new Date() })
        this.feed = this.feed.slice(0, 5)
        const box = this.root.querySelector('.js-feed')
        if (box) box.outerHTML = this.#feedHtml()
    }

    #feedHtml() {
        return `
            <section class="lite-card lite-feed js-feed" aria-live="polite">
                <h2><span class="live-dot" aria-hidden="true"></span> En vivo</h2>
                ${this.feed.length
                    ? `<ul>${this.feed.map((f) => `<li><span>${esc(f.text)}</span><time>${f.at.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</time></li>`).join('')}</ul>`
                    : '<p class="lite-muted">Aquí aparecen los aportes y traslados en cuanto ocurren, en toda la ciudad.</p>'}
            </section>`
    }

    /* ---------------- home ---------------- */

    #home() {
        const t = this.theme
        const why = liteSuggested()
        return `
            <section class="lite-hero">
                <p class="theme-chip">${icon(t.icon)}<span>${esc(t.title)}</span></p>
                <h1>Red de ayuda en tiempo real</h1>
                <p class="lite-lead">${esc(t.lead)}</p>
                <div class="lite-roles">
                    <button class="role-btn role-donor js-donor" type="button" data-autofocus><span class="role-icon" data-icon="heart" aria-hidden="true"></span><span class="role-text"><strong>Quiero donar</strong><span>Elige una zona y arma una cesta de apoyo.</span></span><span class="role-go" data-icon="chevron-right" aria-hidden="true"></span></button>
                    <button class="role-btn role-point js-point" type="button"><span class="role-icon" data-icon="box" aria-hidden="true"></span><span class="role-text"><strong>Soy punto de acopio</strong><span>Ingresa y actualiza el inventario de tu zona.</span></span><span class="role-go" data-icon="chevron-right" aria-hidden="true"></span></button>
                </div>
                ${why ? `<p class="lite-muted lite-why">${icon('info')} Abrimos la versión ligera porque tu dispositivo tiene ${esc(why)}.</p>` : ''}
            </section>
            ${this.#feedHtml()}`
    }

    bind_home() {
        this.root.querySelector('.js-donor').addEventListener('click', () => this.go('zones'))
        this.root.querySelector('.js-point').addEventListener('click', () => this.go('login'))
    }

    /* ---------------- donor ---------------- */

    #zones() {
        return `
            <h1 class="lite-title">¿Dónde quieres apoyar?</h1>
            <p class="lite-muted">Cada zona tiene un punto de acopio. Primero aparecen las que más lo necesitan.</p>
            <div class="lite-zones js-zones">${this.#zoneCards()}</div>
            ${this.#feedHtml()}
            <div class="lite-actions">${this.#back('home')}</div>`
    }

    #zoneCards() {
        const rank = { alta: 0, media: 1, baja: 2 }
        return [...ZONES]
            .sort((a, b) => rank[zoneLevel(a, this.theme)] - rank[zoneLevel(b, this.theme)])
            .map((z) => {
                const p = pointForZone(z.id)
                const level = zoneLevel(z, this.theme)
                const critical = Object.values(SUPPLIES).filter((s) => this.board.isCritical(z.id, s.id))
                return `
                <article class="lite-card lite-zone" style="--zone:${z.color}">
                    <div class="lite-zone-head">
                        <span class="lite-zone-dot" aria-hidden="true"></span>
                        <div class="lite-zone-name"><h2>${esc(z.name)}</h2><small>Barrio ${esc(z.barrio)}${z.id === lastZone() ? ' · <b class="lite-last">Tu última zona</b>' : ''}</small></div>
                        <span class="need-pill" data-level="${level}">${esc(NEED_WORD[level])}</span>
                    </div>
                    <p class="lite-muted">${icon('pin')} ${esc(p.name)} · ${esc(p.address)}</p>
                    <p class="lite-needs">${zoneNeeds(z, this.theme)
                        .map(([cat, l]) => `<span class="lite-chip" data-level="${l}">${icon(CATEGORIES[cat].icon)} ${esc(CATEGORIES[cat].label)}</span>`)
                        .join('')}</p>
                    ${critical.length ? `<p class="lite-urgent">${icon('alert')} Urgente: ${critical.map((s) => esc(s.label)).join(', ')}</p>` : ''}
                    <button class="btn btn-primary js-zone" type="button" data-zone="${z.id}">Donar en ${esc(z.name)} ${icon('chevron-right')}</button>
                </article>`
            })
            .join('')
    }

    #zonesList() {
        const box = this.root.querySelector('.js-zones')
        if (!box) return
        box.innerHTML = this.#zoneCards()
        hydrateIcons(box)
        this.bind_zones()
    }

    bind_zones() {
        this.#bindBack()
        this.root.querySelectorAll('.js-zone').forEach((b) =>
            b.addEventListener('click', () => {
                if (this.zone?.id !== b.dataset.zone) this.basket = new Map()
                this.mode = null
                this.zone = ZONES.find((z) => z.id === b.dataset.zone)
                try {
                    localStorage.setItem('nexos.lite.zone', this.zone.id)
                } catch {
                    /* storage unavailable: nothing to remember */
                }
                this.go('basket')
            })
        )
    }

    get pointNow() {
        return pointForZone(this.zone.id)
    }

    /** Units the point still needs of a supply: what a donor can bring. */
    #max(id) {
        return this.board.need(this.pointNow.id, id)
    }

    #basket() {
        const p = this.pointNow
        const order = Object.keys(CATEGORIES)
        const list = Object.values(SUPPLIES)
            .filter((s) => this.#max(s.id) > 0)
            .sort((a, b) => Number(this.board.isCritical(this.zone.id, b.id)) - Number(this.board.isCritical(this.zone.id, a.id)) || order.indexOf(a.category) - order.indexOf(b.category))
        return `
            ${this.#steps(1)}
            <h1 class="lite-title">Tu cesta para ${esc(this.zone.name)}</h1>
            <p class="lite-muted">${icon('pin')} ${esc(p.name)}. Solo puedes aportar lo que al punto le falta.</p>
            <div class="lite-list">
                ${list.length
                    ? list
                          .map((s) => {
                              const q = this.basket.get(s.id) ?? 0
                              const max = this.#max(s.id)
                              const urgent = this.board.isCritical(this.zone.id, s.id)
                              return `
                    <div class="lite-row" data-item="${s.id}">
                        <span class="lite-row-icon" style="color:${CATEGORIES[s.category].color}">${icon(CATEGORIES[s.category].icon)}</span>
                        <span class="lite-row-text"><b>${esc(s.label)}</b><small>${esc(s.unit)} · ${money(s.value)} · faltan ${max}${urgent ? ' · <em>urgente</em>' : ''}</small></span>
                        <span class="stepper" role="group" aria-label="Unidades de ${esc(s.label)}">
                            <button type="button" class="js-minus" aria-label="Quitar una unidad de ${esc(s.label)}" ${q <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
                            <input class="js-qty" type="number" inputmode="numeric" min="0" max="${max}" value="${q}" aria-label="Unidades de ${esc(s.label)}, hasta ${max}">
                            <button type="button" class="js-plus" aria-label="Agregar una unidad de ${esc(s.label)}" ${q >= max ? 'disabled' : ''}>${icon('plus')}</button>
                        </span>
                    </div>`
                          })
                          .join('')
                    : `<p class="lite-muted">El punto de ${esc(this.zone.name)} está abastecido por ahora. Gracias: mira otra zona.</p>`}
            </div>
            <div class="lite-sticky">
                <span class="js-total"></span>
                ${this.#back('zones')}
                <button class="btn btn-primary js-next" type="button">Continuar ${icon('chevron-right')}</button>
            </div>`
    }

    #totals() {
        let units = 0, value = 0
        for (const [id, q] of this.basket) {
            units += q
            value += q * SUPPLIES[id].value
        }
        return { units, value }
    }

    bind_basket() {
        this.#bindBack()
        const total = () => {
            const t = this.#totals()
            this.root.querySelector('.js-total').textContent = t.units ? `${t.units} ${t.units === 1 ? 'unidad' : 'unidades'} · ${money(t.value)}` : 'Tu cesta está vacía'
            this.root.querySelector('.js-next').disabled = !t.units
        }
        this.root.querySelectorAll('.lite-row').forEach((row) => {
            const id = row.dataset.item
            const input = row.querySelector('.js-qty')
            const set = (n) => {
                const max = this.#max(id)
                const q = Math.max(0, Math.min(max, Math.round(Number(n) || 0)))
                if (q) this.basket.set(id, q)
                else this.basket.delete(id)
                input.value = q
                row.querySelector('.js-minus').disabled = q <= 0
                row.querySelector('.js-plus').disabled = q >= max
                total()
            }
            row.querySelector('.js-minus').addEventListener('click', () => set((this.basket.get(id) ?? 0) - 1))
            row.querySelector('.js-plus').addEventListener('click', () => set((this.basket.get(id) ?? 0) + 1))
            input.addEventListener('change', () => set(input.value))
            input.addEventListener('focus', () => input.select())
        })
        this.root.querySelector('.js-next').addEventListener('click', () => this.go('method'))
        total()
    }

    #method() {
        const t = this.#totals()
        return `
            ${this.#steps(2)}
            <h1 class="lite-title">¿Cómo quieres aportar?</h1>
            <p class="lite-muted">${t.units} ${t.units === 1 ? 'unidad' : 'unidades'} · valor equivalente ${money(t.value)}</p>
            <div class="lite-choices">
                <button class="lite-choice js-physical" type="button" data-autofocus>${icon('box')}<span><b>Llevarlo al punto</b><small>Eliges cuándo; te damos un código QR para mostrar allá.</small></span>${icon('chevron-right')}</button>
                <button class="lite-choice js-money" type="button">${icon('card')}<span><b>Aportar en dinero</b><small>El equipo compra los insumos y los deja en el punto. (Demostración: no se cobra nada.)</small></span>${icon('chevron-right')}</button>
            </div>
            <div class="lite-actions">${this.#back('basket')}</div>`
    }

    bind_method() {
        this.#bindBack()
        this.root.querySelector('.js-physical').addEventListener('click', () => {
            this.mode = 'physical'
            this.go('details')
        })
        this.root.querySelector('.js-money').addEventListener('click', () => {
            this.mode = 'money'
            this.go('summary')
        })
    }

    #details() {
        const d = this.details
        const windows = deliveryWindows()
        return `
            ${this.#steps(3)}
            <h1 class="lite-title">¿Cuándo lo llevas?</h1>
            <p class="lite-muted">Tus datos se quedan en este dispositivo: solo sirven para que el punto te reconozca.</p>
            <form class="lite-form donor-form" novalidate>
                <label class="field"><span class="field-label">Nombre</span><input name="name" type="text" autocomplete="name" value="${esc(d.name)}" required data-autofocus></label>
                <label class="field"><span class="field-label">Teléfono</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(d.phone)}" required></label>
                <fieldset class="field"><legend class="field-label">Franja de entrega</legend>
                    <div class="chips">${windows
                        .map((w) => `<label class="chip"><input type="radio" name="window" value="${w.id}" ${d.window === w.id ? 'checked' : ''}><span><b>${w.label}</b><small>${w.detail}</small></span></label>`)
                        .join('')}</div>
                </fieldset>
                <p class="form-error js-error" role="alert" hidden></p>
            </form>
            <div class="lite-actions">${this.#back('method')}<button class="btn btn-primary js-next" type="button">Ver resumen ${icon('chevron-right')}</button></div>`
    }

    bind_details() {
        this.#bindBack()
        const form = this.root.querySelector('form')
        const next = () => {
            const f = new FormData(form)
            Object.assign(this.details, { name: String(f.get('name') ?? '').trim(), phone: String(f.get('phone') ?? '').trim(), window: String(f.get('window') ?? '') })
            const d = this.details
            const problem = d.name.length < 3 ? 'Escribe tu nombre.' : d.phone.replace(/\D/g, '').length < 7 ? 'Escribe un teléfono de al menos 7 números.' : !d.window ? 'Elige cuándo puedes llevarlo.' : ''
            const err = this.root.querySelector('.js-error')
            err.textContent = problem
            err.hidden = !problem
            if (!problem) this.go('summary')
        }
        form.addEventListener('submit', (e) => {
            e.preventDefault()
            next()
        })
        this.root.querySelector('.js-next').addEventListener('click', next)
    }

    #summary() {
        const p = this.pointNow
        const t = this.#totals()
        const w = deliveryWindows().find((x) => x.id === this.details.window)
        const physical = this.mode === 'physical'
        return `
            ${this.#steps(4)}
            <h1 class="lite-title">Resumen del aporte</h1>
            <section class="lite-card">
                <ul class="mini-list">${[...this.basket].map(([id, q]) => `<li><span>${q} × ${esc(SUPPLIES[id].label)}</span><span>${money(q * SUPPLIES[id].value)}</span></li>`).join('')}</ul>
                <div class="total-line"><span>Valor equivalente</span><b>${money(t.value)}</b></div>
            </section>
            <div class="info-block">${icon('pin')}<div><span class="info-label">Punto de acopio</span><b>${esc(p.name)}</b><span>${esc(p.address)}, Cali · Atención ${esc(p.hours)}</span><a href="${directionsUrl(p)}" target="_blank" rel="noopener">Cómo llegar ${icon('chevron-right')}</a></div></div>
            ${physical
                ? `<div class="info-block">${icon('calendar')}<div><span class="info-label">Cuándo</span><b>${esc(w?.label ?? '')}</b><span>${esc(w?.detail ?? '')}</span></div></div>`
                : `<div class="info-block">${icon('card')}<div><span class="info-label">Aporte en dinero</span><b>Demostración</b><span>No se realizará ningún cobro.</span></div></div>`}
            <div class="lite-actions">${this.#back(physical ? 'details' : 'method', 'Cambiar')}<button class="btn btn-primary js-confirm" type="button" data-autofocus>${physical ? 'Confirmar entrega' : `Aportar ${money(t.value)}`}</button></div>`
    }

    bind_summary() {
        this.#bindBack()
        this.root.querySelector('.js-confirm').addEventListener('click', (e) => {
            e.currentTarget.disabled = true
            this.#confirm()
        })
    }

    /** Same as the full version: recorded in the sheet; in money it counts in the stock at once. */
    #confirm() {
        const p = this.pointNow
        const w = deliveryWindows().find((x) => x.id === this.details.window)
        const record = {
            code: newCode(),
            mode: this.mode,
            point: p.id,
            barrio: this.zone.id,
            items: Object.fromEntries(this.basket),
            value: this.#totals().value,
            slot: this.mode === 'physical' && w ? `${w.label}: ${w.detail}` : '',
            at: new Date().toISOString(),
        }
        const basket = new Map(this.basket)
        if (record.mode === 'money') this.board.donate(p.id, basket, { push: false })
        ledger.donate(record).then((out) => {
            if (out.queued && this.screen === 'done') {
                this.root.querySelector('.lite-done')?.insertAdjacentHTML(
                    'beforeend',
                    `<p class="done-offline">${icon('info')} Sin conexión en este momento: tu aporte quedó guardado en este dispositivo y se envía solo apenas vuelva la conexión.</p>`
                )
                hydrateIcons(this.root)
            }
            if (out.rows) this.board.applyRows(p.id, out.rows)
            // a sheet with the previous script: the donation goes into the stock straight away, as before
            if (out.unsupported) record.mode === 'money' ? this.board.resend(p.id, basket.keys()) : this.board.donate(p.id, basket)
        })
        this.last = record
        this.basket = new Map()
        this.go('done')
    }

    #done() {
        const r = this.last
        const physical = r.mode === 'physical'
        const p = this.pointNow
        return `
            <section class="lite-card lite-done">
                <span class="done-mark">${icon('check')}</span>
                <h1>Gracias por tu apoyo</h1>
                <p>${physical ? `Te esperamos en <b>${esc(p.name)}</b>. ${esc(r.slot.replace(/\.$/, ''))}.` : 'Con tu aporte, el equipo comprará estos insumos y los dejará en el punto de acopio.'}</p>
                <p class="done-code">${physical ? 'Código de entrega' : 'Referencia'}<b>${esc(r.code)}</b></p>
                ${physical ? `<div class="done-qr"><div class="qr-img js-qr" role="img" aria-label="Código QR del aporte ${esc(r.code)}"></div><span>Muestra este QR en el punto: al escanearlo, tu aporte queda recibido.</span></div>` : ''}
                <p class="lite-muted">${esc(itemsLine(r.items))} · ${money(r.value)}</p>
            </section>
            <div class="lite-actions">
                <button class="btn btn-secondary js-again" type="button">Apoyar otra zona</button>
                <button class="btn btn-primary js-follow" type="button">${icon('search')} Seguir mi aporte</button>
            </div>`
    }

    bind_done() {
        if (this.last.mode === 'physical') qrSvg(trackUrl(this.last.code)).then((svg) => this.root.querySelector('.js-qr') && (this.root.querySelector('.js-qr').innerHTML = svg))
        this.root.querySelector('.js-again').addEventListener('click', () => this.go('zones'))
        this.root.querySelector('.js-follow').addEventListener('click', () => this.track.show(this.last.code))
    }

    /* ---------------- collection point ---------------- */

    #login() {
        return `
            <h1 class="lite-title">Acceso para puntos de acopio</h1>
            <form class="lite-form" novalidate>
                <label class="field"><span class="field-label">Código del punto</span><input name="code" type="text" autocomplete="username" autocapitalize="characters" spellcheck="false" required data-autofocus></label>
                <label class="field"><span class="field-label">Clave</span><input name="pin" type="password" autocomplete="current-password" inputmode="numeric" required></label>
                <p class="form-error js-error" role="alert" hidden></p>
                <p class="demo-note">${icon('info')}<span>Prototipo: <b>ACOPIO-CENTRO</b>, <b>-NORTE</b>, <b>-SUR</b>, <b>-ORIENTE</b> u <b>-OESTE</b>, con la clave <b>2024</b>.</span></p>
                <div class="lite-actions">${this.#back('home')}<button class="btn btn-primary" type="submit">Ingresar</button></div>
            </form>`
    }

    bind_login() {
        this.#bindBack()
        const form = this.root.querySelector('form')
        form.addEventListener('submit', (e) => {
            e.preventDefault()
            const point = validateCredentials(form.code.value.trim().toUpperCase(), form.pin.value.trim())
            const err = this.root.querySelector('.js-error')
            if (!point) {
                err.textContent = 'El código o la clave no coinciden. El código es como ACOPIO-NORTE y la clave tiene 4 números.'
                err.hidden = false
                return
            }
            this.point = point
            session.role = 'collector'
            session.point = point
            this.store = new InventoryStore({ pointId: point.id, localQueue })
            this.store.on(() => this.#pointSync())
            this.store.start()
            this.go('point')
        })
    }

    #point() {
        const z = ZONES.find((zz) => zz.id === this.point.zone)
        return `
            <h1 class="lite-title">${esc(z?.name ?? '')}</h1>
            <p class="lite-muted">${esc(this.point.name)} · <span class="js-sync"></span></p>
            <div class="board-tabs" role="tablist" aria-label="Secciones del punto">
                <button class="board-tab js-tab" type="button" role="tab" id="lt-stock" data-tab="stock" aria-controls="lv-stock">${icon('basket')} Inventario</button>
                <button class="board-tab js-tab" type="button" role="tab" id="lt-receive" data-tab="receive" aria-controls="lv-receive">${icon('qr')} Recibir<span class="tab-badge js-pending-count" hidden></span></button>
            </div>
            <section class="lite-card" id="lv-stock" role="tabpanel" aria-labelledby="lt-stock">
                <div class="stock-tools">
                    <div class="step-toggle lite-by" role="radiogroup" aria-label="Los botones suman o quitan">
                        <button type="button" role="radio" class="js-by" data-by="unit" aria-checked="${!this.byBox}">Unidad</button>
                        <button type="button" role="radio" class="js-by" data-by="box" aria-checked="${!!this.byBox}">Caja</button>
                    </div>
                    <button class="btn btn-secondary js-transfer" type="button">${icon('truck')} Enviar a otro punto</button>
                </div>
                <div class="lite-list js-stock"></div>
            </section>
            <section id="lv-receive" role="tabpanel" aria-labelledby="lt-receive" hidden>
                <div class="receive-card">
                    <h3>Recibir un aporte o un traslado</h3>
                    <p>Escanea el QR que trae el donante, o escribe su código. Lo recibido se suma solo al inventario.</p>
                    <button class="btn btn-primary receive-scan js-scan" type="button">${icon('camera')} Escanear QR</button>
                    <form class="pending-form js-receive-form" novalidate>
                        <label class="sr-only" for="lite-code">Código del aporte o del traslado</label>
                        <input id="lite-code" name="code" type="text" placeholder="O escribe el código (NX-… o TR-…)" autocapitalize="characters" autocomplete="off" spellcheck="false">
                        <button class="btn btn-secondary" type="submit">Recibir</button>
                    </form>
                    <p class="form-error js-receive-error" role="alert" hidden></p>
                </div>
                <div class="lite-card js-pending-lists"></div>
            </section>
            <div class="lite-actions"><button class="btn btn-secondary js-logout" type="button">${icon('logout')} Salir</button></div>`
    }

    /** Inventario and Recibir, one at a time, as in the full version. */
    #tab(tab) {
        this.pointTab = tab
        for (const t of this.root.querySelectorAll('.js-tab')) {
            t.setAttribute('aria-selected', String(t.dataset.tab === tab))
            t.tabIndex = t.dataset.tab === tab ? 0 : -1
        }
        this.root.querySelector('#lv-stock').hidden = tab !== 'stock'
        this.root.querySelector('#lv-receive').hidden = tab !== 'receive'
    }

    bind_point() {
        this.root.querySelectorAll('.js-tab').forEach((t) => t.addEventListener('click', () => this.#tab(t.dataset.tab)))
        this.#tab(this.pointTab ?? 'stock')
        const form = this.root.querySelector('.js-receive-form')
        form.addEventListener('submit', (e) => {
            e.preventDefault()
            this.#receive(form.querySelector('input').value, { button: form.querySelector('[type="submit"]') })
        })
        this.root.querySelector('.js-scan').addEventListener('click', () => this.#scan())
        this.root.querySelectorAll('.js-by').forEach((b) =>
            b.addEventListener('click', () => {
                this.byBox = b.dataset.by === 'box'
                this.root.querySelectorAll('.js-by').forEach((o) => o.setAttribute('aria-checked', String(o === b)))
            })
        )
        this.root.querySelector('.js-transfer').addEventListener('click', () => this.#transfer())
        this.root.querySelector('.js-logout').addEventListener('click', () => {
            this.store.stop()
            this.point = this.store = null
            session.role = session.point = null
            this.go('home')
        })
        this.root.querySelector('.js-pending-lists').addEventListener('click', (e) => {
            const b = e.target.closest('[data-action]')
            if (b?.dataset.action === 'deliver') this.#deliver(b.dataset.code, b)
            else if (b) this.#receive(b.dataset.code, { confirm: true, button: b })
        })
        this.stockKey = this.queueKey = null
        this.#pointSync()
    }

    #pointSync() {
        if (this.screen !== 'point' || !this.store) return
        const st = this.store
        const sync = this.root.querySelector('.js-sync')
        if (sync) sync.textContent = !st.ready ? 'cargando…' : st.status === 'local' ? 'guardado en este dispositivo' : st.failures >= 2 ? 'sin conexión, se guarda aquí' : st.unsaved ? 'guardando…' : 'guardado'
        // the stock list: redrawn only when a number changed, and never under the person's finger
        const key = JSON.stringify(st.stock) + st.ready
        if (key !== this.stockKey && !this.root.querySelector('.js-stock input:focus')) {
            this.stockKey = key
            const box = this.root.querySelector('.js-stock')
            box.innerHTML = Object.values(SUPPLIES)
                .map((s) => {
                    const q = st.get(s.id)
                    const state = stockState(s.id, q)
                    return `
                <div class="lite-row" data-item="${s.id}">
                    <span class="lite-row-text"><b>${esc(s.label)}</b><small><i class="stock-state" data-state="${state.id}">${state.label}</i> · de ${stockCap(s.id)}</small></span>
                    <span class="stepper" role="group" aria-label="Unidades de ${esc(s.label)}">
                        <button type="button" class="js-minus" aria-label="Quitar una unidad de ${esc(s.label)}" ${!st.ready || q <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
                        <input class="js-qty" type="number" inputmode="numeric" min="0" max="${stockCap(s.id)}" value="${q}" ${st.ready ? '' : 'disabled'} aria-label="Cantidad de ${esc(s.label)}">
                        <button type="button" class="js-plus" aria-label="Agregar una unidad de ${esc(s.label)}" ${!st.ready || q >= stockCap(s.id) ? 'disabled' : ''}>${icon('plus')}</button>
                    </span>
                </div>`
                })
                .join('')
            hydrateIcons(box)
            box.querySelectorAll('.lite-row').forEach((row) => {
                const id = row.dataset.item
                // with "Caja" the buttons count whole boxes, as in the full version
                const step = () => (this.byBox ? perBox(id) : 1)
                row.querySelector('.js-minus').addEventListener('click', () => st.set(id, st.get(id) - step()))
                row.querySelector('.js-plus').addEventListener('click', () => st.set(id, st.get(id) + step()))
                const input = row.querySelector('.js-qty')
                input.addEventListener('focus', () => input.select())
                input.addEventListener('change', () => {
                    st.set(id, Math.round(Number(input.value) || 0))
                    input.blur()
                })
            })
            this.board.mirror(this.point.id, st.stock)
        }
        const q = st.queue ?? {}
        const qKey = JSON.stringify(q)
        if (qKey === this.queueKey) return
        this.queueKey = qKey
        const name = (id) => COLLECTION_POINTS.find((p) => p.id === id)?.name.replace('Punto de acopio ', '') ?? id
        const row = (ic, x, sub, action, label) => `
            <li class="pend-row"><span class="pend-icon">${icon(ic)}</span><span class="pend-text"><b>${esc(x.code)}</b><span>${esc(itemsLine(x.items))}</span><small>${esc(sub)}</small></span>
            ${action ? `<button class="btn btn-primary pend-btn" type="button" data-action="${action}" data-code="${esc(x.code)}">${label}</button>` : ''}</li>`
        const group = (title, rows, empty) => `<div class="pend-group"><h3>${title}</h3>${rows.length ? `<ul class="pend-list">${rows.join('')}</ul>` : `<p class="pend-empty">${empty}</p>`}</div>`
        const toReceive = [...(q.scheduled ?? []).map((d) => row('heart', d, d.slot || 'Entrega agendada', 'receive', 'Recibir')), ...(q.incoming ?? []).map((t) => row('truck', t, `Traslado desde ${name(t.from)}`, 'receive', 'Recibir'))]
        const toDeliver = (q.toDeliver ?? []).map((d) => row('home', d, d.mode === 'money' ? 'Aporte en dinero' : 'Recibido en el punto', 'deliver', 'Entregado'))
        const out = (q.outgoing ?? []).map((t) => row('truck', t, `En camino a ${name(t.to)}`))
        const badge = this.root.querySelector('.js-pending-count')
        badge.hidden = !(toReceive.length + toDeliver.length)
        badge.textContent = toReceive.length + toDeliver.length
        const lists = this.root.querySelector('.js-pending-lists')
        lists.innerHTML =
            group('Por recibir', toReceive, 'Nada por recibir por ahora.') +
            group('Por entregar a las familias', toDeliver, 'Todo lo recibido ya se entregó.') +
            (out.length ? group('Traslados enviados', out, '') : '')
        hydrateIcons(lists)
    }

    /** As in the full version: a tap on the list asks what arrived; busy while the sheet answers; undo after. */
    async #receive(text, { confirm = false, button = null } = {}) {
        const err = this.root.querySelector('.js-receive-error')
        const code = readCode(text)
        err.hidden = true
        if (!code) {
            err.textContent = 'Escribe el código del aporte (NX-…) o del traslado (TR-…).'
            err.hidden = false
            return
        }
        if (confirm) {
            const q = this.store.queue ?? {}
            const it = [...(q.scheduled ?? []), ...(q.incoming ?? [])].find((x) => x.code === code)
            const yes = await this.dialog.ask({
                icon: 'box',
                title: '¿Llegó esto al punto?',
                body: `<p><b>${esc(code)}</b></p><ul class="dialog-items">${Object.entries(it?.items ?? {})
                    .filter(([id]) => SUPPLIES[id])
                    .map(([id, n]) => `<li><b>${n}</b> × ${esc(SUPPLIES[id].label)}</li>`)
                    .join('')}</ul><p>Revisa que esté completo: al confirmar se suma al inventario.</p>`,
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
            err.textContent = out.error
            err.hidden = false
            return
        }
        this.root.querySelector('.js-receive-form input').value = ''
        const what = itemsLine((out.record ?? out.transfer).items)
        if (out.already) this.toast.show(`<b>${code}</b> ya se había recibido. No se sumó otra vez.`, { duration: 4000 })
        else
            this.toast.show(`<b>${code}</b> recibido: ${esc(what)} se sumaron al inventario.`, {
                duration: 7000,
                action: 'Deshacer',
                onAction: async () => {
                    const back = code.startsWith('TR-') ? await ledger.transferUnreceive(code, this.point.id) : await ledger.unreceive(code, this.point.id)
                    if (!back.ok) return this.toast.show(esc(back.error), { duration: 4500 })
                    this.toast.show(`Se deshizo: <b>${code}</b> volvió a Por recibir y salió del inventario.`, { duration: 3500 })
                    if (back.rows) this.store.take(back.rows)
                },
            })
        if (out.rows) this.store.take(out.rows)
    }

    async #deliver(code, button = null) {
        const busy = busyButton(button, 'Guardando…')
        const out = await ledger.deliver(code, this.point.id)
        busy()
        if (!out.ok) return this.toast.show(esc(out.error), { duration: 4000 })
        this.toast.show(`<b>${esc(code)}</b> entregado a las familias.`, {
            duration: 7000,
            action: 'Deshacer',
            onAction: async () => {
                const back = await ledger.undeliver(code, this.point.id)
                if (!back.ok) return this.toast.show(esc(back.error), { duration: 4500 })
                this.toast.show(`Se deshizo: <b>${esc(code)}</b> volvió a Por entregar.`, { duration: 3500 })
                this.store.take([])
            },
        })
        this.store.take([])
    }

    async #scan() {
        const sheet = document.createElement('div')
        sheet.className = 'scan-sheet lite-overlay'
        sheet.setAttribute('role', 'dialog')
        sheet.setAttribute('aria-label', 'Escanear el código QR de un aporte')
        sheet.innerHTML = `<div class="scan-box"><video class="scan-video" playsinline muted></video><span class="scan-frame" aria-hidden="true"></span></div>
            <p class="scan-hint">Apunta la cámara al código QR del aporte.</p><button class="btn btn-secondary js-cancel" type="button">Cancelar</button>`
        document.body.appendChild(sheet)
        const scan = scanQr(sheet.querySelector('video'))
        const close = () => {
            scan.stop()
            sheet.remove()
        }
        sheet.querySelector('.js-cancel').addEventListener('click', close)
        sheet.querySelector('.js-cancel').focus()
        let text = null
        try {
            text = await scan.result
        } catch {
            close()
            this.toast.show('No pudimos usar la cámara. Escribe el código del aporte.', { duration: 5000 })
            return
        }
        close()
        if (text) this.#receive(text)
    }

    /** Send to another point: the same suggestions as the full version (see InventoryPanel). */
    #transfer() {
        const st = this.store
        if (!st.ready) return
        const me = this.point.id
        const others = COLLECTION_POINTS.filter((p) => p.id !== me)
        const spare = (id) => Math.max(0, st.get(id) - Math.ceil(stockCap(id) * 0.5))
        const toStocked = (p, id) => Math.max(0, Math.ceil(stockCap(id) * 0.75) - this.board.qty(p.id, id))
        const suggest = (p, id) => (this.board.state(p.id, id).id === 'abastecido' ? 0 : Math.min(spare(id), toStocked(p, id)))
        const critical = (p) => Object.keys(SUPPLIES).filter((id) => this.board.state(p.id, id).id === 'critico').length
        const helps = (p) => Object.keys(SUPPLIES).reduce((n, id) => n + suggest(p, id) * (this.board.state(p.id, id).id === 'critico' ? 3 : 1), 0)
        let dest = [...others].sort((a, b) => helps(b) - helps(a) || critical(b) - critical(a))[0]
        const zname = (p) => ZONES.find((z) => z.id === p.zone)?.name ?? ''
        const sheet = document.createElement('div')
        sheet.className = 'xfer-sheet lite-overlay'
        sheet.setAttribute('role', 'dialog')
        sheet.setAttribute('aria-label', 'Enviar a otro punto')
        document.body.appendChild(sheet)
        const qty = {}
        const draw = () => {
            const list = Object.values(SUPPLIES).filter((s) => st.get(s.id) > 0)
            for (const s of list) qty[s.id] ??= suggest(dest, s.id)
            sheet.innerHTML = `
                <div class="xfer-head"><span class="track-mark">${icon('truck')}</span><div><h3>Enviar a otro punto</h3><p class="sub">Sale de tu inventario ahora y entra en el del otro punto cuando lo reciba.</p></div>
                <button class="icon-btn js-close" type="button" aria-label="Cerrar">${icon('x')}</button></div>
                <fieldset class="xfer-dest"><legend class="field-label">¿A qué punto?</legend>${others
                    .map((p) => `<label class="xfer-point"><input type="radio" name="dest" value="${p.id}" ${p.id === dest.id ? 'checked' : ''}><span><b>${esc(zname(p))}</b><small>${esc(p.name.replace('Punto de acopio ', ''))}</small></span><em class="${critical(p) ? 'is-critical' : ''}">${critical(p) ? `${critical(p)} ${critical(p) === 1 ? 'crítico' : 'críticos'}` : 'Sin críticos'}</em></label>`)
                    .join('')}</fieldset>
                <div class="xfer-items">${list
                    .map((s) => {
                        const ds = this.board.state(dest.id, s.id)
                        return `<div class="xfer-row"><span class="xfer-name">${esc(s.label)}</span><span>${st.get(s.id)}</span><span><i class="stock-state" data-state="${ds.id}">${ds.label}</i></span><input class="js-q" type="number" inputmode="numeric" min="0" max="${st.get(s.id)}" value="${qty[s.id]}" data-item="${s.id}" aria-label="Unidades de ${esc(s.label)} para enviar"></div>`
                    })
                    .join('')}</div>
                <p class="form-error js-err" role="alert" hidden></p>
                <div class="xfer-foot"><span class="js-sum"></span><button class="btn btn-secondary js-close" type="button">Cancelar</button><button class="btn btn-primary js-send" type="button">${icon('truck')} Enviar</button></div>`
            hydrateIcons(sheet)
            const sum = () => {
                const n = Object.values(qty).reduce((a, b) => a + b, 0)
                sheet.querySelector('.js-sum').textContent = n ? `${n} unidades para ${zname(dest)}` : 'Elige qué enviar'
                sheet.querySelector('.js-send').disabled = !n
            }
            sheet.querySelectorAll('.js-q').forEach((i) => i.addEventListener('input', () => ((qty[i.dataset.item] = Math.max(0, Math.min(st.get(i.dataset.item), Math.round(Number(i.value) || 0)))), sum())))
            sheet.querySelectorAll('input[name="dest"]').forEach((r) =>
                r.addEventListener('change', () => {
                    dest = others.find((p) => p.id === r.value)
                    for (const k of Object.keys(qty)) delete qty[k]
                    draw()
                })
            )
            sheet.querySelectorAll('.js-close').forEach((b) => b.addEventListener('click', () => sheet.remove()))
            sheet.querySelector('.js-send').addEventListener('click', () => {
                const items = Object.fromEntries(Object.entries(qty).filter(([, n]) => n > 0))
                if (!Object.keys(items).length) return
                // first what will go where; only "Confirmar envío" sends it
                sheet.innerHTML = `
                    <div class="xfer-review">
                        <h4>Revisa el envío</h4>
                        <p>Para <b>${esc(zname(dest))}</b> · ${esc(dest.name)}</p>
                        <ul class="dialog-items">${Object.entries(items)
                            .map(([id, n]) => `<li><b>${n}</b> × ${esc(SUPPLIES[id].label)} <small>(te quedan ${st.get(id) - n})</small></li>`)
                            .join('')}</ul>
                        <p class="xfer-note">${icon('info')} Sale de tu inventario ahora y entra en el de ${esc(zname(dest))} cuando lo reciban. Mientras siga en camino, puedes anularlo.</p>
                        <p class="form-error js-err" role="alert" hidden></p>
                        <div class="xfer-foot">
                            <button class="btn btn-secondary js-edit" type="button">${icon('chevron-left')} Cambiar</button>
                            <button class="btn btn-primary js-confirm" type="button">${icon('truck')} Confirmar envío</button>
                        </div>
                    </div>`
                hydrateIcons(sheet)
                sheet.querySelector('.js-confirm').focus()
                sheet.querySelector('.js-edit').addEventListener('click', draw)
                sheet.querySelector('.js-confirm').addEventListener('click', async (e) => {
                    const busy = busyButton(e.currentTarget, 'Enviando…')
                    const out = await ledger.transfer(me, dest.id, items)
                    busy()
                    if (!out.ok) {
                        const err = sheet.querySelector('.js-err')
                        err.textContent = out.error
                        err.hidden = false
                        return
                    }
                    sheet.remove()
                    const tcode = out.transfer.code
                    this.toast.show(`Traslado <b>${tcode}</b> en camino a ${esc(zname(dest))}.`, {
                        duration: 7000,
                        action: 'Deshacer',
                        onAction: async () => {
                            const back = await ledger.transferCancel(tcode, me)
                            if (!back.ok) return this.toast.show(esc(back.error), { duration: 4500 })
                            this.toast.show(`Se anuló <b>${tcode}</b>: los insumos volvieron a tu inventario.`, { duration: 3500 })
                            if (back.rows) st.take(back.rows)
                        },
                    })
                    if (out.rows) st.take(out.rows)
                })
            })
            sum()
        }
        draw()
    }
}
