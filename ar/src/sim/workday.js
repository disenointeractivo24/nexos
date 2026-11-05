import { CATEGORIES, SUPPLIES } from '../../../src/data/catalog.js'

/**
 * The workday, with no 3D in it: what has arrived, who is waiting, what the person just
 * did. The scene asks it and shows the answer, so the rules can be read (and tested) alone.
 */

/** What comes off the first truck. */
export const FIRST_DELIVERY = [
    { id: 'caja-1', from: 'Barrio San Fernando', items: ['rice', 'rice', 'water', 'water', 'cans'] },
    { id: 'caja-2', from: 'Barrio El Ingenio', items: ['medicine', 'soap', 'soap', 'hygieneKit'] },
    { id: 'caja-3', from: 'Barrio La Flora', items: ['blanket', 'milk', 'milk'] },
]

/** What comes off the second one, in the middle of it all. */
export const SECOND_DELIVERY = [
    { id: 'caja-4', from: 'Barrio Meléndez', items: ['water', 'water', 'rice', 'cans'] },
    { id: 'caja-5', from: 'Barrio Aguablanca', items: ['soap', 'milk'] },
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

/**
 * When things happen, in seconds since the first inventory update. If the person has
 * nothing to do, the next thing simply comes sooner.
 */
export const SCHEDULE = [
    { at: 0, type: 'family', id: 'pedido-1' },
    { at: 45, type: 'family', id: 'pedido-2' },
    { at: 70, type: 'truck' },
    { at: 95, type: 'family', id: 'pedido-3' },
    { at: 130, type: 'family', id: 'urgente' },
    { at: 150, type: 'family', id: 'pedido-4' },
]

export const categoryOf = (itemId) => SUPPLIES[itemId].category

const prepareBox = (state) => (b) => ({ ...b, items: [...b.items], state, left: b.items.length })
const clamp01 = (n) => Math.min(1, Math.max(0, n))

export class Workday {
    /**
     * @param {{ store: { add(id: string, n: number): number, get(id: string): number },
     *           delivery?: typeof FIRST_DELIVERY, second?: typeof SECOND_DELIVERY,
     *           orders?: typeof ORDERS, schedule?: typeof SCHEDULE }} opts
     */
    constructor({ store, delivery = FIRST_DELIVERY, second = SECOND_DELIVERY, orders = ORDERS, schedule = SCHEDULE }) {
        this.store = store
        this.second = second
        this.boxes = delivery.map(prepareBox('waiting'))
        this.sorted = {} // item → units on the shelves, not yet written to the inventory
        this.sortedCount = 0
        this.mistakes = 0
        this.received = 0 // units written to the inventory, all shift
        this.arrived = false
        this.committed = false
        this.orders = orders.map((o) => ({ ...o, items: { ...o.items }, packed: {}, state: 'scheduled', waited: 0, warned: false }))
        this.pending = [...schedule].sort((a, b) => a.at - b.at)
        this.current = null
        this.clock = 0 // since the first inventory update: what the schedule counts
        this.elapsed = 0 // the whole shift, for the review
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

    get total() {
        return this.boxes.reduce((n, b) => n + b.items.length, 0)
    }

    get line() {
        return this.orders.filter((o) => o.state === 'waiting')
    }

    get finished() {
        return this.isFinished
    }

    /** The checklist, as the board shows it. */
    get tasks() {
        const opened = this.boxes.filter((b) => b.state !== 'waiting' && b.state !== 'received').length
        const kits = this.orders.filter((o) => o.state === 'ready' || o.state === 'delivered').length
        const closed = this.orders.filter((o) => o.state === 'delivered' || o.state === 'left').length
        const n = this.orders.length
        return [
            { id: 'receive', label: 'Recibir las cajas', progress: `${this.boxes.length} llegaron`, done: this.arrived && !this.pending.some((e) => e.type === 'truck') },
            { id: 'open', label: 'Abrir e inspeccionar', progress: `${opened}/${this.boxes.length}`, done: this.#boxesDone && opened === this.boxes.length },
            { id: 'sort', label: 'Clasificar en los estantes', progress: `${this.sortedCount}/${this.total}`, done: this.#boxesDone },
            { id: 'commit', label: 'Actualizar el inventario', done: this.committed && !this.readyToCommit && this.#boxesDone },
            { id: 'kits', label: 'Armar los pedidos', progress: `${kits}/${n}`, done: closed === n },
            { id: 'deliver', label: 'Entregar los pedidos', progress: `${this.orders.filter((o) => o.state === 'delivered').length}/${n}`, done: closed === n },
        ]
    }

    /* ---------------- the pressure of the moment ---------------- */

    /** From 0 (calm) to 1 (everything at once): what the room shows and sounds like. */
    get pressure() {
        if (this.isFinished) return 0
        const line = this.line
        const boxes = this.boxes.filter((b) => b.state !== 'empty' && b.state !== 'waiting').length
        const urgent = line.some((o) => o.urgent) || this.current?.urgent
        return clamp01(0.12 * line.length + 0.06 * boxes + (urgent ? 0.35 : 0) + 0.2 * Math.min(this.clock / 240, 1))
    }

    get #boxesDone() {
        return this.boxes.every((b) => b.state === 'empty')
    }

    /**
     * Time passes: people arrive, the ones in line lose patience. Call it every frame.
     * A person with nothing to do does not wait for the schedule.
     */
    tick(dt) {
        if (this.arrived && !this.isFinished) this.elapsed += dt
        if (!this.committed || this.isFinished) return
        this.clock += dt
        const idle = !this.current && !this.line.length && this.#boxesDone && !this.readyToCommit
        if (idle && this.pending.length) this.clock = Math.max(this.clock, this.pending[0].at)
        while (this.pending.length && this.pending[0].at <= this.clock) this.#fire(this.pending.shift())
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
        if (!this.pending.length && !this.current && !this.line.length && this.#boxesDone && !this.readyToCommit) {
            this.isFinished = true
            this.#emit('finished', this.review)
        }
    }

    #fire(event) {
        if (event.type === 'truck') {
            const boxes = this.second.map(prepareBox('received'))
            this.boxes.push(...boxes)
            this.#emit('truck', boxes)
            return
        }
        const order = this.orders.find((o) => o.id === event.id)
        if (!order) return
        order.state = 'waiting'
        this.#emit('joined', order)
    }

    /* ---------------- receiving ---------------- */

    confirmArrival() {
        if (this.arrived) return false
        this.arrived = true
        for (const b of this.boxes) b.state = 'received'
        this.#emit('arrived')
        return true
    }

    box(id) {
        return this.boxes.find((b) => b.id === id)
    }

    /** A box can only be opened once its arrival is confirmed, and only once. */
    openBox(id) {
        const b = this.box(id)
        if (!b || b.state !== 'received') return false
        b.state = 'open'
        this.#emit('opened', b)
        return true
    }

    /**
     * An item let go over a category's crate.
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
        b.left--
        if (b.left === 0) b.state = 'empty'
        this.sorted[itemId] = (this.sorted[itemId] ?? 0) + 1
        this.sortedCount++
        this.#emit('sorted', { itemId, categoryId, box: b })
        if (this.#boxesDone) this.#emit('allSorted')
        return { ok: true }
    }

    get readyToCommit() {
        return this.#boxesDone && Object.keys(this.sorted).length > 0
    }

    /** Writes what is on the shelves into the point's inventory. Until then, nobody can be given it. */
    commit() {
        if (!this.readyToCommit) return null
        const lines = Object.entries(this.sorted).map(([itemId, qty]) => ({ itemId, qty, now: this.store.add(itemId, qty) }))
        for (const { qty } of lines) this.received += qty
        this.sorted = {}
        const first = !this.committed
        this.committed = true
        this.#emit('committed', { lines, first })
        return lines
    }

    /* ---------------- families ---------------- */

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

    /** How many of an item can still be given to the order at the counter. */
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

    /** Nothing more of what they need is left: they can only be given what there is. */
    get onlyPartial() {
        const o = this.current
        if (!o || o.state !== 'packing') return false
        const ids = Object.keys(this.missing)
        return ids.length > 0 && ids.every((id) => this.available(id) === 0)
    }

    /**
     * Something put into the current kit.
     * @returns {{ ok: boolean, reason?: 'none'|'extra'|'stock', index?: number }}
     */
    addToKit(itemId) {
        const o = this.current
        if (!o || o.state !== 'packing') return { ok: false, reason: 'none' }
        const wanted = o.items[itemId] ?? 0
        const have = o.packed[itemId] ?? 0
        if (have >= wanted) return { ok: false, reason: 'extra' }
        if (this.available(itemId) <= 0) return { ok: false, reason: 'stock' }
        o.packed[itemId] = have + 1
        const index = Object.values(o.packed).reduce((n, q) => n + q, 0) - 1
        const complete = Object.entries(o.items).every(([id, q]) => (o.packed[id] ?? 0) >= q)
        if (complete) o.state = 'ready'
        this.#emit('packed', { order: o, itemId, complete })
        return { ok: true, index }
    }

    /** Hands the kit over, whole or with what there is; only now does it leave the inventory. */
    deliver() {
        const o = this.current
        if (!o || !(o.state === 'ready' || this.onlyPartial)) return null
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
        const whole = delivered.filter((o) => !Object.keys(o.short ?? {}).length)
        const partial = delivered.filter((o) => Object.keys(o.short ?? {}).length)
        const left = this.orders.filter((o) => o.state === 'left')
        const urgent = this.orders.find((o) => o.urgent)
        return {
            orders: this.orders.length,
            whole,
            partial,
            left,
            urgent: urgent && (urgent.state === 'left' ? 'left' : Object.keys(urgent.short ?? {}).length ? 'partial' : urgent.state === 'delivered' ? 'whole' : 'pending'),
            people: delivered.reduce((n, o) => n + o.people, 0),
            peopleLeft: left.reduce((n, o) => n + o.people, 0),
            received: this.received,
            mistakes: this.mistakes,
            seconds: this.elapsed,
        }
    }
}
