import * as THREE from 'three'
import { CATEGORIES, SUPPLIES } from '../../../src/data/catalog.js'
import { crateLabel } from './panels.js'

/**
 * Real size of each supply, in metres: its longest side. The shared models are built for a
 * close-up, so this is what puts them at the scale of the carton they come in.
 */
const REAL_SIZE = { rice: 0.2, water: 0.3, cans: 0.11, milk: 0.2, medicine: 0.16, soap: 0.09, blanket: 0.3, hygieneKit: 0.2 }

/** A small donation carton, 32 × 24 × 22 cm: in the headset a bigger one towered over everything. */
export const BOX = { w: 0.32, h: 0.22, d: 0.24 }
/** A plastic crate on the inventory shelf: what a real collection point uses, at its real size. */
export const CRATE = { w: 0.28, h: 0.14, d: 0.22 }
const WALL = 0.007
/**
 * How large supplies are, everywhere they appear: the same in any carton, crate or kit. A little
 * under their real size, so that what a carton holds stays in the carton instead of towering over it.
 */
const SUPPLY_FIT = 0.72
/** How full a carton is: its contents stand on this much packing paper, so they show. */
const FILL = 0.55

const materialCache = new Map()
const mat = (color, roughness = 0.8, metalness = 0) => {
    const key = `${color}-${roughness}-${metalness}`
    if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }))
    return materialCache.get(key)
}

/** What one supply measures at its real size, and the factor that gives it. */
export function realSize(template, itemId) {
    const { x, y, z } = template.size
    const k = REAL_SIZE[itemId] / Math.max(x, y, z)
    return { k, w: x * k, h: y * k, d: z * k }
}

/**
 * A supply from the shared builders, at `fit` times its real size. Its origin is at the middle
 * of its volume, as a physics body needs; `userData.size` has what it measures.
 */
export function supplyObject(loader, template, itemId, fit = 1) {
    const { k, w, h, d } = realSize(template, itemId)
    const obj = loader.instanceSync(template)
    obj.scale.setScalar(k * fit)
    obj.position.y = (-h * fit) / 2
    const g = new THREE.Group()
    g.add(obj)
    g.name = `insumo:${itemId}`
    g.userData.size = { w: w * fit, h: h * fit, d: d * fit }
    g.userData.itemId = itemId
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

/**
 * A carton's contents, on its packing paper: where each goes, the middle of each, in the space
 * of the carton (origin at its middle). What does not fit beside the others goes on top.
 */
export function cartonLayout(supplies, items) {
    const width = BOX.w - 0.03
    const depth = BOX.d - 0.03
    const entries = items.map((id, i) => {
        const size = realSize(supplies.get(id), id)
        // only what could never fit in a carton gives way, and always by the same amount
        const fit = Math.min(SUPPLY_FIT, width / size.w, depth / size.d)
        return { i, itemId: id, fit, w: size.w * fit, d: size.d * fit, h: size.h * fit }
    })
    const layers = [[]]
    // the tallest go down, and what lies flat on top
    for (const entry of [...entries].sort((a, b) => b.h - a.h)) {
        const layer = layers[layers.length - 1]
        if (layer.length && packInto([...layer, entry], width, depth).fit < 1) layers.push([entry])
        else layer.push(entry)
    }
    const placed = []
    let y = BOX.h * FILL - BOX.h / 2
    for (const layer of layers) {
        const { spots } = packInto(layer, width, depth)
        layer.forEach((entry, n) => {
            placed[entry.i] = { itemId: entry.itemId, fit: entry.fit, position: new THREE.Vector3(spots[n].x, y + entry.h / 2, spots[n].z) }
        })
        y += Math.max(...layer.map((entry) => entry.h)) + 0.004
    }
    return placed
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
        // ink on board: opaque and cut out by its letters, pulled towards the eye, so it is never
        // sorted behind the board it is printed on, whatever the angle
        print: new THREE.MeshStandardMaterial({ map: print, alphaTest: 0.35, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    }
    return shared
}

/** Walls and bottom of one piece of material, and what lines its floor: an open box, truly hollow. Base at y = 0. */
function hollowBox(w, h, d, { fill = FILL, wall = cardboard().kraft, lining = true, floor = cardboard().paper } = {}) {
    const g = new THREE.Group()
    const add = (bw, bh, bd, x, y, z) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), wall)
        mesh.position.set(x, y, z)
        g.add(mesh)
    }
    add(w, WALL, d, 0, WALL / 2, 0)
    add(w, h, WALL, 0, h / 2, d / 2 - WALL / 2)
    add(w, h, WALL, 0, h / 2, -d / 2 + WALL / 2)
    add(WALL, h, d - WALL * 2, w / 2 - WALL / 2, h / 2, 0)
    add(WALL, h, d - WALL * 2, -w / 2 + WALL / 2, h / 2, 0)
    if (lining) {
        const inside = new THREE.Mesh(new THREE.BoxGeometry(w - WALL * 2.2, h * 0.98, d - WALL * 2.2), new THREE.MeshStandardMaterial({ color: cardboard().inner.color, roughness: 1, side: THREE.BackSide }))
        inside.position.y = h * 0.49 + WALL / 2
        g.add(inside)
    }
    if (floor) {
        const filling = new THREE.Mesh(new THREE.PlaneGeometry(w - WALL * 2, d - WALL * 2).rotateX(-Math.PI / 2), floor)
        filling.position.y = h * fill
        g.add(filling)
    }
    return g
}

