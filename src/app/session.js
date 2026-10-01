import { pickTheme } from '../data/themes.js'

/**
 * Session state shared by both roles.
 *  - role: 'donor' | 'collector'
 *  - point: the logged-in collection point (collector role)
 *  - alerts: urgent shortages marked by collection points. Kept in this browser
 *            (localStorage) so a donor on the same device sees them in the demo.
 *  - baskets: per aid point, the donor's draft basket (item → quantity)
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

    /* ---------- urgent shortages ---------- */
    isUrgent(houseId, itemId) {
        return !!this.alerts[houseId]?.[itemId]
    },
    urgentCount(houseId) {
        return Object.keys(this.alerts[houseId] ?? {}).length
    },
    zoneHasUrgent(zoneId) {
        return Object.keys(this.alerts).some((h) => h.startsWith(`${zoneId}-`) && this.urgentCount(h) > 0)
    },
    setUrgent(houseId, itemId, on) {
        const h = (this.alerts[houseId] ??= {})
        if (on) h[itemId] = { at: Date.now(), by: this.point?.id ?? null }
        else delete h[itemId]
        if (!Object.keys(h).length) delete this.alerts[houseId]
        try {
            localStorage.setItem(ALERTS_KEY, JSON.stringify(this.alerts))
        } catch {
            /* storage unavailable: keep alerts for this session only */
        }
        this.emit('alerts', { houseId, itemId, on })
    },

    /* ---------- donor basket ---------- */
    basket(houseId) {
        if (!this.baskets.has(houseId)) this.baskets.set(houseId, new Map())
        return this.baskets.get(houseId)
    },
    clearBasket(houseId) {
        this.baskets.delete(houseId)
    },
}
