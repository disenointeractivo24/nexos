import { SUPPLIES } from '../data/catalog.js'
import { seedStock, stockCap } from '../data/inventory.js'

/**
 * Live inventory for one collection point.
 *
 * The source of truth is a Google Sheet, reached through a Google Apps Script
 * web app (see tools/google-sheets/). The browser never holds a Google
 * credential: the script runs as the sheet's owner and exposes two calls.
 *
 *   GET  ?action=read&point=<id>      → { ok, rows: [{ item, qty, updatedAt, by }] }
 *   POST { action:'set', point, item, qty, by }
 *
 * The POST is sent as text/plain on purpose. Apps Script does not answer CORS
 * preflight requests, and text/plain keeps the request "simple", so the browser
 * sends it straight through.
 *
 * Writes are optimistic: the board moves at once and the change is pushed in
 * the background. Reads are polled, so two volunteers on different devices
 * converge within a few seconds.
 *
 * The sheet answers in a second or two, and taps keep coming meanwhile, so:
 * only one push is in flight at a time (taps made during it go out together
 * right after), and an answer never overwrites a supply that was touched after
 * its request left. Without that, a quick run of "+" made the bar jump back to
 * an older count and forward again. With no endpoint configured — or with the
 * network down — everything still works against this browser's own storage,
 * and the panel says which of the two it is running on.
 */

const POLL_MS = 7000
const RETRY_MS = 20000
/** After a single failure: Apps Script now and then answers with an error page, and the next call works. */
const QUICK_RETRY_MS = 3000
/** While the tab is in the background the sheet is asked far less often (Apps Script has daily quotas). */
export const HIDDEN_POLL_MS = 60000
const KEY = (pointId) => `nexos.inventory.${pointId}`
const QUEUE = (pointId) => `nexos.pending.${pointId}`

/**
 * Changes the sheet has not confirmed yet, kept in this browser: if the tab is
 * closed or the connection drops before a change reaches the sheet, it is sent
 * the next time instead of being lost. Each change carries when it was made, so
 * a later edit in the sheet (or on another device) wins over an older one here.
 */
export function loadQueue(key) {
    try {
        const raw = JSON.parse(localStorage.getItem(key) || 'null')
        return raw && typeof raw === 'object' ? raw : {}
    } catch {
        return {}
    }
}

export function saveQueue(key, value) {
    try {
        if (Object.keys(value).length) localStorage.setItem(key, JSON.stringify(value))
        else localStorage.removeItem(key)
    } catch {
        /* storage unavailable: this session only */
    }
}

/** Send a change as the page goes away: a beacon still leaves when the tab is closing. */
export function beacon(endpoint, point, items) {
    if (!endpoint || !items.length || !navigator.sendBeacon) return
    navigator.sendBeacon(endpoint, new Blob([JSON.stringify({ action: 'set', point, items })], { type: 'text/plain;charset=utf-8' }))
}

/** This browser's copy of a point's stock, or a seeded one if it has none. */
export function readLocalStock(pointId) {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY(pointId)) || 'null')
        if (raw && typeof raw === 'object') {
            const out = {}
            for (const id of Object.keys(SUPPLIES)) out[id] = clampStock(id, raw[id] ?? 0)
            return out
        }
    } catch {
        /* storage unavailable: fall through to a seeded board */
    }
    return seedStock(pointId)
}

export function writeLocalStock(pointId, stock) {
    try {
        localStorage.setItem(KEY(pointId), JSON.stringify(stock))
    } catch {
        /* storage unavailable: this session only */
    }
}

function clampStock(itemId, qty) {
    const n = Number(qty)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(stockCap(itemId), Math.round(n)))
}

/** Configured in .env as VITE_SHEETS_URL, or at runtime with ?hoja=<url> for a demo. */
export function sheetsEndpoint() {
    const fromQuery = new URLSearchParams(location.search).get('hoja')
    if (fromQuery) return fromQuery
    const fromEnv = import.meta.env?.VITE_SHEETS_URL
    return fromEnv && fromEnv !== 'undefined' ? fromEnv : ''
}

