import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { sharedMaterial } from './materials.js'
import { canvasTexture, crossTexture } from './procedural/textures.js'
import { stylize } from './stylize.js'

/**
 * Props of the barrios and the city, one builder each.
 *
 * Every builder returns a fresh THREE.Group in world units (metres), standing
 * on y = 0 and facing +Z, so the scenes only have to place it. The scenes and
 * the FBX exporter (tools/export-models) use these same functions, so the
 * exported models are exactly what the experience shows.
 */

const shadows = (g, receive = true) => {
    g.traverse((o) => {
        if (!o.isMesh) return
        o.castShadow = true
        o.receiveShadow = receive
    })
    return g
}

/* ================================================================
   Barrio
   ================================================================ */

const nb = {
    stone: () => stylize(sharedMaterial('nb:stone', { color: '#D9CFBF', roughness: 0.95 })),
    wood: () => stylize(sharedMaterial('nb:wood', { color: '#A27A55', roughness: 0.85 })),
    metal: () => sharedMaterial('nb:metal', { color: '#4A5560', roughness: 0.6, metalness: 0.3 }),
    white: () => stylize(sharedMaterial('nb:white', { color: '#F6F2EA', roughness: 0.85 })),
    terracotta: () => stylize(sharedMaterial('nb:terracotta', { color: '#C27052', roughness: 0.8 })),
}

/** Park bench: wooden seat and back on two metal legs. */
export function bench() {
    const b = new THREE.Group()
    b.name = 'banca'
    const wood = nb.wood()
    const seat = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.1, 0.5, 2, 0.03), wood)
    seat.position.y = 0.48
    const back = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.42, 0.08, 2, 0.03), wood)
    back.position.set(0, 0.78, -0.24)
    back.rotation.x = -0.12
    b.add(seat, back)
    for (const lx of [-0.75, 0.75]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.46), nb.metal())
        leg.position.set(lx, 0.24, 0)
        b.add(leg)
    }
    return shadows(b)
}

/** Octagonal kiosk with a terracotta roof (La Flora). */
export function kiosk() {
    const g = new THREE.Group()
    g.name = 'quiosco'
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.1, 0.3, 8), nb.stone())
    base.position.y = 0.15
    g.add(base)
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), nb.white())
        post.position.set(Math.cos(a) * 1.7, 1.5, Math.sin(a) * 1.7)
        g.add(post)
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.3, 8), nb.terracotta())
    roof.position.y = 3.35
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), nb.white())
    finial.position.y = 4.05
    g.add(roof, finial)
    return shadows(g)
}

/** Whitewashed hillside chapel with its bell tower (San Antonio). */
export function chapel() {
    const ch = new THREE.Group()
    ch.name = 'capilla'
    const stone = nb.stone()
    const white = nb.white()
    const terracotta = nb.terracotta()
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(6.4, 0.8, 10.2, 2, 0.1), stone)
    plinth.position.y = 0.4
    const nave = new THREE.Mesh(new THREE.BoxGeometry(5.2, 4.2, 8.6), white)
    nave.position.y = 2.9
    const roofShape = new THREE.Shape()
    roofShape.moveTo(-3.0, 0)
    roofShape.lineTo(3.0, 0)
    roofShape.lineTo(0, 1.9)
    roofShape.closePath()
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 9.2, bevelEnabled: false }).translate(0, 0, -4.6), terracotta)
    roof.position.y = 5.0
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.3, 7.8, 2.3), white)
    tower.position.set(0, 4.7, 4.6)
    const towerTop = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.6, 4), terracotta)
    towerTop.rotation.y = Math.PI / 4
    towerTop.position.set(0, 9.4, 4.6)
    const bellOpen = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 2.4), sharedMaterial('nb:dark', { color: '#3A3530', roughness: 1 }))
    bellOpen.position.set(0, 7.3, 4.6)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.1), sharedMaterial('nb:door', { color: '#6F4B33', roughness: 0.8 }))
    door.position.set(0, 1.8, 5.78)
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), white)
    crossV.position.set(0, 10.6, 4.6)
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), white)
    crossH.position.set(0, 10.75, 4.6)
    ch.add(plinth, nave, roof, tower, towerTop, bellOpen, door, crossV, crossH)
    return shadows(ch)
}

/** One stone step of the stair up to the chapel. */
export function chapelStep() {
    const g = new THREE.Group()
    g.name = 'escalon'
    const st = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.3, 0.7, 2, 0.05), nb.stone())
    g.add(st)
    return shadows(g)
}

/**
 * Footbridge over a canal of the given width: a wooden deck with ramps and
 * white railings. The deck top sits at `deckH`.
 */
