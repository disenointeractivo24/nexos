import gsap from 'gsap'
import { icon, hydrateIcons } from './icons.js'
import { SUPPLIES, money } from '../data/catalog.js'
import { COLLECTION_POINTS, directionsUrl } from '../data/collectionPoints.js'
import { ZONES } from '../data/zones.js'
import { ledger, readCode, trackUrl } from '../app/donations.js'
import { qrSvg, qrPng } from './qr.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const pointOf = (id) => COLLECTION_POINTS.find((p) => p.id === id)
const when = (iso) =>
    iso ? new Date(iso).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : ''
const short = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const itemsLine = (items) =>
    Object.entries(items ?? {})
        .filter(([id]) => SUPPLIES[id])
        .map(([id, n]) => `${n} × ${SUPPLIES[id].label}`)
        .join(', ')

/**
 * The way a donation or transfer goes, as three (or two) stops in a row: each with its icon,
 * its name and when it happened, the ones done filled in and the current one marked.
 */
function progress(steps, at) {
    return `
        <ol class="trk-steps" style="--n:${steps.length}">
            ${steps
                .map(
                    (s, i) => `
            <li class="${i < at ? 'is-done' : i === at ? 'is-done is-now' : ''}"${i === at ? ' aria-current="step"' : ''}>
                <span class="trk-dot" aria-hidden="true">${icon(i <= at ? (i === at ? s.icon : 'check') : s.icon)}</span>
                <b>${s.label}</b>
                <small>${i <= at && s.at ? esc(short(s.at)) : i <= at ? 'Listo' : 'Pendiente'}</small>
            </li>`
                )
                .join('')}
        </ol>`
}

/** What is happening now and what comes next, in one sentence the donor can act on. */
const nextBox = (ic, title, text) => `<div class="trk-next">${icon(ic)}<div><b>${title}</b><span>${text}</span></div></div>`

/** What each state is called: the same words the collection point sees. */
const STATE_WORD = { Agendado: 'Agendado', Recibido: 'Recibido', Entregado: 'Entregado', 'En camino': 'En camino', Cancelado: 'Cancelado' }

/**
 * "¿Dónde está mi ayuda?": follow a donation (or a transfer) by its code.
 *
 * Opens from the first screen, from the end of a donation, and from the link in a
 * donation's QR (?aporte=NX-…). The donations made on this device are listed, so
 * nobody has to keep the code. A donation still waiting to be taken to the point
 * shows its QR and the way there.
 */
