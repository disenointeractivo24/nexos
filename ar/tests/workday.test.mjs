import assert from 'node:assert/strict'
import test from 'node:test'
import { ARRIVALS, FIRST_DELIVERY, ORDERS, RESTOCK, SHIFT_STOCK, Workday, categoryOf } from '../src/sim/workday.js'

const fakeStore = (start = SHIFT_STOCK) => {
    const stock = { ...start }
    return { get: (id) => stock[id] ?? 0, add: (id, n) => (stock[id] = (stock[id] ?? 0) + n), stock }
}

function started(store = fakeStore()) {
    const day = new Workday({ store })
    day.start()
    return day
}

function sortBox(day, box) {
    day.openBox(box.id)
    for (const i of box.items) day.sort(box.id, i, categoryOf(i))
}

function pack(day) {
    for (const [id, q] of Object.entries(day.current.items)) for (let i = 0; i < q; i++) day.addToKit(id)
}

/** Brings someone to the line. */
function untilJoined(day, id) {
    for (let i = 0; i < 400 && !day.orders.find((o) => o.id === id && o.state !== 'scheduled'); i++) day.tick(1)
}

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
        assert.ok(day.unopened <= 4)
    }
    assert.ok(day.unopened >= 2)
})

test('nothing forces an order: people can be attended before a single carton is opened', () => {
    const day = started()
    untilJoined(day, 'pedido-1')
    assert.equal(day.boxes.every((b) => b.state === 'received'), true)
    assert.equal(day.call('pedido-1').id, 'pedido-1')
    assert.equal(day.addToKit('rice').ok, true)
    assert.equal(day.canDeliver, true)
})

test('only one at the counter; the person chooses who', () => {
    const day = started()
    untilJoined(day, 'pedido-2')
    assert.equal(day.line.length, 2)
    assert.equal(day.call('pedido-2').id, 'pedido-2')
    assert.equal(day.call('pedido-1'), null)
})

test('whoever waits too long leaves, and that is counted', () => {
    const day = started()
    const events = []
    day.on((e) => events.push(e))
    untilJoined(day, 'pedido-1')
    for (let i = 0; i <= ORDERS[0].patience; i++) day.tick(1)
    assert.ok(events.includes('impatient'))
    assert.equal(day.orders[0].state, 'left')
    assert.ok(events.includes('left'))
})

test('the shelf counts leave out what is already in the kit', () => {
    const store = fakeStore()
    const day = started(store)
    untilJoined(day, 'pedido-1')
    day.call('pedido-1')
    day.addToKit('rice')
    assert.equal(day.available('rice'), SHIFT_STOCK.rice - 1)
    assert.equal(store.get('rice'), SHIFT_STOCK.rice)
})

test('the person may hand over what there is, and it is told as incomplete', () => {
    const store = fakeStore()
    const day = started(store)
    untilJoined(day, 'pedido-1')
    day.call('pedido-1')
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
    untilJoined(day, 'pedido-1')
    day.call('pedido-1')
    assert.equal(day.addToKit('blanket').reason, 'extra')
    day.addToKit('rice')
    day.addToKit('rice')
    assert.equal(day.addToKit('rice').reason, 'extra')
    assert.equal(day.addToKit('soap').ok, true)
    const none = new Workday({ store: fakeStore({ soap: 0 }), orders: [{ ...ORDERS[0] }] })
    none.start()
    untilJoined(none, 'pedido-1')
    none.call('pedido-1')
    assert.equal(none.addToKit('soap').reason, 'stock')
})

test('there is not enough medicine for everyone who asks for it, however long the shift', () => {
    const inBoxes = [...FIRST_DELIVERY, ...RESTOCK].flatMap((b) => b.items).filter((i) => i === 'medicine').length
    const asked = ORDERS.reduce((n, o) => n + (o.items.medicine ?? 0), 0)
    assert.ok(SHIFT_STOCK.medicine + inBoxes < asked)
    assert.ok(!RESTOCK.flatMap((b) => b.items).includes('medicine'))
})

test('the todo list follows what is going on', () => {
    const day = started()
    assert.ok(day.todo.some((r) => r.id === 'boxes'))
    untilJoined(day, 'pedido-1')
    assert.ok(day.todo.some((r) => r.id === 'line'))
    day.call('pedido-1')
    assert.ok(day.todo.some((r) => r.id === 'order' && r.detail.startsWith('Falta')))
    const urgentDay = started()
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
        const open = day.boxes.find((b) => b.state === 'received')
        if (open && guard % 8 === 0) sortBox(day, open)
        if (!day.current && day.line.length) day.call((day.line.find((o) => o.urgent) ?? day.line[0]).id)
        if (day.current) {
            pack(day)
            if (day.canDeliver) day.deliver()
            else if (day.current.waited > 1e5) break
        }
    }
    assert.ok(finished, 'the shift should end')
    assert.equal(day.pressure, 0)
    assert.ok(peak > 0.3)
    assert.equal(finished.whole.length + finished.partial.length + finished.left.length, ORDERS.length)
    assert.ok(Object.values(store.stock).every((n) => n >= 0))
    assert.ok(ARRIVALS.length === ORDERS.length)
})
