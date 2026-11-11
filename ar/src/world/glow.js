import * as THREE from 'three'

const COLOR = '#FFC629'
const box = new THREE.Box3()
const center = new THREE.Vector3()
const size = new THREE.Vector3()

let halo = null
/** A soft ring, clearer at its middle so that what it surrounds can still be seen. */
function haloMaterial() {
    if (halo) return halo
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const c = canvas.getContext('2d')
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,198,41,0.04)')
    g.addColorStop(0.42, 'rgba(255,198,41,0.1)')
    g.addColorStop(0.62, 'rgba(255,198,41,0.8)')
    g.addColorStop(0.8, 'rgba(255,198,41,0.25)')
    g.addColorStop(1, 'rgba(255,198,41,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 128, 128)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    halo = new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    return halo
}

/**
 * What shines right now: a halo around each object, seen even through the walls of a crate,
 * and the object itself lit up. Its halos are out of reach of any ray.
 */
export class Glow {
    constructor(parent) {
        this.parent = parent
        this.lit = new Map()
    }

    /** Exactly these shine from now on. */
    show(objects) {
        for (const object of this.lit.keys()) if (!objects.includes(object)) this.#off(object)
        for (const object of objects) if (!this.lit.has(object)) this.#on(object)
    }

    #on(object) {
        box.setFromObject(object)
        const empty = box.isEmpty()
        if (empty) object.getWorldPosition(center)
        else box.getCenter(center)
        box.getSize(size)
        const sprite = new THREE.Sprite(haloMaterial())
        sprite.raycast = () => {}
        sprite.pointerEvents = 'none'
        sprite.renderOrder = 10
        sprite.scale.setScalar(empty ? 0.6 : Math.max(0.3, Math.max(size.x, size.y, size.z) * 1.5))
        this.parent.add(sprite)
        const swapped = []
        object.traverse((mesh) => {
            if (!mesh.isMesh || !mesh.material?.emissive) return
            const original = mesh.material
            mesh.material = original.clone()
            mesh.material.emissive.set(COLOR)
            swapped.push({ mesh, original })
        })
        this.lit.set(object, { sprite, swapped, offset: object.worldToLocal(center.clone()) })
    }

    #off(object) {
        const { sprite, swapped } = this.lit.get(object)
        sprite.removeFromParent()
        for (const { mesh, original } of swapped) {
            mesh.material.dispose()
            mesh.material = original
        }
        this.lit.delete(object)
    }

    /** Breathes, and follows what moves. */
    update(time) {
        const k = 0.5 + 0.5 * Math.sin(time * 4)
        haloMaterial().opacity = 0.5 + 0.5 * k
        for (const [object, { sprite, swapped, offset }] of this.lit) {
            sprite.position.copy(offset)
            object.localToWorld(sprite.position)
            for (const { mesh } of swapped) mesh.material.emissiveIntensity = 0.08 + 0.22 * k
        }
    }
}