export class InventoryStore {
    /** @param {{pointId: string, endpoint?: string}} opts */
    constructor({ pointId, endpoint = sheetsEndpoint() }) {
        this.pointId = pointId
        this.endpoint = endpoint
        this.stock = readLocalStock(pointId)
        this.pending = new Map() // item → qty waiting to be pushed
        this.pendingAt = new Map() // item → when that change was made
        this.inflight = null // item → { qty, at } of the push in flight, until the sheet confirms it
        this.edits = {} // item → how many local changes it has had, to spot answers that arrive late
        this.pushing = null // the push in flight, if any
        // what the sheet never confirmed last time (a closed tab, a dropped connection)
        if (endpoint) {
            for (const [item, e] of Object.entries(loadQueue(QUEUE(pointId)))) {
                if (!SUPPLIES[item]) continue
                const qty = clampStock(item, e?.qty)
                this.pending.set(item, qty)
                this.pendingAt.set(item, Number(e?.at) || 0)
                this.stock[item] = qty
            }
        }
        this.listeners = new Set()
        /** 'local' · 'sync' · 'online' · 'error' */
        this.status = endpoint ? 'sync' : 'local'
        this.lastError = null
        this.failures = 0 // in a row; one alone is a hiccup, not an outage
        this.lastSync = null
        this.timer = null
        this.stopped = true
    }

    on(fn) {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    }

