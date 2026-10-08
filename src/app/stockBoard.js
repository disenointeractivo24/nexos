import { SUPPLIES } from '../data/catalog.js'
import { COLLECTION_POINTS, pointForZone } from '../data/collectionPoints.js'
import { stockCap, stockState } from '../data/inventory.js'
import { sheetsEndpoint, readLocalStock, writeLocalStock, loadQueue, saveQueue, beacon, HIDDEN_POLL_MS } from './inventoryStore.js'

/**
 * What every collection point holds, as donors see it.
 *
 * The map, the zone card and the donor panel all read from here, and here
 * reads the same Google Sheet the collection points write to (one call for
 * every point, polled), so what a donor is told a barrio needs is exactly the
 * sheet: tope − cantidad, item by item, and "urgente" is whatever the sheet
 * has in crítico.
 *
 * A confirmed donation is added to the point's stock and written back, so the
 * point's own board, the sheet and the next donor all see it at once.
 *
 * Without a sheet it reads the same browser storage the point's board writes,
 * so a demo on one device still agrees with itself.
 */

const POLL_MS = 7000
/** Donations the sheet has not confirmed yet: { point: { item: { qty, at } } } */
const QUEUE = 'nexos.pending.donations'
const QUICK_RETRY_MS = 3000
const RETRY_MS = 20000

export class StockBoard {
    constructor({ endpoint = sheetsEndpoint() } = {}) {
        this.endpoint = endpoint
        this.points = {}
        for (const p of COLLECTION_POINTS) this.points[p.id] = readLocalStock(p.id)
        this.edits = {} // "point:item" → local changes, to spot answers that arrive late
        this.pending = new Map() // point → Map(item → qty) waiting to be written
        this.pendingAt = new Map() // "point:item" → when that change was made
        this.inflight = null // { point, items: Map(item → { qty, at }) } of the push in flight
        this.pushing = null
        // donations the sheet never confirmed last time (a closed tab, a dropped connection)
        if (endpoint) {
            for (const [pointId, items] of Object.entries(loadQueue(QUEUE))) {
                if (!this.points[pointId]) continue
                for (const [item, e] of Object.entries(items ?? {})) {
                    if (!SUPPLIES[item]) continue
                    if (!this.pending.has(pointId)) this.pending.set(pointId, new Map())
                    const qty = clamp(item, e?.qty)
                    this.pending.get(pointId).set(item, qty)
                    this.pendingAt.set(`${pointId}:${item}`, Number(e?.at) || 0)
                    this.points[pointId][item] = qty
                }
            }
        }
        this.listeners = new Set()
        this.status = endpoint ? 'sync' : 'local'
        this.failures = 0
        this.stopped = true
    }

    on(fn) {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    }

