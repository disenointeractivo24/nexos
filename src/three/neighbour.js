import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { stylize } from './stylize.js'

/**
 * A neighbour of the barrio, built on the guide's own model so everyone shares one
 * anatomy and one way of moving: the same puppet, without the helmet and the
 * backpack, dressed as an ordinary resident — T-shirt, jeans, trainers, hair and ears.
 *
 * The clothes are painted on the guide's pieces by height (vertex colours): below the
 * hips the torso is trousers, the upper arm is a short sleeve, the foot is a shoe.
 * Heights are in the guide model's own space, where it stands 1.6 m tall.
 */

/** Where the clothes change, in metres from the ground. */
const CUT = { shoe: 0.13, hips: 0.43, sleeve: 0.6 }

const SKIN = ['#F1C9A5', '#E3B48C', '#C98E63', '#9C6644', '#74462C']
const HAIR = ['#3B2618', '#1F1712', '#5A3A22', '#2C1D14', '#6B4A2E']
const SHIRT = ['#EFE9DF', '#BFD3E6', '#C9D8B6', '#E9C46A', '#E8A598', '#F7F5F0', '#B9A6CF']
const PANTS = ['#4A6589', '#3E4A5C', '#8C7A5B', '#2F3E5C', '#5B6E86']
const SHOES = ['#F2F0EB', '#D8D8D4', '#F7F3EA']

const hidden = /casco|backpack|correas|cierre/i

function jointOf(o) {
    for (let p = o.parent; p; p = p.parent) if (/^(body|head|armL|armR|legL|legR)$/.test(p.name)) return p.name
    return 'body'
}

/**
 * @param loader the AssetLoader
 * @param guide  the guide's loaded template (loader.load('guide'))
 * @param n      which neighbour: picks the colours, so each one looks different
 */
export function makeNeighbour(loader, guide, n = 0) {
    // a small seeded random per neighbour, so each one is dressed differently but always the same way
    let h = (n + 1) * 2654435761
    const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ ((h + 0x9e3779b9) | 0)) >>> 0) / 4294967296
    const pick = (list) => list[Math.floor(rand() * list.length)]
    const colours = {
        skin: new THREE.Color(pick(SKIN)),
        hair: pick(HAIR),
        shirt: new THREE.Color(pick(SHIRT)),
        pants: new THREE.Color(pick(PANTS)),
        shoes: new THREE.Color(pick(SHOES)),
    }
    const model = loader.instanceSync(guide)
    model.updateMatrixWorld(true)

    const cloth = stylize(new THREE.MeshStandardMaterial({ name: 'vecino_ropa', color: '#FFFFFF', vertexColors: true, roughness: 0.9 }), { ao: 0.2, aoHeight: 0.7, rim: 0.12 })
    const remove = []
    const head = new THREE.Box3()
    const p = new THREE.Vector3()
    model.traverse((o) => {
        if (!o.isMesh) return
        const name = [o.material].flat()[0]?.name ?? ''
        if (hidden.test(name)) return remove.push(o)
        const joint = jointOf(o)
        const geo = o.geometry.clone()
        const pos = geo.attributes.position
        const col = new Float32Array(pos.count * 3)
        for (let i = 0; i < pos.count; i++) {
            p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
            let c = colours.skin
            if (joint === 'legL' || joint === 'legR') c = p.y < CUT.shoe ? colours.shoes : colours.pants
            else if (joint === 'body') c = p.y < CUT.hips ? colours.pants : colours.shirt
            else if (joint === 'armL' || joint === 'armR') c = p.y > CUT.sleeve ? colours.shirt : colours.skin
            c.toArray(col, i * 3)
            if (joint === 'head') head.expandByPoint(p)
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
        o.geometry = geo
        o.material = cloth
    })
    for (const o of remove) o.removeFromParent()

    const headJoint = model.getObjectByName('head')
    if (headJoint && !head.isEmpty()) headJoint.attach(hairAndEars(head, colours))

    // the box they carry home, hidden until they are given something
    const body = model.getObjectByName('body')
    if (body) {
        const parcel = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.26, 0.24, 2, 0.03), new THREE.MeshStandardMaterial({ color: '#C9A77C', roughness: 0.9 }))
        parcel.name = 'parcel'
        parcel.position.set(0, 0.62, 0.36)
        parcel.visible = false
        body.attach(parcel)
    }
    model.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true
    })
    return model
}

/** A soft cap of hair with a swept fringe, and two ears, sized to the head. */
function hairAndEars(head, colours) {
    const c = head.getCenter(new THREE.Vector3())
    const s = head.getSize(new THREE.Vector3())
    const g = new THREE.Group()
    g.name = 'pelo'
    const hair = stylize(new THREE.MeshStandardMaterial({ name: 'vecino_pelo', color: colours.hair, roughness: 0.85 }), { ao: 0.15, aoHeight: 2, rim: 0.18 })
    const skin = stylize(new THREE.MeshStandardMaterial({ name: 'vecino_oreja', color: colours.skin, roughness: 0.6 }), { ao: 0, rim: 0.1 })

    // the cap: the top of the head and the back, tipped back so the face stays clear
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), hair)
    cap.scale.set(s.x * 0.545, s.y * 0.56, s.z * 0.56)
    cap.position.set(c.x, c.y + s.y * 0.05, c.z - s.z * 0.02)
    cap.rotation.x = -0.42
    g.add(cap)

    // the fringe: a few locks swept to one side over the forehead
    const locks = [
        [-0.25, 0.27, 0.36, 0.32, 0.5],
        [-0.02, 0.3, 0.4, 0.34, 0.3],
        [0.22, 0.27, 0.37, 0.3, 0.1],
        [0.38, 0.14, 0.27, 0.22, -0.4],
        [-0.4, 0.12, 0.25, 0.22, 0.6],
    ]
    for (const [x, y, z, w, tilt] of locks) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), hair)
        l.scale.set(s.x * w, s.y * 0.13, s.z * 0.2)
        l.position.set(c.x + x * s.x, c.y + y * s.y, c.z + z * s.z)
        l.rotation.set(-0.5, 0, tilt)
        g.add(l)
    }

    for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skin)
        ear.scale.set(s.x * 0.085, s.y * 0.135, s.z * 0.1)
        ear.position.set(c.x + side * s.x * 0.535, c.y - s.y * 0.05, c.z - s.z * 0.02)
        g.add(ear)
    }
    return g
}