export function footbridge(width = 4.2, deckH = 0.45) {
    const g = new THREE.Group()
    g.name = 'puente_peatonal'
    const wood = nb.wood()
    const white = nb.white()
    const deck = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.24, width + 2.2, 2, 0.06), wood)
    deck.position.y = deckH - 0.12
    g.add(deck)
    for (const side of [-1, 1]) {
        const ramp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.9), wood)
        ramp.position.set(0, deckH / 2 - 0.06, side * (width / 2 + 2.0))
        ramp.rotation.x = side * 0.23
        g.add(ramp)
        for (const rx of [-1.55, 1.55]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, width + 2.2), white)
            rail.position.set(rx, deckH + 0.9, 0)
            g.add(rail)
            for (let k = -2; k <= 2; k++) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), white)
                post.position.set(rx, deckH + 0.45, k * ((width + 2) / 4))
                g.add(post)
            }
        }
    }
    return shadows(g)
}

/** Small football goal frame for the court. */
export function goal() {
    const g = new THREE.Group()
    g.name = 'arco'
    const white = nb.white()
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), white)
    p1.position.set(0, 0.7, -1.0)
    const p2 = p1.clone()
    p2.position.z = 1.0
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.08), white)
    bar.position.y = 1.4
    g.add(p1, p2, bar)
    return shadows(g, false)
}

/** A potted plant: tapered pot, soil, and a small cluster of leaves. */
export function pot(rand = Math.random, scale = 1) {
    const terracotta = stylize(sharedMaterial('nb:pot', { color: '#C47A58', roughness: 0.9 }))
    const soil = sharedMaterial('nb:potSoil', { color: '#6F5B47', roughness: 1 })
    const greens = ['#6F9158', '#7FA368', '#86AC6E', '#648A52'].map((c) => sharedMaterial(`nb:potLeaf${c}`, { color: c, roughness: 0.9 }))
    const g = new THREE.Group()
    g.name = 'matera'
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.19, 0.34, 14), terracotta)
    body.position.y = 0.17
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.27, 0.06, 14), terracotta)
    lip.position.y = 0.33
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(0.25, 14).rotateX(-Math.PI / 2), soil)
    dirt.position.y = 0.345
    g.add(body, lip, dirt)
    const leaf = greens[Math.floor(rand() * greens.length)]
    const n = 3 + Math.floor(rand() * 3)
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand()
        const blade = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), leaf)
        blade.scale.set(0.7, 1.5 + rand() * 0.7, 0.7)
        blade.position.set(Math.cos(a) * 0.1, 0.52 + rand() * 0.12, Math.sin(a) * 0.1)
        blade.rotation.z = Math.cos(a) * 0.3
        blade.rotation.x = -Math.sin(a) * 0.3
        g.add(blade)
    }
    g.scale.setScalar(scale)
    return shadows(g)
}

/** Street litter bin on a post. */
export function bin() {
    const metal = sharedMaterial('nb:streetMetal', { color: '#5A6670', roughness: 0.55, metalness: 0.35 })
    const binBody = stylize(sharedMaterial('nb:bin', { color: '#3F6B54', roughness: 0.7 }))
    const g = new THREE.Group()
    g.name = 'caneca'
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.72, 14), binBody)
    body.position.y = 0.36
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 14), binBody)
    lid.position.y = 0.75
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 8), metal)
    post.position.set(0.38, 0.5, 0)
    g.add(body, lid, post)
    return shadows(g)
}

/** A bicycle leaning where someone left it. */
export function bicycle() {
    const g = new THREE.Group()
    g.name = 'bicicleta'
    const frame = sharedMaterial('nb:bikeFrame', { color: '#2F6E8F', roughness: 0.5, metalness: 0.3 })
    const tyre = sharedMaterial('nb:tyre', { color: '#3A3A3C', roughness: 0.9 })
    for (const x of [-0.52, 0.52]) {
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.045, 8, 22), tyre)
        w.position.set(x, 0.33, 0)
        g.add(w)
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.04, 8).rotateZ(Math.PI / 2), frame)
    bar.position.set(0, 0.58, 0)
    const down = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.72, 8), frame)
    down.position.set(-0.1, 0.4, 0)
    down.rotation.z = 0.7
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.07, 0.12, 2, 0.03), sharedMaterial('nb:seat', { color: '#3A3A3C', roughness: 0.8 }))
    seat.position.set(-0.46, 0.68, 0)
    const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8).rotateX(Math.PI / 2), frame)
    bars.position.set(0.5, 0.72, 0)
    g.add(bar, down, seat, bars)
    g.rotation.z = 0.12 // leaning
    return shadows(g)
}

