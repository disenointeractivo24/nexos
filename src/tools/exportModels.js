import * as THREE from 'three'

/**
 * Model export, step 1 of 2 (run in the browser: /export-models.html).
 *
 * Builds every model with the same functions the experience uses, converts
 * each mesh to quads (quadMesh.js) and sends the result, with its textures,
 * to the local receiver (tools/export-models/receive.mjs). Step 2 is the
 * Blender script that turns that into FBX files.
 */

// Record every translate/rotate/scale baked into a geometry, so caps and poles
// can be rebuilt in the geometry's own frame. Must run before any model is built.
const bakeApply = THREE.BufferGeometry.prototype.applyMatrix4
THREE.BufferGeometry.prototype.applyMatrix4 = function (m) {
    this.userData.bake = m.clone().multiply(this.userData.bake ?? new THREE.Matrix4())
    return bakeApply.call(this, m)
}

const RECEIVER = 'http://localhost:5199'
const log = (msg) => {
    document.querySelector('#log').textContent += `${msg}\n`
    console.log(msg)
}

/** Deterministic random numbers, so pots and clothes lines export the same every time. */
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

async function main() {
    // imported only now, after the geometry patch above
    const { toQuadMesh, quadSphere, mergeQ, rawQ, deformQ, QMesh } = await import('./quadMesh.js')
    const { AssetLoader } = await import('../three/AssetLoader.js')
    const { buildVillager } = await import('../three/procedural/villager.js')
    const { buildCollectionPoint } = await import('../three/CollectionPoint.js')
    const props = await import('../three/props.js')
    const cues = await import('../three/ThemeCues.js')
    const nature = await import('../three/procedural/nature.js')
    const { WORLD } = await import('../three/materials.js')

    const loader = new AssetLoader()
    const asset = async (id) => (await loader.load(id)).object

    /* ---------------- vegetation: quad spheres stand in for the icosahedron blobs ---------------- */
    const jitter = (q, amount, seed) => {
        const rnd = seeded(seed)
        const map = new Map()
        return deformQ(q, (p) => {
            const k = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`
            if (!map.has(k)) map.set(k, [(rnd() - 0.5) * amount, (rnd() - 0.5) * amount, (rnd() - 0.5) * amount])
            const d = map.get(k)
            p.x += d[0]
            p.y += d[1]
            p.z += d[2]
        })
    }
    const blobs = ({ blobs: list, jitter: amount, seed }) => {
        const merged = new QMesh()
        for (const [x, y, z, r] of list) {
            const s = quadSphere(r, 4, new THREE.Vector3(x, y, z))
            const base = merged.v.length
            s.v.forEach((p) => merged.v.push(p))
            s.f.forEach((f, i) => merged.face(f.map((k) => k + base), s.uv[i]))
        }
        return jitter(merged, amount, seed).out(true)
    }
    const meshNode = (name, quad, material, { position = [0, 0, 0], scale = [1, 1, 1] } = {}) => {
        const o = new THREE.Mesh(new THREE.BufferGeometry(), material)
        o.name = name
        o.userData.quad = quad
        o.position.set(...position)
        o.scale.set(...scale)
        return o
    }
    const mat = (name, color, roughness = 0.9) => new THREE.MeshStandardMaterial({ name, color, roughness })

    const tree = () => {
        const g = new THREE.Group()
        g.name = 'arbol'
        const T = nature.TRUNK
        // a 7-sided trunk cannot be capped with quads, so it gets 8 sides
        const trunk = new THREE.CylinderGeometry(T.radiusTop, T.radiusBottom, T.height, 8).translate(0, T.height / 2, 0)
        g.add(meshNode('tronco', toQuadMesh(trunk), mat('arbol_tronco', WORLD.trunk, 1), { scale: [1.3, 1.35, 1.3] }))
        g.add(meshNode('copa', blobs(nature.CANOPY), mat('arbol_copa', WORLD.leaf[0], 0.92), { position: [0, 1.5, 0], scale: [1.35, 1.25, 1.35] }))
        return g
    }
    const bush = () => {
        const g = new THREE.Group()
        g.name = 'arbusto'
        g.add(meshNode('arbusto', blobs(nature.BUSH), mat('arbusto', '#7C9B66', 0.95)))
        return g
    }
    const palm = () => {
        const P = nature.PALM
        const F = P.frond
        const g = new THREE.Group()
        g.name = 'palmera'
        const curve = new THREE.CatmullRomCurve3(P.spine.map((p) => new THREE.Vector3(...p)))
        const trunk = new THREE.TubeGeometry(curve, P.trunk.tubular, P.trunk.radius, P.trunk.radial, false)
        g.add(meshNode('tronco', toQuadMesh(trunk), mat('palmera_tronco', P.trunk.color, 0.95)))
        const top = curve.getPoint(1)
        const fronds = []
        for (let i = 0; i < F.count; i++) {
            // build the frond as a quad sphere, then bend it exactly like the scene does
            const q = rawQ(new THREE.SphereGeometry(F.radius, 8, 4), { sphereDome: true })
            const turn = new THREE.Matrix4().makeRotationY((i / F.count) * Math.PI * 2 + F.turn)
            deformQ(q, (p) => {
                p.multiply(new THREE.Vector3(...F.scale))
                p.x += F.offset
                p.y -= Math.pow(Math.max(p.x, 0) / F.scale[0], 2) * F.droop
                p.applyMatrix4(turn).add(top)
            })
            fronds.push(q)
        }
        g.add(meshNode('hojas', mergeQ(fronds), mat('palmera_hojas', F.color, 0.95)))
        return g
    }

    /* ---------------- the catalogue ---------------- */
    const MODELS = [
        ['personajes', 'guia', () => asset('guide')],
        ['personajes', 'vecino', () => buildVillager({ palette: 0 })],
        ['insumos', 'arroz', () => asset('rice')],
        ['insumos', 'agua', () => asset('water')],
        ['insumos', 'alimentos_enlatados', () => asset('cans')],
        ['insumos', 'leche', () => asset('milk')],
        ['insumos', 'medicinas', () => asset('medicine')],
        ['insumos', 'jabon', () => asset('soap')],
        ['insumos', 'cobija', () => asset('blanket')],
        ['insumos', 'kit_de_higiene', () => asset('hygiene-kit')],
        ['punto_de_acopio', 'punto_de_acopio', () => buildCollectionPoint()],
        ['punto_de_acopio', 'caja_de_insumos', () => props.supplyBox()],
        ['vegetacion', 'arbol', tree],
        ['vegetacion', 'arbusto', bush],
        ['vegetacion', 'palmera', palm],
        ['barrio', 'banca', () => props.bench()],
        ['barrio', 'quiosco', () => props.kiosk()],
        ['barrio', 'capilla', () => props.chapel()],
        ['barrio', 'escalon_capilla', () => props.chapelStep()],
        ['barrio', 'puente_peatonal', () => props.footbridge()],
        ['barrio', 'arco_cancha', () => props.goal()],
        ['barrio', 'matera', () => props.pot(seeded(11))],
        ['barrio', 'caneca', () => props.bin()],
        ['barrio', 'bicicleta', () => props.bicycle()],
        ['barrio', 'muro_bajo', () => props.wallSection()],
        ['ciudad', 'cristo_rey', () => props.cristoRey()],
        ['ciudad', 'tres_cruces', () => props.tresCruces()],
        ['ciudad', 'la_ermita', () => props.ermita()],
        ['ciudad', 'torre_de_cali', () => props.torreDeCali()],
        ['ciudad', 'estadio', () => props.estadio()],
        ['ciudad', 'punto_de_ayuda_mapa', () => props.aidPoint()],
        ['ciudad', 'casa_mapa', () => props.cityHouse()],
        ['ciudad', 'torre_mapa', () => props.cityTower()],
        ['emergencias', 'carpa_de_socorro', () => cues.reliefTent()],
        ['emergencias', 'barrera_revision', () => cues.barrier()],
        ['emergencias', 'sacos_de_arena', () => cues.sandbags()],
        ['emergencias', 'tanques_de_agua', () => cues.waterTanks()],
        ['emergencias', 'conos', () => cues.cones()],
        ['emergencias', 'punto_de_encuentro', () => cues.meetingPoint()],
        ['emergencias', 'punto_de_agua', () => cues.waterPoint()],
        ['emergencias', 'estibas', () => cues.pallets()],
        ['emergencias', 'tendedero', () => cues.clothesLine(seeded(5))],
    ]

    const only = new URLSearchParams(location.search).get('solo')
    let ok = 0
    for (const [category, name, build] of MODELS) {
        if (only && only !== name) continue
        try {
            const root = await build()
            const data = serialize(root, name, toQuadMesh)
            data.category = category
            const res = await fetch(`${RECEIVER}/model`, { method: 'POST', body: JSON.stringify(data) })
            if (!res.ok) throw new Error(`receiver answered ${res.status}`)
            const faces = data.meshes.reduce((s, m) => s + m.faces.length / 4, 0)
            log(`✓ ${category}/${name}: ${data.meshes.length} piezas, ${faces} quads`)
            ok++
        } catch (err) {
            log(`✗ ${category}/${name}: ${err.message}`)
            console.error(err)
        }
    }
    log(`Listo: ${ok} modelos.`)
    document.body.dataset.done = 'true'
}

/* ------------------------------------------------------------------ */

/**
 * One model as JSON: a node tree (local matrices, three.js axes, metres),
 * the quad meshes, the materials and the textures as PNG data URLs.
 */
function serialize(root, modelName, toQuadMesh) {
    const meshes = []
    const materials = []
    const matIndex = new Map()
    const textures = {}
    const usedNames = new Map()
    const unique = (n) => {
        const k = usedNames.get(n) ?? 0
        usedNames.set(n, k + 1)
        return k ? `${n}_${String(k + 1).padStart(2, '0')}` : n
    }

    const usedMatNames = new Map()
    const materialId = (m) => {
        if (matIndex.has(m)) return matIndex.get(m)
        // distinct materials must never share a name: Blender (and most tools) would merge them
        const base = (m.name || `${modelName}_${m.map ? 'etiqueta' : m.color?.getHexString?.() ?? 'mat'}`).replace(/[^\w-]+/g, '_')
        const k = usedMatNames.get(base) ?? 0
        usedMatNames.set(base, k + 1)
        const name = k ? `${base}_${String(k + 1).padStart(2, '0')}` : base
        let texture = null
        if (m.map?.image) {
            texture = `${modelName}__${name}.png`
            if (!textures[texture]) {
                const img = m.map.image
                const c = img instanceof HTMLCanvasElement ? img : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
                if (c !== img) c.getContext('2d').drawImage(img, 0, 0)
                textures[texture] = c.toDataURL('image/png')
            }
        }
        materials.push({
            name,
            color: `#${m.color?.getHexString?.() ?? 'ffffff'}`,
            roughness: m.roughness ?? 1,
            metalness: m.metalness ?? 0,
            opacity: m.transparent ? m.opacity : 1,
            emissive: m.emissive ? `#${m.emissive.getHexString()}` : '#000000',
            emissiveIntensity: m.emissiveIntensity ?? 0,
            doubleSided: m.side === THREE.DoubleSide,
            vertexColors: !!m.vertexColors,
            texture,
        })
        matIndex.set(m, materials.length - 1)
        return materials.length - 1
    }

    const walk = (o, parentName) => {
        o.updateMatrix()
        const node = { name: unique(o.name || (o.isMesh ? `${parentName}_pieza` : 'grupo')), matrix: o.matrix.toArray(), visible: o.visible, children: [] }
        if (o.isMesh) {
            const quad = o.userData.quad ?? toQuadMesh(o.geometry)
            const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(materialId)
            meshes.push({ ...quad, materials: mats })
            node.mesh = meshes.length - 1
            if (!o.name) node.name = unique(`${materials[mats[0]].name.replace(/^.*?[:_]/, '')}`)
        }
        for (const c of o.children) node.children.push(walk(c, node.name))
        return node
    }
    const tree = walk(root, modelName)
    tree.name = modelName
    return { name: modelName, root: tree, meshes, materials, textures }
}

main().catch((e) => log(`Error: ${e.message}`))
