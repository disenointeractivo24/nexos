import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { sharedMaterial } from './materials.js'
import { canvasTexture, crossTexture } from './procedural/textures.js'
import { stylize } from './stylize.js'

/**
 * The collection point — the one place in a barrio where aid changes hands.
 *
 * A marquee with a counter, crates behind it and a banner, built big enough to
 * read as the destination from the barrio overview. Donors walk here to leave
 * supplies; collection points work from behind the counter. Everything else in
 * the barrio is context around this.
 *
 * Built facing +Z, like the houses, so a layout's `yaw` orients it the same way.
 */
export function buildCollectionPoint() {
    const g = new THREE.Group()
    g.name = 'collection-point'

    const canvasMat = stylize(sharedMaterial('cp:canvas', { color: '#F7F5F0', roughness: 0.85, side: THREE.DoubleSide }))
    const canvasUnder = stylize(sharedMaterial('cp:canvasIn', { color: '#E4DED2', roughness: 0.9, side: THREE.DoubleSide }))
    const pole = sharedMaterial('cp:pole', { color: '#5D6A72', roughness: 0.55, metalness: 0.35 })
    const table = stylize(sharedMaterial('cp:table', { color: '#ECEAE4', roughness: 0.7 }))
    const wood = stylize(sharedMaterial('cp:crate', { color: '#C9A77C', roughness: 0.9 }))
    const woodDark = stylize(sharedMaterial('cp:crate2', { color: '#B4895F', roughness: 0.9 }))
    const navy = stylize(sharedMaterial('cp:navy', { color: '#011E41', roughness: 0.6 }))

    /* ---- roof: a shallow gable, 6 × 5 ---- */
    const roofShape = new THREE.Shape()
    roofShape.moveTo(-3.1, 0)
    roofShape.lineTo(3.1, 0)
    roofShape.lineTo(0, 0.95)
    roofShape.closePath()
    const roof = new THREE.Mesh(
        new THREE.ExtrudeGeometry(roofShape, { depth: 5, bevelEnabled: false }).translate(0, 0, -2.5),
        canvasMat
    )
    roof.position.y = 2.75
    g.add(roof)
    const soffit = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 5).rotateX(Math.PI / 2), canvasUnder)
    soffit.position.y = 2.74
    g.add(soffit)

    /* ---- poles ---- */
    for (const [x, z] of [[-2.85, -2.3], [2.85, -2.3], [-2.85, 2.3], [2.85, 2.3]]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.75, 8), pole)
        p.position.set(x, 1.375, z)
        g.add(p)
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 10), pole)
        foot.position.set(x, 0.04, z)
        g.add(foot)
    }

    /* ---- banner across the front, with the emblem ---- */
    const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(5.7, 0.72),
        new THREE.MeshStandardMaterial({
            map: canvasTexture(760, 96, (ctx, w, h) => {
                ctx.fillStyle = '#011E41'
                ctx.fillRect(0, 0, w, h)
                ctx.fillStyle = '#FFFFFF'
                ctx.font = '800 44px "Atkinson Hyperlegible Next", system-ui, sans-serif'
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText('PUNTO DE ACOPIO', w / 2 + 28, h / 2 + 2)
            }),
            roughness: 0.8,
            side: THREE.DoubleSide,
        })
    )
    banner.position.set(0, 2.3, 2.32)
    g.add(banner)
    const emblem = new THREE.Mesh(
        new THREE.PlaneGeometry(0.56, 0.56),
        new THREE.MeshStandardMaterial({ map: crossTexture({ scale: 0.6 }), roughness: 0.8, transparent: true })
    )
    emblem.position.set(-2.4, 2.3, 2.34)
    g.add(emblem)

    /* ---- counter at the front ---- */
    const top = new THREE.Mesh(new RoundedBoxGeometry(4.4, 0.1, 0.9, 2, 0.04), table)
    top.position.set(0, 0.92, 1.55)
    g.add(top)
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.84, 0.06), navy)
    skirt.position.set(0, 0.45, 1.97)
    g.add(skirt)
    for (const x of [-1.95, 1.95]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.7), pole)
        leg.position.set(x, 0.45, 1.55)
        g.add(leg)
    }

    /* ---- crates stacked behind; the counter stays clear for what donors leave ---- */
    const crates = [
        [-2.2, 0.26, -0.6, 0.52, 0.2],
        [-1.65, 0.24, -1.1, 0.48, -0.3],
        [-2.0, 0.76, -0.75, 0.46, 0.08],
        [2.0, 0.28, -0.9, 0.56, -0.12],
        [1.45, 0.25, -0.3, 0.5, 0.3],
        [2.05, 0.82, -0.95, 0.5, 0.22],
    ]
    crates.forEach(([x, y, z, s, r], i) => {
        const c = new THREE.Mesh(new RoundedBoxGeometry(s * 1.25, s, s * 0.95, 2, 0.035), i % 3 === 1 ? woodDark : wood)
        c.position.set(x, y, z)
        c.rotation.y = r
        g.add(c)
    })

    /* ---- a pair of water drums, because water is always part of it ---- */
    for (const [x, z] of [[2.45, -0.1], [2.45, -0.85]]) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.62, 16), stylize(sharedMaterial('cp:drum', { color: '#3F7FB8', roughness: 0.5 })))
        d.position.set(x, 0.31, z)
        g.add(d)
    }

    g.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = true
            o.receiveShadow = true
        }
    })
    return g
}

/**
 * Where supplies left by a donor appear, in the stand's local space: four
 * spots along the counter top first, then the ground at the front corners and
 * at the sides. One kind of supply per spot.
 */
export const DISPLAY_SLOTS = [
    new THREE.Vector3(-1.55, 0.97, 1.55),
    new THREE.Vector3(-0.52, 0.97, 1.55),
    new THREE.Vector3(0.52, 0.97, 1.55),
    new THREE.Vector3(1.55, 0.97, 1.55),
    new THREE.Vector3(-1.9, 0, 3.0),
    new THREE.Vector3(2.1, 0, 3.0),
    new THREE.Vector3(-3.8, 0, -1.1),
    new THREE.Vector3(3.8, 0, -0.4),
]

/** Invisible box used for clicking the whole stand, not just one crate. */
export function collectionPointProxy() {
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(6.6, 3.4, 5.6).translate(0, 1.7, 0),
        new THREE.MeshBasicMaterial({ visible: false })
    )
    m.name = 'collection-point-proxy'
    return m
}