/** One 1.9 m section of the low whitewashed wall with its terracotta cap (San Antonio). */
export function wallSection() {
    const wall = stylize(sharedMaterial('nb:wallLow', { color: '#F1ECE2', roughness: 0.9 }), { ao: 0.3, aoHeight: 0.8 })
    const cap = stylize(sharedMaterial('nb:wallCap', { color: '#BF6F50', roughness: 0.85 }))
    const g = new THREE.Group()
    g.name = 'muro_bajo'
    const seg = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.32).translate(0, 0.35, 0), wall)
    const c = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.42).translate(0, 0.75, 0), cap)
    seg.scale.x = c.scale.x = 1.9
    seg.castShadow = c.castShadow = true
    seg.receiveShadow = true
    g.add(seg, c)
    return g
}

/**
 * Cardboard box that stands in for more than five units of a supply on the
 * collection point's counter, taped in the colour of the supply's category.
 * The stand puts one unit of the supply on its lid.
 */
export function supplyBox(tapeColor = '#B8642A') {
    const g = new THREE.Group()
    g.name = 'caja_insumos'
    const cardboard = stylize(sharedMaterial('nb:supplyBox', { color: '#C9A47A', roughness: 0.9 }))
    const tape = sharedMaterial(`nb:supplyTape${tapeColor}`, { color: tapeColor, roughness: 0.6 })
    const body = new THREE.Mesh((supplyBox.bodyGeo ??= new RoundedBoxGeometry(0.9, 0.5, 0.7, 2, 0.04).translate(0, 0.25, 0)), cardboard)
    const band = new THREE.Mesh((supplyBox.bandGeo ??= new THREE.BoxGeometry(0.92, 0.12, 0.72).translate(0, 0.3, 0)), tape)
    g.add(body, band)
    return shadows(g)
}

/* ================================================================
   City (map view)
   ================================================================ */

const lm = {
    white: () => sharedMaterial('lm:white', { color: '#F2EFE9', roughness: 0.7 }),
    slate: () => sharedMaterial('lm:slate', { color: '#7C8896', roughness: 0.7 }),
    glass: () => sharedMaterial('lm:glass', { color: '#8197AA', roughness: 0.3, metalness: 0.25 }),
    stone: () => sharedMaterial('lm:stone', { color: '#CFC6B5', roughness: 0.9 }),
    pitch: () => sharedMaterial('lm:pitch', { color: '#8FB07A', roughness: 1 }),
}

/** Cristo Rey: the statue with open arms on its pedestal, on a base sunk into the hilltop. */
export function cristoRey() {
    const g = new THREE.Group()
    g.name = 'cristo_rey'
    const white = lm.white()
    const stone = lm.stone()
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 6, 10), stone)
    base.position.y = -1.5 // sunk into the hilltop so it never floats
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 3, 8), stone)
    pedestal.position.y = 1.5
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.35, 7.5, 12), white)
    robe.position.y = 6.75
    const arms = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.9, 0.9), white)
    arms.position.y = 9.4
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), white)
    head.position.y = 11.2
    g.add(base, pedestal, robe, arms, head)
    g.traverse((o) => o.isMesh && (o.castShadow = true))
    return g
}

/** Tres Cruces: three white crosses side by side, the middle one tallest, on a low round terrace. */
export function tresCruces() {
    const g = new THREE.Group()
    g.name = 'tres_cruces'
    const white = lm.white()
    // a low round terrace, deep enough to meet the slope on every side
    const base = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 10.5, 10, 20), lm.stone())
    base.scale.z = 0.6
    base.position.y = -4.6
    g.add(base)
    for (const [dx, dz, s] of [[-5.6, 0.6, 0.78], [0, 0, 1], [5.6, 0.6, 0.78]]) {
        const cross = new THREE.Group()
        cross.name = 'cruz'
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.9, 15, 0.9), white)
        v.position.y = 7.5
        const h = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.9, 0.9), white)
        h.position.y = 10.6
        const foot = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), white)
        foot.position.y = 0.5
        cross.add(v, h, foot)
        cross.scale.setScalar(s)
        cross.position.set(dx, 0, dz)
        g.add(cross)
    }
    g.traverse((o) => o.isMesh && (o.castShadow = true))
    return g
}

/** La Ermita: the small white gothic church. */
export function ermita() {
    const g = new THREE.Group()
    g.name = 'la_ermita'
    const white = lm.white()
    const slate = lm.slate()
    const nave = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 9), white)
    nave.position.y = 2.5
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.4, 2.6, 4, 1), slate)
    roof.rotation.y = Math.PI / 4
    roof.scale.set(1, 1, 1.8)
    roof.position.y = 6.3
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 9, 2.6), white)
    tower.position.set(0, 4.5, 4.8)
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.7, 6.5, 8), slate)
    spire.position.set(0, 12.2, 4.8)
    g.add(nave, roof, tower, spire)
    for (const sx of [-1.9, 1.9]) {
        const p = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.4, 6), slate)
        p.position.set(sx, 6.6, 4.8)
        g.add(p)
    }
    return g
}

