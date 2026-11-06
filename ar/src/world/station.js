import * as THREE from 'three'
import { CATEGORIES, SUPPLIES } from '../../../src/data/catalog.js'
import { crateLabel, matPanel } from './panels.js'

/**
 * Real size of each supply, in metres: its longest side. The shared models are built for a
 * close-up, so this is what puts them at the scale of the carton they come in.
 */
const REAL_SIZE = { rice: 0.2, water: 0.3, cans: 0.14, milk: 0.2, medicine: 0.2, soap: 0.09, blanket: 0.3, hygieneKit: 0.2 }

/** The 40 × 30 × 30 cm carton from the catalog. */
const BOX = { w: 0.4, h: 0.3, d: 0.3 }
export const BOX_HEIGHT = BOX.h
const CRATE = { w: 0.5, h: 0.2, d: 0.32 }
const WALL = 0.007
/** How full a carton is: its contents stand on this much packing paper, so they show. */
const FILL = 0.6

/** Height of the top of the shelf's boards above its feet, measured in the model. */
const BOARD_TOP = [0.04, 0.72, 1.27, 1.82]

/** How much of the real floor shows through the tent's: what is on it must stay visible. */
const FLOOR_OPACITY = 0.42

/** Underside of the tent's roof above its floor, measured. */
const ROOF_Y = 2.65

/** The person stands between the counter and the shelves, facing the counter (-Z). */
export const WORKER = new THREE.Vector3(0.05, 0, -0.55)

const materialName = (o) => [o.material].flat()[0]?.name ?? ''

/**
 * The whole stand, exactly as it was modelled: its textures carry baked shadows of the desk,
 * the shelf and the stacked boxes, so none of them can move. Its floor at y = 0, its sign to
 * -Z, where the families come from. Returns where its furniture ended up.
 */
function tentOf(loader, template) {
    const tent = loader.instanceSync(template)
    tent.rotation.y = Math.PI
    tent.updateMatrixWorld(true)
    const boxOf = (pattern) => {
        const box = new THREE.Box3()
        tent.traverse((o) => {
            if (o.isMesh && pattern.test(materialName(o))) box.expandByObject(o)
        })
        return box
    }
    const floor = boxOf(/piso/i)
    tent.position.y = -floor.max.y
    tent.updateMatrixWorld(true)
    tent.traverse((o) => {
        if (!o.isMesh) return
        if (/piso/i.test(materialName(o))) {
            for (const m of [o.material].flat()) {
                m.transparent = true
                m.opacity = FLOOR_OPACITY
                m.depthWrite = false
            }
        }
        if (/techo|bombilla/i.test(materialName(o))) o.userData.roof = true
    })
    return { tent, desk: boxOf(/escritorio/i), shelf: boxOf(/estanteria/i) }
}

/** What one supply measures at its real size, and the factor that gives it. */
export function realSize(template, itemId) {
    const { x, y, z } = template.size
    const k = REAL_SIZE[itemId] / Math.max(x, y, z)
    return { k, w: x * k, h: y * k, d: z * k }
}

/** A supply from the shared builders, at `fit` times its real size, with its base at y = 0. */
export function supplyObject(loader, template, itemId, fit = 1) {
    const { k } = realSize(template, itemId)
    const obj = loader.instanceSync(template)
    obj.scale.setScalar(k * fit)
    const g = new THREE.Group()
    g.add(obj)
    g.name = `insumo:${itemId}`
    return g
}

export const preloadSupplies = (loader) =>
    Promise.all(Object.values(SUPPLIES).map((s) => loader.load(s.asset).then((t) => [s.id, t]))).then((pairs) => new Map(pairs))

/**
 * Lays objects out side by side inside a rectangle, row by row, so none touches another; if
 * they do not fit at their size, all shrink together.
 * @returns {{ fit: number, spots: {x: number, z: number}[] }} spots in the input's order, centred
 */
export function packInto(sizes, width, depth, gap = 0.012) {
    const attempt = (fit) => {
        const rows = [{ items: [], w: 0, d: 0 }]
        sizes.forEach((s, i) => {
            const w = s.w * fit
            const d = s.d * fit
            let row = rows[rows.length - 1]
            if (row.items.length && row.w + gap + w > width) rows.push((row = { items: [], w: 0, d: 0 }))
            row.items.push({ i, w, d })
            row.w += (row.items.length > 1 ? gap : 0) + w
            row.d = Math.max(row.d, d)
        })
        const total = rows.reduce((n, r) => n + r.d, 0) + gap * (rows.length - 1)
        const widest = Math.max(...rows.map((r) => r.w))
        return { rows, total, widest }
    }
    let fit = 1
    let layout = attempt(fit)
    for (let n = 0; n < 40 && (layout.total > depth || layout.widest > width); n++) {
        fit *= 0.95
        layout = attempt(fit)
    }
    const spots = []
    let z = -layout.total / 2
    for (const row of layout.rows) {
        let x = -row.w / 2
        for (const it of row.items) {
            spots[it.i] = { x: x + it.w / 2, z: z + row.d / 2 }
            x += it.w + gap
        }
        z += row.d + gap
    }
    return { fit, spots }
}

