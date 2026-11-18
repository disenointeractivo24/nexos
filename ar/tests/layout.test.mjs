import assert from 'node:assert/strict'
import test from 'node:test'
import {
    autoLayout,
    layoutProblems,
    mainTable,
    packOnTables,
    packStands,
    pickShelfZone,
    pointInPolygon,
    polygonInside,
    polygonsOverlap,
    rectFromCorners,
    rectPoly,
    shelfZoneCandidates,
    tablePoly,
} from '../src/world/layout.js'
import { FloorPlan } from '../src/world/floorplan.js'

/** A classroom desk, 1.2 × 0.6 m, top at 0.75 m, the person centred at it (as WorkFrame gives it). */
const FRAME = { minX: -0.6, maxX: 0.6, depth: 0.6, top: 0.75 }
const BOX = { w: 0.32, h: 0.22, d: 0.24 }
const STAND = { w: 0.32, d: 0.26 }

test('a point on the edge of a polygon is inside, one past it is not', () => {
    const sq = rectFromCorners({ x: 0, z: 0 }, { x: 1, z: 1 })
    assert.ok(pointInPolygon({ x: 0.5, z: 0.5 }, sq))
    assert.ok(pointInPolygon({ x: 1, z: 0.5 }, sq))
    assert.ok(!pointInPolygon({ x: 1.01, z: 0.5 }, sq))
})

test('a footprint whose centre is inside but a corner is out does not count as inside', () => {
    const zone = rectFromCorners({ x: 0, z: 0 }, { x: 1, z: 1 })
    assert.ok(pointInPolygon({ x: 0.9, z: 0.5 }, zone))
    assert.ok(!polygonInside(rectPoly(0.9, 0.5, 0.15, 0.1), zone))
    assert.ok(polygonInside(rectPoly(0.8, 0.5, 0.15, 0.1), zone))
})

test('two tables side by side touch but do not overlap', () => {
    const a = { cx: -0.6, cz: 0, hw: 0.6, hd: 0.3, yaw: 0 }
    const b = { cx: 0.6, cz: 0, hw: 0.6, hd: 0.3, yaw: 0 }
    assert.ok(!polygonsOverlap(tablePoly(a), tablePoly(b)))
    assert.ok(polygonsOverlap(tablePoly(a, 0.01), tablePoly(b)))
})

test('the automatic layout holds the person, the one table and the shelves, with no extra tables', () => {
    const layout = autoLayout(FRAME)
    assert.deepEqual(layoutProblems(layout), [])
    assert.equal(layout.tables.length, 1)
    assert.ok(pointInPolygon({ x: 0.9, z: 0.6 }, layout.area))
    assert.ok(polygonInside(layout.shelfZone, layout.area))
    for (const z of shelfZoneCandidates(FRAME)) assert.ok(polygonInside(z, layout.area))
})

test('the shelves go to the first zone where they all fit, else to the next one', () => {
    const layout = autoLayout(FRAME)
    const zones = shelfZoneCandidates(FRAME)
    const first = pickShelfZone(layout, zones, 5, STAND)
    assert.equal(first.zone, zones[0])
    assert.equal(first.spots.length, 5)
    // the floor to the right of the person is taken (furniture): the shelves go elsewhere, all of them
    const blocked = pickShelfZone(layout, zones, 5, STAND, { isFree: (x, z) => !(x > 0.3 && z < 1.6) })
    assert.notEqual(blocked.zone, zones[0])
    assert.equal(blocked.spots.length, 5)
})

