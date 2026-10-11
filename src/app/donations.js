import { SUPPLIES } from '../data/catalog.js'
import { stockCap } from '../data/inventory.js'
import { sheetsEndpoint, loadQueue, saveQueue, readLocalStock, writeLocalStock } from './inventoryStore.js'

/**
 * Donations and transfers, from the moment they are confirmed to the moment the
 * families take them home.
 *
 *   Aporte     Agendado → Recibido → Entregado     (in money: Recibido from the start)
 *   Traslado   En camino → Recibido
 *
 * A donation brought in person only counts in the point's stock once the point
 * receives it (scans its QR or types its code). A transfer leaves the sending
 * point's stock when it is sent and enters the other's when that point receives it.
 *
 * Everything goes through the same Google Sheet as the stock (tools/google-sheets),
 * which keeps the record of every donation and transfer. Without a sheet the same
 * flow runs in this browser, so a demo on one device still works end to end.
 *
 * This device also remembers its own donations ("Mis aportes"), so the person can
 * follow them later without writing the code down. No personal data (name, phone)
 * ever leaves the device.
 */

const MINE = 'nexos.myDonations.v1'
const OUTBOX = 'nexos.outbox.v1'
const LEDGER = 'nexos.localLedger.v1'
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A code nobody will mistype: no 0/O or 1/I. NX-… for donations, TR-… for transfers. */
export function newCode(prefix = 'NX') {
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    return `${prefix}-${[...bytes].map((b) => CHARS[b % CHARS.length]).join('')}`
}

/** The page that follows a donation: what its QR opens on any phone. */
export function trackUrl(code) {
    return `${location.origin}${location.pathname}?aporte=${encodeURIComponent(code)}`
}

/** A code from what was typed or scanned: a bare code, or a tracking link that holds one. */
export function readCode(text) {
    const s = String(text ?? '').trim()
    const m = s.match(/(?:aporte=)?((?:NX|TR)-[A-Z0-9]{4,8})\b/i)
    return m ? m[1].toUpperCase() : null
}

class OfflineError extends Error {
    constructor() {
        super('Sin conexión con la hoja de Google')
        this.offline = true
    }
}

class Ledger {
    constructor({ endpoint = sheetsEndpoint() } = {}) {
        this.endpoint = endpoint
        this.listeners = new Set()
    }

    on(fn) {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    }

