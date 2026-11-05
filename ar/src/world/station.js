import * as THREE from 'three'
import { supplyBox } from '../../../src/three/props.js'
import { CATEGORIES, SUPPLIES } from '../../../src/data/catalog.js'
import { crateLabel } from './panels.js'

/**
 * Real size of each supply, in metres: its longest side. The shared models are built for a
 * close-up, so this is what puts them at the scale of the carton they come in.
 */
const REAL_SIZE = { rice: 0.2, water: 0.3, cans: 0.14, milk: 0.2, medicine: 0.2, soap: 0.09, blanket: 0.3, hygieneKit: 0.2 }

/** The 40 × 30 × 30 cm carton from the catalog, from the shared box model (0.9 × 0.5 × 0.7 m). */
const BOX = { w: 0.4, h: 0.3, d: 0.3 }
export const BOX_HEIGHT = BOX.h
const CRATE = { w: 0.5, h: 0.2, d: 0.32 }

/** Height of the top of the shelf's boards above its feet, measured in the model. */
const BOARD_TOP = [0.04, 0.72, 1.27, 1.82]

/** How much of the real floor shows through the tent's: what is on it must stay visible. */
const FLOOR_OPACITY = 0.42

/** Underside of the tent's roof above its floor, measured. */
const ROOF_Y = 2.65

/** The person stands between the counter and the shelves, facing the counter (-Z). */
export const WORKER = new THREE.Vector3(0.05, 0, -0.55)

const dark = new THREE.MeshBasicMaterial({ color: '#2B2118' })

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

/** A carton's contents, poking out of its top: where each goes and how big, in the carton's space. */
export function cartonLayout(supplies, items, width = BOX.w - 0.03, depth = BOX.d - 0.03, top = BOX.h) {
    const sizes = items.map((id) => realSize(supplies.get(id), id))
    const { fit, spots } = packInto(sizes, width, depth)
    return items.map((id, i) => ({ itemId: id, fit, position: new THREE.Vector3(spots[i].x, top - sizes[i].h * fit * 0.6, spots[i].z) }))
}

/**
 * A sealed carton: the shared box, with two flaps and the tape that gets pulled off.
 * Built around y = 0 at its base.
 */
export function cardboardBox(tape = '#B8642A') {
    const g = new THREE.Group()
    const body = supplyBox(tape)
    body.scale.set(BOX.w / 0.9, BOX.h / 0.5, BOX.d / 0.7)
    g.add(body)
    const flapMat = new THREE.MeshStandardMaterial({ color: '#C9A47A', roughness: 0.9, side: THREE.DoubleSide })
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(BOX.w - 0.02, BOX.d - 0.02).rotateX(-Math.PI / 2), dark)
    inside.position.y = BOX.h + 0.001
    g.add(inside)
    const flaps = [-1, 1].map((side) => {
        const hinge = new THREE.Group()
        hinge.position.set(0, BOX.h + 0.004, (side * BOX.d) / 2)
        const flap = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, 0.004, BOX.d / 2), flapMat)
        flap.position.z = (-side * BOX.d) / 4
        hinge.add(flap)
        hinge.userData.side = side
        g.add(hinge)
        return hinge
    })
    const seal = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.002, BOX.d + 0.01), new THREE.MeshStandardMaterial({ color: tape, roughness: 0.6 }))
    seal.position.y = BOX.h + 0.008
    g.add(seal)
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
    station.solids = [
        { minX: desk.min.x, maxX: desk.max.x, minZ: desk.min.z, maxZ: desk.max.z },
        { minX: shelf.min.x, maxX: shelf.max.x, minZ: shelf.min.z, maxZ: shelf.max.z },
    ]

    const pad = (x, w, d, color) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.006, d), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }))
        m.position.set(x, top + 0.003, matZ)
        root.add(m)
        return new THREE.Vector3(x, top + 0.006, matZ)
    }
    station.mat = pad(WORKER.x - 0.43, 0.52, 0.5, '#28435F') // where a carton gets opened
    station.kitMat = pad(WORKER.x + 0.43, 0.52, 0.5, '#7A4B00') // where a kit gets packed

    // where the truck's cartons land: two side by side, and on top of them
    const intakeY = top + 0.002
    station.intake = [
        new THREE.Vector3(desk.min.x + 0.23, intakeY, matZ),
        new THREE.Vector3(desk.min.x + 0.7, intakeY, matZ),
        new THREE.Vector3(desk.min.x + 0.23, intakeY + BOX.h, matZ),
        new THREE.Vector3(desk.min.x + 0.7, intakeY + BOX.h, matZ),
    ]

    // the crates, on the stand's own boards, their labels towards the person
    const shelfGroup = new THREE.Group()
    shelfGroup.position.set((shelf.min.x + shelf.max.x) / 2, 0, (shelf.min.z + shelf.max.z) / 2)
    shelfGroup.rotation.y = Math.PI
    root.add(shelfGroup)
    station.shelf = shelfGroup

    for (const [categoryId, board, along] of CRATE_SPOTS) {
        const cat = CATEGORIES[categoryId]
        const crate = new THREE.Group()
        const body = supplyBox(cat.color)
        body.scale.set(CRATE.w / 0.9, CRATE.h / 0.5, CRATE.d / 0.7)
        crate.add(body)
        const inside = new THREE.Mesh(new THREE.PlaneGeometry(CRATE.w - 0.02, CRATE.d - 0.02).rotateX(-Math.PI / 2), dark)
        inside.position.y = CRATE.h + 0.001
        crate.add(inside)
        const label = crateLabel(cat.label, cat.color, cat.tint)
        label.mesh.position.set(0, CRATE.h * 0.24, CRATE.d / 2 + 0.012) // below the shared box's band
        crate.add(label.mesh)
        crate.position.set(along, BOARD_TOP[board], 0)
        crate.name = `caja-categoria:${categoryId}`
        shelfGroup.add(crate)
        station.zones.push({ categoryId, crate })
    }
    return station
}

const support = new THREE.MeshStandardMaterial({ color: '#2B2118', roughness: 0.8 })
const rod = (radius, length) => new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), support)

/** Two cords from a panel up to the tent's roof, so no sign floats on its own. Call once it is placed. */
export function hangFromRoof(mesh, width, height) {
    const k = mesh.scale.y
    const length = (ROOF_Y - mesh.position.y) / k - height / 2
    for (const side of [-1, 1]) {
        const cord = rod(0.004, length)
        cord.position.set((side * width) / 2.6, height / 2 + length / 2, -0.002)
        mesh.add(cord)
    }
}

/** A pole from a surface at `baseY` to a panel's back. */
export function standOnPole(mesh, height, baseY = 0) {
    const length = mesh.position.y - baseY
    const pole = rod(0.01, length)
    pole.position.set(0, -length / 2, -0.012)
    mesh.add(pole)
}

/** What a crate shows on top: one of each supply of its category, side by side. */
export function crateLayout(supplies, categoryId) {
    const items = Object.values(SUPPLIES)
        .filter((s) => s.category === categoryId)
        .map((s) => s.id)
    return cartonLayout(supplies, items, CRATE.w - 0.04, CRATE.d - 0.04, CRATE.h)
}
