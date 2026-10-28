import { icon } from './icons.js'
import { SUPPLIES, money } from '../data/catalog.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const itemsLine = (items) =>
    Object.entries(items ?? {})
        .filter(([id]) => SUPPLIES[id])
        .map(([id, n]) => `${n} × ${SUPPLIES[id].label}`)
        .join(', ')

/**
 * The end of a donation, shared by both versions: thanks first; then the ticket (the QR and
 * the code, which is what is shown at the point, with the way to follow it); then what comes
 * next, in one sentence; then what was given. The QR is drawn into `.js-qr` afterwards, and
 * the follow button carries both versions' hooks (`.js-track`, `.js-follow`).
 *
 * @param {{code: string, physical: boolean, place: string, slot?: string, items: object,
 *          value: number, offline?: boolean}} r
 */
export function doneHtml({ code, physical, place, slot = '', items, value, offline = false }) {
    const when = slot.replace(/\.$/, '')
    return `
        <div class="dd">
            <div class="dd-hero">
                <span class="dd-mark" aria-hidden="true">${icon('check')}</span>
                <h3>¡Gracias por tu apoyo!</h3>
                <p>${physical ? 'Tu entrega quedó agendada.' : 'Tu aporte quedó registrado.'}</p>
            </div>
            ${offline ? `<p class="done-offline">${icon('info')} Sin conexión en este momento: tu aporte quedó guardado en este dispositivo y se suma al inventario apenas vuelva la conexión.</p>` : ''}
            <div class="dd-ticket${physical ? '' : ' is-ref'}">
                ${physical ? `<div class="qr-img js-qr" role="img" aria-label="Código QR del aporte ${esc(code)}"></div>` : ''}
                <div class="dd-ticket-text">
                    <small>${physical ? 'Código de entrega' : 'Referencia'}</small>
                    <b class="dd-code">${esc(code)}</b>
                    <span>${physical ? 'Muestra este QR en el punto: al escanearlo, tu aporte queda recibido.' : 'Con este código puedes seguir tu aporte.'}</span>
                    <button class="btn btn-secondary js-track js-follow" type="button">${icon('search')} Seguir mi aporte</button>
                </div>
            </div>
            <div class="trk-next">${icon(physical ? 'pin' : 'box')}<div><b>${physical ? 'Llévalo al punto' : 'El equipo compra los insumos'}</b><span>${physical ? `${when ? `${esc(when)}, en ` : 'En '}${esc(place)}.` : `Los deja en ${esc(place)}; las familias los recogen allí.`}</span></div></div>
            <p class="dd-small">${esc(itemsLine(items))} · Valor equivalente ${money(value ?? 0)}${physical ? '' : ' · Pago de demostración'}</p>
        </div>`
}
