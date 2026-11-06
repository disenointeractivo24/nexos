import assert from 'node:assert/strict'
import test from 'node:test'
import { COMPLAINS_BELOW, angerFor, complaintFor, moodFor } from '../src/sim/temper.js'
import { ARRIVALS, GUIDED, MEDICINE_IN_CARTONS, ORDERS, SHIFT_STOCK, TRUCK_GAP, Workday, categoryOf } from '../src/sim/workday.js'

/** A first truck that always brings the same, for the rules that are not about what comes. */
const FIRST = [
    { from: 'Barrio San Fernando', items: ['rice', 'rice', 'water', 'water', 'cans'] },
    { from: 'Barrio El Ingenio', items: ['medicine', 'soap', 'soap', 'hygieneKit'] },
    { from: 'Barrio La Flora', items: ['blanket', 'milk', 'milk'] },
]

/** Random numbers that repeat from one run to the next. */
const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

const fakeStore = (start = SHIFT_STOCK) => {
    const stock = { ...start }
    return { get: (id) => stock[id] ?? 0, add: (id, n) => (stock[id] = (stock[id] ?? 0) + n), stock }
}

function started(store = fakeStore()) {
    const day = new Workday({ store, first: FIRST })
    day.start()
    day.receive()
    return day
}

function sortBox(day, box) {
    day.openBox(box.id)
    for (const i of box.items) day.sort(box.id, i, categoryOf(i))
}

function pack(day) {
    for (const [id, q] of Object.entries(day.current.items)) for (let i = 0; i < q; i++) day.addToKit(id)
}

/** Until someone has arrived, at the line or straight at the counter. */
function untilJoined(day, id) {
    for (let i = 0; i < 400 && !day.orders.find((o) => o.id === id && o.state !== 'scheduled'); i++) day.tick(1)
}

/** Until someone is the one at the counter. */
function untilAtCounter(day, id) {
    for (let i = 0; i < 400 && day.current?.id !== id; i++) day.tick(1)
    assert.equal(day.current?.id, id)
}

test('cartons wait at the door until they are received, and only as many as fit come in', () => {
    const day = new Workday({ store: fakeStore(), first: FIRST, random: seeded(7) })
    day.start()
    assert.equal(day.boxes.length, 0)
    assert.equal(day.incoming.length, 3)
    assert.ok(day.todo.some((r) => r.id === 'receive'))
    assert.equal(day.receive().length, 3)
    assert.equal(day.incoming.length, 0)
    assert.deepEqual(day.receive(), [])
    day.orders.forEach((o) => (o.patience = 1e6))
    for (let i = 0; i < 300; i++) day.tick(1)
    assert.ok(day.incoming.length > 1)
    assert.equal(day.receive().length, 1, 'three on the counter leave room for one')
    assert.equal(day.room, 0)
    assert.equal(day.unopened, 4)
})

test('a carton opens only once, and is ready from the moment it arrives', () => {
    const day = started()
    assert.equal(day.unopened, 3)
    const { id } = day.boxes[0]
    assert.equal(day.openBox(id), true)
    assert.equal(day.openBox(id), false)
})

test('a wrong crate counts as a mistake and keeps the item out', () => {
    const store = fakeStore()
    const day = started(store)
    const b = day.boxes[0]
    day.openBox(b.id)
    const r = day.sort(b.id, 'rice', 'agua')
    assert.equal(r.ok, false)
    assert.ok(r.wanted)
    assert.equal(day.mistakes, 1)
    assert.equal(store.get('rice'), SHIFT_STOCK.rice)
})

test('on the shelf it counts: the inventory moves as each item is put away', () => {
    const store = fakeStore()
    const day = started(store)
    const b = day.boxes[0]
    day.openBox(b.id)
    day.sort(b.id, 'rice', categoryOf('rice'))
    assert.equal(store.get('rice'), SHIFT_STOCK.rice + 1)
    assert.equal(day.unsorted, b.items.length - 1)
})

test('there are always cartons to pick up, and the pile has a limit', () => {
    const day = started()
    for (const b of [...day.boxes]) sortBox(day, b)
    assert.equal(day.unopened, 0)
    day.orders.forEach((o) => (o.patience = 1e6))
    for (let i = 0; i < 300; i++) {
        day.tick(1)
        day.receive()
        assert.ok(day.unopened <= 4)
    }
    assert.ok(day.unopened >= 2)
})

