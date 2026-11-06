import { CATEGORIES, SUPPLIES } from '../../../src/data/catalog.js'

/**
 * The workday, with no 3D in it: what has arrived, who is waiting, what the person just
 * did. The scene asks it and shows the answer, so the rules can be read (and tested) alone.
 *
 * There is no fixed order to it. Cartons keep arriving and people keep coming; the person
 * decides whether to open, to sort or to attend, and the day answers to what they chose.
 */

/** Where donations come from. */
const NEIGHBOURHOODS = ['San Fernando', 'El Ingenio', 'La Flora', 'Meléndez', 'Aguablanca', 'Ciudad Jardín', 'San Antonio', 'Siloé', 'Granada', 'Pance'].map((n) => `Barrio ${n}`)

/** How often each supply turns up in a carton: people give much more food than medicine. */
const LIKELIHOOD = { rice: 5, water: 5, cans: 4, milk: 3, soap: 3, hygieneKit: 1.5, blanket: 1.5, medicine: 1 }

/** Medicine in cartons over a whole shift, however long: never enough for everyone who asks. */
export const MEDICINE_IN_CARTONS = 1
const CARTON_ITEMS = { min: 2, max: 5 }

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

/** What the counter holds. */
const MAX_BOXES = 4
/** Seconds from one truck leaving to the next one arriving, and how many cartons each brings. */
export const TRUCK_GAP = 40
const FIRST_TRUCK_CARTONS = 3
/**
 * The first time: one carton and a small order with one thing from it and one from the shelves,
 * enough to go through the whole job once. And the next truck, soon after, once it is over.
 */
export const GUIDED = { carton: { from: 'Barrio San Fernando', items: ['rice', 'soap', 'cans'] }, order: 'pedido-1', items: { rice: 1, water: 1 }, truckAfter: 12 }
/** Seconds the counter stays free between one person leaving and the next coming up. */
const COUNTER_GAP = 3

export const categoryOf = (itemId) => SUPPLIES[itemId].category
const clamp01 = (n) => Math.min(1, Math.max(0, n))
const low = (id) => SUPPLIES[id].label.toLowerCase()

export class Workday {
    /**
     * @param {{ store: { add(id: string, n: number): number, get(id: string): number },
     *           first?: { from: string, items: string[] }[], random?: () => number,
     *           orders?: typeof ORDERS, arrivals?: typeof ARRIVALS, guided?: boolean }} opts
     */
    constructor({ store, first = null, random = Math.random, orders = ORDERS, arrivals = ARRIVALS, guided = false }) {
        this.store = store
        this.first = guided ? [GUIDED.carton] : first
        /** Learning: time stands still, until that first order has been handed over. */
        this.calm = guided
        this.random = random
        this.medicineLeft = MEDICINE_IN_CARTONS
        this.boxes = []
        this.incoming = []
        this.boxCount = 0
        this.nextTruck = TRUCK_GAP
        this.counterFree = 0
        this.sortedCount = 0
        this.mistakes = 0
        this.orders = orders.map((o) => ({ ...o, items: { ...(guided && o.id === GUIDED.order ? GUIDED.items : o.items) }, packed: {}, state: 'scheduled', waited: 0, warned: false }))
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

    #between(min, max) {
        return min + Math.floor(this.random() * (max - min + 1))
    }

