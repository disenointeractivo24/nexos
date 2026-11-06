import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BRAND, FONT } from './panels.js'
import { plainCarton } from './station.js'

const RED = '#D92632'
const NAVY = BRAND.navy
const DARK = '#23272C'
const STEEL = '#8B949E'
const GLASS = '#1D3142'
const WOOD = '#8A6A45'
const WHEEL_RADIUS = 0.42

/** Where the cartons ride, along the bed's open side. */
const CARGO = [
    [0.55, 1.03, -1.35],
    [0.55, 1.03, -1.85],
    [0.55, 1.33, -1.6],
]

/** One piece of the body, painted through its vertices so the whole body is a single draw. */
function part(geometry, color, x, y, z) {
    const g = geometry.toNonIndexed().translate(x, y, z)
    const paint = new THREE.Color(color)
    const count = g.attributes.position.count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) paint.toArray(colors, i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.deleteAttribute('uv')
    return g
}

const box = (w, h, d, color, x, y, z) => part(new THREE.BoxGeometry(w, h, d), color, x, y, z)

function body() {
    const parts = [
        // chassis and bumpers
        box(1.8, 0.18, 4.9, DARK, 0, 0.62, -0.5),
        box(2.04, 0.2, 0.12, STEEL, 0, 0.62, 1.98),
        box(2.04, 0.14, 0.1, DARK, 0, 0.62, -3),
        // the cab: everything forward of the bed
        part(new RoundedBoxGeometry(2.02, 1.5, 1.42, 3, 0.1), RED, 0, 1.47, 1.22),
        box(2.05, 0.1, 1.44, '#FFFFFF', 0, 1.1, 1.22),
        box(1.72, 0.58, 0.03, GLASS, 0, 1.76, 1.93),
        box(0.03, 0.54, 0.86, GLASS, 1.01, 1.76, 1.26),
        box(0.03, 0.54, 0.86, GLASS, -1.01, 1.76, 1.26),
        box(0.02, 0.9, 0.02, DARK, 1.02, 1.28, 0.8),
        box(0.02, 0.9, 0.02, DARK, -1.02, 1.28, 0.8),
        box(0.9, 0.2, 0.03, DARK, 0, 1.03, 1.93),
        box(0.28, 0.16, 0.03, '#FFF3C4', 0.72, 1.03, 1.93),
        box(0.28, 0.16, 0.03, '#FFF3C4', -0.72, 1.03, 1.93),
        box(0.14, 0.2, 0.05, DARK, 1.1, 1.85, 1.72),
        box(0.14, 0.2, 0.05, DARK, -1.1, 1.85, 1.72),
        // over the wheels
        box(0.28, 0.1, 1.05, DARK, 0.9, 0.92, 1.25),
        box(0.28, 0.1, 1.05, DARK, -0.9, 0.92, 1.25),
        // the bed, and the canvas over it, open on the side that faces the tent
        box(2.1, 0.1, 3.5, WOOD, 0, 0.98, -1.3),
        box(0.06, 1.72, 3.5, NAVY, -1.02, 1.9, -1.3),
        box(2.1, 1.72, 0.06, NAVY, 0, 1.9, 0.42),
        box(2.1, 0.86, 0.05, NAVY, 0, 2.33, -3.03),
        box(2.18, 0.08, 3.58, NAVY, 0, 2.79, -1.3),
        box(0.05, 0.46, 3.5, NAVY, 1.03, 2.53, -1.3),
        box(0.08, 1.3, 0.08, STEEL, 1.03, 1.68, -3),
        box(0.08, 1.3, 0.08, STEEL, 1.03, 1.68, -1.3),
        box(0.08, 1.3, 0.08, STEEL, 1.03, 1.68, 0.38),
        box(0.05, 0.14, 3.5, WOOD, 1.03, 1.1, -1.3),
    ]
    const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.05 }))
    for (const g of parts) g.dispose()
    return mesh
}

function wheelGeometry() {
    const parts = [
        part(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 18).rotateZ(Math.PI / 2), '#17191C', 0, 0, 0),
        part(new THREE.CylinderGeometry(0.2, 0.2, 0.32, 12).rotateZ(Math.PI / 2), STEEL, 0, 0, 0),
    ]
    // bolts that are not all alike, or the wheel would not seem to turn
    for (const angle of [0, 1.26, 2.51, 3.77, 5.03]) {
        parts.push(box(0.34, 0.05, 0.05, DARK, 0, Math.cos(angle) * 0.13, Math.sin(angle) * 0.13))
    }
    return mergeGeometries(parts)
}

/** The name on the canvas, on the side the person looks at. */
function sign() {
    const canvas = document.createElement('canvas')
    canvas.width = 1400
    canvas.height = 184
    const c = canvas.getContext('2d')
    c.fillStyle = NAVY
    c.fillRect(0, 0, canvas.width, canvas.height)
    c.textBaseline = 'middle'
    c.font = `800 118px ${FONT}`
    const words = [['NE', '#FFFFFF'], ['X', BRAND.red], ['OS', '#FFFFFF']]
    let x = 70
    for (const [text, fill] of words) {
        c.fillStyle = fill
        c.fillText(text, x, 96)
        x += c.measureText(text).width
    }
    c.fillStyle = 'rgba(255,255,255,0.82)'
    c.font = `400 76px ${FONT}`
    c.fillText('Donaciones de Cali', x + 56, 98)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 4
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 0.434), new THREE.MeshStandardMaterial({ map, roughness: 0.8 }))
    plane.rotation.y = Math.PI / 2
    plane.position.set(1.06, 2.53, -1.3)
    return plane
}

/**
 * The truck that brings the cartons: its base at y = 0, its nose to +Z, the bed open to +X.
 * Built here, as nothing in the project's models is one; few draws, so a headset can afford it.
 */
export function buildTruck() {
    const object = new THREE.Group()
    object.name = 'camion'
    object.add(body(), sign())
    const geometry = wheelGeometry()
    const rubber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
    const wheels = [[0.92, 1.25], [-0.92, 1.25], [0.92, -2], [-0.92, -2]].map(([x, z]) => {
        const wheel = new THREE.Mesh(geometry, rubber)
        wheel.position.set(x, WHEEL_RADIUS, z)
        object.add(wheel)
        return wheel
    })
    const cargo = CARGO.map(([x, y, z]) => {
        const carton = plainCarton()
        carton.position.set(x, y, z)
        object.add(carton)
        return carton
    })
    return {
        object,
        wheels,
        wheelRadius: WHEEL_RADIUS,
        /** Where a carton leaves from, in the truck's own space. */
        tailgate: new THREE.Vector3(0.75, 1.2, -1.6),
        /** As many cartons as it still carries. */
        setCargo(n) {
            cargo.forEach((carton, i) => (carton.visible = i < n))
        },
    }
}