test('a truck stays until all it brought is received, and only then the clock runs for the next', () => {
    const day = new Workday({ store: fakeStore(), first: FIRST, random: seeded(11) })
    day.orders.forEach((o) => (o.patience = 1e6))
    let arrivals = 0
    day.on((e) => e === 'incoming' && arrivals++)
    day.start()
    assert.equal(arrivals, 1)
    assert.equal(day.truckIn, 0, 'there is a truck at the door')
    for (let i = 0; i < 200; i++) day.tick(1)
    assert.equal(arrivals, 1, 'no second truck while the first one waits')
    assert.equal(day.incoming.length, 3)
    day.receive()
    assert.equal(day.truckIn, TRUCK_GAP)
    for (let i = 0; i < TRUCK_GAP - 1; i++) day.tick(1)
    assert.equal(arrivals, 1)
    assert.equal(day.truckIn, 1)
    day.tick(1)
    assert.equal(arrivals, 2)
    assert.ok(day.incoming.length >= 2)
    assert.equal(day.truckIn, 0)
})

test('with no room for all of it, what is left stays on the truck and the truck stays too', () => {
    const day = new Workday({ store: fakeStore(), first: [...FIRST, FIRST[0], FIRST[1], FIRST[2]] })
    day.start()
    assert.equal(day.receive().length, 4)
    assert.equal(day.incoming.length, 2)
    assert.equal(day.truckIn, 0)
    for (const b of day.boxes.slice(0, 2)) day.openBox(b.id)
    assert.equal(day.receive().length, 2)
    assert.equal(day.truckIn, TRUCK_GAP)
})

test('what comes in a carton is not known beforehand, and is different each time', () => {
    const load = (seed) => {
        const day = new Workday({ store: fakeStore(), random: seeded(seed) })
        day.start()
        return day.incoming.map((b) => b.items)
    }
    assert.notDeepEqual(load(1), load(2))
    const day = new Workday({ store: fakeStore(), random: seeded(3) })
    day.orders.forEach((o) => (o.patience = 1e6))
    day.start()
    const seen = new Set()
    for (let i = 0; i < 2000; i++) {
        for (const b of day.incoming) {
            assert.ok(b.items.length >= 2 && b.items.length <= 5)
            for (const id of b.items) seen.add(id)
        }
        day.incoming.length = 0
        day.nextTruck = 0
        day.tick(1)
    }
    assert.ok(seen.size >= 7, `only ${[...seen]}`)
})

test('nothing forces an order: whoever arrives can be attended before a single carton is opened', () => {
    const day = started()
    untilAtCounter(day, 'pedido-1')
    assert.equal(day.boxes.every((b) => b.state === 'received'), true)
    assert.equal(day.addToKit('rice').ok, true)
    assert.equal(day.canDeliver, true)
})

test('nobody has to be called: they come up by themselves, one at a time, each in turn', () => {
    const day = started()
    untilAtCounter(day, 'pedido-1')
    untilJoined(day, 'pedido-2')
    assert.equal(day.current.id, 'pedido-1')
    assert.equal(day.line.length, 1)
    pack(day)
    day.deliver()
    assert.equal(day.current, null)
    untilAtCounter(day, 'pedido-2')
    assert.equal(day.line.length, 0)
})

test('what is urgent comes up before anyone who has been waiting longer', () => {
    const day = started()
    untilAtCounter(day, 'pedido-1')
    day.orders.forEach((o) => (o.patience = 1e6))
    untilJoined(day, 'urgente')
    assert.equal(day.line.length, 3)
    day.addToKit('rice')
    day.deliver()
    untilAtCounter(day, 'urgente')
})

