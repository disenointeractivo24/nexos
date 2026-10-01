import { NEEDS_BY_CATEGORY, CATEGORIES } from './catalog.js'
import { LAYOUTS, LAYOUT_BY_ZONE } from './layouts.js'

/**
 * Five readable territorial zones of an abstracted Cali.
 * Coordinates are city-map units (x: west → east, z: north → south).
 * `need` is phrased in words, never percentages.
 */
export const ZONES = [
    {
        id: 'norte',
        name: 'Zona Norte',
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

/** Top needs of a zone for the active theme (words, never percentages). */
export function zoneNeeds(zone, theme) {
    const scored = Object.keys(CATEGORIES).map((cat) => {
        const base = zone.topNeeds.find(([c]) => c === cat)
        const score = (base ? LEVEL[base[1]] : 0) + (theme?.boost?.[cat] ?? 0) * 0.75
        return { cat, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 3).map(({ cat, score }) => [cat, score >= 3 ? 'alta' : score >= 1.5 ? 'media' : 'baja'])
}

export function zoneLevel(zone, theme) {
    return zoneNeeds(zone, theme).some(([, l]) => l === 'alta') ? 'alta' : 'media'
}

/* ------------------------------------------------------------------
   Neighborhood content. Each zone's barrio has its own layout
   (data/layouts.js), houses, colours, categories and needs.
   ------------------------------------------------------------------ */

const LABELLED_SLOTS = ['A', 'B', 'C', 'D', 'E']

/** Which provided house model sits in each labelled slot, per layout */
const MODELS = {
    plaza: ['house-tile', 'house-flat', 'house-two-story', 'house-zinc', 'house-tile'],
    avenida: ['house-flat', 'house-tile', 'house-zinc', 'house-flat', 'house-two-story'],
    loma: ['house-tile', 'house-zinc', 'house-tile', 'house-tile', 'house-flat'],
    canal: ['house-zinc', 'house-flat', 'house-two-story', 'house-tile', 'house-zinc'],
    parque: ['house-tile', 'house-flat', 'house-two-story', 'house-zinc', 'house-tile'],
}
const FILLER_MODELS = ['house-flat', 'house-zinc', 'house-two-story', 'house-tile']

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
            model: FILLER_MODELS[(i + Math.floor(rand() * 4)) % FILLER_MODELS.length],
            scheme: ['cream', 'white', 'sage', 'blush', 'ochre'][Math.floor(rand() * 5)],
        }))

    return { id: zone.id, name: `Barrio ${zone.barrio}`, zone, layout, houses, fillers }
}
