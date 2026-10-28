import { icon, hydrateIcons } from './icons.js'
import { busyButton } from './feedback.js'
import { SUPPLIES } from '../data/catalog.js'
import { stockCap } from '../data/inventory.js'
import { ZONES } from '../data/zones.js'
import { COLLECTION_POINTS } from '../data/collectionPoints.js'
import { ledger } from '../app/donations.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const zoneOf = (p) => ZONES.find((z) => z.id === p.zone)
const place = (p) => p.name.replace('Punto de acopio ', '')
const ORDER = { critico: 0, estable: 1, abastecido: 2 }

/**
 * Send supplies to another point, in two screens: first where and what, then a review that
 * only sends on "Confirmar envío". Used by the full and the light version alike.
 *
 * Every quantity starts at 0: the person adds what they want to send. The point where this
 * point's spare stock does most good is marked (its crítico supplies count three times) and
 * chosen first, and each supply offers a suggestion to tap: just enough to bring the other
 * point up to abastecido, never more than this one can spare (it keeps half of its cap).
 * It all leaves this stock now, and enters the other point's when that point receives it.
 *
 * @param {{host: HTMLElement, point: object, store: object, board: object, toast?: object,
 *          audio?: object, extraClass?: string, onClose?: () => void}} o
 */
export function transferSheet({ host, point, store, board, toast = null, audio = null, extraClass = '', onClose = () => {} }) {
    const play = (s) => audio?.play(s)
    if (!store.ready || !board) return play('error')
    play('tap')
    const me = point.id
    const others = COLLECTION_POINTS.filter((p) => p.id !== me)
    const mine = (id) => store.get(id)
    const spare = (id) => Math.max(0, mine(id) - Math.ceil(stockCap(id) * 0.5))
    const toStocked = (p, id) => Math.max(0, Math.ceil(stockCap(id) * 0.75) - board.qty(p.id, id))
    const suggest = (p, id) => (board.state(p.id, id).id === 'abastecido' ? 0 : Math.min(spare(id), toStocked(p, id)))
    const criticalOf = (p) => Object.keys(SUPPLIES).filter((id) => board.state(p.id, id).id === 'critico')
    const helps = (p) => Object.keys(SUPPLIES).reduce((n, id) => n + suggest(p, id) * (board.state(p.id, id).id === 'critico' ? 3 : 1), 0)
    const best = [...others].sort((a, b) => helps(b) - helps(a) || criticalOf(b).length - criticalOf(a).length)[0]
    let dest = best
    const qty = {}
    const picked = () => Object.entries(qty).filter(([, n]) => n > 0)
    const units = (n) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`

    const sheet = document.createElement('div')
    sheet.className = `xfer-sheet ${extraClass}`.trim()
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-labelledby', 'xfer-title')
    host.appendChild(sheet)
    // the board grows to its full height while the sheet covers it (style.css)
    host.classList.add('has-xfer')
    const close = () => {
        sheet.remove()
        host.classList.remove('has-xfer')
        onClose()
    }
    sheet.addEventListener('keydown', (e) => e.key === 'Escape' && close())
    sheet.addEventListener('click', (e) => e.target.closest('.js-xfer-close') && close())

    const head = (title, sub, back = false) => `
        <div class="xfer-head">
            ${back ? `<button class="icon-btn js-xfer-back" type="button" aria-label="Volver a elegir" title="Volver">${icon('chevron-left')}</button>` : `<span class="xfer-mark" aria-hidden="true">${icon('truck')}</span>`}
            <div class="xfer-title"><h3 id="xfer-title" tabindex="-1">${title}</h3><p class="sub">${sub}</p></div>
            <button class="icon-btn js-xfer-close" type="button" aria-label="Cerrar" title="Cerrar">${icon('x')}</button>
        </div>`

    /* ---------------- 1 · where and what ---------------- */

    const destCard = (p) => {
        const z = zoneOf(p)
        const crit = criticalOf(p)
        return `
            <label class="xfer-point" style="--zone:${z?.color ?? '#011E41'}">
                <input type="radio" name="xfer-dest" value="${p.id}" ${p.id === dest.id ? 'checked' : ''}>
                <span class="xfer-point-dot" aria-hidden="true"></span>
                <span class="xfer-point-text">
                    <b>${esc(z?.name ?? '')}${p.id === best.id && helps(best) > 0 ? '<i class="xfer-tag">Más lo necesita</i>' : ''}</b>
                    <small>${esc(place(p))}</small>
                    <span class="xfer-point-need ${crit.length ? 'is-critical' : ''}">${
                        crit.length ? `Le falta: ${crit.map((id) => esc(SUPPLIES[id].label)).join(', ')}` : 'No le falta nada crítico'
                    }</span>
                </span>
            </label>`
    }

    const itemCard = (s) => {
        const st = board.state(dest.id, s.id)
        const sug = suggest(dest, s.id)
        const n = qty[s.id] ?? 0
        return `
            <div class="xfer-item ${n ? 'is-picked' : ''}" data-item="${s.id}">
                <div class="xfer-item-info">
                    <b>${esc(s.label)}</b>
                    <span class="xfer-item-meta">Tienes ${mine(s.id)} · allá <i class="stock-state" data-state="${st.id}">${st.label}</i></span>
                    ${sug ? `<button class="xfer-suggest js-suggest" type="button" data-n="${sug}">${icon('check')} Sugerido: ${sug}</button>` : ''}
                </div>
                <div class="xfer-stepper" role="group" aria-label="Unidades de ${esc(s.label)} para enviar">
                    <button class="js-minus" type="button" aria-label="Quitar una unidad de ${esc(s.label)}" ${n <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
                    <input class="js-xfer-qty" type="number" inputmode="numeric" min="0" max="${mine(s.id)}" step="1" value="${n}" aria-label="Unidades de ${esc(s.label)} para enviar, de ${mine(s.id)}">
                    <button class="js-plus" type="button" aria-label="Agregar una unidad de ${esc(s.label)}" ${n >= mine(s.id) ? 'disabled' : ''}>${icon('plus')}</button>
                </div>
            </div>`
    }

    const drawItems = () => {
        // what the other point lacks most comes first
        const list = Object.values(SUPPLIES)
            .filter((s) => mine(s.id) > 0)
            .sort((a, b) => ORDER[board.state(dest.id, a.id).id] - ORDER[board.state(dest.id, b.id).id] || a.label.localeCompare(b.label, 'es'))
        const box = sheet.querySelector('.js-xfer-items')
        box.innerHTML = list.length ? list.map(itemCard).join('') : '<p class="pend-empty">Tu punto no tiene insumos para enviar.</p>'
        hydrateIcons(box)
        for (const card of box.querySelectorAll('.xfer-item')) {
            const id = card.dataset.item
            const input = card.querySelector('.js-xfer-qty')
            card.querySelector('.js-minus').addEventListener('click', () => setQty(card, id, (qty[id] ?? 0) - 1))
            card.querySelector('.js-plus').addEventListener('click', () => setQty(card, id, (qty[id] ?? 0) + 1))
            card.querySelector('.js-suggest')?.addEventListener('click', (e) => setQty(card, id, Number(e.currentTarget.dataset.n)))
            input.addEventListener('focus', () => input.select())
            input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur())
            input.addEventListener('input', () => setQty(card, id, Math.round(Number(input.value) || 0), { typing: true }))
            input.addEventListener('blur', () => (input.value = qty[id] ?? 0))
        }
        total()
    }

    const setQty = (card, id, n, { typing = false } = {}) => {
        const v = Math.max(0, Math.min(mine(id), n))
        const before = qty[id] ?? 0
        qty[id] = v
        const input = card.querySelector('.js-xfer-qty')
        if (!typing || Number(input.value) !== v) input.value = v
        card.querySelector('.js-minus').disabled = v <= 0
        card.querySelector('.js-plus').disabled = v >= mine(id)
        card.classList.toggle('is-picked', v > 0)
        if (!typing) play(v > before ? 'add' : v < before ? 'remove' : 'error')
        total()
    }

    const total = () => {
        const list = picked()
        const n = list.reduce((a, [, k]) => a + k, 0)
        const out = sheet.querySelector('.js-xfer-total')
        if (!out) return
        out.innerHTML = n
            ? `<b>${units(n)}</b> de ${list.length} ${list.length === 1 ? 'insumo' : 'insumos'} para <b>${esc(zoneOf(dest)?.name ?? '')}</b>`
            : 'Aún no has agregado insumos'
        sheet.querySelector('.js-xfer-next').disabled = !n
    }

    const showPick = ({ focus = 'dest' } = {}) => {
        sheet.innerHTML = `
            ${head('Enviar a otro punto', `Desde ${esc(place(point))}`)}
            <div class="xfer-body">
                <section class="xfer-section">
                    <h4 class="xfer-step"><span>1</span>¿A qué punto lo envías?</h4>
                    <div class="xfer-dest" role="radiogroup" aria-label="Punto que recibe">${others.map(destCard).join('')}</div>
                </section>
                <section class="xfer-section">
                    <h4 class="xfer-step"><span>2</span>¿Qué le envías?</h4>
                    <p class="xfer-hint">Todo empieza en 0. Suma con <b>+</b>, escribe la cantidad o toca <b>Sugerido</b>.</p>
                    <div class="xfer-items js-xfer-items"></div>
                </section>
            </div>
            <div class="xfer-foot">
                <p class="xfer-total js-xfer-total" aria-live="polite"></p>
                <button class="btn btn-secondary js-xfer-close" type="button">Cancelar</button>
                <button class="btn btn-primary js-xfer-next" type="button">Revisar envío ${icon('chevron-right')}</button>
            </div>`
        hydrateIcons(sheet)
        sheet.querySelectorAll('input[name="xfer-dest"]').forEach((r) =>
            r.addEventListener('change', () => {
                dest = others.find((p) => p.id === r.value)
                play('tap')
                // what was picked stays: it depends on this point's stock, not on the other's
                drawItems()
            })
        )
        sheet.querySelector('.js-xfer-next').addEventListener('click', showReview)
        drawItems()
        // focus without scrolling: the sheet opens at its top, on step 1
        if (focus === 'next') sheet.querySelector('.js-xfer-next').focus()
        else sheet.querySelector('input[name="xfer-dest"]:checked')?.focus({ preventScroll: true })
    }

    /* ---------------- 2 · review, then send ---------------- */

    const showReview = () => {
        const items = Object.fromEntries(picked())
        if (!Object.keys(items).length) return play('error')
        play('tap')
        const from = zoneOf(point)
        const to = zoneOf(dest)
        const n = Object.values(items).reduce((a, b) => a + b, 0)
        sheet.innerHTML = `
            ${head('Revisa el envío', 'Confirma solo si todo está bien', true)}
            <div class="xfer-body">
                <div class="xfer-route">
                    <div class="xfer-end" style="--zone:${from?.color ?? '#011E41'}"><small>Desde</small><b>${esc(from?.name ?? '')}</b><span>${esc(place(point))}</span></div>
                    <span class="xfer-arrow" aria-hidden="true">${icon('truck')}</span>
                    <div class="xfer-end" style="--zone:${to?.color ?? '#011E41'}"><small>Hacia</small><b>${esc(to?.name ?? '')}</b><span>${esc(place(dest))}</span></div>
                </div>
                <ul class="xfer-list" aria-label="Lo que se envía">${Object.entries(items)
                    .map(([id, k]) => `<li><span class="xfer-list-n">${k}</span><span class="xfer-list-name">${esc(SUPPLIES[id].label)}<small>Te quedan ${mine(id) - k}</small></span></li>`)
                    .join('')}</ul>
                <p class="xfer-note">${icon('info')}<span>Sale de tu inventario ahora y entra en el de ${esc(to?.name ?? '')} cuando lo reciban. Mientras siga en camino, puedes anularlo.</span></p>
                <p class="form-error js-xfer-error" role="alert" hidden></p>
            </div>
            <div class="xfer-foot">
                <p class="xfer-total"><b>${units(n)}</b> en total</p>
                <button class="btn btn-secondary js-xfer-back" type="button">${icon('chevron-left')} Cambiar</button>
                <button class="btn btn-primary js-xfer-confirm" type="button">${icon('truck')} Confirmar envío</button>
            </div>`
        hydrateIcons(sheet)
        sheet.querySelectorAll('.js-xfer-back').forEach((b) =>
            b.addEventListener('click', () => {
                play('tap')
                showPick({ focus: 'next' })
            })
        )
        sheet.querySelector('.js-xfer-confirm').focus()
        sheet.querySelector('.js-xfer-confirm').addEventListener('click', async (e) => {
            const busy = busyButton(e.currentTarget, 'Enviando…')
            const out = await ledger.transfer(me, dest.id, items)
            busy()
            if (!out.ok) {
                play('error')
                const err = sheet.querySelector('.js-xfer-error')
                err.textContent = out.error
                err.hidden = false
                return
            }
            close()
            play('confirm')
            const tcode = out.transfer.code
            toast?.show(`Traslado <b>${tcode}</b> en camino a ${esc(to?.name ?? '')}.`, {
                duration: 7000,
                action: 'Deshacer',
                onAction: async () => {
                    const back = await ledger.transferCancel(tcode, me)
                    if (!back.ok) return toast.show(esc(back.error), { duration: 4500 })
                    play('remove')
                    toast.show(`Se anuló <b>${tcode}</b>: los insumos volvieron a tu inventario.`, { duration: 3500 })
                    if (back.rows) store.take(back.rows)
                },
            })
            if (out.rows) store.take(out.rows)
        })
    }

    showPick()
}
