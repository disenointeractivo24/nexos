/**
 * Aid categories and supply items. Labels are the words people will read,
 * so they stay short and plain.
 */

export const CATEGORIES = {
    alimentos: { id: 'alimentos', label: 'Alimentos', icon: 'apple', color: '#B8642A' },
    agua: { id: 'agua', label: 'Agua', icon: 'drop', color: '#2F69A3' },
    medicinas: { id: 'medicinas', label: 'Medicinas', icon: 'cross', color: '#F5333F' },
    higiene: { id: 'higiene', label: 'Higiene', icon: 'soap', color: '#2E7D5B' },
    refugio: { id: 'refugio', label: 'Refugio', icon: 'home', color: '#011E41' },
}

/**
 * Supply items — `asset` points to the registry in assets.js.
 * `category` is the one tab each item is listed under at the collection point,
 * so an item is never counted twice.
 * `value` is a reference equivalent value per unit in Colombian pesos (COP).
 * It tells donors what a support basket is worth; it is not a shop price.
 *
 * `litres` and `kg` describe one unit as it is actually packed — the space the
 * object takes on a shelf, not the volume printed on its label. They are what
 * decides how many of a thing fill a box, so a box of tuna holds dozens of tins
 * while a box of milk holds far fewer. See BOX and perBox below.
 */
export const SUPPLIES = {
    rice: { id: 'rice', label: 'Arroz', asset: 'rice', category: 'alimentos', unit: 'bolsa de 1 kg', units: 'bolsas de 1 kg', value: 4800, litres: 1.2, kg: 1.02 },
    water: { id: 'water', label: 'Agua', asset: 'water', category: 'agua', unit: 'botella de 1,5 L', units: 'botellas de 1,5 L', value: 2600, litres: 1.85, kg: 1.56 },
    cans: { id: 'cans', label: 'Alimentos enlatados', asset: 'cans', category: 'alimentos', unit: 'lata', units: 'latas', value: 6500, litres: 0.45, kg: 0.42 },
    milk: { id: 'milk', label: 'Leche', asset: 'milk', category: 'alimentos', unit: 'caja de 1 L', units: 'cajas de 1 L', value: 4300, litres: 1.05, kg: 1.03 },
    medicine: { id: 'medicine', label: 'Medicinas', asset: 'medicine', category: 'medicinas', unit: 'botiquín básico', units: 'botiquines básicos', value: 18000, litres: 4.2, kg: 1.6 },
    soap: { id: 'soap', label: 'Jabón', asset: 'soap', category: 'higiene', unit: 'barra', units: 'barras', value: 3200, litres: 0.26, kg: 0.12 },
    blanket: { id: 'blanket', label: 'Cobija', asset: 'blanket', category: 'refugio', unit: 'cobija', units: 'cobijas', value: 32000, litres: 11.5, kg: 1.5 },
    hygieneKit: { id: 'hygieneKit', label: 'Kit de higiene', asset: 'hygiene-kit', category: 'higiene', unit: 'kit', units: 'kits', value: 21000, litres: 5.4, kg: 1.25 },
}

/**
 * The box every collection point packs: a 40 × 30 × 30 cm carton. Only part of
 * it is usable — things do not tessellate — and a box a volunteer has to carry
 * is capped by weight long before it is capped by space.
 */
export const BOX = {
    litres: 36 * 0.82, // usable space once packing losses are taken off
    kg: 15, // what one person can carry comfortably
    label: 'caja de 40 × 30 × 30 cm',
}

/** How many units of an item fill one box: whichever runs out first, space or weight. */
export function perBox(itemId) {
    const s = SUPPLIES[itemId]
    if (!s) return 1
    const byVolume = Math.floor(BOX.litres / s.litres)
    const byWeight = Math.floor(BOX.kg / s.kg)
    return Math.max(1, Math.min(byVolume, byWeight))
}

/** Whole boxes and the units left over, for a quantity of one item. */
export function packing(itemId, qty) {
    const per = perBox(itemId)
    return { per, boxes: Math.floor(qty / per), loose: qty % per }
}

/** How much of a box a whole basket fills, as boxes (may be fractional). */
export function basketBoxes(basket) {
    let litres = 0
    let kg = 0
    for (const [id, q] of basket) {
        const s = SUPPLIES[id]
        if (!s) continue
        litres += s.litres * q
        kg += s.kg * q
    }
    return Math.max(litres / BOX.litres, kg / BOX.kg)
}

/** What each kind of aid point typically asks for (item id → quantity) */
export const NEEDS_BY_CATEGORY = {
    alimentos: [['rice', 4], ['cans', 6], ['milk', 4], ['water', 6]],
    agua: [['water', 12], ['cans', 3], ['soap', 2]],
    medicinas: [['medicine', 3], ['hygieneKit', 2], ['water', 4], ['blanket', 1]],
    higiene: [['soap', 6], ['hygieneKit', 4], ['water', 2], ['blanket', 2]],
    refugio: [['rice', 2], ['water', 6], ['cans', 4], ['milk', 4], ['medicine', 2], ['soap', 3], ['blanket', 3], ['hygieneKit', 2]],
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

/** "$ 12.600" */
export const money = (n) => cop.format(Math.round(n)).replace(/ /g, ' ')
