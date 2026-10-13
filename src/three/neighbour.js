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
 *
 * Ages: an adult, a teenager, a child (drawn smaller by whoever places them, with a
 * slightly bigger head) and an older person, with grey, thinning hair and quieter clothes.
 */

/** Where the clothes change, in metres from the ground (the same cuts as the FBX models in
 *  fuentes_3d/npcs): children wear shorts to the knee, older people long sleeves. */
const CUT = { shoe: 0.13, hips: 0.43, sleeve: 0.6, knee: 0.25, longSleeve: 0.45 }

const SKIN = ['#F1C9A5', '#E3B48C', '#C98E63', '#9C6644', '#74462C']
const HAIR = ['#3B2618', '#1F1712', '#5A3A22', '#2C1D14', '#6B4A2E']
const SHIRT = ['#EFE9DF', '#BFD3E6', '#C9D8B6', '#E9C46A', '#E8A598', '#F7F5F0', '#B9A6CF']
const PANTS = ['#4A6589', '#3E4A5C', '#8C7A5B', '#2F3E5C', '#5B6E86']
const SHOES = ['#F2F0EB', '#D8D8D4', '#F7F3EA']
/** What changes with age: hair and clothes. */
const BY_AGE = {
    elder: {
        hair: ['#E4E1DB', '#C9C5BE', '#A9A59E', '#F0EEEA'],
        shirt: ['#B48A6A', '#7D8C9E', '#C2B59B', '#8E6F5E', '#A7B39A', '#D6CBB8'],
        pants: ['#6B5E50', '#4B4F57', '#857563', '#5E6470'],
        shoes: ['#5A4636', '#3E3A36', '#7A6A5A'],
    },
    child: {
        shirt: ['#E76F51', '#F4A261', '#2A9D8F', '#E9C46A', '#8AB6F9', '#F28DB2', '#90C978'],
        pants: ['#4A6589', '#2F3E5C', '#7A5C8E', '#C26B4A', '#5B6E86'],
    },
    teen: {
        shirt: ['#2B2D42', '#E63946', '#457B9D', '#F1FAEE', '#6D597A', '#3A5A40'],
    },
}

const hidden = /casco|backpack|correas|cierre/i

function jointOf(o) {
    for (let p = o.parent; p; p = p.parent) if (/^(body|head|armL|armR|legL|legR)$/.test(p.name)) return p.name
    return 'body'
}

/**
 * @param loader the AssetLoader
 * @param guide  the guide's loaded template (loader.load('guide'))
 * @param n      which neighbour: picks the colours, so each one looks different
 * @param age    'adult' | 'teen' | 'child' | 'elder'
 */
/** The textured neighbours, once loaded (see preloadNeighbours): id → template. */
const textured = new Map()
const TEXTURED = ['npc-joven-1', 'npc-joven-2', 'npc-nino-1', 'npc-nino-2', 'npc-mayor']

/**
 * Loads the textured neighbours in the background. Until they arrive (or if they fail),
 * makeNeighbour dresses the guide's model in painted clothes instead.
 */
export function preloadNeighbours(loader) {
    return Promise.all(
        TEXTURED.map((id) =>
            loader
                .load(id)
                .then((t) => t.source === 'glb' && textured.set(id, t))
                .catch(() => {})
        )
    )
}

/** The textured model for a neighbour of this age, or null if it is not loaded. */
function texturedModel(loader, n, age) {
    const id = age === 'elder' ? 'npc-mayor' : `npc-${age === 'child' ? 'nino' : 'joven'}-${1 + (n % 2)}`
    const t = textured.get(id)
    return t ? loader.instanceSync(t) : null
}

export function makeNeighbour(loader, guide, n = 0, age = 'adult') {
    const model = texturedModel(loader, n, age)
    if (model) return finish(model, age)
    return paintedNeighbour(loader, guide, n, age)
}

/** The parcel they carry home, shadows, and the child's slightly bigger head. */
function finish(model, age) {
    model.updateMatrixWorld(true)
    const body = model.getObjectByName('body')
    if (body) {
        const parcel = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.26, 0.24, 2, 0.03), new THREE.MeshStandardMaterial({ color: '#C9A77C', roughness: 0.9 }))
        parcel.name = 'parcel'
        parcel.position.set(0, 0.62, 0.36)
        parcel.visible = false
        body.attach(parcel)
    }
    const head = model.getObjectByName('head')
    if (head && age === 'child') head.scale.multiplyScalar(1.16)
    model.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true
    })
    model.userData.age = age
    return model
}

