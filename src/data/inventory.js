import { SUPPLIES, perBox } from './catalog.js'

/**
 * What a barrio collection point keeps in stock.
 *
 * The cap of each supply is written in boxes, not in loose units, because that
 * is how a point actually measures itself: "we have room for eight boxes of
 * rice". perBox turns those boxes into units using the real size and weight of
 * the thing, so the caps stay honest if a supply's packing ever changes.
 */
const TARGET_BOXES = {
    rice: 8,
    water: 10,
    cans: 4,
    milk: 6,
    medicine: 3,
    soap: 1,
    blanket: 15,
    hygieneKit: 6,
}

/** Units of an item a point aims to hold. */
export function stockCap(itemId) {
    return Math.max(1, perBox(itemId) * (TARGET_BOXES[itemId] ?? 4))
}

export const STOCK_CAPS = Object.fromEntries(Object.keys(SUPPLIES).map((id) => [id, stockCap(id)]))

/**
 * Three states, in the words a volunteer would use.
 *   critico     — not enough to serve the families waiting
 *   estable     — enough for now, worth topping up
 *   abastecido  — the point is covered
 */
export const STOCK_STATES = {
    critico: { id: 'critico', label: 'Crítico', color: '#F5333F', hint: 'Falta con urgencia' },
    estable: { id: 'estable', label: 'Estable', color: '#C98A1E', hint: 'Alcanza por ahora' },
    abastecido: { id: 'abastecido', label: 'Abastecido', color: '#2E7D5B', hint: 'Cubierto' },
}

const CRITICAL_AT = 0.3
const STOCKED_AT = 0.75

export function stockState(itemId, qty) {
    const cap = stockCap(itemId)
    const k = cap ? qty / cap : 0
    if (k < CRITICAL_AT) return STOCK_STATES.critico
    if (k < STOCKED_AT) return STOCK_STATES.estable
    return STOCK_STATES.abastecido
}

/** 0–1, for the fill bar on each card. */
export function stockRatio(itemId, qty) {
    const cap = stockCap(itemId)
    return cap ? Math.min(1, qty / cap) : 0
}

/**
 * A plausible opening stock for a point that has never been synced, so the
 * board is never a wall of zeros on a first run. Deterministic per point, and
 * deliberately uneven: some supplies are already short.
 */
export function seedStock(pointId) {
    let h = 2166136261
    const key = String(pointId ?? 'nexos')
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
    const rand = () => {
        h += 0x6d2b79f5
        let t = h
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const out = {}
    for (const id of Object.keys(SUPPLIES)) out[id] = Math.round(stockCap(id) * (0.12 + rand() * 0.75))
    return out
}