/** Torre de Cali: the glass tower with its white crown and mast. */
export function torreDeCali() {
    const g = new THREE.Group()
    g.name = 'torre_de_cali'
    const white = lm.white()
    const body = new THREE.Mesh(new THREE.BoxGeometry(6.5, 38, 6.5), lm.glass())
    body.position.y = 19
    const crown = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, 7), white)
    crown.position.y = 39.2
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), white)
    mast.position.y = 43
    g.add(body, crown, mast)
    return g
}

/** Estadio Pascual Guerrero: an oval stand around the pitch. */
export function estadio() {
    const g = new THREE.Group()
    g.name = 'estadio'
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(15, 13, 3.6, 40, 1, true), sharedMaterial('lm:stadium', { color: '#E8E4DC', roughness: 0.8, side: THREE.DoubleSide }))
    ring.position.y = 1.8
    const field = new THREE.Mesh(new THREE.CircleGeometry(12.8, 40).rotateX(-Math.PI / 2), lm.pitch())
    field.position.y = 0.3
    const lines = new THREE.Mesh(new THREE.RingGeometry(3, 3.3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#E9F0E2' }))
    lines.position.y = 0.35
    g.add(ring, field, lines)
    g.scale.set(1, 1, 0.72)
    return g
}

/** A zone's aid point on the map: a ridge tent and a pole with the Red Cross flag. */
export function aidPoint() {
    const g = new THREE.Group()
    g.name = 'punto_de_ayuda'
    const canvas = sharedMaterial('aid:tent', { color: '#F7F6F2', roughness: 0.8 })
    const flagMat = (aidPoint.flagMat ??= new THREE.MeshStandardMaterial({ map: crossTexture({ scale: 0.6 }), roughness: 0.8, side: THREE.DoubleSide }))
    const tentShape = new THREE.Shape()
    tentShape.moveTo(-1.6, 0)
    tentShape.lineTo(1.6, 0)
    tentShape.lineTo(0, 2.2)
    tentShape.closePath()
    const tentGeo = (aidPoint.tentGeo ??= new THREE.ExtrudeGeometry(tentShape, { depth: 3.4, bevelEnabled: false }).translate(0, 0, -1.7))
    const tent = new THREE.Mesh(tentGeo, canvas)
    tent.castShadow = true
    tent.position.set(-1.2, 0.2, 0)
    tent.rotation.y = 0.4
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.6, 6), sharedMaterial('aid:pole', { color: '#3B4552' }))
    pole.position.set(2.2, 2.3, 0.6)
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), flagMat)
    flag.position.set(3.1, 3.9, 0.6)
    g.add(tent, pole, flag)
    return g
}

/**
 * Geometry of the city's low-rise blocks (instanced by the thousand on the
 * map): a unit box for the body and a unit gable for the roof. The map scales
 * each instance; cityHouse() assembles one typical house from them.
 */
export function cityBlockGeometries() {
    const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const roofShape = new THREE.Shape()
    roofShape.moveTo(-0.5, 0)
    roofShape.lineTo(0.5, 0)
    roofShape.lineTo(0, 1)
    roofShape.closePath()
    const roof = new THREE.ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5)
    roof.computeVertexNormals()
    return { body, roof }
}

/** One typical house of the map, at the average size the map uses. */
export function cityHouse() {
    const { body, roof } = cityBlockGeometries()
    const g = new THREE.Group()
    g.name = 'casa_mapa'
    const b = new THREE.Mesh(body, sharedMaterial('city:houseWall', { color: '#EFE5D3', roughness: 0.95 }))
    b.scale.set(2.6, 2.2, 2.8)
    const r = new THREE.Mesh(roof, sharedMaterial('city:houseRoof', { color: '#BE6B4E', roughness: 0.85 }))
    r.scale.set(2.6 * 1.12, 1.05, 2.8 * 1.08)
    r.position.y = 2.2
    g.add(b, r)
    return g
}

/** One typical tower of the map: a banded block. */
export function cityTower() {
    const g = new THREE.Group()
    g.name = 'torre_mapa'
    const bandTex = (cityTower.bandTex ??= canvasTexture(64, 256, (ctx, w, h) => {
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = 'rgba(80,100,120,0.32)'
        for (let k = 0; k < 10; k++) ctx.fillRect(0, k * (h / 10) + 6, w, h / 10 - 12)
    }))
    const t = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), sharedMaterial('city:towerExport', { color: '#E6E8EA', map: bandTex, roughness: 0.75 }))
    t.scale.set(5.2, 18, 5.2)
    g.add(t)
    return g
}