/**
 * A carton in one piece of board: the box, two flaps that close flush with its top, and
 * tape along the seam and down its ends. Its origin at its middle, for physics; the flaps,
 * the seal and the top's height are in `userData`.
 */
export function cardboardBox(tape = '#B8642A') {
    const { kraft, print } = cardboard()
    const body = hollowBox(BOX.w, BOX.h, BOX.d)
    body.position.y = -BOX.h / 2
    const flaps = [-1, 1].map((side) => {
        const hinge = new THREE.Group()
        hinge.position.set(0, BOX.h, (side * BOX.d) / 2)
        const flap = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, 0.005, BOX.d / 2 - 0.001), kraft)
        flap.position.z = (-side * BOX.d) / 4
        hinge.add(flap)
        hinge.userData.side = side
        body.add(hinge)
        return hinge
    })
    const tapeMat = new THREE.MeshStandardMaterial({ color: tape, roughness: 0.45 })
    const seal = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(BOX.w + 0.002, 0.0015, 0.04), tapeMat)
    top.position.y = BOX.h + 0.0035
    seal.add(top)
    for (const side of [-1, 1]) {
        const end = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.055, 0.04), tapeMat)
        end.position.set((side * BOX.w) / 2 + side * 0.001, BOX.h - 0.0275, 0)
        seal.add(end)
    }
    body.add(seal)
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), print)
    mark.position.set(0, BOX.h * 0.42, BOX.d / 2 + 0.0015)
    body.add(mark)
    const g = new THREE.Group()
    g.add(body)
    g.userData.flaps = flaps
    g.userData.seal = seal
    g.userData.size = { w: BOX.w, h: BOX.h, d: BOX.d }
    return g
}

/** A closed carton, one box of board with its base at y = 0: it only rides on the hand truck. */
export function plainCarton() {
    return new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d).translate(0, BOX.h / 2, 0), cardboard().kraft)
}

/* ---------------- what stands in the room ---------------- */

/** A plain folding table for when the room has none: what a collection point would bring. Top at `top`. */
export function virtualTable(width, depth, top) {
    const g = new THREE.Group()
    const board = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, depth), mat('#D9D4CA', 0.7))
    board.position.y = top - 0.015
    g.add(board)
    const edge = new THREE.Mesh(new THREE.BoxGeometry(width + 0.004, 0.012, depth + 0.004), mat('#9C978E', 0.6))
    edge.position.y = top - 0.03
    g.add(edge)
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, top - 0.03, 10), mat('#5F646B', 0.4, 0.6))
            leg.position.set(sx * (width / 2 - 0.06), (top - 0.03) / 2, sz * (depth / 2 - 0.06))
            g.add(leg)
        }
    }
    return g
}

/** A wooden pallet on the floor, where what is donated gets set down. Base at y = 0. */
export const PALLET = { w: 0.9, h: 0.13, d: 0.8 }
export function pallet() {
    const g = new THREE.Group()
    const wood = mat('#B48A5A', 0.9)
    const dark = mat('#8E6A43', 0.9)
    for (let i = 0; i < 5; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(PALLET.w, 0.02, 0.12), wood)
        slat.position.set(0, PALLET.h - 0.01, -PALLET.d / 2 + 0.06 + (i * (PALLET.d - 0.12)) / 4)
        g.add(slat)
    }
    for (const x of [-1, 0, 1]) {
        const runner = new THREE.Mesh(new THREE.BoxGeometry(0.1, PALLET.h - 0.02, PALLET.d), dark)
        runner.position.set((x * (PALLET.w - 0.1)) / 2, (PALLET.h - 0.02) / 2, 0)
        g.add(runner)
    }
    return g
}

