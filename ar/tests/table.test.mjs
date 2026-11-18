import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { isWorktop, sameTable, tableInFront } from '../src/world/room.js'

/**
 * A table of the room, level, with its near edge across the view: `x` and `z` are its centre, `top`
 * its height over the floor. A room's own tables and the neighbours' are told apart only by where
 * they are, which is what being in front of one means.
 */
const table = (id, x, z, { top = 0.75, hu = 0.6, hv = 0.35 } = {}) => ({
    id,
    center: new THREE.Vector3(x, top, z),
    u: new THREE.Vector3(1, 0, 0),
    v: new THREE.Vector3(0, 0, 1),
    hu,
    hv,
    top,
    label: 'table',
    real: true,
    source: 'plano',
})

/** Someone standing at the origin, looking along −Z unless told otherwise. */
const head = new THREE.Vector3(0, 1.6, 0)
const looking = (yaw) => new THREE.Vector3(Math.sin(yaw), -0.25, -Math.cos(yaw)).normalize()
const ahead = looking(0)

test('of all the tables in the room, only the one in front is offered', () => {
    const mine = table('plano#1', 0, -1.2)
    const room = [mine, table('plano#2', 3.2, -1.0), table('plano#3', -3.0, -0.8), table('plano#4', 0.2, 2.4)]
    assert.equal(tableInFront(room, head, ahead)?.id, 'plano#1')
})

test('turning to another table offers that one instead', () => {
    const room = [table('plano#1', 0, -1.2), table('plano#2', 2.0, -0.2)]
    const right = tableInFront(room, head, looking(Math.PI / 2))
    assert.equal(right?.id, 'plano#2')
})

test('two tables side by side: the gaze picks one, and small turns of the head do not swap it', () => {
    const left = table('plano#1', -0.7, -1.2)
    const right = table('plano#2', 0.7, -1.2)
    const room = [left, right]
    const first = tableInFront(room, head, looking(-0.42))
    assert.equal(first?.id, 'plano#1')
    // the head drifts towards the middle, between the two: the one already marked is held
    let current = first
    for (const yaw of [-0.3, -0.15, -0.05, 0]) current = tableInFront(room, head, looking(yaw), current)
    assert.equal(current?.id, 'plano#1')
    // turning well onto the other one does change it
    assert.equal(tableInFront(room, head, looking(0.45), current)?.id, 'plano#2')
})

test('with the back to every table, none is offered: the person marks theirs by hand', () => {
    const room = [table('plano#1', 0, -1.2), table('plano#2', 0.6, -1.6)]
    assert.equal(tableInFront(room, head, looking(Math.PI)), null)
})

test('a table across the room is not the one in front', () => {
    const far = table('plano#9', 0, -6.5)
    assert.equal(tableInFront([far], head, ahead), null)
    assert.equal(tableInFront([far, table('plano#1', 0, -1.1)], head, ahead)?.id, 'plano#1')
})

test('the same table found again in the next frame is the same one, by id or by where it is', () => {
    assert.ok(sameTable(table('plano#1', 0, -1.2), table('plano#1', 0, -1.2)))
    assert.ok(!sameTable(table('plano#1', 0, -1.2), table('plano#2', 0, -1.2)))
    const a = { ...table('x', 0, -1.2), id: null }
    const b = { ...table('x', 0.05, -1.25), id: null }
    assert.ok(sameTable(a, b))
    const far = { ...table('x', 0, -2.0), id: null }
    assert.ok(!sameTable(a, far))
})

test('only tables one can stand and work at are offered at all', () => {
    const low = table('plano#1', 0, -1.2, { top: 0.3 })
    const small = table('plano#2', 0, -1.2, { hu: 0.1, hv: 0.1 })
    const good = table('plano#3', 0, -1.2)
    const room = [low, small, good].filter((s) => isWorktop(s, 0))
    assert.deepEqual(room.map((s) => s.id), ['plano#3'])
    assert.equal(tableInFront(room, head, ahead)?.id, 'plano#3')
})
