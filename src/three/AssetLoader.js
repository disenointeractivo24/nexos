import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getAsset } from '../data/assets.js'
import { houseMaterial } from './materials.js'
import { PROCEDURAL } from './procedural/index.js'

/**
 * Loads every asset once, normalises it (centre, ground, façade, scale),
 * and hands out cheap clones that share geometry and materials.
 *
 * Supports Draco and Meshopt compressed GLBs. Failed loads fall back to the
 * procedural builder (or a neutral placeholder) so the experience never breaks.
 */
export class AssetLoader {
    constructor() {
        const draco = new DRACOLoader()
        draco.setDecoderPath('/draco/')
        this.gltf = new GLTFLoader()
        this.gltf.setDRACOLoader(draco)
        this.gltf.setMeshoptDecoder(MeshoptDecoder)
        this.templates = new Map() // id → Promise<Template>
    }

    /** @returns {Promise<{object: THREE.Object3D, size: THREE.Vector3, animations: THREE.AnimationClip[], source: string, painted: boolean}>} */
    load(id) {
        if (!this.templates.has(id)) this.templates.set(id, this.#loadTemplate(id))
        return this.templates.get(id)
    }

    async preload(ids, onProgress) {
        let done = 0
        onProgress?.(0)
        await Promise.all(
            ids.map((id) =>
                this.load(id).finally(() => {
                    done++
                    onProgress?.(done / ids.length)
                })
            )
        )
    }

    /**
     * Clone a loaded template. For painted assets pass a colour scheme.
     * Must be called after load(id) resolved.
     */
    async instance(id, { scheme } = {}) {
        const t = await this.load(id)
        return this.instanceSync(t, { scheme })
    }

    instanceSync(template, { scheme } = {}) {
        const obj = template.object.clone(true)
        if (template.painted) {
            obj.traverse((o) => {
                if (o.isMesh && o.userData.role) o.material = houseMaterial(o.userData.role, scheme)
            })
        }
        obj.userData.size = template.size.clone()
        return obj
    }

    async #loadTemplate(id) {
        const def = getAsset(id)
        let root = null
        let animations = []
        let source = 'procedural'

        if (def.model) {
            try {
                const gltf = await this.gltf.loadAsync(def.model)
                root = gltf.scene
                animations = gltf.animations ?? []
                source = 'glb'
            } catch (err) {
                console.warn(`[assets] Could not load "${def.model}" for "${id}". Using fallback.`, err)
            }
        }

        if (!root) {
            const build = def.procedural && PROCEDURAL[def.procedural]
            root = build ? build() : placeholder()
            source = build ? 'procedural' : 'placeholder'
        }

        const painted = source === 'glb' && !!def.paint && animations.length === 0
        const object = painted ? mergeByRole(root, def.paint) : root
        normalise(object, def)

        object.traverse((o) => {
            if (o.isMesh) {
                o.castShadow = true
                o.receiveShadow = true
            }
        })

        const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
        object.userData.assetId = id
        return { id, object, size, animations, source, painted }
    }
}

/* ------------------------------------------------------------------ */

function resolveRole(name, paint) {
    for (const [test, role] of paint.rules ?? []) {
        if (test instanceof RegExp ? test.test(name) : test === name) return role
    }
    return paint.default ?? 'wall'
}

/**
 * Untextured GLBs arrive as dozens of loose meshes (a roof is 54 tiles).
 * Bake transforms and merge per material role → a few draw calls per house.
 */
