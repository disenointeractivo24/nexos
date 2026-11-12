import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { isWorktop, mergeSurfaces } from '../src/world/room.js'

const up = new THREE.Vector3(0, 1, 0)

/**
 * A worktop as the headset would hand it over: its centre on the top face, and its own two
 * horizontal axes. `turn` is the yaw of its `u` axis, the way room.js reads it.
 */
function surface({ x = 0, z = 0, top = 0.73, w = 1.6, d = 0.8, turn = 0, label = 'table' } = {}) {
    const u = new THREE.Vector3(Math.cos(turn), 0, -Math.sin(turn))
    const v = new THREE.Vector3().crossVectors(u, up).negate().normalize()
    return { center: new THREE.Vector3(x, top, z), u, v, hu: w / 2, hv: d / 2, top, label, real: true }
}

/** A desk of a run, `i` places along it, as in a classroom row. */
const desk = (i, over = {}) => surface({ x: i * 1.6, ...over })
const row = (n, over = {}) => Array.from({ length: n }, (_, i) => desk(i, over))

const width = (s) => s.hu * 2
const depth = (s) => s.hv * 2

test('a row of desks pushed together is one counter, not one table each', () => {
    const [counter, ...rest] = mergeSurfaces(row(5))
    assert.equal(rest.length, 0, 'it should come back as a single worktop')
    assert.equal(counter.parts, 5)
    assert.ok(Math.abs(width(counter) - 5 * 1.6) < 0.01, `width ${width(counter)}`)
    assert.ok(Math.abs(depth(counter) - 0.8) < 0.01, `depth ${depth(counter)}`)
    assert.ok(Math.abs(counter.center.x - 2 * 1.6) < 0.01, 'centred on the run')
    assert.equal(counter.center.y, counter.top, 'still measured on its top face')
})

test('the same desk reported twice, as a plane and as a mesh, is still one desk', () => {
    // the runtime may hand over both; they land on each other, so they must not become two
    const [one, ...rest] = mergeSurfaces([surface(), surface({ top: 0.735 })])
    assert.equal(rest.length, 0)
    assert.ok(Math.abs(width(one) - 1.6) < 0.02, `it grew to ${width(one)}`)
    assert.ok(Math.abs(depth(one) - 0.8) < 0.02)
})

test('a desk reported the other way round still joins its run', () => {
    // nothing says which side the headset calls `u`: a quarter turn is the same rectangle
    const sideways = surface({ x: 1.6, w: 0.8, d: 1.6, turn: Math.PI / 2 })
    const [counter] = mergeSurfaces([desk(0), sideways, desk(2)])
    assert.equal(counter.parts, 3)
    assert.ok(Math.abs(width(counter) - 3 * 1.6) < 0.02, `width ${width(counter)}`)
})

test('desks of a set are never exactly level, and that does not split them', () => {
    const [counter] = mergeSurfaces([desk(0), desk(1, { top: 0.742 }), desk(2, { top: 0.718 })])
    assert.equal(counter.parts, 3)
})

test('what is not the same worktop stays on its own', () => {
    const aisle = desk(0, { z: 2.4 }) // the row across the walkway
    const shelf = desk(0, { top: 1.15 }) // something above the same spot
    const faraway = desk(9) // the far end of the room
    const runs = mergeSurfaces([desk(0), aisle, shelf, faraway])
    assert.equal(runs.length, 4, 'a gap, a height and a distance each keep them apart')
})

test('two rows facing each other are two counters, the longer one first', () => {
    const other = row(3).map((s) => surface({ x: s.center.x, z: 2.4 }))
    const runs = mergeSurfaces([...row(5), ...other])
    assert.equal(runs.length, 2)
    assert.equal(runs[0].parts, 5, 'the longer run leads')
    assert.equal(runs[1].parts, 3)
})

test('a run standing at an angle to the room is still one counter', () => {
    const turn = 0.6
    const turned = row(4).map((s, i) =>
        surface({ x: i * 1.6 * Math.cos(turn), z: i * 1.6 * -Math.sin(turn), turn })
    )
    const [counter, ...rest] = mergeSurfaces(turned)
    assert.equal(rest.length, 0, 'the angle must not split it')
    assert.ok(Math.abs(width(counter) - 4 * 1.6) < 0.03, `width ${width(counter)}`)
    assert.ok(Math.abs(depth(counter) - 0.8) < 0.03, `depth ${depth(counter)}`)
})

test('a single table is handed back as it was', () => {
    const only = surface({ w: 2, d: 1 })
    const [same, ...rest] = mergeSurfaces([only])
    assert.equal(rest.length, 0)
    assert.equal(same.parts, 1)
    assert.ok(Math.abs(width(same) - 2) < 1e-6)
    assert.ok(Math.abs(depth(same) - 1) < 1e-6)
})

test('nothing found is nothing to join', () => {
    assert.deepEqual(mergeSurfaces([]), [])
})

test('a joined counter is still something one can stand and work at', () => {
    const [counter] = mergeSurfaces(row(5))
    assert.equal(isWorktop(counter), true, 'a long run must not fall out of the worktop test')
})
