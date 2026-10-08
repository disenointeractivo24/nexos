import * as THREE from 'three'
import gsap from 'gsap'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { CATEGORIES } from '../data/catalog.js'
import { stockCap, stockState, stockRatio } from '../data/inventory.js'
import { sharedMaterial, WORLD } from './materials.js'
import { crossTexture } from './procedural/textures.js'
import { canopyGeometry, trunkGeometry } from './procedural/nature.js'
import { supplyBox } from './props.js'
import { stylize } from './stylize.js'

/**
 * The collection point seen straight from the front while its inventory is
 * open: a canopy over a shelving unit with one bay per supply.
 *
 * Each bay holds boxes in proportion to what the point has in stock, and a
 * sign with the count and its state, so the shelves above and the board below
 * always tell the same story. Both read from the same InventoryStore, so a
 * change made on another device (or straight in the sheet) shows up here too.
 *
 * Built at the origin facing +Z; `view()` gives the frontal camera.
 */

const COLS = 4
const BAY_W = 1.9
const BAY_H = 1.15
const POST = 0.08
const BOARD = 0.06
const DEPTH = 0.62
const FLOOR = 0.18 // top of the lowest board
const SHELF_Z = -0.55
/** Boxes a full bay holds: three across, two high. */
const SLOTS = 6
const BOX_SCALE = 0.6
const FONT = '"Atkinson Hyperlegible Next", "Segoe UI", system-ui, sans-serif'

const unitW = COLS * BAY_W + (COLS + 1) * POST
const colX = (c) => -unitW / 2 + POST + BAY_W / 2 + c * (BAY_W + POST)
const rowFloor = (r) => FLOOR + r * (BAY_H + BOARD)

/** Everything the frontal view has to show, for framing it: width, bottom, top. */
export const DEPOT_BOUNDS = { width: 9.8, bottom: 0, top: 4.25 }

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
}

/** Shrink text until it fits `max` pixels, never below `min`. */
function fitFont(ctx, text, weight, size, min, max) {
    let s = size
    do {
        ctx.font = `${weight} ${s}px ${FONT}`
        if (ctx.measureText(text).width <= max) break
        s -= 2
    } while (s > min)
    return s
}

export class Depot {
    /** @param {{ supplies: object[], reducedMotion?: boolean }} opts — supplies in board order */
    constructor({ supplies, reducedMotion = false }) {
        this.supplies = supplies
        this.reducedMotion = reducedMotion
        this.group = new THREE.Group()
        this.group.name = 'depot'
        this.group.visible = false
        this.bays = new Map()
        this.#ground()
        this.#backdrop()
        this.#canopy()
        this.#shelves()
        this.group.traverse((o) => {
            if (o.isMesh && !o.userData.flat) {
                o.castShadow = true
                o.receiveShadow = true
            }
        })
    }

    /* ---------------- static set ---------------- */

