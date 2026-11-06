import * as THREE from 'three'

/** Warmth of the light at calm and at the worst moment: warmer, never darker. */
const CALM = { sky: new THREE.Color('#FFF4E6'), sun: new THREE.Color('#FFE9CF') }
const TENSE = { sky: new THREE.Color('#FFEBD6'), sun: new THREE.Color('#FFD9B3') }

/**
 * How the light feels with the pressure on. It moves slowly and evenly, with no flashes and
 * nothing that shifts the view, so it weighs on the mood and not on the stomach.
 */
export class Atmosphere {
    constructor(sky, sun) {
        this.sky = sky
        this.sun = sun
        this.level = 0
    }

    update(dt, pressure) {
        // about ten seconds to catch up: a change of mood, not an event
        this.level += (pressure - this.level) * Math.min(1, dt * 0.25)
        this.sky.color.lerpColors(CALM.sky, TENSE.sky, this.level)
        this.sun.color.lerpColors(CALM.sun, TENSE.sun, this.level)
    }
}