test('the next one can be brought forward: whoever was there goes back to the line, empty-handed', () => {
    const store = fakeStore()
    const day = started(store)
    assert.equal(day.callNext(), null, 'nobody waiting')
    untilAtCounter(day, 'pedido-1')
    assert.equal(day.callNext(), null, 'nobody else waiting')
    assert.equal(day.current.id, 'pedido-1')
    untilJoined(day, 'pedido-2')
    const first = day.current
    day.addToKit('rice')
    const events = []
    day.on((e) => events.push(e))
    assert.equal(day.callNext().id, 'pedido-2')
    assert.deepEqual(events, ['backToLine', 'order'])
    assert.equal(first.state, 'waiting')
    assert.deepEqual(first.packed, {})
    assert.equal(day.available('rice'), SHIFT_STOCK.rice)
    assert.equal(day.callNext().id, 'pedido-1', 'and back again')
})

test('who is next can be read beforehand, and is who comes up', () => {
    const day = started()
    assert.equal(day.nextInLine, null)
    untilAtCounter(day, 'pedido-1')
    day.orders.forEach((o) => (o.patience = 1e6))
    untilJoined(day, 'urgente')
    assert.equal(day.nextInLine.id, 'urgente')
    assert.equal(day.callNext().id, 'urgente')
    assert.equal(day.nextInLine.id, 'pedido-2')
})

test('a carton taken straight to a kit stays in the inventory when that person goes back', () => {
    const store = fakeStore({ ...SHIFT_STOCK, rice: 0 })
    const day = started(store)
    untilAtCounter(day, 'pedido-1')
    untilJoined(day, 'pedido-2')
    const b = day.boxes.find((x) => x.items.includes('rice'))
    day.openBox(b.id)
    day.addFromBox(b.id, 'rice')
    day.callNext()
    assert.equal(store.get('rice'), 1)
    assert.equal(day.available('rice'), 1)
})

test('going back to the line does not refill anyone\'s patience', () => {
    const day = started()
    untilAtCounter(day, 'pedido-1')
    untilJoined(day, 'pedido-2')
    const first = day.current
    const waited = first.waited
    assert.ok(waited > 0)
    day.callNext()
    day.callNext()
    assert.equal(day.current, first)
    assert.equal(first.waited, waited)
})

test('the first time, nothing happens until the person does it', () => {
    const day = new Workday({ store: fakeStore(), guided: true })
    day.start()
    assert.equal(day.incoming.length, 1)
    day.tick(1000)
    assert.equal(day.clock, 0)
    assert.equal(day.line.length + (day.current ? 1 : 0), 0)
    const [box] = day.receive()
    assert.deepEqual(box.items, GUIDED.carton.items)
    day.tick(1000)
    assert.equal(day.incoming.length, 0, 'no other truck')
    assert.equal(day.current, null)
})

test('the guided order comes up on opening the carton, and can be met from the carton and the shelves', () => {
    const day = new Workday({ store: fakeStore(), guided: true })
    day.start()
    const [box] = day.receive()
    day.openBox(box.id)
    assert.equal(day.current.id, GUIDED.order)
    assert.deepEqual(day.current.items, GUIDED.items)
    for (const id of Object.keys(GUIDED.items)) assert.ok(GUIDED.carton.items.includes(id) || SHIFT_STOCK[id] > 0, id)
    day.tick(1000)
    assert.equal(day.current.waited, 0, 'no hurry')
    assert.ok(day.addFromBox(box.id, 'rice').ok)
    assert.ok(day.addToKit('water').ok)
    assert.deepEqual(day.missing, {})
})

test('once the guided order is handed over, the day runs as any other', () => {
    const day = new Workday({ store: fakeStore(), guided: true })
    day.start()
    const [box] = day.receive()
    day.openBox(box.id)
    pack(day)
    day.deliver()
    assert.equal(day.calm, false)
    assert.equal(day.truckIn, GUIDED.truckAfter)
    for (let i = 0; i < GUIDED.truckAfter; i++) day.tick(1)
    assert.ok(day.incoming.length >= 2, 'the next truck')
    untilAtCounter(day, 'pedido-2')
    assert.equal(day.current.items.milk, ORDERS[1].items.milk)
})

test('a shift that is not guided never stands still', () => {
    const day = started()
    assert.equal(day.calm, false)
    day.tick(1)
    assert.equal(day.clock, 1)
})