function mergeByRole(root, paint) {
    root.updateMatrixWorld(true)
    const buckets = new Map()
    const fixes = []

    root.traverse((o) => {
        if (!o.isMesh) return
        const role = resolveRole(o.name, paint)
        let g = o.geometry.clone()
        for (const key of Object.keys(g.attributes)) {
            if (key !== 'position' && key !== 'normal') g.deleteAttribute(key)
        }
        g.morphAttributes = {}
        if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()])
        if (!g.attributes.normal) g.computeVertexNormals()
        g.applyMatrix4(o.matrixWorld)
        // glTF: a mirrored node (negative scale) inverts triangle winding. Baking the
        // transform keeps the geometry mirrored, so the winding must be flipped by hand.
        if (o.matrixWorld.determinant() < 0) flipWinding(g)
        // Some source meshes are modelled inside-out. Re-orient the clear cases.
        const out = outwardRatio(g)
        if (out < 0.35) {
            flipWinding(g)
            negateNormals(g)
            fixes.push(o.name)
        }
        if (!buckets.has(role)) buckets.set(role, [])
        buckets.get(role).push(g)
    })

    const group = new THREE.Group()
    for (const [role, list] of buckets) {
        const allIndexed = list.every((g) => g.index)
        const parts = allIndexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g))
        const merged = mergeGeometries(parts, false)
        if (!merged) continue
        merged.computeBoundingSphere()
        const mesh = new THREE.Mesh(merged, houseMaterial(role))
        mesh.name = role
        mesh.userData.role = role
        group.add(mesh)
        parts.forEach((g) => g.dispose())
    }
    if (fixes.length && import.meta.env?.DEV) console.debug(`[assets] re-oriented ${fixes.length} inward mesh(es):`, fixes.join(', '))
    return group
}

function flipWinding(g) {
    const idx = g.index.array
    for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i + 1]
        idx[i + 1] = idx[i + 2]
        idx[i + 2] = t
    }
    g.index.needsUpdate = true
}

function negateNormals(g) {
    const n = g.attributes.normal
    for (let i = 0; i < n.array.length; i++) n.array[i] *= -1
    n.needsUpdate = true
}

/** Share of triangles whose face normal points away from the mesh centre (1 = all outward). */
function outwardRatio(g) {
    g.computeBoundingBox()
    const c = g.boundingBox.getCenter(new THREE.Vector3())
    const p = g.attributes.position
    const idx = g.index.array
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3()
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3()
    let out = 0, total = 0
    for (let i = 0; i < idx.length; i += 3) {
        a.fromBufferAttribute(p, idx[i])
        b.fromBufferAttribute(p, idx[i + 1])
        d.fromBufferAttribute(p, idx[i + 2])
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a))
        const area = n.length()
        if (area < 1e-9) continue
        m.copy(a).add(b).add(d).divideScalar(3).sub(c)
        total += area
        if (n.dot(m) > 0) out += area
    }
    return total ? out / total : 1
}

/** Centre on X/Z, rest on the ground, face +Z, and scale. */
function normalise(object, def) {
    const wrapper = object
    wrapper.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(wrapper)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())

    let scale = def.scale ?? 1
    if (def.fit?.height) scale = def.fit.height / Math.max(size.y, 1e-6)
    if (def.fit?.size) scale = def.fit.size / Math.max(size.x, size.y, size.z, 1e-6)

    const offset = new THREE.Vector3(-center.x, -box.min.y, -center.z)
    const rot = def.front === '-z' ? Math.PI : def.front === '+x' ? -Math.PI / 2 : def.front === '-x' ? Math.PI / 2 : 0

    // Bake into children so clones stay simple (root keeps identity transform).
    const m = new THREE.Matrix4()
        .makeScale(scale, scale, scale)
        .multiply(new THREE.Matrix4().makeRotationY(rot))
        .multiply(new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z))

    for (const child of [...wrapper.children]) {
        child.applyMatrix4(m)
    }
    wrapper.position.set(0, 0, 0)
    wrapper.rotation.set(0, 0, 0)
    wrapper.scale.set(1, 1, 1)
    wrapper.updateMatrixWorld(true)
}

function placeholder() {
    const g = new THREE.Group()
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
        new THREE.MeshStandardMaterial({ color: '#D9D4CB', roughness: 1 })
    )
    g.add(m)
    return g
}