/** A small stand for one crate: a board on four legs, its top at `height`. Base at y = 0, centred. */
export const STAND = { w: CRATE.w + 0.04, d: CRATE.d + 0.04 }
export function crateStand(height) {
    const g = new THREE.Group()
    const steel = mat('#7E8792', 0.45, 0.55)
    const top = new THREE.Mesh(new THREE.BoxGeometry(STAND.w, 0.018, STAND.d), mat('#C9CED4', 0.6, 0.3))
    top.position.y = height - 0.009
    g.add(top)
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.022, height - 0.018, 0.022), steel)
            leg.position.set(sx * (STAND.w / 2 - 0.015), (height - 0.018) / 2, sz * (STAND.d / 2 - 0.015))
            g.add(leg)
        }
    }
    return g
}

/**
 * A low metal shelf, two boards, facing +Z: the inventory, beside the person instead of behind
 * them. Its boards' heights are given, so that the top one sits at the person's working height.
 * Base at y = 0, centred.
 */
export function lowShelf(width, depth, boards) {
    const g = new THREE.Group()
    const steel = mat('#7E8792', 0.45, 0.55)
    const board = mat('#C9CED4', 0.6, 0.3)
    const height = boards[boards.length - 1] + 0.02
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, height, 0.03), steel)
            post.position.set(sx * (width / 2 - 0.015), height / 2, sz * (depth / 2 - 0.015))
            g.add(post)
        }
    }
    for (const y of boards) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(width, 0.018, depth), board)
        b.position.y = y - 0.009
        g.add(b)
    }
    return g
}

/** A two-wheeled hand truck, for the volunteer to bring cartons in. Its nose plate at y = 0, facing +Z. */
export function handTruck() {
    const g = new THREE.Group()
    const steel = mat('#2F3842', 0.5, 0.5)
    for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.2, 8), steel)
        rail.position.set(sx * 0.2, 0.6, -0.05)
        rail.rotation.x = -0.12
        g.add(rail)
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 18).rotateZ(Math.PI / 2), mat('#1D1F22', 0.9))
        wheel.position.set(sx * 0.26, 0.11, -0.14)
        g.add(wheel)
    }
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.012, 0.22), steel)
    nose.position.set(0, 0.006, 0.08)
    g.add(nose)
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.44, 8).rotateZ(Math.PI / 2), mat('#D92632', 0.6))
    handle.position.set(0, 1.18, -0.13)
    g.add(handle)
    return g
}

/** A crate of one category, open, with its label towards the person. Base at y = 0. */
export function categoryCrate(categoryId) {
    const cat = CATEGORIES[categoryId]
    const plastic = mat(cat.color, 0.55)
    const crate = hollowBox(CRATE.w, CRATE.h, CRATE.d, { fill: 0.5, wall: plastic, lining: false, floor: mat('#3A3F45', 0.9) })
    const label = crateLabel(cat.label, cat.color, cat.tint, categoryId)
    label.mesh.position.set(0, CRATE.h * 0.5, CRATE.d / 2 + 0.003)
    crate.add(label.mesh)
    crate.name = `caja-categoria:${categoryId}`
    return { crate, label }
}

/** What a crate shows inside: one of each supply of its category, side by side, their middles. */
export function crateLayout(supplies, categoryId) {
    const items = Object.values(SUPPLIES)
        .filter((s) => s.category === categoryId)
        .map((s) => s.id)
    // on show, side by side: here they do give way, so that one of each fits along the crate
    const sizes = items.map((id) => realSize(supplies.get(id), id)).map((s) => ({ w: s.w * SUPPLY_FIT, d: s.d * SUPPLY_FIT }))
    const { fit, spots } = packInto(sizes, CRATE.w - 0.03, CRATE.d - 0.03)
    return items.map((id, i) => {
        const h = realSize(supplies.get(id), id).h * fit * SUPPLY_FIT
        return { itemId: id, fit: fit * SUPPLY_FIT, position: new THREE.Vector3(spots[i].x, CRATE.h * 0.5 + h / 2, spots[i].z) }
    })
}