test('faces follow the bar: glad in the green, losing patience in the amber, angry in the red', () => {
    assert.equal(moodFor(1), 'happy')
    assert.equal(moodFor(0.7), 'smile')
    assert.equal(moodFor(0.6), 'flat')
    assert.equal(moodFor(0.4), 'worried')
    assert.equal(moodFor(0.34), 'angry')
    assert.equal(moodFor(0), 'angry')
    assert.ok(moodFor(COMPLAINS_BELOW - 0.01) === 'angry', 'whoever complains is angry')
    assert.equal(moodFor(COMPLAINS_BELOW), 'worried', 'and not before the bar turns red')
})

test('anger only grows as the wait runs out', () => {
    assert.equal(angerFor(1), 0)
    assert.equal(angerFor(0.5), 0)
    assert.equal(angerFor(0), 1)
    for (let left = 1; left > 0; left -= 0.05) assert.ok(angerFor(left - 0.05) >= angerFor(left))
})

test('complaints depend on who says them and how close they are to leaving', () => {
    const waiting = { state: 'waiting' }
    assert.notEqual(complaintFor(waiting, 0.3, 0), complaintFor(waiting, 0.3, 1))
    assert.match(complaintFor(waiting, 0.1, 0), /nos vamos/)
    assert.match(complaintFor({ state: 'packing' }, 0.3, 0), /pedido/)
    assert.match(complaintFor({ state: 'waiting', urgent: true }, 0.1, 0), /pacientes/)
})

test('whoever waits too long in line leaves, and that is counted', () => {
    const day = started()
    const events = []
    day.on((e) => events.push(e))
    untilAtCounter(day, 'pedido-1')
    day.orders[0].patience = 1e6
    untilJoined(day, 'pedido-2')
    for (let i = 0; i <= ORDERS[1].patience; i++) day.tick(1)
    assert.ok(events.includes('impatient'))
    assert.equal(day.orders[1].state, 'left')
    assert.ok(events.includes('left'))
})

test('patience starts again at the counter, and has its limit there too', () => {
    const day = started()
    untilAtCounter(day, 'pedido-1')
    const o = day.current
    assert.ok(o.waited < 2)
    day.addToKit('rice')
    for (let i = 0; i <= o.patience; i++) day.tick(1)
    assert.notEqual(day.current?.id, 'pedido-1')
    assert.equal(o.state, 'delivered', 'they take what was in the kit')
    assert.equal(o.gaveUp, true)
    assert.deepEqual(o.packed, { rice: 1 })

    const empty = started()
    untilAtCounter(empty, 'pedido-1')
    const nothing = empty.current
    for (let i = 0; i <= nothing.patience; i++) empty.tick(1)
    assert.equal(nothing.state, 'left', 'with an empty kit, they leave with nothing')
    assert.notEqual(empty.current?.id, 'pedido-1')
})

test('the shelf counts leave out what is already in the kit', () => {
    const store = fakeStore()
    const day = started(store)
    untilAtCounter(day, 'pedido-1')
    day.addToKit('rice')
    assert.equal(day.available('rice'), SHIFT_STOCK.rice - 1)
    assert.equal(store.get('rice'), SHIFT_STOCK.rice)
})

test('the person may hand over what there is, and it is told as incomplete', () => {
    const store = fakeStore()
    const day = started(store)
    untilAtCounter(day, 'pedido-1')
    assert.equal(day.deliver(), null, 'not with an empty kit')
    day.addToKit('rice')
    const o = day.deliver()
    assert.deepEqual(o.short, { rice: 1, water: 2, soap: 1 })
    assert.equal(store.get('rice'), SHIFT_STOCK.rice - 1)
    assert.equal(day.current, null)
    assert.equal(day.review.partial.length, 1)
})

test('asking for more than the order, or than there is, is refused', () => {
    const day = started()
    untilAtCounter(day, 'pedido-1')
    assert.equal(day.addToKit('blanket').reason, 'extra')
    day.addToKit('rice')
    day.addToKit('rice')
    assert.equal(day.addToKit('rice').reason, 'extra')
    assert.equal(day.addToKit('soap').ok, true)
    const none = new Workday({ store: fakeStore({ soap: 0 }), first: FIRST, orders: [{ ...ORDERS[0] }] })
    none.start()
    untilAtCounter(none, 'pedido-1')
    assert.equal(none.addToKit('soap').reason, 'stock')
})