    #emit(detail) {
        for (const fn of this.listeners) fn(detail)
    }

    /* ---------------- this device's own donations ---------------- */

    /** Newest first. */
    mine() {
        return Object.values(loadQueue(MINE)).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    }

    #remember(record) {
        const all = loadQueue(MINE)
        all[record.code] = { ...all[record.code], ...record }
        saveQueue(MINE, all)
    }

    /* ---------------- talking to the sheet ---------------- */

    async #get(query) {
        let res
        try {
            res = await fetch(`${this.endpoint}${this.endpoint.includes('?') ? '&' : '?'}${query}&t=${Date.now()}`)
        } catch {
            throw new OfflineError()
        }
        return parse(res)
    }

    async #post(body) {
        let res
        try {
            res = await fetch(this.endpoint, {
                method: 'POST',
                // text/plain keeps this a simple request: Apps Script answers no preflight
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(body),
            })
        } catch {
            throw new OfflineError()
        }
        return parse(res)
    }

    /* ---------------- donations ---------------- */

    /**
     * A donor confirmed a donation. It is remembered here at once; if the sheet cannot be
     * reached it waits in the outbox and goes out by itself later (see flush()).
     * @returns {{ ok, record, rows?, queued? }}
     */
    async donate(record) {
        const rec = { ...record, items: clean(record.items), state: record.mode === 'money' ? 'Recibido' : 'Agendado', synced: false }
        this.#remember(rec)
        if (!this.endpoint) {
            const out = localDonate(rec)
            this.#remember({ ...out.record, synced: true })
            this.#emit({ kind: rec.mode === 'money' ? 'recibido' : 'aporte', point: rec.point, code: rec.code })
            return { ok: true, ...out }
        }
        try {
            const data = await this.#post({ action: 'donate', record: rec })
            // a sheet still running the previous script knows nothing of donations: the caller
            // falls back to adding them to the stock straight away, as that script expects
            if (!data.ok && /no soportada/i.test(data.error ?? '')) return { ok: false, unsupported: true, record: rec }
            if (!data.ok) throw new Error(data.error)
            this.#remember({ ...data.record, synced: true })
            this.#emit({ kind: rec.mode === 'money' ? 'recibido' : 'aporte', point: rec.point, code: rec.code })
            return { ok: true, record: data.record, rows: data.rows }
        } catch (err) {
            if (!err.offline) return { ok: false, error: plain(err.message), record: rec }
            const box = loadQueue(OUTBOX)
            box[rec.code] = { action: 'donate', record: rec }
            saveQueue(OUTBOX, box)
            return { ok: true, queued: true, record: rec }
        }
    }

    /** Sends whatever waited in the outbox. Safe to call often: the sheet ignores repeats. */
    async flush() {
        if (!this.endpoint || this.flushing) return
        const box = loadQueue(OUTBOX)
        if (!Object.keys(box).length) return
        this.flushing = true
        try {
            for (const [code, entry] of Object.entries(box)) {
                try {
                    const data = await this.#post(entry)
                    if (data.ok && data.record) this.#remember({ ...data.record, synced: true })
                    // sent, or refused for good (a bad record): either way it leaves the outbox
                    const now = loadQueue(OUTBOX)
                    delete now[code]
                    saveQueue(OUTBOX, now)
                } catch (err) {
                    if (err.offline) break
                }
            }
        } finally {
            this.flushing = false
        }
    }

    /** A donation or a transfer by its code. @returns {{ ok, record?, transfer?, notFound?, offline? }} */
    async lookup(code) {
        code = readCode(code)
        if (!code) return { ok: false, notFound: true }
        const local = () => {
            const l = loadLedger()
            if (code.startsWith('TR-')) return l.transfers[code] ? { ok: true, transfer: l.transfers[code] } : null
            const rec = l.donations[code] ?? loadQueue(MINE)[code]
            return rec ? { ok: true, record: rec } : null
        }
        if (!this.endpoint) return local() ?? { ok: false, notFound: true }
        try {
            const data = await this.#get(`action=aporte&code=${encodeURIComponent(code)}`)
            if (!data.ok && /no soportada/i.test(data.error ?? '')) {
                const mine = loadQueue(MINE)[code]
                return mine ? { ok: true, record: mine, unsupported: true } : { ok: false, notFound: true }
            }
            if (data.ok && data.record) this.#remember({ ...data.record, synced: true, ...(loadQueue(MINE)[code] ? {} : { foreign: true }) })
            if (data.ok) return data
            // not in the sheet yet: maybe it is still waiting in this device's outbox
            const mine = loadQueue(MINE)[code]
            return mine ? { ok: true, record: mine, pending: true } : { ok: false, notFound: true }
        } catch (err) {
            const mine = local()
            return mine ? { ...mine, offline: true } : { ok: false, offline: true, error: err.message }
        }
    }

    /** The point received a donation brought in person: it goes into the point's stock. */
    receive(code, point) {
        return this.#act({ action: 'receive', code: readCode(code), point })
    }

    /** The families took a donation home. */
    deliver(code, point) {
        return this.#act({ action: 'deliver', code: readCode(code), point })
    }

    /* ---------------- transfers ---------------- */

    /** Send supplies to another point: they leave this point's stock now. */
    transfer(from, to, items) {
        return this.#act({ action: 'transfer', code: newCode('TR'), from, to, items: clean(items) })
    }

    /** A transfer arrived: into this point's stock. */
    transferReceive(code, point) {
        return this.#act({ action: 'transferReceive', code: readCode(code), point })
    }

    /** Point actions need an answer to be trusted, so they are not queued: offline, they fail. */
    async #act(body) {
        if (!body.code) return { ok: false, error: 'Ese código no es válido' }
        let out
        if (!this.endpoint) out = localAct(body)
        else {
            try {
                out = await this.#post(body)
            } catch (err) {
                return { ok: false, offline: !!err.offline, error: err.offline ? 'Sin conexión. Inténtalo de nuevo en un momento.' : err.message }
            }
        }
        if (!out.ok) out.error = plain(out.error)
        if (out.ok && !out.already) {
            const kind = { receive: 'recibido', deliver: 'entregado', transfer: 'traslado', transferReceive: 'traslado-recibido' }[body.action]
            this.#emit({ kind, point: body.point ?? body.from, to: body.to, code: body.code })
        }
        if (out.ok && out.record && loadQueue(MINE)[out.record.code]) this.#remember(out.record)
        return out
    }
}

/* ---------------- the same flow without a sheet (one device) ---------------- */

function loadLedger() {
    const l = loadQueue(LEDGER)
    return { donations: l.donations ?? {}, transfers: l.transfers ?? {} }
}

function saveLedger(l) {
    saveQueue(LEDGER, l)
}