/** A carton's contents, standing on its packing paper: where each goes and how big, in the carton's space. */
export function cartonLayout(supplies, items, width = BOX.w - 0.03, depth = BOX.d - 0.03, floor = BOX.h * FILL) {
    const sizes = items.map((id) => realSize(supplies.get(id), id))
    const { fit, spots } = packInto(sizes, width, depth)
    return items.map((id, i) => ({ itemId: id, fit, position: new THREE.Vector3(spots[i].x, floor, spots[i].z) }))
}

/* ---------------- cardboard ---------------- */

function noiseTexture(base, grain, { lines = false } = {}) {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    // the fine vertical ribs of corrugated board, or the creases of crumpled paper
    if (lines) {
        for (let x = 0; x < size; x += 4) {
            ctx.fillStyle = `rgba(70,40,10,${x % 8 ? 0.035 : 0.07})`
            ctx.fillRect(x, 0, 2, size)
        }
    }
    for (let i = 0; i < (lines ? 600 : 90); i++) {
        ctx.fillStyle = `rgba(${grain},${Math.random() * 0.1})`
        const w = lines ? 2 + Math.random() * 10 : 18 + Math.random() * 60
        ctx.save()
        ctx.translate(Math.random() * size, Math.random() * size)
        ctx.rotate(lines ? 0 : Math.random() * Math.PI)
        ctx.fillRect(0, 0, w, lines ? 1.5 : 8 + Math.random() * 16)
        ctx.restore()
    }
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    return t
}

let shared = null
function cardboard() {
    if (shared) return shared
    const printCanvas = document.createElement('canvas')
    printCanvas.width = 512
    printCanvas.height = 256
    const c = printCanvas.getContext('2d')
    c.fillStyle = '#4A3320'
    c.font = '800 96px "Atkinson Hyperlegible Next", sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('NEXOS', 256, 92)
    c.font = '400 44px "Atkinson Hyperlegible Next", sans-serif'
    c.fillText('Donación · Cali', 256, 176)
    const print = new THREE.CanvasTexture(printCanvas)
    print.colorSpace = THREE.SRGBColorSpace
    shared = {
        kraft: new THREE.MeshStandardMaterial({ map: noiseTexture('#C39A6B', '80,50,20', { lines: true }), roughness: 0.92 }),
        inner: new THREE.MeshStandardMaterial({ color: '#A5835C', roughness: 1 }),
        paper: new THREE.MeshStandardMaterial({ map: noiseTexture('#E2D2B4', '120,95,60'), roughness: 1 }),
        print: new THREE.MeshBasicMaterial({ map: print, transparent: true, opacity: 0.75, depthWrite: false }),
    }
    return shared
}

/** Walls and bottom of one piece of cardboard, and the packing paper in it: an open box, truly hollow. */
function hollowBox(w, h, d, { fill = FILL } = {}) {
    const { kraft, inner, paper } = cardboard()
    const g = new THREE.Group()
    const add = (bw, bh, bd, x, y, z) => {
        // the outside in kraft, the inside a shade darker: the same board, seen from within
        const wall = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), kraft)
        wall.position.set(x, y, z)
        g.add(wall)
    }
    add(w, WALL, d, 0, WALL / 2, 0)
    add(w, h, WALL, 0, h / 2, d / 2 - WALL / 2)
    add(w, h, WALL, 0, h / 2, -d / 2 + WALL / 2)
    add(WALL, h, d - WALL * 2, w / 2 - WALL / 2, h / 2, 0)
    add(WALL, h, d - WALL * 2, -w / 2 + WALL / 2, h / 2, 0)
    const lining = new THREE.Mesh(new THREE.BoxGeometry(w - WALL * 2.2, h * 0.98, d - WALL * 2.2), new THREE.MeshStandardMaterial({ color: inner.color, roughness: 1, side: THREE.BackSide }))
    lining.position.y = h * 0.49 + WALL / 2
    g.add(lining)
    const filling = new THREE.Mesh(new THREE.PlaneGeometry(w - WALL * 2, d - WALL * 2).rotateX(-Math.PI / 2), paper)
    filling.position.y = h * fill
    g.add(filling)
    return g
}

/**
 * A carton in one piece of board: the box, two flaps that close flush with its top, and
 * tape along the seam and down its ends. Its base at y = 0.
 */
export function cardboardBox(tape = '#B8642A') {
    const { kraft, print } = cardboard()
    const g = hollowBox(BOX.w, BOX.h, BOX.d)
    const flaps = [-1, 1].map((side) => {
        const hinge = new THREE.Group()
        hinge.position.set(0, BOX.h, (side * BOX.d) / 2)
        const flap = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, 0.005, BOX.d / 2 - 0.001), kraft)
        flap.position.z = (-side * BOX.d) / 4
        hinge.add(flap)
        hinge.userData.side = side
        g.add(hinge)
        return hinge
    })
    const tapeMat = new THREE.MeshStandardMaterial({ color: tape, roughness: 0.45 })
    const seal = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(BOX.w + 0.002, 0.0015, 0.05), tapeMat)
    top.position.y = BOX.h + 0.0035
    seal.add(top)
    for (const side of [-1, 1]) {
        const end = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.07, 0.05), tapeMat)
        end.position.set((side * BOX.w) / 2 + side * 0.001, BOX.h - 0.035, 0)
        seal.add(end)
    }
    g.add(seal)
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), print)
    mark.position.set(0, BOX.h * 0.42, BOX.d / 2 + 0.0015)
    g.add(mark)
    g.userData.flaps = flaps
    g.userData.seal = seal
    return g
}