    /** One supply, as likely as people are to give it. */
    #anySupply() {
        const ids = Object.keys(LIKELIHOOD).filter((id) => id !== 'medicine' || this.medicineLeft > 0)
        let pick = this.random() * ids.reduce((n, id) => n + LIKELIHOOD[id], 0)
        const id = ids.find((x) => (pick -= LIKELIHOOD[x]) < 0) ?? ids[0]
        if (id === 'medicine') this.medicineLeft--
        return id
    }

    /** What someone gave: no two alike, and no knowing what is in it until it is opened. */
    #carton() {
        const items = Array.from({ length: this.#between(CARTON_ITEMS.min, CARTON_ITEMS.max) }, () => this.#anySupply())
        return { from: NEIGHBOURHOODS[this.#between(0, NEIGHBOURHOODS.length - 1)], items }
    }

    /** A truck at the door. It stays until every carton has been received; only then does the next one get closer. */
    #truckArrives(list) {
        this.incoming.push(...list)
        this.#emit('incoming', this.incoming.length)
    }

    /** The first truck is at the door, and the clock starts. */
    start() {
        if (this.started) return false
        this.started = true
        this.#truckArrives(this.first ?? Array.from({ length: FIRST_TRUCK_CARTONS }, () => this.#carton()))
        return true
    }

    /** Seconds until the next truck; none while one is waiting at the door. */
    get truckIn() {
        return this.incoming.length ? 0 : Math.max(0, Math.ceil(this.nextTruck))
    }

    /** Room for more on the counter, whoever brings them. */
    get room() {
        return Math.max(0, MAX_BOXES - this.unopened)
    }

    /**
     * Takes in what is at the door, as much as fits on the counter.
     * @returns the cartons that came in
     */
    receive() {
        const list = this.incoming.splice(0, this.room)
        if (!list.length) return []
        const boxes = list.map((b) => ({ ...b, id: `caja-${++this.boxCount}`, items: [...b.items], loose: [...b.items], state: 'received', left: b.items.length }))
        this.boxes.push(...boxes)
        if (!this.incoming.length) this.nextTruck = TRUCK_GAP
        this.#emit('received', boxes)
        return boxes
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
        if (normal.length) rows.push({ id: 'line', tone: 'work', label: 'En la fila', detail: normal.length === 1 ? `${normal[0].family} espera su turno` : `${normal.length} familias esperan su turno` })
        if (this.unsorted) rows.push({ id: 'sort', tone: 'work', label: 'Clasificar lo que abriste', detail: `${this.unsorted} ${this.unsorted === 1 ? 'insumo' : 'insumos'} en la mesa` })
        if (this.unopened) rows.push({ id: 'boxes', tone: 'work', label: 'Abrir cajas', detail: `${this.unopened} por abrir` })
        if (this.incoming.length) rows.push({ id: 'receive', tone: 'work', label: 'Recibir donaciones', detail: `El camión espera con ${this.incoming.length} ${this.incoming.length === 1 ? 'caja' : 'cajas'}` })
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

    /** Time passes: people arrive and come up in turn, patience runs out, more trucks come. */
    tick(dt) {
        if (!this.started || this.isFinished || this.calm) return
        this.clock += dt
        while (this.pending.length && this.pending[0].at <= this.clock) this.#arrive(this.pending.shift())

        if (!this.incoming.length) {
            this.nextTruck -= dt
            if (this.nextTruck <= 0) this.#truckArrives(Array.from({ length: this.#between(2, 3) }, () => this.#carton()))
        }

        for (const o of this.line) {
            if (this.#waits(o, dt)) {
                o.state = 'left'
                this.#emit('left', o)
            }
        }
        if (this.current && this.#waits(this.current, dt)) this.#runOutAtCounter(this.current)
        this.counterFree -= dt
        if (!this.current && this.counterFree <= 0 && this.line.length) this.#comeUp()

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

    /** While learning, nobody arrives on their own: the first person comes once there is a carton open. */
    #firstComes() {
        const first = this.pending.shift()
        this.clock = first.at
        this.#arrive(first)
        this.#comeUp()
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
        if (this.calm && !this.current) this.#firstComes()
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
        const at = b.loose.indexOf(itemId)
        if (at >= 0) b.loose.splice(at, 1)
        if (b.left === 0) b.state = 'empty'
        this.store.add(itemId, 1)
        this.sortedCount++
    }

    /* ---------------- people ---------------- */

    /** One more moment of waiting. @returns whether that was too much */
    #waits(o, dt) {
        o.waited += dt
        if (!o.warned && o.waited > o.patience * 0.65) {
            o.warned = true
            this.#emit('impatient', o)
        }
        return o.waited >= o.patience
    }

    /** Nobody has to be called: whoever is next comes up as soon as there is room, what is urgent first. */
    #comeUp(except = null) {
        const order = this.#nextOf(this.line.filter((o) => o !== except))
        order.state = 'packing'
        // patience starts again only the first time: going back to the line does not refill it
        if (!order.attended) {
            order.attended = true
            order.waited = 0
            order.warned = false
        }
        this.current = order
        this.#emit('order', order)
    }

    #nextOf(line) {
        return [...line].sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || (a.attended ? 1 : 0) - (b.attended ? 1 : 0) || b.waited - a.waited)[0] ?? null
    }

    /** Who would come up next: what is urgent first, then whoever has not been up yet, then whoever has waited longest. */
    get nextInLine() {
        return this.#nextOf(this.line)
    }

    /**
     * The person decides not to wait for the turn: the next one comes up now, and whoever was
     * at the counter goes back to the line. What was in their kit stays on the shelves.
     * @returns the order now at the counter, or null with nobody waiting
     */
    callNext() {
        if (!this.line.length) return null
        const previous = this.current
        if (previous) {
            previous.packed = {}
            previous.state = 'waiting'
            this.current = null
            this.#emit('backToLine', previous)
        }
        this.#comeUp(previous)
        return this.current
    }

    /** Waiting at the counter has its limit too: they take what is in the kit, if there is anything. */
    #runOutAtCounter(o) {
        if (this.canDeliver) {
            o.gaveUp = true
            this.deliver()
            return
        }
        o.state = 'left'
        this.current = null
        this.counterFree = COUNTER_GAP
        this.#emit('left', o)
    }

    /** How many of an item are on the shelves, leaving out what is already in the kit. */
    available(itemId) {
        return Math.max(0, this.store.get(itemId) - (this.current?.packed[itemId] ?? 0))
    }

    /** How many of an item are out in the open, in the cartons that have been opened. */
    inOpenCartons(itemId) {
        return this.boxes.filter((b) => b.state === 'open').reduce((n, b) => n + b.loose.filter((id) => id === itemId).length, 0)
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
        this.counterFree = COUNTER_GAP
        if (this.calm) {
            this.calm = false
            this.nextTruck = GUIDED.truckAfter
        }
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
            boxesLeft: this.unopened + this.incoming.length,
            mistakes: this.mistakes,
            seconds: this.clock,
        }
    }
}