/** The guide's model dressed with painted clothes: the stand-in until the textured ones load. */
function paintedNeighbour(loader, guide, n = 0, age = 'adult') {
    // a small seeded random per neighbour, so each one is dressed differently but always the same way
    let h = (n + 1) * 2654435761
    const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ ((h + 0x9e3779b9) | 0)) >>> 0) / 4294967296
    const pick = (list) => list[Math.floor(rand() * list.length)]
    const look = BY_AGE[age] ?? {}
    const colours = {
        skin: new THREE.Color(pick(SKIN)),
        hair: pick(look.hair ?? HAIR),
        shirt: new THREE.Color(pick(look.shirt ?? SHIRT)),
        pants: new THREE.Color(pick(look.pants ?? PANTS)),
        shoes: new THREE.Color(pick(look.shoes ?? SHOES)),
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
            if (joint === 'legL' || joint === 'legR') c = p.y < CUT.shoe ? colours.shoes : age === 'child' && p.y < CUT.knee ? colours.skin : colours.pants
            else if (joint === 'body') c = p.y < CUT.hips ? colours.pants : colours.shirt
            else if (joint === 'armL' || joint === 'armR') c = p.y > (age === 'elder' ? CUT.longSleeve : CUT.sleeve) ? colours.shirt : colours.skin
            c.toArray(col, i * 3)
            if (joint === 'head') head.expandByPoint(p)
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
        o.geometry = geo
        o.material = cloth
    })
    for (const o of remove) o.removeFromParent()

    const headJoint = model.getObjectByName('head')
    if (headJoint && !head.isEmpty()) headJoint.attach(hairAndEars(head, colours, age))
    // children: a slightly bigger head on the smaller body
    if (headJoint && age === 'child') headJoint.scale.multiplyScalar(1.16)
    model.userData.age = age

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
function hairAndEars(head, colours, age = 'adult') {
    const c = head.getCenter(new THREE.Vector3())
    const s = head.getSize(new THREE.Vector3())
    const g = new THREE.Group()
    g.name = 'pelo'
    const hair = stylize(new THREE.MeshStandardMaterial({ name: 'vecino_pelo', color: colours.hair, roughness: 0.85 }), { ao: 0.15, aoHeight: 2, rim: 0.18 })
    const skin = stylize(new THREE.MeshStandardMaterial({ name: 'vecino_oreja', color: colours.skin, roughness: 0.6 }), { ao: 0, rim: 0.1 })

    // the cap: the top of the head and the back, tipped back so the face stays clear
    // children: a bowl cut, the cap brought down over the forehead, with no fringe
    const kid = age === 'child'
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * (kid ? 0.51 : 0.6)), hair)
    cap.scale.set(s.x * 0.545, s.y * 0.56, s.z * 0.56)
    cap.position.set(c.x, c.y + s.y * 0.05, c.z - s.z * 0.02)
    cap.rotation.x = age === 'elder' ? -0.75 : kid ? -0.1 : -0.42
    if (kid) cap.scale.set(s.x * 0.565, s.y * 0.6, s.z * 0.585)
    g.add(cap)
    // older people: the hair has thinned back from the forehead, and there is no fringe
    if (age === 'elder') {
        for (const side of [-1, 1]) {
            const tuft = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), hair)
            tuft.scale.set(s.x * 0.16, s.y * 0.2, s.z * 0.3)
            tuft.position.set(c.x + side * s.x * 0.44, c.y + s.y * 0.08, c.z - s.z * 0.06)
            g.add(tuft)
        }
    }

    // the fringe: a few locks swept to one side over the forehead
    const locks = [
        [-0.25, 0.27, 0.36, 0.32, 0.5],
        [-0.02, 0.3, 0.4, 0.34, 0.3],
        [0.22, 0.27, 0.37, 0.3, 0.1],
        [0.38, 0.14, 0.27, 0.22, -0.4],
        [-0.4, 0.12, 0.25, 0.22, 0.6],
    ]
    for (const [x, y, z, w, tilt] of age === 'elder' || kid ? [] : locks) {
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