    #ground() {
        const paving = stylize(sharedMaterial('dp:paving', { color: '#E4DDD0', roughness: 0.95 }))
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 60).rotateX(-Math.PI / 2), paving)
        ground.position.z = 10
        ground.receiveShadow = true
        this.group.add(ground)
        // a darker slab under the stand, so it reads as a place and not as a floating set
        const slab = new THREE.Mesh(
            new RoundedBoxGeometry(10, 0.08, 4.2, 2, 0.03),
            stylize(sharedMaterial('dp:slab', { color: '#D3C8B6', roughness: 0.95 }))
        )
        slab.position.set(0, 0.04, -0.2)
        this.group.add(slab)
    }

    #backdrop() {
        const wall = stylize(sharedMaterial('dp:wall', { color: '#EFE5D3', roughness: 0.9 }))
        const trim = stylize(sharedMaterial('dp:trim', { color: '#D8CBB4', roughness: 0.9 }))
        const back = new THREE.Mesh(new THREE.BoxGeometry(26, 5.4, 0.4), wall)
        back.position.set(0, 2.7, -3.2)
        const base = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 0.5), trim)
        base.position.set(0, 0.25, -2.95)
        this.group.add(back, base)

        // a few trees at the sides frame the stand without competing with it
        const leaf = stylize(sharedMaterial('dp:leaf', { color: WORLD.leaf[1], roughness: 0.9 }), { sway: 0.4 })
        const bark = stylize(sharedMaterial('dp:bark', { color: WORLD.trunk, roughness: 0.9 }))
        const canopy = canopyGeometry(1)
        const trunk = trunkGeometry()
        for (const [x, z, s] of [[-7.8, -1.6, 1.9], [-10, 0.6, 1.5], [8, -1.4, 2.0], [10.2, 0.9, 1.4]]) {
            const t = new THREE.Group()
            const tr = new THREE.Mesh(trunk, bark)
            const cn = new THREE.Mesh(canopy, leaf)
            cn.position.y = 1.15
            t.add(tr, cn)
            t.scale.setScalar(s)
            t.position.set(x, 0, z)
            this.group.add(t)
        }
    }

    #canopy() {
        const canvas = stylize(sharedMaterial('dp:canvas', { color: '#F7F5F0', roughness: 0.85, side: THREE.DoubleSide }))
        const under = stylize(sharedMaterial('dp:canvasIn', { color: '#E4DED2', roughness: 0.9, side: THREE.DoubleSide }))
        const pole = sharedMaterial('dp:pole', { color: '#5D6A72', roughness: 0.55, metalness: 0.35 })

        const shape = new THREE.Shape()
        shape.moveTo(-4.75, 0)
        shape.lineTo(4.75, 0)
        shape.lineTo(0, 0.85)
        shape.closePath()
        const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 3.8, bevelEnabled: false }).translate(0, 0, -1.9), canvas)
        roof.position.set(0, 3.35, -0.35)
        const soffit = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 3.8).rotateX(Math.PI / 2), under)
        soffit.position.set(0, 3.34, -0.35)
        this.group.add(roof, soffit)

        for (const [x, z] of [[-4.5, -2.05], [4.5, -2.05], [-4.5, 1.35], [4.5, 1.35]]) {
            const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.35, 8), pole)
            p.position.set(x, 1.675, z)
            const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 10), pole)
            foot.position.set(x, 0.12, z)
            this.group.add(p, foot)
        }

        this.bannerCanvas = document.createElement('canvas')
        this.bannerCanvas.width = 1280
        this.bannerCanvas.height = 96
        this.bannerTex = new THREE.CanvasTexture(this.bannerCanvas)
        this.bannerTex.colorSpace = THREE.SRGBColorSpace
        this.bannerTex.anisotropy = 4
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 0.69), new THREE.MeshBasicMaterial({ map: this.bannerTex }))
        banner.position.set(0, 3.0, 1.46)
        banner.userData.flat = true
        const emblem = new THREE.Mesh(
            new THREE.PlaneGeometry(0.5, 0.5),
            new THREE.MeshBasicMaterial({ map: crossTexture({ scale: 0.6 }), transparent: true })
        )
        emblem.position.set(-4.18, 3.0, 1.47)
        emblem.userData.flat = true
        this.group.add(banner, emblem)
        this.#drawBanner('')
    }

    #drawBanner(name) {
        const ctx = this.bannerCanvas.getContext('2d')
        const { width: w, height: h } = this.bannerCanvas
        ctx.fillStyle = '#011E41'
        ctx.fillRect(0, 0, w, h)
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#FFFFFF'
        ctx.font = `800 44px ${FONT}`
        ctx.textAlign = 'left'
        ctx.fillText('PUNTO DE ACOPIO', 110, h / 2 + 2)
        if (name) {
            ctx.textAlign = 'right'
            ctx.fillStyle = 'rgba(255,255,255,0.78)'
            fitFont(ctx, name, 600, 34, 22, w - 110 - 520 - 40)
            ctx.fillText(name, w - 40, h / 2 + 2)
        }
        this.bannerTex.needsUpdate = true
    }

    #shelves() {
        const wood = stylize(sharedMaterial('dp:shelf', { color: '#B4895F', roughness: 0.85 }))
        const back = stylize(sharedMaterial('dp:shelfBack', { color: '#8C6A4C', roughness: 0.9 }))
        const rows = Math.ceil(this.supplies.length / COLS)
        const height = rowFloor(rows) + BOARD

        const unit = new THREE.Group()
        unit.position.z = SHELF_Z
        for (let i = 0; i <= COLS; i++) {
            const x = -unitW / 2 + POST / 2 + i * (BAY_W + POST)
            const post = new THREE.Mesh(new THREE.BoxGeometry(POST, height, DEPTH), wood)
            post.position.set(x, height / 2, 0)
            unit.add(post)
        }
        for (let r = 0; r <= rows; r++) {
            const board = new THREE.Mesh(new THREE.BoxGeometry(unitW, BOARD, DEPTH), wood)
            board.position.set(0, rowFloor(r) - BOARD / 2, 0)
            unit.add(board)
        }
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(unitW, height), back)
        panel.position.set(0, height / 2, -DEPTH / 2 + 0.01)
        unit.add(panel)
        this.group.add(unit)

        this.supplies.forEach((s, i) => {
            const col = i % COLS
            const row = rows - 1 - Math.floor(i / COLS) // the board reads top-left first
            const x = colX(col)
            const y = rowFloor(row)
            const bay = new THREE.Group()
            bay.position.set(x, y, SHELF_Z)
            unit.parent.add(bay)

            const tape = CATEGORIES[s.category]?.color ?? '#B8642A'
            const boxes = []
            for (let k = 0; k < SLOTS; k++) {
                const b = supplyBox(tape)
                const level = Math.floor(k / 3)
                const across = (k % 3) - 1
                b.position.set(across * BAY_W * 0.31, level * 0.5 * BOX_SCALE, 0.02)
                b.rotation.y = (((k * 37) % 7) - 3) * 0.012 // a hand-stacked shelf is never perfectly square
                b.scale.setScalar(0)
                b.visible = false
                b.userData.full = BOX_SCALE
                bay.add(b)
                boxes.push(b)
            }

            const canvas = document.createElement('canvas')
            canvas.width = 512
            canvas.height = 104
            const tex = new THREE.CanvasTexture(canvas)
            tex.colorSpace = THREE.SRGBColorSpace
            tex.anisotropy = 4
            const signW = BAY_W - 0.12
            const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signW * (104 / 512)), new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
            sign.position.set(0, BAY_H - 0.04 - (signW * (104 / 512)) / 2, DEPTH / 2 + 0.02)
            sign.userData.flat = true
            bay.add(sign)

            this.bays.set(s.id, { supply: s, boxes, sign, canvas, tex, shown: 0, qty: null })
        })
    }

    #drawSign(bay, qty) {
        const { canvas, tex, supply } = bay
        const ctx = canvas.getContext('2d')
        const { width: w, height: h } = canvas
        const cap = stockCap(supply.id)
        const st = stockState(supply.id, qty)
        ctx.clearRect(0, 0, w, h)
        roundRect(ctx, 2, 2, w - 4, h - 4, 22)
        ctx.fillStyle = '#FFFFFF'
        ctx.fill()
        // the state is a band on the left, in the same colours as the board's chips
        ctx.save()
        ctx.clip()
        ctx.fillStyle = st.color
        ctx.fillRect(0, 0, 18, h)
        ctx.restore()

        ctx.textBaseline = 'middle'
        const count = `${qty}/${cap}`
        ctx.font = `800 40px ${FONT}`
        ctx.textAlign = 'right'
        const countW = ctx.measureText(count).width
        ctx.fillStyle = st.id === 'critico' ? '#D3222E' : '#011E41'
        ctx.fillText(count, w - 22, h / 2 + 2)

        ctx.textAlign = 'left'
        ctx.fillStyle = '#011E41'
        fitFont(ctx, supply.label, 800, 38, 22, w - 40 - countW - 40)
        ctx.fillText(supply.label, 38, h / 2 + 2)
        tex.needsUpdate = true
    }

    /* ---------------- live state ---------------- */

    setPoint(point) {
        this.#drawBanner(point?.name?.replace(/^Punto de acopio\s*/i, '') ?? '')
    }

    /** Bring every bay in line with the store. Only what changed moves. */
    sync(store, { instant = false } = {}) {
        for (const [id, bay] of this.bays) {
            const qty = store.get(id)
            if (qty === bay.qty) continue
            const first = bay.qty === null
            bay.qty = qty
            this.#drawSign(bay, qty)
            const target = qty > 0 ? Math.max(1, Math.round(stockRatio(id, qty) * SLOTS)) : 0
            if (!first && !instant && !this.reducedMotion) {
                gsap.fromTo(bay.sign.scale, { x: 1.08, y: 1.08 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2)' })
            }
            this.#stack(bay, target, first || instant)
        }
    }

    #stack(bay, target, instant) {
        if (target === bay.shown) return
        const adding = target > bay.shown
        const from = Math.min(bay.shown, target)
        const to = Math.max(bay.shown, target)
        for (let k = from; k < to; k++) {
            const b = bay.boxes[k]
            const order = adding ? k - from : to - 1 - k
            gsap.killTweensOf(b.scale)
            if (instant || this.reducedMotion) {
                b.scale.setScalar(adding ? b.userData.full : 0)
                b.visible = adding
                continue
            }
            b.visible = true
            gsap.to(b.scale, {
                x: adding ? b.userData.full : 0,
                y: adding ? b.userData.full : 0,
                z: adding ? b.userData.full : 0,
                duration: adding ? 0.42 : 0.28,
                delay: order * 0.06,
                ease: adding ? 'back.out(1.8)' : 'power2.in',
                onComplete: () => (b.visible = adding),
            })
        }
        bay.shown = target
    }

    /** Forget the drawn state, so the next sync redraws every bay from scratch. */
    reset() {
        for (const bay of this.bays.values()) bay.qty = null
    }

    /** Where the stand's middle is, for the frontal camera. */
    get center() {
        return new THREE.Vector3(0, (DEPOT_BOUNDS.bottom + DEPOT_BOUNDS.top) / 2, 0)
    }
}