test('there is not enough medicine for everyone who asks for it, however long the shift', () => {
    const asked = ORDERS.reduce((n, o) => n + (o.items.medicine ?? 0), 0)
    assert.ok(SHIFT_STOCK.medicine + MEDICINE_IN_CARTONS < asked)
    for (const seed of [1, 2, 3, 4, 5]) {
        const day = new Workday({ store: fakeStore(), random: seeded(seed) })
        day.orders.forEach((o) => (o.patience = 1e6))
        day.start()
        let medicine = 0
        for (let i = 0; i < 300; i++) {
            medicine += day.incoming.flatMap((b) => b.items).filter((id) => id === 'medicine').length
            day.incoming.length = 0
            day.nextTruck = 0
            day.tick(1)
        }
        assert.ok(medicine <= MEDICINE_IN_CARTONS)
    }
})

test('from an open carton straight into the kit: the shelves stay as they were', () => {
    const store = fakeStore({ ...SHIFT_STOCK, milk: 0 })
    const day = started(store)
    untilAtCounter(day, 'pedido-1')
    day.addToKit('rice')
    day.deliver()
    untilAtCounter(day, 'pedido-2')
    const b = day.boxes.find((x) => x.items.includes('milk'))
    assert.equal(day.addFromBox(b.id, 'milk').reason, 'none', 'not while it is closed')
    day.openBox(b.id)
    assert.equal(day.addFromBox(b.id, 'soap').reason, 'extra')
    const left = b.left
    assert.equal(day.addFromBox(b.id, 'milk').ok, true)
    assert.equal(b.left, left - 1)
    assert.equal(day.current.packed.milk, 1)
    assert.equal(day.available('milk'), 0)
    day.deliver()
    assert.equal(store.get('milk'), 0)
})

test('what is loose in an open carton can be told apart from what truly ran out', () => {
    const day = started(fakeStore({ ...SHIFT_STOCK, milk: 0 }))
    assert.equal(day.inOpenCartons('milk'), 0, 'nobody knows until it is opened')
    const b = day.boxes.find((x) => x.items.includes('milk'))
    day.openBox(b.id)
    assert.equal(day.inOpenCartons('milk'), 2)
    day.sort(b.id, 'milk', categoryOf('milk'))
    assert.equal(day.inOpenCartons('milk'), 1)
    assert.equal(day.available('milk'), 1)
})

test('emptying a carton is told the same way, by either road', () => {
    const day = started()
    let emptied = 0
    day.on((e) => e === 'emptied' && emptied++)
    sortBox(day, day.boxes[0])
    assert.equal(emptied, 1)
})

test('the todo list follows what is going on', () => {
    const day = started()
    assert.ok(day.todo.some((r) => r.id === 'boxes'))
    untilAtCounter(day, 'pedido-1')
    assert.ok(day.todo.some((r) => r.id === 'order' && r.detail.startsWith('Falta')))
    untilJoined(day, 'pedido-2')
    assert.ok(day.todo.some((r) => r.id === 'line'))
    const urgentDay = started()
    urgentDay.orders.forEach((o) => (o.patience = 1e6))
    untilJoined(urgentDay, 'urgente')
    assert.equal(urgentDay.todo[0].id, 'urgent')
})

test('the whole shift ends in a review; pressure rises and falls', () => {
    const store = fakeStore()
    const day = started(store)
    let finished = null
    let peak = 0
    day.on((e, d) => e === 'finished' && (finished = d))
    for (let guard = 0; guard < 3000 && !finished; guard++) {
        day.tick(1)
        peak = Math.max(peak, day.pressure)
        day.receive()
        const open = day.boxes.find((b) => b.state === 'received')
        if (open && guard % 8 === 0) sortBox(day, open)
        if (day.current) {
            pack(day)
            if (day.canDeliver) day.deliver()
        }
    }
    assert.ok(finished, 'the shift should end')
    assert.equal(day.pressure, 0)
    assert.ok(peak > 0.3)
    assert.equal(finished.whole.length + finished.partial.length + finished.left.length, ORDERS.length)
    assert.ok(Object.values(store.stock).every((n) => n >= 0))
    assert.ok(ARRIVALS.length === ORDERS.length)
})