test('stands go only in their zone, each whole, apart, facing the person; none in a full zone', () => {
    const layout = autoLayout(FRAME)
    const spots = packStands(layout, 5, STAND)
    assert.equal(spots.length, 5)
    for (const s of spots) {
        assert.ok(polygonInside(s.foot, layout.shelfZone), 'whole footprint in the zone')
        assert.ok(polygonInside(s.foot, layout.area), 'whole footprint in the area')
        // its front (+z, local) faces the person at (0, 0.35)
        const toPerson = Math.atan2(0 - s.x, 0.35 - s.z)
        assert.ok(Math.abs(Math.atan2(Math.sin(s.yaw - toPerson), Math.cos(s.yaw - toPerson))) < 1e-9)
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(!polygonsOverlap(spots[i].foot, spots[j].foot))
    // a zone too small: fewer than asked, and nothing anywhere else
    const tiny = { ...layout, shelfZone: rectFromCorners({ x: 0.5, z: 0.2 }, { x: 0.9, z: 0.55 }) }
    const few = packStands(tiny, 5, STAND)
    assert.ok(few.length < 5)
    for (const s of few) assert.ok(polygonInside(s.foot, tiny.shelfZone))
})

test('stands avoid what the floor plan says is taken', () => {
    const layout = autoLayout(FRAME)
    // only the part of the zone nearer the table than x = 0.8 is free
    const spots = packStands(layout, 5, STAND, { isFree: (x) => x < 0.8 })
    assert.ok(spots.length > 0)
    for (const s of spots) assert.ok(s.x < 0.8)
})

test('cartons sit whole on their own table: two tables side by side are never bridged', () => {
    const left = { id: 'mesa-1', label: 'a', cx: -0.6, cz: -0.3, hw: 0.6, hd: 0.3, yaw: 0, top: 0.75 }
    const right = { id: 'mesa-2', label: 'b', cx: 0.6, cz: -0.3, hw: 0.6, hd: 0.3, yaw: 0, top: 0.74 }
    const spots = packOnTables([left, right], 20, BOX)
    assert.ok(spots.length > 0)
    for (const s of spots) {
        const own = s.tableId === 'mesa-1' ? left : right
        assert.ok(polygonInside(s.foot, tablePoly(own)), `${s.tableId} carton wholly on its table`)
        // its base on the table's top, or on the carton below
        assert.equal(s.y, own.top + s.level * (BOX.h + 0.004))
    }
    assert.ok(spots.some((s) => s.tableId === 'mesa-2'))
})

test('the bottom layer of every table fills before any carton is stacked', () => {
    const t = mainTable(FRAME)
    const spots = packOnTables([t], 99, BOX, { levels: 2 })
    const firstStacked = spots.findIndex((s) => s.level === 1)
    assert.ok(firstStacked > 0)
    assert.ok(spots.slice(0, firstStacked).every((s) => s.level === 0))
    assert.ok(spots.length === firstStacked * 2)
})

test('the reserved end of the table (the family carton) gets no cartons, and a narrow table none at all', () => {
    const t = mainTable(FRAME)
    const reserve = [rectFromCorners({ x: -0.62, z: 0.02 }, { x: 0.08, z: -0.62 })]
    const spots = packOnTables([t], 20, BOX, { reserve })
    assert.ok(spots.length > 0)
    for (const s of spots) assert.ok(!polygonsOverlap(s.foot, reserve[0]))
    const strip = { ...t, hd: 0.1 }
    assert.equal(packOnTables([strip], 5, BOX).length, 0)
})

test('the floor plan keeps the whole of a body inside the area, not only its centre', () => {
    const layout = autoLayout(FRAME)
    const plan = new FloorPlan()
    plan.blockRect(0, -0.3, 0.6, 0.3)
    plan.keepInside(layout.area)
    plan.finalize({ x: 0, z: 0.35 })
    // right at the area's edge, a body of radius 0.42 does not fit; well inside it does
    assert.ok(!plan.free(-2.85, 1.0, 0.42))
    assert.ok(plan.free(-2.0, 1.0, 0.42))
    // the person's table is taken
    assert.ok(!plan.free(0, -0.3, 0.05))
})

test('problems are named: the person outside the area, a table not wholly in it', () => {
    const layout = autoLayout(FRAME)
    const small = { ...layout, area: rectFromCorners({ x: -0.7, z: -0.7 }, { x: 0.7, z: 0.2 }) }
    const problems = layoutProblems(small)
    assert.ok(problems.some((p) => /fuera del área/.test(p)))
})
