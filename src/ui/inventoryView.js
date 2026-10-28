import { stockState } from '../data/inventory.js'

const FILTERS = [
    { id: 'all', label: 'Todos' },
    { id: 'critico', label: 'Críticos' },
    { id: 'estable', label: 'Estables' },
    { id: 'abastecido', label: 'Abastecidos' },
]

/**
 * The counts at the top of a point's inventory, which double as a filter: how many supplies
 * are crítico, estable and abastecido, and a tap shows only those. Used by both versions.
 */
export function inventoryFilter(current = 'all') {
    return `
        <div class="inv-filter" role="group" aria-label="Mostrar insumos">
            ${FILTERS.map(
                (f) => `
            <button class="inv-chip js-filter" type="button" data-filter="${f.id}" data-state="${f.id}" aria-pressed="${f.id === current}">
                ${f.id === 'all' ? '' : '<i aria-hidden="true"></i>'}${f.label}<span class="js-filter-count">0</span>
            </button>`
            ).join('')}
        </div>`
}

/** Each supply's state, from the store. */
const states = (store, ids) => Object.fromEntries(ids.map((id) => [id, stockState(id, store.get(id)).id]))

/** The numbers on the chips. Cards are not hidden here: one must not vanish under the finger counting it. */
export function updateFilterCounts(root, store, ids) {
    const st = states(store, ids)
    for (const chip of root.querySelectorAll('.js-filter')) {
        const f = chip.dataset.filter
        chip.querySelector('.js-filter-count').textContent = f === 'all' ? ids.length : ids.filter((id) => st[id] === f).length
    }
}

/** Show only the cards (anything with data-item) in the chosen state; returns the filter now on. */
export function applyFilter(root, store, filter, cardSelector) {
    const cards = [...root.querySelectorAll(cardSelector)]
    const st = states(store, cards.map((c) => c.dataset.item))
    for (const chip of root.querySelectorAll('.js-filter')) chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter))
    for (const card of cards) card.hidden = filter !== 'all' && st[card.dataset.item] !== filter
    const empty = root.querySelector('.js-filter-empty')
    if (empty) empty.hidden = cards.some((c) => !c.hidden)
    return filter
}