export class TrackView {
    constructor(root, { reducedMotion = false, audio = null } = {}) {
        this.root = root
        this.card = root.querySelector('.track-card')
        this.reducedMotion = reducedMotion
        this.audio = audio
        root.addEventListener('pointerdown', (e) => e.target === root && this.close())
        root.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                this.close()
            }
            if (e.key === 'Tab') this.#trap(e)
        })
    }

    get open() {
        return !this.root.hidden
    }

    /** @param code optional: look this one up straight away */
    show(code = null) {
        this.returnFocus = document.activeElement
        this.root.hidden = false
        this.#render()
        gsap.fromTo(this.card, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: this.reducedMotion ? 0.01 : 0.35, ease: 'power2.out' })
        gsap.fromTo(this.root, { opacity: 0 }, { opacity: 1, duration: this.reducedMotion ? 0.01 : 0.25 })
        if (code) this.#find(code)
        else this.card.querySelector('input')?.focus()
    }

    close() {
        if (!this.open) return
        gsap.to(this.root, {
            opacity: 0,
            duration: this.reducedMotion ? 0.01 : 0.2,
            onComplete: () => {
                this.root.hidden = true
                this.card.innerHTML = ''
                this.returnFocus?.focus?.({ preventScroll: true })
            },
        })
        // the link that opened this page should not reopen it on a reload
        if (new URLSearchParams(location.search).has('aporte')) {
            const url = new URL(location.href)
            url.searchParams.delete('aporte')
            history.replaceState(null, '', url)
        }
    }

    #render() {
        this.card.innerHTML = `
            <div class="track-head">
                <span class="track-mark">${icon('search')}</span>
                <div class="track-title">
                    <h2 id="track-title">¿Dónde está mi ayuda?</h2>
                    <p class="sub">Sigue tu aporte desde que lo confirmas hasta que llega a las familias.</p>
                </div>
                <button class="icon-btn js-close" type="button" aria-label="Cerrar" title="Cerrar">${icon('x')}</button>
            </div>
            <form class="track-form" novalidate>
                <label class="field">
                    <span class="field-label">Código del aporte</span>
                    <span class="track-search">
                        <input name="code" type="text" placeholder="NX-…" autocapitalize="characters" autocomplete="off" spellcheck="false" inputmode="text">
                        <button class="btn btn-primary" type="submit">${icon('search')} Buscar</button>
                    </span>
                </label>
                <p class="form-error js-error" role="alert" hidden></p>
            </form>
            <div class="track-result js-result" aria-live="polite"></div>
            <div class="track-mine js-mine"></div>`
        hydrateIcons(this.card)
        this.card.querySelector('.js-close').addEventListener('click', () => this.close())
        this.card.querySelector('form').addEventListener('submit', (e) => {
            e.preventDefault()
            this.#find(this.card.querySelector('input').value)
        })
        this.#mine()
    }

    /** The donations made on this device: one tap to follow any of them. */
    #mine() {
        const list = ledger.mine().filter((r) => !r.foreign).slice(0, 6)
        const el = this.card.querySelector('.js-mine')
        if (!list.length) {
            el.innerHTML = ''
            return
        }
        el.innerHTML = `
            <h3 class="trk-mine-title">${icon('heart')} Tus aportes en este dispositivo</h3>
            <ul class="mine-list">
                ${list
                    .map(
                        (r) => `
                    <li><button type="button" class="mine-row" data-code="${esc(r.code)}">
                        <span class="mine-text"><b>${esc(r.code)}</b><span>${esc(itemsLine(r.items))}</span></span>
                        <span class="state-pill" data-state="${esc(r.state)}">${esc(STATE_WORD[r.state] ?? r.state)}</span>
                    </button></li>`
                    )
                    .join('')}
            </ul>`
        hydrateIcons(el)
        el.querySelectorAll('.mine-row').forEach((b) => b.addEventListener('click', () => this.#find(b.dataset.code)))
    }

    async #find(text) {
        const err = this.card.querySelector('.js-error')
        const out = this.card.querySelector('.js-result')
        const input = this.card.querySelector('input')
        const code = readCode(text)
        err.hidden = true
        if (!code) {
            err.textContent = 'Escribe el código tal como aparece en tu comprobante, por ejemplo NX-7K3P9Q.'
            err.hidden = false
            input.focus()
            this.audio?.play('error')
            return
        }
        input.value = code
        out.innerHTML = `<p class="track-loading" role="status">${icon('refresh')} Buscando ${esc(code)}…</p>`
        hydrateIcons(out)
        const data = await ledger.lookup(code)
        if (!this.open) return
        if (!data.ok) {
            out.innerHTML = ''
            err.textContent = data.offline
                ? 'Sin conexión en este momento. Inténtalo de nuevo en un rato.'
                : `No encontramos el código ${code}. Revísalo: son las letras NX, un guion y seis letras o números.`
            err.hidden = false
            this.audio?.play('error')
            return
        }
        this.lastCode = code
        out.innerHTML = data.transfer ? this.#transfer(data.transfer) : await this.#donation(data.record, data)
        hydrateIcons(out)
        out.querySelector('.js-refresh')?.addEventListener('click', () => this.#find(code))
        // cancelling asks once more, right where the button was
        out.querySelector('.js-cancel')?.addEventListener('click', () => {
            out.querySelector('.js-cancel-ask').hidden = false
            out.querySelector('.js-cancel').hidden = true
            out.querySelector('.js-cancel-no').focus()
        })
        out.querySelector('.js-cancel-no')?.addEventListener('click', () => {
            out.querySelector('.js-cancel-ask').hidden = true
            out.querySelector('.js-cancel').hidden = false
            out.querySelector('.js-cancel').focus()
        })
        out.querySelector('.js-cancel-yes')?.addEventListener('click', async (e) => {
            e.currentTarget.disabled = true
            e.currentTarget.textContent = 'Cancelando…'
            const res = await ledger.cancel(code)
            if (!res.ok) {
                this.audio?.play('error')
                const err = this.card.querySelector('.js-error')
                err.textContent = res.error
                err.hidden = false
                return this.#find(code)
            }
            this.audio?.play('tap')
            this.#find(code)
        })
        out.querySelector('.js-save-qr')?.addEventListener('click', async () => {
            const a = document.createElement('a')
            a.href = await qrPng(trackUrl(code))
            a.download = `aporte-${code}.png`
            a.click()
        })
        this.#mine()
        gsap.fromTo(out, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: this.reducedMotion ? 0.01 : 0.3 })
    }

    /**
     * A donation: where it is on its way (agendado, in the point, with the families) and what
     * to do next first; then the QR when it still has to be taken to the point, since that is
     * what the donor needs there; then the point and what was given, side by side.
     */
    async #donation(r, { pending, offline, unsupported }) {
        const p = pointOf(r.point)
        const zone = ZONES.find((z) => z.id === p?.zone)
        const physical = r.mode !== 'money'
        const order = ['Agendado', 'Recibido', 'Entregado']
        const cancelled = r.state === 'Cancelado'
        const at = cancelled ? 0 : Math.max(0, order.indexOf(r.state))
        const steps = physical
            ? [
                  { label: 'Agendado', icon: 'calendar', at: r.at },
                  { label: 'En el punto', icon: 'box', at: r.receivedAt },
                  { label: 'Con las familias', icon: 'home', at: r.deliveredAt },
              ]
            : [
                  { label: 'Confirmado', icon: 'card', at: r.at },
                  { label: 'En el punto', icon: 'box', at: r.receivedAt },
                  { label: 'Con las familias', icon: 'home', at: r.deliveredAt },
              ]
        const place = esc(p?.name ?? r.point)
        const next = cancelled
            ? nextBox('x', 'Cancelaste esta entrega', 'El punto ya no la espera.')
            : at === 2
              ? nextBox('heart', '¡Llegó a las familias!', `Gracias: tu aporte ya está con las familias${zone ? ` de ${esc(zone.name)}` : ''}.`)
              : at === 1
                ? nextBox('box', physical ? 'Ya está en el punto' : 'El equipo dejó los insumos en el punto', 'Las familias lo recogen allí; cuando lo hagan, aparece aquí como entregado.')
                : physical
                  ? nextBox('pin', 'Llévalo al punto', `${r.slot ? `${esc(r.slot.replace(/\.$/, ''))}, en ` : 'En '}${place}. Muestra el QR de abajo o di tu código.`)
                  : nextBox('box', 'El equipo está comprando los insumos', `Los deja en ${place}.`)
        const qr = physical && r.state === 'Agendado' ? await qrSvg(trackUrl(r.code)) : ''
        const canCancel = physical && r.state === 'Agendado' && !pending
        return `
            <section class="trk-status${cancelled ? ' is-cancelled' : ''}">
                <div class="track-card-head">
                    <span class="trk-code"><small>Código</small><b class="track-code">${esc(r.code)}</b></span>
                    <span class="state-pill" data-state="${esc(r.state)}">${esc(STATE_WORD[r.state] ?? r.state)}</span>
                </div>
                ${cancelled ? '' : progress(steps, at)}
                ${next}
            </section>
            ${pending || offline || unsupported ? `<p class="done-offline">${icon('info')} ${unsupported ? 'El seguimiento todavía no está activo en la hoja de los puntos: esto es lo que guardó este dispositivo.' : pending ? 'Tu aporte está guardado en este dispositivo y llegará a la hoja apenas haya conexión.' : 'Sin conexión: esto es lo último que sabemos.'}</p>` : ''}
            ${qr
                ? `<div class="qr-box">
                    <div class="qr-img" role="img" aria-label="Código QR del aporte ${esc(r.code)}">${qr}</div>
                    <div class="qr-text"><b>Muéstralo en el punto</b><span>Al escanearlo, tu aporte queda recibido y se suma al inventario.</span>
                    <button class="btn btn-secondary js-save-qr" type="button">${icon('download')} Guardar QR</button></div>
                </div>`
                : ''}
            <div class="trk-info">
                <div class="info-block">${icon('pin')}<div><span class="info-label">Punto de acopio</span><b>${place}</b><span>${esc(p?.address ?? '')}${zone ? ` · ${esc(zone.name)}` : ''}</span>${p ? `<span>Atiende ${esc(p.hours)}</span><a href="${directionsUrl(p)}" target="_blank" rel="noopener">Cómo llegar ${icon('chevron-right')}</a>` : ''}</div></div>
                <div class="info-block">${icon('basket')}<div><span class="info-label">${physical ? 'Qué llevas' : 'Qué compra tu aporte'}</span><b>${esc(itemsLine(r.items))}</b><span>Valor equivalente: ${money(r.value ?? 0)}</span><span>Confirmado el ${esc(when(r.at))}</span></div></div>
            </div>
            <div class="track-actions">
                ${canCancel
                    ? `<button class="btn btn-secondary btn-danger-text js-cancel" type="button">${icon('x')} Cancelar entrega</button>
                       <span class="track-ask js-cancel-ask" hidden>¿Cancelar esta entrega? El punto ya no la esperará.
                         <button class="btn btn-secondary js-cancel-no" type="button">No, mantener</button>
                         <button class="btn btn-danger js-cancel-yes" type="button">Sí, cancelar</button></span>`
                    : ''}
                <button class="btn btn-secondary js-refresh" type="button">${icon('refresh')} Actualizar</button>
            </div>`
    }

    /** A transfer between two points: sent, then received, in the same row of stops. */
    #transfer(t) {
        const from = pointOf(t.from)
        const to = pointOf(t.to)
        const done = t.state === 'Recibido'
        const name = (p, id) => esc(p?.name.replace('Punto de acopio ', '') ?? id)
        if (t.state === 'Cancelado') {
            return `
            <section class="trk-status is-cancelled">
                <div class="track-card-head"><span class="trk-code"><small>Traslado</small><b class="track-code">${esc(t.code)}</b></span><span class="state-pill" data-state="Cancelado">Cancelado</span></div>
                ${nextBox('x', 'Traslado anulado', `${name(from, t.from)} lo anuló: los insumos volvieron a su inventario.`)}
            </section>
            <div class="info-block">${icon('truck')}<div><span class="info-label">Qué se iba a enviar</span><b>${esc(itemsLine(t.items))}</b></div></div>`
        }
        return `
            <section class="trk-status">
                <div class="track-card-head">
                    <span class="trk-code"><small>Traslado</small><b class="track-code">${esc(t.code)}</b></span>
                    <span class="state-pill" data-state="${esc(t.state)}">${esc(STATE_WORD[t.state] ?? t.state)}</span>
                </div>
                ${progress(
                    [
                        { label: `Sale de ${name(from, t.from)}`, icon: 'truck', at: t.at },
                        { label: `Llega a ${name(to, t.to)}`, icon: 'box', at: t.receivedAt },
                    ],
                    done ? 1 : 0
                )}
                ${done ? nextBox('check', 'Traslado recibido', 'Los insumos ya están en el inventario del otro punto.') : nextBox('truck', 'En camino', 'Aparece como recibido cuando el otro punto confirme que llegó.')}
            </section>
            <div class="info-block">${icon('truck')}<div><span class="info-label">Qué se envió</span><b>${esc(itemsLine(t.items))}</b></div></div>
            <div class="track-actions"><button class="btn btn-secondary js-refresh" type="button">${icon('refresh')} Actualizar</button></div>`
    }

    #trap(e) {
        const f = [...this.card.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent)
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
        }
    }
}
