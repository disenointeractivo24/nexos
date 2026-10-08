import { NEEDS_BY_CATEGORY, CATEGORIES, SUPPLIES } from './catalog.js'
import { LAYOUTS, LAYOUT_BY_ZONE } from './layouts.js'
import { pointForZone } from './collectionPoints.js'

/**
 * Five readable territorial zones of an abstracted Cali.
 * Coordinates are city-map units (x: west → east, z: north → south).
 * `need` is phrased in words, never percentages.
 * `color` identifies the zone's marker on the map (the marker only), chosen apart
 * from the supply category colours so the two are never confused.
 */
export const ZONES = [
    {
        id: 'norte',
        name: 'Zona Norte',
        color: '#7B52C7',
        seed: [14, -82],
        label: [16, -76],
        need: 'media',
        barrio: 'La Flora',
        topNeeds: [['agua', 'alta'], ['alimentos', 'media'], ['higiene', 'media']],
        categories: ['agua', 'alimentos', 'higiene', 'medicinas', 'refugio'],
        schemes: ['white', 'sage', 'cream', 'blush', 'ochre'],
    },
    {
        id: 'oeste',
        name: 'Zona Oeste',
        color: '#0E8F9C',
        seed: [-74, 4],
        label: [-70, 0],
        need: 'alta',
        barrio: 'San Antonio',
        topNeeds: [['medicinas', 'alta'], ['agua', 'alta'], ['refugio', 'media']],
        categories: ['medicinas', 'agua', 'refugio', 'alimentos', 'higiene'],
        schemes: ['ochre', 'white', 'blush', 'cream', 'sage'],
    },
    {
        id: 'centro',
        name: 'Zona Centro',
        color: '#E0702A',
        seed: [4, 4],
        label: [2, 6],
        need: 'alta',
        barrio: 'San Fernando',
        topNeeds: [['alimentos', 'alta'], ['agua', 'media'], ['medicinas', 'media']],
        categories: ['alimentos', 'agua', 'medicinas', 'higiene', 'refugio'],
        schemes: ['cream', 'white', 'sage', 'blush', 'ochre'],
    },
    {
        id: 'oriente',
        name: 'Zona Oriente',
        color: '#D6457F',
        seed: [84, 22],
        label: [84, 16],
        need: 'alta',
        barrio: 'El Poblado',
        topNeeds: [['refugio', 'alta'], ['alimentos', 'alta'], ['higiene', 'media']],
        categories: ['refugio', 'alimentos', 'higiene', 'agua', 'medicinas'],
        schemes: ['blush', 'ochre', 'white', 'sage', 'cream'],
    },
    {
        id: 'sur',
        name: 'Zona Sur',
        color: '#C99A1E',
        seed: [6, 84],
        label: [10, 78],
        need: 'media',
        barrio: 'El Ingenio',
        topNeeds: [['higiene', 'media'], ['agua', 'media'], ['alimentos', 'baja']],
        categories: ['higiene', 'agua', 'alimentos', 'refugio', 'medicinas'],
        schemes: ['sage', 'cream', 'white', 'ochre', 'blush'],
    },
]

export const NEED_WORD = { alta: 'Necesidad alta', media: 'Necesidad media', baja: 'Necesidad baja' }

/* ------------------------------------------------------------------
   Needs, adjusted by the session's emergency context
   ------------------------------------------------------------------ */

const LEVEL = { alta: 3, media: 1.5, baja: 0.5 }

/**
 * The live stock of every collection point (app/stockBoard.js). Once it is
 * set, everything a donor is told about a zone and its barrio comes from it:
 * the sheet the points keep, not the figures written in this file.
 */
let stock = null
export function useStock(source) {
    stock = source
}

/** crítico → alta, estable → media, abastecido → baja */
const NEED_BY_STATE = { critico: 'alta', estable: 'media', abastecido: 'baja' }
const STATE_RANK = { critico: 0, estable: 1, abastecido: 2 }

/** Each category at the zone's point, rated by its scarcest item, most pressing first. */
function stockedNeeds(zone) {
    const pointId = pointForZone(zone.id)?.id
    return Object.keys(CATEGORIES)
        .map((cat) => {
            let worst = null
            for (const s of Object.values(SUPPLIES)) {
                if (s.category !== cat) continue
                const st = stock.state(pointId, s.id)
                const ratio = stock.qty(pointId, s.id) / Math.max(1, stock.qty(pointId, s.id) + stock.need(pointId, s.id))
                if (!worst || STATE_RANK[st.id] < STATE_RANK[worst.st.id] || (st.id === worst.st.id && ratio < worst.ratio)) worst = { st, ratio }
            }
            return { cat, worst }
        })
        .sort((a, b) => STATE_RANK[a.worst.st.id] - STATE_RANK[b.worst.st.id] || a.worst.ratio - b.worst.ratio)
        .map(({ cat, worst }) => [cat, NEED_BY_STATE[worst.st.id]])
}