function addStock(pointId, deltas) {
    const stock = readLocalStock(pointId)
    for (const [id, n] of Object.entries(deltas)) stock[id] = Math.max(0, Math.min(stockCap(id), (stock[id] ?? 0) + n))
    writeLocalStock(pointId, stock)
    return Object.entries(stock).map(([item, qty]) => ({ point: pointId, item, qty, cap: stockCap(item), updatedAt: new Date().toISOString(), by: 'Donación' }))
}

function localDonate(rec) {
    const l = loadLedger()
    if (l.donations[rec.code]) return { record: l.donations[rec.code] }
    const now = new Date().toISOString()
    const record = { ...rec, at: rec.at ?? now, receivedAt: rec.mode === 'money' ? now : null, deliveredAt: null }
    delete record.synced
    l.donations[rec.code] = record
    saveLedger(l)
    return { record, rows: rec.mode === 'money' ? addStock(rec.point, rec.items) : undefined }
}

function localAct(body) {
    const l = loadLedger()
    const now = new Date().toISOString()
    if (body.action === 'transfer') {
        const have = readLocalStock(body.from)
        const items = {}
        for (const [id, n] of Object.entries(body.items)) if ((have[id] ?? 0) > 0) items[id] = Math.min(n, have[id])
        if (!Object.keys(items).length) return { ok: false, error: 'No hay insumos para enviar' }
        const transfer = { code: body.code, state: 'En camino', from: body.from, to: body.to, items, at: now, receivedAt: null }
        l.transfers[body.code] = transfer
        saveLedger(l)
        return { ok: true, transfer, rows: addStock(body.from, Object.fromEntries(Object.entries(items).map(([k, v]) => [k, -v]))) }
    }
    if (body.action === 'transferReceive') {
        const t = l.transfers[body.code]
        if (!t) return { ok: false, error: `No encontramos el traslado ${body.code}` }
        if (t.to !== body.point) return { ok: false, error: 'Este traslado va para otro punto' }
        if (t.state !== 'En camino') return { ok: true, transfer: t, already: true }
        Object.assign(t, { state: 'Recibido', receivedAt: now })
        saveLedger(l)
        return { ok: true, transfer: t, rows: addStock(body.point, t.items) }
    }
    const rec = l.donations[body.code]
    if (!rec) return { ok: false, error: `No encontramos el aporte ${body.code}` }
    if (rec.point !== body.point) return { ok: false, error: 'Este aporte es para otro punto' }
    if (body.action === 'receive') {
        if (rec.state !== 'Agendado') return { ok: true, record: rec, already: true }
        Object.assign(rec, { state: 'Recibido', receivedAt: now })
        saveLedger(l)
        return { ok: true, record: rec, rows: addStock(body.point, rec.items) }
    }
    if (rec.state === 'Entregado') return { ok: true, record: rec, already: true }
    if (rec.state !== 'Recibido') return { ok: false, error: 'Primero hay que recibir el aporte en el punto' }
    Object.assign(rec, { state: 'Entregado', deliveredAt: now })
    saveLedger(l)
    return { ok: true, record: rec }
}

/** A point's pending work, without a sheet. Same shape as the sheet's `queue`. */
export function localQueue(pointId) {
    const l = loadLedger()
    const newest = (a, b) => (b.at ?? '').localeCompare(a.at ?? '')
    const ds = Object.values(l.donations).filter((d) => d.point === pointId).sort(newest)
    const ts = Object.values(l.transfers).filter((t) => t.state === 'En camino').sort(newest)
    return {
        scheduled: ds.filter((d) => d.state === 'Agendado'),
        toDeliver: ds.filter((d) => d.state === 'Recibido'),
        incoming: ts.filter((t) => t.to === pointId),
        outgoing: ts.filter((t) => t.from === pointId),
    }
}

/** A message as a person reads it, without the 'Error: ' Apps Script puts in front. */
/** A message as a person reads it, without the "Error: " Apps Script puts in front. */
const plain = (msg) => String(msg ?? '').replace(/^Error:\s*/, '')

function clean(items) {
    const out = {}
    for (const [id, n] of Object.entries(items ?? {})) {
        const q = Math.round(Number(n) || 0)
        if (SUPPLIES[id] && q > 0) out[id] = Math.min(q, stockCap(id))
    }
    return out
}

async function parse(res) {
    const text = await res.text()
    try {
        return JSON.parse(text)
    } catch {
        throw new Error(`La hoja respondió con un error temporal de Google (${res.status})`)
    }
}

export const ledger = new Ledger()
