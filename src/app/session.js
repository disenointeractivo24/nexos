import { pickTheme } from '../data/themes.js'

/**
 * Session state shared by both roles.
 *  - role: 'donor' | 'collector'
 *  - point: the logged-in collection point (collector role)
 *  - alerts: urgent shortages marked by collection points, keyed by barrio.
 *            Kept in this browser (localStorage) so a donor on the same device
 *            sees them in the demo.
 *  - baskets: per barrio, the donor's draft basket (item → quantity)
 */
const ALERTS_KEY = 'nexos.alerts.v1'

function readAlerts() {
    try {
        return JSON.parse(localStorage.getItem(ALERTS_KEY) || '{}') || {}
    } catch {
        return {}
    }
}

export const session = {
    role: null,
    point: null,
    theme: pickTheme(),
    alerts: readAlerts(),
    baskets: new Map(),
    donations: [],
    listeners: new Set(),

    on(fn) {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    },
    emit(type, detail) {
        for (const fn of this.listeners) fn(type, detail)
    },

    /**
     * The live stock of every collection point (app/stockBoard.js). When it is
     * set, "urgent" means "in crítico at that zone's point", read from the same
     * sheet the points write to; the hand-kept alerts below are only a fallback.
     */
    stock: null,

    /* ---------- urgent shortages ---------- */
    isUrgent(key, itemId) {
        if (this.stock) return this.stock.isCritical(key, itemId)
        return !!this.alerts[key]?.[itemId]
    },
    urgentCount(key) {
        if (this.stock) return this.stock.criticalCount(key)
        return Object.keys(this.alerts[key] ?? {}).length
    },
    zoneHasUrgent(zoneId) {
        return this.urgentCount(zoneId) > 0
    },
    setUrgent(key, itemId, on) {
        const h = (this.alerts[key] ??= {})
        if (on) h[itemId] = { at: Date.now(), by: this.point?.id ?? null }
        else delete h[itemId]
        if (!Object.keys(h).length) delete this.alerts[key]
        try {
            localStorage.setItem(ALERTS_KEY, JSON.stringify(this.alerts))
        } catch {
            /* storage unavailable: keep alerts for this session only */
        }
        this.emit('alerts', { key, itemId, on })
    },

    /* ---------- donor basket ---------- */
    basket(key) {
        if (!this.baskets.has(key)) this.baskets.set(key, new Map())
        return this.baskets.get(key)
    },
    clearBasket(key) {
        this.baskets.delete(key)
    },
}