    #emit() {
        for (const fn of this.listeners) fn(this)
    }

    /* ---------------- reading ---------------- */

    pointOf(zoneId) {
        return pointForZone(zoneId)?.id ?? null
    }

    qty(pointId, itemId) {
        return this.points[pointId]?.[itemId] ?? 0
    }

    /** How many more units the point needs to be full: what a donor can bring. */
    need(pointId, itemId) {
        return Math.max(0, stockCap(itemId) - this.qty(pointId, itemId))
    }

    state(pointId, itemId) {
        return stockState(itemId, this.qty(pointId, itemId))
    }

    /** By zone, for the map and the donor panel (a barrio's id is its zone's id). */
    isCritical(zoneId, itemId) {
        const p = this.pointOf(zoneId)
        return !!p && this.state(p, itemId).id === 'critico'
    }

    criticalCount(zoneId) {
        return Object.keys(SUPPLIES).filter((id) => this.isCritical(zoneId, id)).length
    }

    /* ---------------- polling ---------------- */

    async start() {
        this.stopped = false
        if (!this.endpoint) {
            // no sheet: re-read this browser's boards, which a point may have just updated
            for (const p of COLLECTION_POINTS) this.points[p.id] = readLocalStock(p.id)
            this.#emit()
            return
        }
        this.#watchPage()
        if (this.pending.size) await this.#reconcileQueued()
        await this.refresh()
        this.#loop()
    }

    stop() {
        this.stopped = true
        clearTimeout(this.timer)
        clearTimeout(this.pushTimer)
        this.timer = this.pushTimer = null
        document.removeEventListener('visibilitychange', this.onVisible)
        window.removeEventListener('pagehide', this.onLeave)
        this.onVisible = this.onLeave = null
    }

    /** Back in front: read now. Leaving: send what is still waiting. */
    #watchPage() {
        if (this.onVisible) return
        this.onVisible = () => {
            if (document.hidden || this.stopped) return
            this.refresh().then(() => this.#loop())
        }
        this.onLeave = () => {
            for (const [pointId, items] of Object.entries(this.#unconfirmed())) {
                beacon(this.endpoint, pointId, Object.entries(items).map(([item, e]) => ({ item, qty: e.qty })))
            }
        }
        document.addEventListener('visibilitychange', this.onVisible)
        window.addEventListener('pagehide', this.onLeave)
    }

    /** { point: { item: { qty, at } } } of everything not confirmed yet. */
    #unconfirmed() {
        const out = {}
        if (this.inflight) out[this.inflight.point] = Object.fromEntries(this.inflight.items)
        for (const [pointId, items] of this.pending) {
            out[pointId] ??= {}
            for (const [item, qty] of items) out[pointId][item] = { qty, at: this.pendingAt.get(`${pointId}:${item}`) ?? Date.now() }
        }
        return out
    }

    #persist() {
        saveQueue(QUEUE, this.#unconfirmed())
    }

    /** Before sending what was left from last time, drop whatever was changed in the sheet after it. */
    async #reconcileQueued() {
        try {
            const data = await json(await fetch(this.#url('action=all')))
            if (!data?.ok || !data.points) return
            for (const [pointId, rows] of Object.entries(data.points)) {
                const items = this.pending.get(pointId)
                if (!items || !Array.isArray(rows)) continue
                for (const row of rows) {
                    if (!items.has(row.item)) continue
                    const k = `${pointId}:${row.item}`
                    if ((Date.parse(row.updatedAt ?? '') || 0) > (this.pendingAt.get(k) ?? 0)) {
                        items.delete(row.item)
                        this.pendingAt.delete(k)
                        this.points[pointId][row.item] = clamp(row.item, row.qty)
                    }
                }
                if (!items.size) this.pending.delete(pointId)
            }
            this.#persist()
            this.#emit()
        } catch {
            // offline: the queue stays, and goes out as soon as the sheet answers
        }
    }

    #loop() {
        clearTimeout(this.timer)
        if (this.stopped) return
        const wait = document.hidden ? HIDDEN_POLL_MS : this.status !== 'error' ? POLL_MS : this.failures < 2 ? QUICK_RETRY_MS : RETRY_MS
        this.timer = setTimeout(async () => {
            await this.refresh()
            this.#loop()
        }, wait)
    }

    async refresh() {
        if (!this.endpoint || this.stopped) return
        if (this.pending.size || this.pushing) return this.#push()
        const seen = { ...this.edits }
        try {
            let data = await json(await fetch(this.#url('action=all')))
            // a sheet still running an older script only answers point by point
            if (!data?.ok && /no soportada/i.test(data?.error ?? '')) data = await this.#readEach()
            if (!data?.ok || !data.points) throw new Error(data?.error || 'La hoja no devolvió datos')
            let changed = false
            for (const [pointId, rows] of Object.entries(data.points)) changed = this.#apply(pointId, rows, seen) || changed
            this.#ok()
            if (changed) this.#emit()
        } catch (err) {
            this.#fail(err)
        }
    }

    #url(query) {
        return `${this.endpoint}${this.endpoint.includes('?') ? '&' : '?'}${query}&t=${Date.now()}`
    }

    async #readEach() {
        const points = {}
        await Promise.all(
            COLLECTION_POINTS.map(async (p) => {
                const data = await json(await fetch(this.#url(`action=read&point=${encodeURIComponent(p.id)}`)))
                if (!data?.ok) throw new Error(data?.error || 'La hoja no devolvió datos')
                points[p.id] = data.rows
            })
        )
        return { ok: true, points }
    }

    /** Take the sheet's numbers, except where this device changed them after the request left. */
    #apply(pointId, rows, seen) {
        if (!this.points[pointId] || !Array.isArray(rows)) return false
        let changed = false
        for (const row of rows) {
            const id = row?.item
            if (!SUPPLIES[id]) continue
            const k = `${pointId}:${id}`
            if (this.pending.get(pointId)?.has(id) || (this.edits[k] ?? 0) !== (seen[k] ?? 0)) continue
            const qty = clamp(id, row.qty)
            if (this.points[pointId][id] !== qty) {
                this.points[pointId][id] = qty
                changed = true
            }
        }
        if (changed) writeLocalStock(pointId, this.points[pointId])
        return changed
    }

    #ok() {
        this.status = 'online'
        this.failures = 0
    }

    #fail(err) {
        this.status = 'error'
        this.lastError = err.message
        this.failures++
    }

    /* ---------------- writing ---------------- */

    #set(pointId, itemId, qty, { push = true } = {}) {
        const next = clamp(itemId, qty)
        if (this.points[pointId][itemId] === next) return false
        this.points[pointId][itemId] = next
        const k = `${pointId}:${itemId}`
        this.edits[k] = (this.edits[k] ?? 0) + 1
        if (push && this.endpoint) {
            if (!this.pending.has(pointId)) this.pending.set(pointId, new Map())
            this.pending.get(pointId).set(itemId, next)
            this.pendingAt.set(k, Date.now())
        }
        return true
    }

    /** A confirmed donation: what it brings goes onto the point's shelves, and to the sheet. */
    donate(pointId, basket) {
        if (!this.points[pointId]) return
        let changed = false
        for (const [itemId, n] of basket) if (SUPPLIES[itemId] && n > 0) changed = this.#set(pointId, itemId, this.qty(pointId, itemId) + n) || changed
        if (!changed) return
        writeLocalStock(pointId, this.points[pointId])
        this.#persist()
        this.#emit()
        this.#schedulePush()
    }

    /**
     * The logged-in point's own board moved: show it here at once. Its store
     * writes to the sheet itself, so nothing is pushed from here.
     */
    mirror(pointId, stock) {
        if (!this.points[pointId]) return
        let changed = false
        for (const id of Object.keys(SUPPLIES)) if (stock[id] !== undefined) changed = this.#set(pointId, id, stock[id], { push: false }) || changed
        if (changed) this.#emit()
    }

    #schedulePush() {
        if (this.pushTimer || this.pushing || !this.endpoint) return
        this.pushTimer = setTimeout(() => {
            this.pushTimer = null
            this.#push()
        }, 300)
    }

    #push() {
        if (this.pushing) return this.pushing
        if (!this.endpoint || !this.pending.size) return Promise.resolve()
        this.pushing = this.#send().finally(() => {
            this.pushing = null
            if (this.pending.size && !this.stopped && this.status !== 'error') this.#schedulePush()
        })
        return this.pushing
    }

    async #send() {
        const [pointId, items] = this.pending.entries().next().value
        this.pending.delete(pointId)
        const batch = [...items].map(([item, qty]) => ({ item, qty }))
        this.inflight = { point: pointId, items: new Map(batch.map(({ item, qty }) => [item, { qty, at: this.pendingAt.get(`${pointId}:${item}`) ?? Date.now() }])) }
        const seen = { ...this.edits }
        try {
            const res = await fetch(this.endpoint, {
                method: 'POST',
                // text/plain keeps this a simple request: Apps Script answers no preflight
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'set', point: pointId, items: batch, by: 'donor' }),
            })
            const data = await json(res)
            if (!data?.ok) throw new Error(data?.error || 'La hoja rechazó la donación')
            if (this.#apply(pointId, data.rows, seen)) this.#emit()
            for (const { item } of batch) if (!this.pending.get(pointId)?.has(item)) this.pendingAt.delete(`${pointId}:${item}`)
            this.#ok()
        } catch (err) {
            // keep it and send it again on the next poll
            const again = this.pending.get(pointId) ?? new Map()
            for (const { item, qty } of batch) if (!again.has(item)) again.set(item, qty)
            this.pending.set(pointId, again)
            this.#fail(err)
        }
        this.inflight = null
        this.#persist()
    }
}

function clamp(itemId, qty) {
    const n = Number(qty)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(stockCap(itemId), Math.round(n)))
}

async function json(res) {
    const text = await res.text()
    try {
        return JSON.parse(text)
    } catch {
        throw new Error(`La hoja respondió con un error temporal de Google (${res.status})`)
    }
}