    #emit() {
        for (const fn of this.listeners) fn(this)
    }

    /* ---------------- local copy ---------------- */

    #writeLocal() {
        writeLocalStock(this.pointId, this.stock)
    }

    #clamp(itemId, qty) {
        return clampStock(itemId, qty)
    }

    /* ---------------- reading ---------------- */

    get(itemId) {
        return this.stock[itemId] ?? 0
    }

    /** Items currently below their critical line, most short first. */
    shortages() {
        return Object.keys(SUPPLIES)
            .map((id) => ({ id, ratio: this.get(id) / stockCap(id) }))
            .filter((r) => r.ratio < 0.3)
            .sort((a, b) => a.ratio - b.ratio)
            .map((r) => r.id)
    }

    /* ---------------- writing ---------------- */

    /** Optimistic: the board moves now, the sheet catches up. */
    set(itemId, qty) {
        const next = this.#clamp(itemId, qty)
        if (next === this.stock[itemId]) return next
        this.stock[itemId] = next
        this.edits[itemId] = (this.edits[itemId] ?? 0) + 1
        this.#writeLocal()
        this.#emit()
        if (this.endpoint) {
            this.pending.set(itemId, next)
            this.pendingAt.set(itemId, Date.now())
            this.#persist()
            this.#schedulePush()
        }
        return next
    }

    /** The unconfirmed changes (in flight and waiting), as they would be sent. */
    #unconfirmed() {
        const out = new Map(this.inflight ?? [])
        for (const [item, qty] of this.pending) out.set(item, { qty, at: this.pendingAt.get(item) ?? Date.now() })
        return out
    }

    #persist() {
        saveQueue(QUEUE(this.pointId), Object.fromEntries(this.#unconfirmed()))
    }

    add(itemId, delta) {
        return this.set(itemId, this.get(itemId) + delta)
    }

    #schedulePush() {
        // a push in flight sends what piled up as soon as it lands
        if (this.pushTimer || this.pushing) return
        // one push per burst of taps, so holding "+" is a single write
        this.pushTimer = setTimeout(() => {
            this.pushTimer = null
            this.#push()
        }, 250)
    }

    #push() {
        if (this.pushing) return this.pushing
        if (!this.endpoint || !this.pending.size) return Promise.resolve()
        this.pushing = this.#send().finally(() => {
            this.pushing = null
            // after a failure the poll retries on its slower clock instead
            if (this.pending.size && !this.stopped && this.status !== 'error') this.#schedulePush()
        })
        return this.pushing
    }

    /** The sheet's answer, or a plain error when Google sent back a page instead of data. */
    async #json(res) {
        const text = await res.text()
        try {
            return JSON.parse(text)
        } catch {
            throw new Error(`La hoja respondió con un error temporal de Google (${res.status})`)
        }
    }

    #ok() {
        this.status = 'online'
        this.lastError = null
        this.failures = 0
        this.lastSync = Date.now()
    }

    #fail(err) {
        this.status = 'error'
        this.lastError = err.message
        this.failures++
    }

    async #send() {
        const batch = [...this.pending].map(([item, qty]) => ({ item, qty }))
        this.inflight = new Map(batch.map(({ item, qty }) => [item, { qty, at: this.pendingAt.get(item) ?? Date.now() }]))
        this.pending.clear()
        const seen = { ...this.edits }
        this.status = 'sync'
        this.#emit()
        try {
            const res = await fetch(this.endpoint, {
                method: 'POST',
                // text/plain keeps this a simple request: Apps Script answers no preflight
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'set', point: this.pointId, items: batch }),
            })
            const data = await this.#json(res)
            if (!data?.ok) throw new Error(data?.error || 'La hoja rechazó la actualización')
            this.#applyRows(data.rows, seen)
            for (const { item } of batch) if (!this.pending.has(item)) this.pendingAt.delete(item)
            this.#ok()
        } catch (err) {
            // keep the change locally and try again on the next poll
            for (const { item, qty } of batch) if (!this.pending.has(item)) this.pending.set(item, qty)
            this.#fail(err)
        }
        this.inflight = null
        this.#persist()
        this.#emit()
    }

    /* ---------------- polling ---------------- */

    async start() {
        this.stopped = false
        if (!this.endpoint) {
            this.status = 'local'
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
        this.onLeave = () => beacon(this.endpoint, this.pointId, [...this.#unconfirmed()].map(([item, e]) => ({ item, qty: e.qty })))
        document.addEventListener('visibilitychange', this.onVisible)
        window.addEventListener('pagehide', this.onLeave)
    }

    /**
     * Before sending what was left from last time, drop whatever was changed in
     * the sheet after it: the newer change wins, wherever it was made.
     */
    async #reconcileQueued() {
        try {
            const data = await this.#json(await fetch(this.#readUrl()))
            if (!data?.ok || !Array.isArray(data.rows)) return
            for (const row of data.rows) {
                if (!this.pending.has(row.item)) continue
                const theirs = Date.parse(row.updatedAt ?? '') || 0
                if (theirs > (this.pendingAt.get(row.item) ?? 0)) {
                    this.pending.delete(row.item)
                    this.pendingAt.delete(row.item)
                    this.stock[row.item] = clampStock(row.item, row.qty)
                }
            }
            this.#writeLocal()
            this.#persist()
            this.#emit()
        } catch {
            // offline: the queue stays, and goes out as soon as the sheet answers
        }
    }

    #readUrl() {
        return `${this.endpoint}${this.endpoint.includes('?') ? '&' : '?'}action=read&point=${encodeURIComponent(this.pointId)}&t=${Date.now()}`
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
        // a change still waiting to be pushed must not be overwritten by an older read
        if (this.pending.size || this.pushing) return this.#push()
        const seen = { ...this.edits }
        try {
            const url = `${this.endpoint}${this.endpoint.includes('?') ? '&' : '?'}action=read&point=${encodeURIComponent(this.pointId)}&t=${Date.now()}`
            const res = await fetch(url)
            const data = await this.#json(res)
            if (!data?.ok) throw new Error(data?.error || 'La hoja no devolvió datos')
            if (Array.isArray(data.rows) && !data.rows.length) {
                // a sheet that has never seen this point starts from what this device holds,
                // so every supply gets its row at once instead of one by one as it is edited
                for (const id of Object.keys(SUPPLIES)) this.pending.set(id, this.stock[id])
                return this.#push()
            }
            this.#applyRows(data.rows, seen)
            this.#ok()
        } catch (err) {
            this.#fail(err)
        }
        this.#emit()
    }

    /**
     * Take the sheet's numbers, except for supplies touched here since the
     * request left (`seen` is the edit count at that moment) or still waiting
     * to be pushed: for those this device already holds the newer count.
     */
    #applyRows(rows, seen = this.edits) {
        if (!Array.isArray(rows)) return
        let changed = false
        for (const row of rows) {
            const id = row?.item
            if (!SUPPLIES[id]) continue
            if (this.pending.has(id) || (this.edits[id] ?? 0) !== (seen[id] ?? 0)) continue
            const qty = this.#clamp(id, row.qty)
            if (this.stock[id] !== qty) {
                this.stock[id] = qty
                changed = true
            }
        }
        if (changed) this.#writeLocal()
    }

    /** One line for the panel: where the numbers are coming from right now. */
    sourceLine() {
        if (!this.endpoint) return 'Inventario guardado en este dispositivo. Conecta una hoja de Google para compartirlo.'
        if (this.status === 'error') return 'Sin conexión con la hoja de Google. Tus cambios quedan guardados aquí y se envían solos al volver la conexión.'
        if (this.status === 'sync') return 'Sincronizando con la hoja de Google…'
        const when = this.lastSync ? new Date(this.lastSync).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''
        return `Conectado a la hoja de Google${when ? ` · actualizado ${when}` : ''}`
    }
}