/** Top needs of a zone (words, never percentages): from the point's stock when there is one. */
export function zoneNeeds(zone, theme) {
    if (stock) return stockedNeeds(zone).slice(0, 3)
    const scored = Object.keys(CATEGORIES).map((cat) => {
        const base = zone.topNeeds.find(([c]) => c === cat)
        const score = (base ? LEVEL[base[1]] : 0) + (theme?.boost?.[cat] ?? 0) * 0.75
        return { cat, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 3).map(({ cat, score }) => [cat, score >= 3 ? 'alta' : score >= 1.5 ? 'media' : 'baja'])
}

export function zoneLevel(zone, theme) {
    if (stock) return stockedNeeds(zone)[0]?.[1] ?? 'baja'
    return zoneNeeds(zone, theme).some(([, l]) => l === 'alta') ? 'alta' : 'media'
}

/* ------------------------------------------------------------------
   Neighborhood content. Each zone's barrio has its own layout
   (data/layouts.js), houses, colours, categories and needs.
   ------------------------------------------------------------------ */

const LABELLED_SLOTS = ['A', 'B', 'C', 'D', 'E']

/** Which provided house model sits in each labelled slot, per layout */
const MODELS = {
    plaza: ['house-tile', 'house-estrato2', 'house-two-story', 'house-zinc', 'house-estrato4'],
    avenida: ['house-estrato4', 'house-estrato5', 'house-zinc', 'house-estrato3', 'house-two-story'],
    loma: ['house-tile', 'house-estrato2', 'house-estrato3', 'house-estrato5', 'house-estrato4'],
    canal: ['house-zinc', 'house-estrato4', 'house-two-story', 'house-tile', 'house-estrato2'],
    parque: ['house-tile', 'house-estrato2', 'house-two-story', 'house-zinc', 'house-estrato3'],
}
const FILLER_MODELS = ['house-estrato2', 'house-zinc', 'house-two-story', 'house-tile', 'house-estrato3', 'house-estrato4', 'house-estrato5']

function seeded(str) {
    let h = 2166136261
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
    return () => {
        h += 0x6d2b79f5
        let t = h
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function buildBarrio(zone, theme) {
    const layoutId = LAYOUT_BY_ZONE[zone.id]
    const layout = LAYOUTS[layoutId]
    const rand = seeded(zone.id)
    const levels = Object.fromEntries(zoneNeeds(zone, theme).map(([c, l]) => [c, l]))

    const houses = LABELLED_SLOTS.map((slot, i) => {
        const category = zone.categories[i]
        const boost = theme?.boost?.[category] ?? 0
        const needs = NEEDS_BY_CATEGORY[category].map(([item, qty]) => ({
            item,
            qty: Math.max(1, qty + boost + Math.round((rand() - 0.5) * 2)),
        }))
        return {
            id: `${zone.id}-${slot}`,
            slot,
            model: MODELS[layoutId][i],
            scheme: zone.schemes[i],
            category,
            number: 4 + Math.floor(rand() * 40),
            priority: levels[category] === 'alta' || boost >= 2 ? 'alta' : 'media',
            needs,
            supported: false,
        }
    })

    // San Fernando mirrors the reference: the shelter is house 12.
    if (zone.id === 'centro') houses[4].number = 12

    const fillers = Object.keys(layout.slots)
        .filter((k) => k.startsWith('F'))
        .map((slot, i) => ({
            id: `${zone.id}-${slot}`,
            slot,
            model: FILLER_MODELS[(i + Math.floor(rand() * FILLER_MODELS.length)) % FILLER_MODELS.length],
            scheme: ['cream', 'white', 'sage', 'blush', 'ochre'][Math.floor(rand() * 5)],
        }))

    const barrio = { id: zone.id, name: `Barrio ${zone.barrio}`, zone, layout, houses, fillers }
    refreshBarrioNeeds(barrio)
    return barrio
}

/**
 * Bring a barrio's needs in line with its collection point's stock: for each
 * supply, the families together need exactly what the point is missing
 * (tope − cantidad in the sheet). It is shared out among the houses whose kind
 * of need includes that supply, in proportion to how much of it they usually
 * ask for, so the families who come to collect stay believable while the
 * totals stay exact.
 */
export function refreshBarrioNeeds(barrio) {
    if (!stock) return barrio
    const pointId = pointForZone(barrio.zone.id)?.id
    for (const h of barrio.houses) h.needs = []
    for (const id of Object.keys(SUPPLIES)) {
        const total = stock.need(pointId, id)
        if (total <= 0) continue
        let takers = barrio.houses
            .map((h) => ({ h, weight: NEEDS_BY_CATEGORY[h.category]?.find(([item]) => item === id)?.[1] ?? 0 }))
            .filter((t) => t.weight > 0)
        if (!takers.length) takers = barrio.houses.map((h) => ({ h, weight: 1 }))
        const sum = takers.reduce((a, t) => a + t.weight, 0)
        // largest remainder: whole units that add up to the total exactly
        const shares = takers.map((t) => {
            const exact = (total * t.weight) / sum
            return { ...t, qty: Math.floor(exact), rest: exact - Math.floor(exact) }
        })
        let left = total - shares.reduce((a, s) => a + s.qty, 0)
        for (const s of [...shares].sort((a, b) => b.rest - a.rest)) {
            if (left <= 0) break
            s.qty++
            left--
        }
        for (const s of shares) if (s.qty > 0) s.h.needs.push({ item: id, qty: s.qty })
    }
    for (const h of barrio.houses) {
        h.supported = h.needs.length === 0
        h.priority = h.needs.some((n) => stock.state(pointId, n.item).id === 'critico') ? 'alta' : 'media'
    }
    return barrio
}

/* ------------------------------------------------------------------
   The barrio seen from the collection point
   ------------------------------------------------------------------ */

/**
 * Everything the barrio still needs, grouped by category.
 *
 * Donations are no longer made house by house: a person leaves supplies at the
 * collection point and the families come to collect them. So the panel works
 * from the barrio's totals, while each entry remembers which houses are behind
 * it, so what arrives can be shared out again afterwards.
 *
 * Each item is totalled once across every house and listed under its own
 * category (SUPPLIES[item].category). That total is exactly what the panel
 * shows as "Se necesitan" and the most a donor can put in the basket, and it
 * is what applyDonation can actually hand out.
 *
 * @returns {{category: string, items: {item: string, qty: number, houses: string[]}[]}[]}
 */
export function barrioNeeds(barrio) {
    const byCat = new Map()
    for (const h of barrio.houses) {
        for (const n of h.needs) {
            if (n.qty <= 0) continue
            const cat = SUPPLIES[n.item].category
            if (!byCat.has(cat)) byCat.set(cat, new Map())
            const items = byCat.get(cat)
            const cur = items.get(n.item) ?? { item: n.item, qty: 0, houses: [] }
            cur.qty += n.qty
            if (!cur.houses.includes(h.id)) cur.houses.push(h.id)
            items.set(n.item, cur)
        }
    }
    // keep the categories in the order the zone considers most pressing
    return barrio.zone.categories
        .filter((c) => byCat.has(c))
        .map((c) => ({ category: c, items: [...byCat.get(c).values()] }))
}

/** True once nothing in the barrio is outstanding. */
export function barrioCovered(barrio) {
    return barrio.houses.every((h) => h.needs.every((n) => n.qty <= 0))
}

/**
 * Share a delivered basket out among the families who were waiting for it.
 * Houses with the highest priority are served first.
 *
 * @returns {{houseId: string, items: Map<string, number>}[]} what each house
 *          collects, in serving order; together it is exactly the basket
 */
export function applyDonation(barrio, basket) {
    const served = new Map()
    const order = [...barrio.houses].sort((a, b) => (a.priority === 'alta' ? -1 : 0) - (b.priority === 'alta' ? -1 : 0))
    for (const [item, amount] of basket) {
        let left = amount
        for (const h of order) {
            if (left <= 0) break
            const need = h.needs.find((n) => n.item === item && n.qty > 0)
            if (!need) continue
            const give = Math.min(need.qty, left)
            need.qty -= give
            left -= give
            if (!served.has(h.id)) served.set(h.id, new Map())
            const take = served.get(h.id)
            take.set(item, (take.get(item) ?? 0) + give)
            if (h.needs.every((n) => n.qty <= 0)) h.supported = true
        }
    }
    return order.filter((h) => served.has(h.id)).map((h) => ({ houseId: h.id, items: served.get(h.id) }))
}
