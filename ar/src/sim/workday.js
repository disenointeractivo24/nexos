import { CATEGORIES, SUPPLIES } from '../../../src/data/catalog.js'

/**
 * The workday, with no 3D in it: what has arrived, who is waiting, what the person just
 * did. The scene asks it and shows the answer, so the rules can be read (and tested) alone.
 *
 * There is no fixed order to it. Cartons keep arriving and people keep coming; the person
 * decides whether to open, to sort or to attend, and the day answers to what they chose.
 */

/** What comes off the first truck: the only medicine, blanket and hygiene kit of the shift. */
export const FIRST_DELIVERY = [
    { from: 'Barrio San Fernando', items: ['rice', 'rice', 'water', 'water', 'cans'] },
    { from: 'Barrio El Ingenio', items: ['medicine', 'soap', 'soap', 'hygieneKit'] },
    { from: 'Barrio La Flora', items: ['blanket', 'milk', 'milk'] },
]

/** What keeps coming afterwards, round and round: always more cartons, never of everything. */
export const RESTOCK = [
    { from: 'Barrio Meléndez', items: ['water', 'water', 'rice', 'cans'] },
    { from: 'Barrio Aguablanca', items: ['soap', 'milk', 'rice'] },
    { from: 'Barrio Ciudad Jardín', items: ['cans', 'water', 'milk'] },
]

/** The demonstration point opens each shift with this little: not everyone will get everything. */
export const SHIFT_STOCK = { rice: 2, water: 2, cans: 1, milk: 0, medicine: 1, soap: 1, hygieneKit: 0, blanket: 0 }

/** Who comes to the point. `patience`: the seconds they can wait in line. */
export const ORDERS = [
    { id: 'pedido-1', family: 'Familia Rodríguez', people: 4, patience: 170, items: { rice: 2, water: 2, soap: 1 }, visitors: ['npc-mayor'] },
    { id: 'pedido-2', family: 'Familia Mosquera', people: 3, patience: 170, items: { milk: 2, cans: 1, blanket: 1 }, visitors: ['npc-joven-1', 'npc-nino-1'] },
    { id: 'pedido-3', family: 'Familia Valencia', people: 5, patience: 150, items: { medicine: 1, hygieneKit: 1, water: 2 }, visitors: ['npc-joven-2', 'npc-nino-2'] },
    { id: 'urgente', family: 'Clínica móvil', people: 12, patience: 80, urgent: true, items: { medicine: 2, water: 2 }, visitors: ['npc-joven-1'] },
    { id: 'pedido-4', family: 'Familia Caicedo', people: 6, patience: 130, items: { rice: 4, cans: 1 }, visitors: ['npc-mayor', 'npc-nino-1'] },
]

/** When each of them comes, in seconds since the shift began. */
export const ARRIVALS = [
    { at: 30, id: 'pedido-1' },
    { at: 100, id: 'pedido-2' },
    { at: 170, id: 'pedido-3' },
    { at: 240, id: 'urgente' },
    { at: 300, id: 'pedido-4' },
]

/** Cartons waiting: below the first a new one comes soon, at the second the pile is full. */
const KEEP_BOXES = 2
const MAX_BOXES = 4
const TRUCK_EVERY = 35
const TRUCK_SOON = 3

export const categoryOf = (itemId) => SUPPLIES[itemId].category
const clamp01 = (n) => Math.min(1, Math.max(0, n))
const low = (id) => SUPPLIES[id].label.toLowerCase()

export class Workday {
    /**
     * @param {{ store: { add(id: string, n: number): number, get(id: string): number },
     *           first?: typeof FIRST_DELIVERY, restock?: typeof RESTOCK,
     *           orders?: typeof ORDERS, arrivals?: typeof ARRIVALS }} opts
     */
    constructor({ store, first = FIRST_DELIVERY, restock = RESTOCK, orders = ORDERS, arrivals = ARRIVALS }) {
        this.store = store
        this.restock = restock
        this.first = first
        this.boxes = []
        this.boxCount = 0
        this.restocked = 0
        this.nextTruck = TRUCK_EVERY
        this.sortedCount = 0
        this.mistakes = 0
        this.orders = orders.map((o) => ({ ...o, items: { ...o.items }, packed: {}, state: 'scheduled', waited: 0, warned: false }))
        this.pending = [...arrivals].sort((a, b) => a.at - b.at)
        this.current = null
        this.clock = 0
        this.started = false
        this.isFinished = false
        this.listeners = new Set()
    }

    on(fn) {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    }

