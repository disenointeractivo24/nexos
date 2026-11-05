import assert from 'node:assert/strict'
import test from 'node:test'
import { FIRST_DELIVERY, ORDERS, SECOND_DELIVERY, SHIFT_STOCK, Workday, categoryOf } from '../src/sim/workday.js'

const fakeStore = (start = SHIFT_STOCK) => {
    const stock = { ...start }
    return { get: (id) => stock[id] ?? 0, add: (id, n) => (stock[id] = (stock[id] ?? 0) + n), stock }
}

/** Takes the first truck through to the inventory. */
function firstTruckDone(store = fakeStore()) {
    const day = new Workday({ store })
    day.confirmArrival()
    for (const b of FIRST_DELIVERY) {
        day.openBox(b.id)
        for (const i of b.items) day.sort(b.id, i, categoryOf(i))
    }
    day.commit()
    return day
}

function pack(day) {
    for (const [id, q] of Object.entries(day.current.items)) for (let i = 0; i < q; i++) day.addToKit(id)
}

test('nothing can be opened before the arrival is confirmed', () => {
    const day = new Workday({ store: fakeStore() })
    assert.equal(day.openBox('caja-1'), false)
    assert.equal(day.confirmArrival(), true)
    assert.equal(day.confirmArrival(), false)
    assert.equal(day.openBox('caja-1'), true)
    assert.equal(day.openBox('caja-1'), false)
})

test('a wrong crate counts as a mistake and keeps the item out', () => {
    const day = new Workday({ store: fakeStore() })
    day.confirmArrival()
    day.openBox('caja-1')
    const r = day.sort('caja-1', 'rice', 'agua')
    assert.equal(r.ok, false)
    assert.ok(r.wanted)
    assert.equal(day.mistakes, 1)
    assert.equal(day.sortedCount, 0)
})

test('the inventory only moves on commit, and each batch is written once', () => {
    const store = fakeStore()
    const day = firstTruckDone(store)
    assert.equal(store.get('rice'), SHIFT_STOCK.rice + 2)
    assert.equal(day.commit(), null)
    assert.equal(day.received, 12)
})

test('stock not yet written cannot be handed out', () => {
    const store = fakeStore({ rice: 0 })
    const day = new Workday({ store, delivery: FIRST_DELIVERY.slice(0, 1) })
    day.confirmArrival()
    day.openBox('caja-1')
    for (const i of FIRST_DELIVERY[0].items) day.sort('caja-1', i, categoryOf(i))
    assert.equal(day.call('pedido-1'), null)
})

test('families join on schedule, and idle time brings them sooner', () => {
    const day = firstTruckDone()
    day.tick(0.1)
    assert.deepEqual(day.line.map((o) => o.id), ['pedido-1'])
    day.call('pedido-1')
    day.tick(46)
    assert.deepEqual(day.line.map((o) => o.id), ['pedido-2'])
})

test('only one order at the counter; the person chooses who', () => {
    const day = firstTruckDone()
    day.tick(0.1)
    day.tick(50)
    assert.equal(day.line.length, 2)
    assert.equal(day.call('pedido-2').id, 'pedido-2')
    assert.equal(day.call('pedido-1'), null)
})

test('whoever waits too long leaves, and that is counted', () => {
    const day = firstTruckDone()
    const events = []
    day.on((e) => events.push(e))
    day.tick(0.1)
    day.tick(ORDERS[0].patience * 0.7)
    assert.ok(events.includes('impatient'))
    day.tick(ORDERS[0].patience)
    assert.equal(day.orders[0].state, 'left')
    assert.ok(events.includes('left'))
    assert.equal(day.review.left.length >= 1, true)
})

test('a whole kit leaves the inventory only when delivered', () => {
    const store = fakeStore()
    const day = firstTruckDone(store)
    day.tick(0.1)
    day.call('pedido-1')
    const before = store.get('rice')
    pack(day)
    assert.equal(day.orders[0].state, 'ready')
    assert.equal(store.get('rice'), before)
    day.deliver()
    assert.equal(store.get('rice'), before - 2)
    assert.equal(day.current, null)
})

test('asking for more than the order refuses it', () => {
    const day = firstTruckDone()
    day.tick(0.1)
    day.call('pedido-1')
    assert.equal(day.addToKit('blanket').reason, 'extra')
})

test('scarcity: with nothing left, only what there is can be handed over', () => {
    const store = fakeStore({ medicine: 1, water: 5 })
    const day = new Workday({
        store,
        delivery: [{ id: 'x', from: 'y', items: ['water'] }],
        orders: [{ id: 'urgente', family: 'Clínica', people: 12, patience: 80, urgent: true, items: { medicine: 2, water: 1 }, visitors: [] }],
        schedule: [{ at: 0, type: 'family', id: 'urgente' }],
    })
    day.confirmArrival()
    day.openBox('x')
    day.sort('x', 'water', categoryOf('water'))
    day.commit()
    day.tick(0.1)
    day.call('urgente')
    assert.equal(day.deliver(), null)
    day.addToKit('medicine')
    assert.equal(day.addToKit('medicine').reason, 'stock')
    assert.equal(day.onlyPartial, false)
    day.addToKit('water')
    assert.equal(day.onlyPartial, true)
    const o = day.deliver()
    assert.deepEqual(o.short, { medicine: 1 })
    assert.equal(store.get('medicine'), 0)
    assert.equal(day.review.urgent, 'partial')
})

test('there is not enough medicine for everyone who asks for it', () => {
    const inBoxes = [...FIRST_DELIVERY, ...SECOND_DELIVERY].flatMap((b) => b.items).filter((i) => i === 'medicine').length
    const asked = ORDERS.reduce((n, o) => n + (o.items.medicine ?? 0), 0)
    assert.ok(SHIFT_STOCK.medicine + inBoxes < asked)
})

test('the whole shift ends in a review; pressure rises and falls', () => {
    const store = fakeStore()
    const day = firstTruckDone(store)
    let finished = null
    let peak = 0
    day.on((e, d) => e === 'finished' && (finished = d))
    for (let guard = 0; guard < 2000 && !finished; guard++) {
        day.tick(1)
        peak = Math.max(peak, day.pressure)
        const open = day.boxes.find((b) => b.state === 'received')
        if (open) {
            day.openBox(open.id)
            for (const i of open.items) day.sort(open.id, i, categoryOf(i))
        }
        if (day.readyToCommit) day.commit()
        if (!day.current && day.line.length) {
            const urgent = day.line.find((o) => o.urgent)
            day.call((urgent ?? day.line[0]).id)
        }
        if (day.current) {
            pack(day)
            day.deliver()
        }
    }
    assert.ok(finished, 'the shift should end')
    assert.equal(day.pressure, 0)
    assert.ok(peak > 0.3)
    assert.ok(['whole', 'partial'].includes(finished.urgent))
    assert.equal(finished.whole.length + finished.partial.length + finished.left.length, ORDERS.length)
    assert.ok(finished.partial.length >= 1, 'scarcity should leave someone short')
    assert.ok(Object.values(store.stock).every((n) => n >= 0))
})
