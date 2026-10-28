import { icon } from './icons.js'
import { SUPPLIES } from '../data/catalog.js'
import { COLLECTION_POINTS } from '../data/collectionPoints.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const pointName = (id) => COLLECTION_POINTS.find((p) => p.id === id)?.name.replace('Punto de acopio ', '') ?? id
const itemsLine = (it) =>
    Object.entries(it ?? {})
        .filter(([id]) => SUPPLIES[id])
        .map(([id, n]) => `${n} × ${SUPPLIES[id].label}`)
        .join(', ')

/**
 * The two ways something arrives at a point, side by side: the camera reads the donor's QR,
 * or the code is typed. The form keeps the classes the panels look for (.js-scan,
 * .js-receive-form, .js-receive-error). Used by the full and the light version alike.
 */
export function receiveWays(inputId) {
    return `
        <div class="rcv-ways">
            <button class="rcv-scan js-scan" type="button">
                <span class="rcv-scan-icon" aria-hidden="true">${icon('camera')}</span>
                <span class="rcv-scan-text"><b>Escanear QR</b><small>Apunta la cámara al código que trae el donante</small></span>
            </button>
            <form class="rcv-code pending-form js-receive-form" novalidate>
                <label class="rcv-code-label" for="${inputId}"><b>¿No trae QR?</b> Escribe el código</label>
                <div class="rcv-code-row">
                    <input id="${inputId}" name="code" type="text" placeholder="NX-… o TR-…" autocapitalize="characters" autocomplete="off" spellcheck="false">
                    <button class="btn btn-secondary" type="submit">Recibir</button>
                </div>
                <p class="form-error js-receive-error" role="alert" hidden></p>
            </form>
        </div>`
}

/** One donation or transfer: what it is, its code, what it carries, and the one thing to do with it. */
function row({ kind, ic, label, x, when = '', action = null, button = '' }) {
    return `
        <li class="rcv-row">
            <span class="rcv-row-icon is-${kind}" aria-hidden="true">${icon(ic)}</span>
            <span class="rcv-row-text">
                <small class="rcv-row-kind">${esc(label)}</small>
                <b>${esc(x.code)}</b>
                <span class="rcv-row-items">${esc(itemsLine(x.items))}</span>
                ${when ? `<small class="rcv-row-when">${icon('clock')}${esc(when)}</small>` : ''}
            </span>
            ${action ? `<button class="btn ${action === 'deliver' ? 'rcv-done' : 'btn-primary'} rcv-row-btn" type="button" data-action="${action}" data-code="${esc(x.code)}">${button}</button>` : ''}
        </li>`
}

function group({ ic, title, hint, rows, empty }) {
    return `
        <section class="rcv-group">
            <h3 class="rcv-group-title"><span class="rcv-group-icon" aria-hidden="true">${icon(ic)}</span>${title}${rows.length ? `<span class="rcv-count">${rows.length}</span>` : ''}</h3>
            <p class="rcv-group-hint">${hint}</p>
            ${rows.length ? `<ul class="rcv-list">${rows.join('')}</ul>` : `<p class="rcv-empty">${icon('check')}<span>${empty}</span></p>`}
        </section>`
}

/** What waits at the point: what is on its way in, and what is ready for the families. */
export function receiveLists(q = {}) {
    return (
        group({
            ic: 'box',
            title: 'Por recibir',
            hint: 'Aportes agendados y traslados que vienen a tu punto. Toca <b>Recibir</b> cuando lleguen.',
            rows: [
                ...(q.scheduled ?? []).map((d) => row({ kind: 'donation', ic: 'heart', label: 'Donación agendada', x: d, when: d.slot, action: 'receive', button: 'Recibir' })),
                ...(q.incoming ?? []).map((t) => row({ kind: 'transfer', ic: 'truck', label: `Traslado desde ${pointName(t.from)}`, x: t, action: 'receive', button: 'Recibir' })),
            ],
            empty: 'Nada por recibir. Cuando un donante agende una entrega o te envíen un traslado, aparece aquí.',
        }) +
        group({
            ic: 'home',
            title: 'Por entregar a las familias',
            hint: 'Lo que ya está en el punto. Toca <b>Entregado</b> cuando las familias lo recojan.',
            rows: (q.toDeliver ?? []).map((d) =>
                row({ kind: 'family', ic: 'home', label: d.mode === 'money' ? 'Aporte en dinero · comprado por el equipo' : 'Recibido en el punto', x: d, action: 'deliver', button: `${icon('check')} Entregado` })
            ),
            empty: 'Todo lo recibido ya se entregó.',
        })
    )
}

/** The transfers this point sent that are still on the road. */
export function sentList(q = {}) {
    return group({
        ic: 'truck',
        title: 'Traslados en camino',
        hint: 'Salieron de tu inventario y entran en el del otro punto cuando lo reciba.',
        rows: (q.outgoing ?? []).map((t) => row({ kind: 'transfer', ic: 'truck', label: `En camino a ${pointName(t.to)}`, x: t })),
        empty: 'No tienes traslados en camino.',
    })
}
