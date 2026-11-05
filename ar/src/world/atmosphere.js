import * as THREE from 'three'

/** Warmth of the light at calm and at the worst moment. */
const CALM = { sky: new THREE.Color('#FFF4E6'), sun: new THREE.Color('#FFE9CF'), veil: new THREE.Color('#E39B1B') }
const TENSE = { sky: new THREE.Color('#FFE9D2'), sun: new THREE.Color('#FFD2A6'), veil: new THREE.Color('#D9601F') }
/** Strongest the warm veil over the view gets: felt, never in the way of reading. */
const VEIL_MAX = 0.13

/**
 * How the room feels with the pressure on: warmer light and a warm veil over everything the
 * person sees. It moves slowly and evenly, with no flashes, no pulsing and nothing that shifts
 * the view, so it weighs on the mood and not on the stomach.
 */
export class Atmosphere {
    constructor(scene, camera, sky, sun) {
        this.camera = camera
        this.sky = sky
        this.sun = sun
        this.level = 0
        this.veil = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 16, 12),
            new THREE.MeshBasicMaterial({ color: CALM.veil, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false })
        )
        this.veil.renderOrder = 1000
        this.veil.frustumCulled = false
        this.veil.visible = false
        scene.add(this.veil)
        this.head = new THREE.Vector3()
    }

    update(dt, pressure) {
        // about ten seconds to catch up: a change of mood, not an event
        this.level += (pressure - this.level) * Math.min(1, dt * 0.25)
        const k = this.level
        this.sky.color.lerpColors(CALM.sky, TENSE.sky, k)
        this.sun.color.lerpColors(CALM.sun, TENSE.sun, k)
        this.veil.material.color.lerpColors(CALM.veil, TENSE.veil, k)
        this.veil.material.opacity = VEIL_MAX * k
        this.veil.visible = k > 0.01
        this.camera.getWorldPosition(this.head)
        this.veil.position.copy(this.head)
    }
}