/** Where each category's crate rests: its board, and along it, seen from the person. */
const CRATE_SPOTS = [
    ['alimentos', 2, -0.62],
    ['agua', 2, 0],
    ['medicinas', 2, 0.62],
    ['higiene', 1, -0.34],
    ['refugio', 1, 0.34],
]

/**
 * The collection point around the person, in metres, y = 0 on the floor, facing -Z: the
 * stand as it was modelled, and what the shift needs on top of it. The counter is in front
 * (families on its far side): where the truck's cartons land on its left, then the mat where
 * a carton is opened, the button, and the mat where a kit is packed. The shelves are behind.
 */
export function buildStation(root, loader, stand) {
    const station = { root, zones: [] }
    const { tent, desk, shelf } = tentOf(loader, stand)
    root.add(tent)
    station.tent = tent

    const top = desk.max.y
    const nearEdge = desk.max.z
    const matZ = nearEdge - 0.32
    station.deskTop = top
    station.matZ = matZ
    station.deskFar = desk.min.z
    station.deskMaxX = desk.max.x
    station.solids = [
        { minX: desk.min.x, maxX: desk.max.x, minZ: desk.min.z, maxZ: desk.max.z },
        { minX: shelf.min.x, maxX: shelf.max.x, minZ: shelf.min.z, maxZ: shelf.max.z },
    ]

    const pad = (x, label, color) => {
        const { mesh } = matPanel(label, color)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(x, top + 0.003, matZ)
        root.add(mesh)
        return new THREE.Vector3(x, top + 0.004, matZ)
    }
    station.mat = pad(WORKER.x - 0.43, 'Abre aquí', '#28435F') // where a carton gets opened
    station.kitMat = pad(WORKER.x + 0.43, 'Arma el pedido', '#7A4B00') // where a kit gets packed

    // where the truck's cartons land: two side by side, and on top of them
    const intakeY = top + 0.002
    station.intake = [
        new THREE.Vector3(desk.min.x + 0.23, intakeY, matZ),
        new THREE.Vector3(desk.min.x + 0.7, intakeY, matZ),
        new THREE.Vector3(desk.min.x + 0.23, intakeY + BOX.h + 0.004, matZ),
        new THREE.Vector3(desk.min.x + 0.7, intakeY + BOX.h + 0.004, matZ),
    ]

    // the crates, on the stand's own boards, their labels towards the person
    const shelfGroup = new THREE.Group()
    shelfGroup.position.set((shelf.min.x + shelf.max.x) / 2, 0, (shelf.min.z + shelf.max.z) / 2)
    shelfGroup.rotation.y = Math.PI
    root.add(shelfGroup)
    station.shelf = shelfGroup

    for (const [categoryId, board, along] of CRATE_SPOTS) {
        const cat = CATEGORIES[categoryId]
        const crate = hollowBox(CRATE.w, CRATE.h, CRATE.d, { fill: 0.55 })
        const label = crateLabel(cat.label, cat.color, cat.tint)
        label.mesh.position.set(0, CRATE.h * 0.46, CRATE.d / 2 + 0.002)
        crate.add(label.mesh)
        crate.position.set(along, BOARD_TOP[board], 0)
        crate.name = `caja-categoria:${categoryId}`
        shelfGroup.add(crate)
        station.zones.push({ categoryId, crate, label })
    }
    return station
}

const support = new THREE.MeshStandardMaterial({ color: '#2B2118', roughness: 0.8 })
const rod = (radius, length) => new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), support)

/**
 * Two cords from a panel up to the tent's roof, so no sign floats on its own. Its top edge
 * stays at `topY`, and it grows downwards when its content does.
 */
export function hangFromRoof(panel, topY) {
    const { mesh } = panel
    const k = mesh.scale.y
    const length = (ROOF_Y - topY) / k
    const cords = [-1, 1].map((side) => {
        const cord = rod(0.004, length)
        cord.position.x = (side * panel.width) / 2.6
        mesh.add(cord)
        return cord
    })
    const settle = (h) => {
        mesh.position.y = topY - (h * k) / 2
        for (const cord of cords) cord.position.set(cord.position.x, h / 2 + length / 2, -0.002)
    }
    panel.onResize = settle
    settle(panel.height)
}

/** What a crate shows on top: one of each supply of its category, side by side. */
export function crateLayout(supplies, categoryId) {
    const items = Object.values(SUPPLIES)
        .filter((s) => s.category === categoryId)
        .map((s) => s.id)
    return cartonLayout(supplies, items, CRATE.w - 0.04, CRATE.d - 0.04, CRATE.h * 0.55)
}
