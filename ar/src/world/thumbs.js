import * as THREE from 'three'
import { GuideFace } from '../../../src/three/guideFace.js'
import { supplyObject } from './station.js'
import { THUMBS } from './thumbStore.js'

/**
 * Little photos, taken once before the shift with a renderer of their own: each family as its
 * people look in the shift, and each supply as it looks on the shelf. The order cards draw them.
 */
export { THUMBS }

const SIZE = 256

export function takeThumbs({ loader, people, supplies, orders }) {
    let renderer
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    } catch (err) {
        console.warn('[ar2] no photos for the orders', err)
        return THUMBS
    }
    renderer.setSize(SIZE, SIZE, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight('#FFF4E6', '#8A8172', 2.2))
    const sun = new THREE.DirectionalLight('#FFFFFF', 1.6)
    sun.position.set(1, 2, 3)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50)
    const snap = (object, { portrait = false } = {}) => {
        scene.add(object)
        object.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        // a portrait: from the chest up of the tallest
        if (portrait) {
            center.y = box.max.y - size.y * 0.28
            size.y *= 0.6
        }
        const span = Math.max(size.x, size.y) * 1.1
        const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        camera.position.set(center.x + (portrait ? 0 : dist * 0.45), center.y + (portrait ? 0 : dist * 0.35), center.z + dist)
        camera.lookAt(center)
        renderer.render(scene, camera)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = SIZE
        canvas.getContext('2d').drawImage(renderer.domElement, 0, 0)
        scene.remove(object)
        return canvas
    }
    for (const [id, template] of supplies) {
        try {
            THUMBS.item.set(id, snap(supplyObject(loader, template, id, 1)))
        } catch (err) {
            console.warn('[ar2] no photo of', id, err)
        }
    }
    for (const order of orders) {
        try {
            const group = new THREE.Group()
            let x = 0
            for (const id of order.visitors) {
                const t = people.get(id)
                const o = loader.instanceSync(t)
                // with the same face they have in the shift, looking at the camera
                try {
                    const face = GuideFace.attach(o, o.getObjectByName('head'))
                    if (face) {
                        face.setMood('happy')
                        face.update(1)
                    }
                } catch (err) {
                    console.warn('[ar2] no face for the photo of', id, err)
                }
                const k = id.includes('nino') ? 0.76 : 1
                o.scale.multiplyScalar(k)
                const w = (t.size?.x ?? 0.5) * k
                o.position.x = x + w / 2
                x += w + 0.04
                group.add(o)
            }
            group.position.x = -x / 2
            const holder = new THREE.Group()
            holder.add(group)
            THUMBS.family.set(order.id, snap(holder, { portrait: true }))
        } catch (err) {
            console.warn('[ar2] no photo of', order.family, err)
        }
    }
    renderer.dispose()
    renderer.forceContextLoss?.()
    return THUMBS
}
