import assert from 'node:assert/strict'
import test from 'node:test'
import { clearance, fitTent, toLocal, toWorld } from '../src/world/fit.js'

const worker = { x: 0, z: 0 }
const footprints = [
    { minX: -1, maxX: 1, minZ: -1.2, maxZ: -0.6 }, // counter, ahead
    { minX: 0.6, maxX: 1.2, minZ: -0.4, maxZ: 0.6 }, // shelf, to the right
    { minX: -0.4, maxX: 0.4, minZ: -0.4, maxZ: 0.4 }, // the person
]

test('frames go both ways', () => {
    const p = toWorld({ x: 0.3, z: -0.7 }, { x: 1, z: 2 }, 0.8)
    const back = toLocal(p, { x: 1, z: 2 }, 0.8)
    assert.ok(Math.abs(back.x - 0.3) < 1e-9 && Math.abs(back.z + 0.7) < 1e-9)
})

test('an empty room keeps the person where they stand, facing where they look', () => {
    const f = fitTent({ head: { x: 0, z: 0 }, gazeYaw: 0, worker, footprints, obstacles: [] })
    assert.equal(f.moved, 0)
    assert.equal(f.turned, 0)
})

test('a wall right where the shelf would go: the tent turns or moves until it is clear', () => {
    const wall = Array.from({ length: 40 }, (_, i) => ({ x: 1.0, z: -2 + i * 0.1 }))
    assert.equal(clearance(wall, footprints, { x: 0, z: 0 }, 0), 0)
    const f = fitTent({ head: { x: 0, z: 0 }, gazeYaw: 0, worker, footprints, obstacles: wall })
    assert.ok(f.ok)
    assert.ok(clearance(wall, footprints, f.at, f.yaw) >= 0.3)
})
