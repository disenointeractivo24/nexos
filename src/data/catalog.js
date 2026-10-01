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
 * `value` is a reference equivalent value per unit in Colombian pesos (COP).
 * It tells donors what a support basket is worth; it is not a shop price.
 */
export const SUPPLIES = {
    rice: { id: 'rice', label: 'Arroz', asset: 'rice', unit: 'bolsa de 1 kg', units: 'bolsas de 1 kg', value: 4800 },
    water: { id: 'water', label: 'Agua', asset: 'water', unit: 'botella de 1,5 L', units: 'botellas de 1,5 L', value: 2600 },
    cans: { id: 'cans', label: 'Alimentos enlatados', asset: 'cans', unit: 'lata', units: 'latas', value: 6500 },
    milk: { id: 'milk', label: 'Leche', asset: 'milk', unit: 'caja de 1 L', units: 'cajas de 1 L', value: 4300 },
    medicine: { id: 'medicine', label: 'Medicinas', asset: 'medicine', unit: 'botiquín básico', units: 'botiquines básicos', value: 18000 },
    soap: { id: 'soap', label: 'Jabón', asset: 'soap', unit: 'barra', units: 'barras', value: 3200 },
    blanket: { id: 'blanket', label: 'Cobija', asset: 'blanket', unit: 'cobija', units: 'cobijas', value: 32000 },
    hygieneKit: { id: 'hygieneKit', label: 'Kit de higiene', asset: 'hygiene-kit', unit: 'kit', units: 'kits', value: 21000 },
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
