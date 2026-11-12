import assert from 'node:assert/strict'
import test from 'node:test'
import { EDGE_INSET, contains, fits, mergeSurfaces, readRoom, spotsAlong, usableArea, yawGap } from '../src/sim/room.js'

/** The classroom: five desks of this size pushed into one run, as in the reference model. */
const DESK = { w: 1.6, d: 0.8, top: 0.73 }
const desk = (i, over = {}) => ({ semanticLabel: 'table', cx: i * DESK.w, cz: 0, w: DESK.w, d: DESK.d, yaw: 0, top: DESK.top, ...over })
const row = (n, over = {}) => Array.from({ length: n }, (_, i) => desk(i, over))

/** A monitor standing on the run, as the headset would report it. */
const monitor = (x, z = -0.22) => ({ semanticLabel: 'screen', cx: x, cz: z, w: 0.6, d: 0.06, yaw: 0, top: 1.2, bottom: DESK.top })

const CARTON = { w: 0.34, d: 0.26 }

test('a run of desks pushed together is one work surface, not five', () => {
    const [surface, ...rest] = mergeSurfaces(row(5))
    assert.equal(rest.length, 0, 'it should come back as a single run')
    assert.equal(surface.parts, 5)
    assert.ok(Math.abs(surface.w - 5 * DESK.w) < 0.01, `width ${surface.w}`)
    assert.ok(Math.abs(surface.d - DESK.d) < 0.01, `depth ${surface.d}`)
    assert.ok(Math.abs(surface.cx - 2 * DESK.w) < 0.01, 'centred on the run')
})

test('desks that are not part of the same run stay apart', () => {
    const far = desk(0, { cz: 4 })
    const higher = desk(1, { top: DESK.top + 0.4 })
    const turned = desk(2, { yaw: Math.PI / 4 })
    const runs = mergeSurfaces([desk(0), far, higher, turned])
    assert.equal(runs.length, 4, 'a gap, a different height and a different angle each keep it apart')
})

test('two rows facing each other are two runs, the longer one first', () => {
    const other = row(3).map((t) => ({ ...t, cz: 3 }))
    const runs = mergeSurfaces([...row(5), ...other])
    assert.equal(runs.length, 2)
    assert.equal(runs[0].parts, 5, 'the longer run leads')
    assert.equal(runs[1].parts, 3)
})

test('a run turned in the room still comes back as one surface', () => {
    const yaw = 0.6
    const turned = row(4).map((t) => {
        const c = Math.cos(yaw)
        const s = Math.sin(yaw)
        return { ...t, yaw, cx: t.cx * c, cz: t.cx * s }
    })
    const [surface, ...rest] = mergeSurfaces(turned)
    assert.equal(rest.length, 0)
    assert.ok(Math.abs(surface.w - 4 * DESK.w) < 0.02, `width ${surface.w}`)
    assert.ok(yawGap(surface.yaw, yaw) < 0.01)
})

test('the band along the edge is not part of the usable area', () => {
    const [surface] = mergeSurfaces(row(5))
    const area = usableArea(surface)
    assert.ok(Math.abs(area.d - (DESK.d - EDGE_INSET * 2)) < 1e-9)
    assert.ok(contains(surface, surface.cx, surface.cz + DESK.d / 2 - 0.01), 'the very edge is still the table')
    assert.ok(!contains(area, surface.cx, surface.cz + DESK.d / 2 - 0.01), 'but it is not somewhere to stand a carton')
})

test('nothing is placed hanging over an edge', () => {
    const [surface] = mergeSurfaces(row(5))
    const area = usableArea(surface)
    const overhang = { x: surface.cx, z: surface.cz + area.d / 2, ...CARTON }
    assert.equal(fits(overhang, area), false, 'half of it would be in the air')
    assert.equal(fits({ x: surface.cx, z: surface.cz, ...CARTON }, area), true)
})

test('nothing is placed where something real already stands', () => {
    const [surface] = mergeSurfaces(row(5))
    const area = usableArea(surface)
    const screens = [monitor(surface.cx)]
    assert.equal(fits({ x: surface.cx, z: -0.22, ...CARTON }, area, screens), false, 'that is the monitor')
    assert.equal(fits({ x: surface.cx, z: 0.2, ...CARTON }, area, screens), true, 'in front of it there is room')
})

test('a row of cartons spreads along the whole run and dodges the monitors', () => {
    const [surface] = mergeSurfaces(row(5))
    const area = usableArea(surface)
    const screens = [0, 1, 2, 3, 4].map((i) => monitor(i * DESK.w))
    const spots = spotsAlong(area, CARTON, 4, screens)
    assert.equal(spots.length, 4, 'four places for four cartons')
    for (const spot of spots) {
        assert.ok(fits({ ...spot, ...CARTON }, area, screens), `${spot.x} is not a clear spot`)
    }
    const spread = Math.max(...spots.map((s) => s.x)) - Math.min(...spots.map((s) => s.x))
    assert.ok(spread > DESK.w, `they bunched up into ${spread.toFixed(2)} m`)
})

test('the room comes back as the shift needs it: a counter, a floor, and what is in the way', () => {
    const floor = { semanticLabel: 'floor', cx: 2, cz: 1, w: 8, d: 8, yaw: 0, top: 0 }
    const chair = { semanticLabel: 'other', cx: 1.2, cz: 1.1, w: 0.5, d: 0.5, yaw: 0, top: 0.9, bottom: 0 }
    const room = readRoom([...row(5), ...[0, 2, 4].map((i) => monitor(i * DESK.w)), floor, chair])
    assert.equal(room.surface.parts, 5, 'the five desks are the counter')
    assert.equal(room.floorY, 0)
    assert.equal(room.onSurface.length, 3, 'the monitors are on the counter')
    assert.ok(!room.onSurface.includes(chair), 'the chair is not')
    assert.ok(room.obstacles.includes(chair), 'but it is still something to dodge')
})

test('with no table reported, there is no counter to work on', () => {
    const room = readRoom([{ semanticLabel: 'floor', cx: 0, cz: 0, w: 6, d: 6, yaw: 0, top: 0 }])
    assert.equal(room.surface, null, 'the scene has to fall back to its own tent')
    assert.equal(room.floorY, 0)
})
