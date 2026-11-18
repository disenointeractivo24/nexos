import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { WorldLock, yawMatrix } from '../src/world/worldLock.js'
import { dedupeSurfaces } from '../src/world/room.js'

/** The SDK's world, as far as WorldLock uses it: a player that holds the camera and the hands. */
const fakeWorld = () => ({ player: new THREE.Group() })

/** WebXR's rigid transform, as browsers give it. */
globalThis.XRRigidTransform ??= class {
    constructor(p = {}, q = {}) {
        this.position = { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0, w: 1 }
        this.orientation = { x: q.x ?? 0, y: q.y ?? 0, z: q.z ?? 0, w: q.w ?? 1 }
        const m = new THREE.Matrix4().compose(new THREE.Vector3(this.position.x, this.position.y, this.position.z), new THREE.Quaternion(this.orientation.x, this.orientation.y, this.orientation.z, this.orientation.w), new THREE.Vector3(1, 1, 1))
        this.matrix = Float32Array.from(m.elements)
    }
}

/**
 * A headset whose reference space can be recentred: `origin` is where its space's origin is in the
 * real room. An anchor stays where it was laid in the real room.
 */
function fakeHeadset() {
    const h = {
        origin: new THREE.Matrix4(),
        anchors: [],
        frame: {
            createAnchor: async (t, space) => {
                // laid at t, in the space as it is now: its place in the real room never changes after
                const room = h.origin.clone().multiply(new THREE.Matrix4().fromArray(t.matrix))
                const anchor = { anchorSpace: { room } }
                h.anchors.push(anchor)
                return anchor
            },
            getPose: (anchorSpace) => {
                const inSpace = h.origin.clone().invert().multiply(anchorSpace.room)
                return { transform: { matrix: inSpace.elements } }
            },
        },
    }
    return h
}

/** Where a point fixed in the scene is in the real room, given the player (scene ← space) and the headset (room ← space). */
const inRoom = (world, h, scenePoint) => scenePoint.clone().applyMatrix4(world.player.matrixWorld.clone().invert()).applyMatrix4(h.origin)

test('with an anchor, a recentring of the headset leaves the shift where it was in the room', async () => {
    const world = fakeWorld()
    const h = fakeHeadset()
    const lock = new WorldLock(world)
    lock.begin()
    const table = yawMatrix(new THREE.Vector3(0.4, 0, -1.2), 0.3)
    assert.ok(await lock.lockAt(h.frame, 'space', table))
    const box = new THREE.Vector3(0.7, 0.86, -1.5)
    const before = inRoom(world, h, box)
    // the person recentres: the space's origin moves 1.3 m and turns 70°
    h.origin = yawMatrix(new THREE.Vector3(1.3, 0, -0.4), THREE.MathUtils.degToRad(70))
    // without correcting, the box would be elsewhere in the room
    assert.ok(inRoom(world, h, box).distanceTo(before) > 0.5)
    lock.update(h.frame, 'space')
    assert.ok(inRoom(world, h, box).distanceTo(before) < 1e-5)
    assert.equal(lock.report().correcciones, 1)
})

test('without anchors, the reset event with its transform keeps the shift in place too', () => {
    const world = fakeWorld()
    const lock = new WorldLock(world)
    let onReset
    lock.watch({ addEventListener: (_, fn) => (onReset = fn) })
    const h = fakeHeadset()
    const box = new THREE.Vector3(0.2, 0.9, -1)
    const before = inRoom(world, h, box)
    const T = yawMatrix(new THREE.Vector3(-0.5, 0, 0.8), 1.1)
    h.origin = h.origin.clone().multiply(T) // the new origin, given in the old space
    onReset({ transform: { matrix: T.elements } })
    assert.ok(inRoom(world, h, box).distanceTo(before) < 1e-5)
})

test('a reset without a transform is counted, not guessed at', () => {
    const world = fakeWorld()
    const lock = new WorldLock(world)
    let onReset
    lock.watch({ addEventListener: (_, fn) => (onReset = fn) })
    onReset({ transform: null })
    assert.equal(lock.report().resetsSinTransform, 1)
    assert.ok(world.player.matrix.equals(new THREE.Matrix4()))
})

test('a new session: the table found again is put where the scene had it', () => {
    const world = fakeWorld()
    const lock = new WorldLock(world)
    const sceneTable = yawMatrix(new THREE.Vector3(0.4, 0, -1.2), 0.3)
    const spaceTable = yawMatrix(new THREE.Vector3(-2, 0, 0.5), -1.0)
    lock.align(sceneTable, spaceTable)
    const p = new THREE.Vector3(0.1, 0.75, 0.05).applyMatrix4(spaceTable)
    const q = new THREE.Vector3(0.1, 0.75, 0.05).applyMatrix4(sceneTable)
    assert.ok(p.applyMatrix4(world.player.matrixWorld).distanceTo(q) < 1e-5)
})

test('one table reported as a plane and as a volume is one table; two tables side by side stay two', () => {
    const s = (id, source, x, top = 0.75) => ({ id, source, center: new THREE.Vector3(x, top, -1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1), hu: 0.6, hv: 0.3, top, label: 'table' })
    const out = dedupeSurfaces([s('volumen#3', 'volumen', 0.02, 0.76), s('plano#1', 'plano', 0), s('plano#2', 'plano', 1.2)])
    assert.equal(out.length, 2)
    assert.equal(out[0].id, 'plano#1')
    assert.deepEqual(out[0].merged, ['volumen#3'])
})
