import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * A neighbour — one of the families who live in the barrio.
 *
 * Deliberately simpler and smaller than the guide: no helmet, no emblem, no
 * equipment. These are the people the aid is for, so they are built to read as
 * ordinary residents at a glance, never as staff.
 *
 * Built facing +Z in world units, as tall as the guide (1.6 m), with the same named pivots
 * the guide uses — body, head, armL/R, legL/R — so GuideCharacter can walk and
 * animate them with no special case.
 */

const PALETTES = [
    { shirt: '#D8714F', trousers: '#3F5566', hair: '#3A2A22' },
    { shirt: '#4E7FA6', trousers: '#53483E', hair: '#231B16' },
    { shirt: '#6E9168', trousers: '#4A4A52', hair: '#4A3328' },
    { shirt: '#C9A24A', trousers: '#3C4A52', hair: '#2A1F1A' },
    { shirt: '#A6628A', trousers: '#44504A', hair: '#51382A' },
    { shirt: '#E0E0D6', trousers: '#6B5B4A', hair: '#1E1A17' },
]

export const VILLAGER_PALETTES = PALETTES

export function buildVillager({ palette = 0, child = false } = {}) {
    const P = PALETTES[palette % PALETTES.length]
    const M = {
        skin: new THREE.MeshStandardMaterial({ color: '#E8C9A8', roughness: 0.6 }),
        shirt: new THREE.MeshStandardMaterial({ color: P.shirt, roughness: 0.75 }),
        trousers: new THREE.MeshStandardMaterial({ color: P.trousers, roughness: 0.8 }),
        hair: new THREE.MeshStandardMaterial({ color: P.hair, roughness: 0.7 }),
        face: new THREE.MeshStandardMaterial({ color: '#1C1E22', roughness: 0.3 }),
    }
    // the figure is drawn 1.35 m tall; scale it to the guide's 1.6 m (children a little smaller)
    for (const [name, m] of Object.entries(M)) m.name = `vecino_${name}`
    const k = (child ? 0.8 : 1) * (1.6 / 1.35)

    const root = new THREE.Group()
    root.name = 'villager'
    const body = new THREE.Group()
    body.name = 'body'
    root.add(body)

    /* ---- legs ---- */
    for (const side of [-1, 1]) {
        const hip = new THREE.Group()
        hip.name = side < 0 ? 'legL' : 'legR'
        hip.position.set(side * 0.1 * k, 0.56 * k, 0)
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085 * k, 0.3 * k, 6, 10), M.trousers)
        leg.position.y = -0.24 * k
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.11 * k, 12, 8), M.trousers)
        foot.scale.set(1, 0.58, 1.3)
        foot.position.set(0, -0.47 * k, 0.03 * k)
        hip.add(leg, foot)
        body.add(hip)
    }

    /* ---- torso ---- */
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2 * k, 0.26 * k, 8, 16), M.shirt)
    torso.position.y = 0.82 * k
    torso.scale.set(1, 1, 0.86)
    body.add(torso)

    /* ---- arms ---- */
    for (const side of [-1, 1]) {
        const shoulder = new THREE.Group()
        shoulder.name = side < 0 ? 'armL' : 'armR'
        shoulder.position.set(side * 0.235 * k, 0.98 * k, 0)
        shoulder.rotation.z = side * 0.14
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.058 * k, 0.26 * k, 6, 10), M.shirt)
        arm.position.y = -0.17 * k
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.072 * k, 10, 8), M.skin)
        hand.position.y = -0.34 * k
        shoulder.add(arm, hand)
        body.add(shoulder)
    }

    /* ---- head ---- */
    const head = new THREE.Group()
    head.name = 'head'
    head.position.y = 1.16 * k
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.185 * k, 20, 16), M.skin)
    skull.scale.set(1, 1.06, 0.94)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.191 * k, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), M.hair)
    cap.position.y = 0.012 * k
    head.add(skull, cap)
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.023 * k, 8, 8), M.face)
        eye.position.set(side * 0.068 * k, 0.012 * k, 0.168 * k)
        head.add(eye)
    }
    body.add(head)

    /* ---- the box they carry home, hidden until they are given something ---- */
    const parcel = new THREE.Mesh(
        new RoundedBoxGeometry(0.3 * k, 0.24 * k, 0.22 * k, 2, 0.03),
        new THREE.MeshStandardMaterial({ color: '#C9A77C', roughness: 0.9 })
    )
    parcel.name = 'parcel'
    parcel.position.set(0, 0.82 * k, 0.26 * k)
    parcel.visible = false
    body.add(parcel)

    root.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = true
            o.receiveShadow = true
        }
    })
    return root
}
