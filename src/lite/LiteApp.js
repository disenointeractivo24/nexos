import { icon, hydrateIcons } from '../ui/icons.js'
import { Toast, Dialog, helpList, busyButton } from '../ui/feedback.js'
import { TrackView } from '../ui/track.js'
import { loginFields, pointPicker, bindLogin } from '../ui/loginView.js'
import { pointMenu, POINT_TITLES } from '../ui/pointMenu.js'
import { transferSheet } from '../ui/transferSheet.js'
import { receiveWays, receiveLists, sentList } from '../ui/receiveView.js'
import { inventoryFilter, updateFilterCounts, applyFilter } from '../ui/inventoryView.js'
import { qrSvg, scanQr } from '../ui/qr.js'
import { CATEGORIES, SUPPLIES, money, perBox } from '../data/catalog.js'
import { stockCap, stockState } from '../data/inventory.js'
import { ZONES, NEED_WORD, zoneNeeds, zoneLevel, useStock } from '../data/zones.js'
import { COLLECTION_POINTS, pointForZone, validateCredentials, directionsUrl } from '../data/collectionPoints.js'
import { deliveryWindows, findWindow } from '../data/delivery.js'
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
        this.root.querySelector('.js-home').addEventListener('click', () => {
            // a point goes back to its three options
            this.pointTab = null
            this.go(this.point ? 'point' : 'home')
        })
        this.root.querySelector('.js-track-open').addEventListener('click', () => this.track.show())
        this.root.querySelector('.js-full').addEventListener('click', () => setLite(false))
        this.root.querySelector('.js-help').addEventListener('click', () => this.#help())
    }

    /** Help about what is on screen: donating, or the point's options and each of its views. */
    #help() {
        const point = this.screen === 'point'
        const tab = point ? (this.pointTab ?? 'home') : null
        const receive = tab === 'receive'
        const steps = !point
            ? [
                  'Elige una <b>zona</b>: primero aparecen las que más lo necesitan, con lo que les falta.',
                  'Arma tu <b>cesta</b> con − y +. Solo puedes aportar lo que al punto le falta.',
                  'Elige si lo <b>llevas al punto</b> (eliges cuándo) o si aportas <b>en dinero</b> (demostración).',
                  'Revisa el <b>resumen</b> y confirma. Recibes un código y, si lo llevas, un QR para mostrar en el punto.',
                  'Con <b>Sigue tu aporte</b> ves en qué va tu donación, y puedes cancelar una entrega agendada.',
              ]
            : tab === 'home'
              ? [
                    '<b>Gestionar inventario</b>: cuenta lo que hay en el punto. Lo que quede en rojo es lo primero que ven los donantes.',
                    '<b>Recibir donaciones</b>: escanea el QR del donante o escribe su código, y marca lo que ya se entregó a las familias.',
                    '<b>Enviar a otros puntos</b>: manda lo que te sobra a un punto al que le falta.',
                    'Con <b>Opciones</b> vuelves a estas tres.',
                ]
              : tab === 'send'
              ? [
                    'Toca <b>Nuevo envío</b>: te proponemos el punto que más lo necesita y cuánto mandar.',
                    'Revisa y toca <b>Confirmar envío</b>: sale de tu inventario y entra en el del otro punto cuando lo reciba.',
                    'Si te equivocas, toca <b>Deshacer</b> en el aviso.',
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
                    'Para recibir donaciones o enviar a otro punto, toca <b>Opciones</b>.',
                ]
        this.dialog.ask({
            icon: 'help',
            title: !point ? 'Cómo donar' : { home: 'Qué puedes hacer en el punto', receive: 'Cómo recibir y entregar', send: 'Cómo enviar a otro punto' }[tab] ?? 'Cómo usar el inventario',
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
                <p class="lite-logo" aria-hidden="true">NE<span class="brand-x">X</span>OS</p>
                <h1>Red de ayuda en tiempo real</h1>
                <p class="lite-lead">${esc(t.lead)}</p>
                <div class="lite-roles">
                    <button class="role-btn role-donor js-donor" type="button" data-autofocus><span class="role-icon" data-icon="heart" aria-hidden="true"></span><span class="role-text"><strong>Quiero donar</strong><span>Elige una zona y arma una cesta de apoyo.</span></span><span class="role-go" data-icon="chevron-right" aria-hidden="true"></span></button>
                    <button class="role-btn role-point js-point" type="button"><span class="role-icon" data-icon="box" aria-hidden="true"></span><span class="role-text"><strong>Soy punto de acopio</strong><span>Ingresa y actualiza el inventario de tu zona.</span></span><span class="role-go" data-icon="chevron-right" aria-hidden="true"></span></button>
                </div>
                ${why ? `<p class="lite-muted lite-why">${icon('info')} Abrimos la versión ligera porque ${esc(why)}.</p>` : ''}
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
                        <span class="lite-zone-dot" aria-hidden="true">${icon('home')}</span>
                        <div class="lite-zone-name"><h2>${esc(z.name)}</h2><small>Barrio ${esc(z.barrio)}${z.id === lastZone() ? ' · <b class="lite-last">Tu última zona</b>' : ''}</small></div>
                        <span class="need-pill" data-level="${level}">${esc(NEED_WORD[level])}</span>
                    </div>
                    <p class="lite-muted">${icon('pin')} ${esc(p.name)} · ${esc(p.address)}</p>
                    <p class="lite-needs">${zoneNeeds(z, this.theme)
                        .map(([cat, l]) => `<span class="lite-chip" data-level="${l}" style="background:${CATEGORIES[cat].tint};color:${CATEGORIES[cat].color}">${icon(CATEGORIES[cat].icon)} ${esc(CATEGORIES[cat].label)}</span>`)
                        .join('')}</p>
                    ${critical.length ? `<p class="lite-urgent">${icon('alert')} Urgente: ${critical.map((s) => esc(s.label)).join(', ')}</p>` : ''}
                    <button class="btn btn-primary js-zone" type="button" data-zone="${z.id}" aria-label="Donar en ${esc(z.name)}">Donar aquí ${icon('chevron-right')}</button>
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
                        <span class="lite-row-icon" style="color:${CATEGORIES[s.category].color};background:${CATEGORIES[s.category].tint}">${icon(s.icon ?? CATEGORIES[s.category].icon)}</span>
                        <span class="lite-row-text"><b>${esc(s.label)}${urgent ? ' <em>Urgente</em>' : ''}</b><small>${esc(s.unit)} · ${money(s.value)} · faltan ${max}</small></span>
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
                <button class="lite-choice js-physical" type="button" data-autofocus><span class="lite-choice-icon">${icon('box')}</span><span><b>Llevarlo al punto</b><small>Eliges cuándo; te damos un código QR para mostrar allá.</small></span>${icon('chevron-right')}</button>
                <button class="lite-choice js-money" type="button"><span class="lite-choice-icon">${icon('card')}</span><span><b>Aportar en dinero</b><small>El equipo compra los insumos y los deja en el punto. (Demostración: no se cobra nada.)</small></span>${icon('chevron-right')}</button>
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
        const windows = deliveryWindows(this.pointNow)
        return `
            ${this.#steps(3)}
            <h1 class="lite-title">¿Cuándo lo llevas?</h1>
            <p class="lite-muted">Tus datos se quedan en este dispositivo: solo sirven para que el punto te reconozca.</p>
            <form class="lite-form donor-form" novalidate>
                <label class="field"><span class="field-label">Nombre</span><input name="name" type="text" autocomplete="name" value="${esc(d.name)}" required data-autofocus></label>
                <label class="field"><span class="field-label">Teléfono</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(d.phone)}" required></label>
                <fieldset class="field"><legend class="field-label">Franja de entrega <span class="optional">El punto atiende ${esc(this.pointNow.hours)}</span></legend>
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
        const w = findWindow(this.pointNow, this.details.window)
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
        const w = findWindow(this.pointNow, this.details.window)
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
            <form class="lite-form lite-card lite-login" novalidate>
                <div class="lg-head">
                    <span class="lg-mark">${icon('box')}</span>
                    <div><h1 class="lite-title">Acceso para puntos de acopio</h1><p class="sub">Usa el código de tu punto y tu clave.</p></div>
                </div>
                ${loginFields('data-autofocus')}
                <p class="form-error js-error" role="alert" hidden></p>
                ${pointPicker()}
                <div class="lite-actions">${this.#back('home')}<button class="btn btn-primary" type="submit">Ingresar</button></div>
            </form>`
    }

    bind_login() {
        this.#bindBack()
        const form = this.root.querySelector('form')
        bindLogin(form)
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
            <div class="lite-view-head js-view-head" hidden>
                <button class="btn btn-secondary lite-back js-back" type="button">${icon('chevron-left')} Opciones</button>
                <h2 class="lite-view-title js-view-title" tabindex="-1"></h2>
            </div>
            <section id="lv-home">${pointMenu()}</section>
            <section class="lite-card" id="lv-stock" hidden>
                <div class="stock-tools">
                    <div class="step-toggle lite-by" role="radiogroup" aria-label="Los botones suman o quitan">
                        <button type="button" role="radio" class="js-by" data-by="unit" aria-checked="${!this.byBox}">Unidad</button>
                        <button type="button" role="radio" class="js-by" data-by="box" aria-checked="${!!this.byBox}">Caja</button>
                    </div>
                </div>
                ${inventoryFilter(this.filter ?? 'all')}
                <div class="lite-list js-stock"></div>
                <p class="rcv-empty js-filter-empty" hidden>${icon('check')}<span>Ningún insumo en ese estado.</span></p>
            </section>
            <section id="lv-receive" hidden>
                <p class="rcv-intro">¿Llegó un donante o un traslado? Recíbelo aquí: lo que llega se suma solo al inventario.</p>
                ${receiveWays('lite-code')}
                <div class="rcv-lists js-pending-lists"></div>
            </section>
            <section id="lv-send" hidden>
                <div class="receive-card">
                    <h3>Enviar insumos a otro punto</h3>
                    <p>Elige el punto y qué le mandas. Te sugerimos cuánto; lo revisas antes de confirmar.</p>
                    <button class="btn btn-primary receive-scan js-transfer" type="button">${icon('truck')} Nuevo envío</button>
                </div>
                <div class="rcv-lists js-sent-lists"></div>
            </section>
            <div class="lite-actions"><button class="btn btn-exit js-logout" type="button">${icon('logout')} Salir</button></div>`
    }

    /** The three options first, then one view at a time, as in the full version. */
    #tab(tab, { focus = false } = {}) {
        const from = this.pointTab
        this.pointTab = tab
        for (const v of ['home', 'stock', 'receive', 'send']) this.root.querySelector(`#lv-${v}`).hidden = tab !== v
        const home = tab === 'home'
        this.root.querySelector('.js-view-head').hidden = home
        const title = this.root.querySelector('.js-view-title')
        title.textContent = POINT_TITLES[tab].join('')
        window.scrollTo(0, 0)
        if (!focus) return
        if (home) this.root.querySelector(`.js-option[data-tab="${from}"]`)?.focus()
        else title.focus()
    }

    bind_point() {
        this.root.querySelectorAll('.js-option').forEach((b) => b.addEventListener('click', () => this.#tab(b.dataset.tab, { focus: true })))
        this.root.querySelector('.js-back').addEventListener('click', () => this.#tab('home', { focus: true }))
        this.#tab(this.pointTab ?? 'home')
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
        this.root.querySelectorAll('.js-filter').forEach((b) => b.addEventListener('click', () => (this.filter = applyFilter(this.root, this.store, b.dataset.filter, '.lite-row'))))
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
                <div class="lite-row is-${state.id}" data-item="${s.id}">
                    <span class="lite-row-text"><b>${esc(s.label)}</b><small><i class="stock-state" data-state="${state.id}">${state.label}</i> · ${q} de ${stockCap(s.id)}</small>
                        <span class="inv-meter" aria-hidden="true"><span class="inv-fill" style="width:${Math.round(Math.min(1, q / stockCap(s.id)) * 100)}%"></span></span></span>
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
            updateFilterCounts(this.root, st, Object.keys(SUPPLIES))
            applyFilter(this.root, st, this.filter ?? 'all', '.lite-row')
            this.board.mirror(this.point.id, st.stock)
        }
        const q = st.queue ?? {}
        const qKey = JSON.stringify(q)
        if (qKey === this.queueKey) return
        this.queueKey = qKey
        const waiting = (q.scheduled ?? []).length + (q.incoming ?? []).length + (q.toDeliver ?? []).length
        const badge = this.root.querySelector('.js-receive-badge')
        badge.hidden = !waiting
        badge.textContent = waiting
        const lists = this.root.querySelector('.js-pending-lists')
        lists.innerHTML = receiveLists(q)
        hydrateIcons(lists)
        const sent = this.root.querySelector('.js-sent-lists')
        sent.innerHTML = sentList(q)
        hydrateIcons(sent)
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

    /** Send to another point: the same sheet as the full version (see transferSheet.js). */
    #transfer() {
        transferSheet({
            host: document.body,
            extraClass: 'lite-overlay',
            point: this.point,
            store: this.store,
            board: this.board,
            toast: this.toast,
            onClose: () => this.root.querySelector('.js-transfer')?.focus(),
        })
    }
}