    #emit(event, detail) {
        for (const fn of this.listeners) fn(event, detail)
    }

    #newBoxes(list) {
        const boxes = list.map((b) => ({ ...b, id: `caja-${++this.boxCount}`, items: [...b.items], state: 'received', left: b.items.length }))
        this.boxes.push(...boxes)
        this.#emit('truck', boxes)
    }

    /** The first truck is at the door, and the clock starts. */
    start() {
        if (this.started) return false
        this.started = true
        this.#newBoxes(this.first)
        return true
    }

    get line() {
        return this.orders.filter((o) => o.state === 'waiting')
    }

    get finished() {
        return this.isFinished
    }

    get unopened() {
        return this.boxes.filter((b) => b.state === 'received').length
    }

    /** Units out of their carton's box that still have no place on the shelves. */
    get unsorted() {
        return this.boxes.filter((b) => b.state === 'open').reduce((n, b) => n + b.left, 0)
    }

    /** What is left to do right now, the most pressing first, however it gets done. */
    get todo() {
        const rows = []
        const line = this.line
        for (const o of line.filter((x) => x.urgent)) {
            rows.push({ id: 'urgent', tone: 'alert', label: `Urgente: ${o.family}`, detail: `Le quedan ${Math.max(0, Math.ceil(o.patience - o.waited))} segundos` })
        }
        const o = this.current
        if (o) {
            const missing = Object.entries(this.missing)
            rows.push({
                id: 'order',
                tone: 'work',
                label: `Pedido de ${o.family}`,
                detail: missing.length ? `Falta ${missing.map(([id, n]) => `${n} de ${low(id)}`).join(', ')}` : 'Completo: ya puedes entregarlo',
            })
        }
        const normal = line.filter((x) => !x.urgent)
        if (normal.length) rows.push({ id: 'line', tone: 'work', label: 'Atender a la fila', detail: normal.length === 1 ? `${normal[0].family} espera` : `${normal.length} familias esperan` })
        if (this.unsorted) rows.push({ id: 'sort', tone: 'work', label: 'Clasificar lo que abriste', detail: `${this.unsorted} ${this.unsorted === 1 ? 'insumo' : 'insumos'} en la mesa` })
        if (this.unopened) rows.push({ id: 'boxes', tone: 'work', label: 'Abrir cajas', detail: `${this.unopened} por abrir` })
        const out = Object.keys(SUPPLIES).filter((id) => this.available(id) === 0)
        if (out.length) rows.push({ id: 'out', tone: 'warn', label: 'Sin existencias', detail: out.map((id) => SUPPLIES[id].label).join(', ') })
        return rows
    }

    /** Of all those who come, how many have been closed one way or the other. */
    get progress() {
        return { done: this.orders.filter((o) => o.state === 'delivered' || o.state === 'left').length, total: this.orders.length }
    }

    /* ---------------- the pressure of the moment ---------------- */

    /** From 0 (calm) to 1 (everything at once): what the room shows and sounds like. */
    get pressure() {
        if (this.isFinished) return 0
        const line = this.line
        const urgent = line.some((o) => o.urgent) || this.current?.urgent
        return clamp01(0.14 * line.length + 0.04 * this.unopened + (urgent ? 0.35 : 0) + 0.2 * Math.min(this.clock / 360, 1))
    }

    /** Time passes: people arrive, the ones in line lose patience, more cartons come. */
    tick(dt) {
        if (!this.started || this.isFinished) return
        this.clock += dt
        while (this.pending.length && this.pending[0].at <= this.clock) this.#arrive(this.pending.shift())

        this.nextTruck -= dt
        if (this.unopened < KEEP_BOXES) this.nextTruck = Math.min(this.nextTruck, TRUCK_SOON)
        if (this.nextTruck <= 0) {
            this.nextTruck = TRUCK_EVERY
            if (this.unopened < MAX_BOXES) this.#newBoxes([this.restock[this.restocked++ % this.restock.length]])
        }

        for (const o of this.line) {
            o.waited += dt
            if (!o.warned && o.waited > o.patience * 0.65) {
                o.warned = true
                this.#emit('impatient', o)
            }
            if (o.waited >= o.patience) {
                o.state = 'left'
                this.#emit('left', o)
            }
        }
        if (!this.pending.length && !this.current && !this.line.length) {
            this.isFinished = true
            this.#emit('finished', this.review)
        }
    }

    #arrive(event) {
        const order = this.orders.find((o) => o.id === event.id)
        if (!order) return
        order.state = 'waiting'
        this.#emit('joined', order)
    }

    /* ---------------- cartons ---------------- */

    box(id) {
        return this.boxes.find((b) => b.id === id)
    }

    /** Only once. */
    openBox(id) {
        const b = this.box(id)
        if (!b || b.state !== 'received') return false
        b.state = 'open'
        this.#emit('opened', b)
        return true
    }

    /**
     * An item let go over a category's crate. On the shelf, it counts: there is no
     * separate step to register it, and the inventory moves at once.
     * @returns {{ ok: boolean, wanted?: string }} `wanted` is the label of the right category
     */
    sort(boxId, itemId, categoryId) {
        const b = this.box(boxId)
        if (!b || b.state !== 'open' || b.left <= 0) return { ok: false }
        const right = categoryOf(itemId)
        if (right !== categoryId) {
            this.mistakes++
            this.#emit('mistake', { itemId, categoryId })
            return { ok: false, wanted: CATEGORIES[right].label }
        }
        this.#takeOut(b, itemId)
        this.#emit('sorted', { itemId, categoryId, box: b })
        if (b.state === 'empty') this.#emit('emptied', b)
        return { ok: true }
    }

    /** It left its carton and is now part of the point's inventory, wherever it went. */
    #takeOut(b, itemId) {
        b.left--
        if (b.left === 0) b.state = 'empty'
        this.store.add(itemId, 1)
        this.sortedCount++
    }

    /* ---------------- people ---------------- */

    /** Someone in line comes to the counter, if nobody is being attended. The person chooses who. */
    call(id) {
        if (this.current) return null
        const order = this.orders.find((o) => o.id === id && o.state === 'waiting')
        if (!order) return null
        order.state = 'packing'
        this.current = order
        this.#emit('order', order)
        return order
    }

    /** How many of an item are on the shelves, leaving out what is already in the kit. */
    available(itemId) {
        return Math.max(0, this.store.get(itemId) - (this.current?.packed[itemId] ?? 0))
    }

    /** What the order at the counter still lacks, in units. */
    get missing() {
        const o = this.current
        if (!o) return {}
        return Object.fromEntries(
            Object.entries(o.items)
                .map(([id, q]) => [id, q - (o.packed[id] ?? 0)])
                .filter(([, n]) => n > 0)
        )
    }

    get canDeliver() {
        return !!this.current && Object.values(this.current.packed).some((n) => n > 0)
    }

    /**
     * Something put into the current kit.
     * @returns {{ ok: boolean, reason?: 'none'|'extra'|'stock' }}
     */
    addToKit(itemId) {
        const o = this.current
        if (!o) return { ok: false, reason: 'none' }
        if ((o.packed[itemId] ?? 0) >= (o.items[itemId] ?? 0)) return { ok: false, reason: 'extra' }
        if (this.available(itemId) <= 0) return { ok: false, reason: 'stock' }
        this.#pack(o, itemId)
        return { ok: true }
    }

    /**
     * Straight from an open carton into the current kit, without going by the shelves.
     * @returns {{ ok: boolean, reason?: 'none'|'extra' }}
     */
    addFromBox(boxId, itemId) {
        const o = this.current
        const b = this.box(boxId)
        if (!o || !b || b.state !== 'open' || b.left <= 0) return { ok: false, reason: 'none' }
        if ((o.packed[itemId] ?? 0) >= (o.items[itemId] ?? 0)) return { ok: false, reason: 'extra' }
        this.#takeOut(b, itemId)
        this.#pack(o, itemId)
        if (b.state === 'empty') this.#emit('emptied', b)
        return { ok: true }
    }

    #pack(o, itemId) {
        o.packed[itemId] = (o.packed[itemId] ?? 0) + 1
        this.#emit('packed', { order: o, itemId, complete: !Object.keys(this.missing).length })
    }

    /** Hands over what is in the kit, whole or not: that is the person's call. It leaves the inventory now. */
    deliver() {
        const o = this.current
        if (!this.canDeliver) return null
        o.short = this.missing
        for (const [itemId, qty] of Object.entries(o.packed)) this.store.add(itemId, -qty)
        o.state = 'delivered'
        this.current = null
        this.#emit('delivered', o)
        return o
    }

    /* ---------------- closing ---------------- */

    /** What the shift came to, as the review tells it. */
    get review() {
        const delivered = this.orders.filter((o) => o.state === 'delivered')
        const partial = delivered.filter((o) => Object.keys(o.short ?? {}).length)
        const left = this.orders.filter((o) => o.state === 'left')
        const urgent = this.orders.find((o) => o.urgent)
        return {
            orders: this.orders.length,
            whole: delivered.filter((o) => !partial.includes(o)),
            partial,
            left,
            urgent: urgent && (urgent.state === 'left' ? 'left' : partial.includes(urgent) ? 'partial' : urgent.state === 'delivered' ? 'whole' : 'pending'),
            people: delivered.reduce((n, o) => n + o.people, 0),
            peopleLeft: left.reduce((n, o) => n + o.people, 0),
            sorted: this.sortedCount,
            boxesLeft: this.unopened,
            mistakes: this.mistakes,
            seconds: this.clock,
        }
    }
}
