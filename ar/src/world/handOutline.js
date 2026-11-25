import * as THREE from 'three'

/**
 * The white outline the SDK draws around each tracked hand, always to be seen, and still telling
 * what is in front of what:
 *
 * - where the hand is in front of what is virtual (or in the open), the outline as the SDK draws it;
 * - where something virtual is in front of the hand, the same outline, fainter: an x-ray.
 *
 * The SDK draws it in two meshes on the hand's skeleton: a slightly thinner hand that only writes
 * depth, so just the rim of the outline (a mesh drawn from its back faces) shows. Scene depth then
 * hides the outline behind anything virtual. Here the thinner hand writes the stencil instead,
 * through anything, and both outlines leave out what it marked: the rim, in front or behind.
 * Needs a renderer with a stencil buffer (`render.stencil` in World.create).
 *
 * The SDK's materials are found in the scene, not imported, and are shared by every hand: they are
 * changed once. Hands come and go with sessions and controllers, so the scene is looked at now and then.
 */
const XRAY_OPACITY = 0.4
const LOOK_EVERY = 0.5
const MARK = 1

const isThinHand = (m) => m?.isShaderMaterial && m.uniforms?.outlineThickness
const isOutline = (m) => m?.isShaderMaterial && m.uniforms?.outlineColor && !m.userData.xray

export class HandOutline {
    constructor(scene) {
        this.scene = scene
        this.since = LOOK_EVERY
        this.xray = null
    }

    update(dt) {
        this.since += dt
        if (this.since < LOOK_EVERY) return
        this.since = 0
        const outlines = []
        this.scene.traverse((o) => {
            if (!o.isSkinnedMesh) return
            if (isThinHand(o.material)) {
                this.#markInside(o.material)
                o.renderOrder = 998
            } else if (isOutline(o.material) && !o.userData.xrayCopy) outlines.push(o)
        })
        for (const outline of outlines) this.#addXray(outline)
    }

    /** The thinner hand: no colour and no depth, but the stencil, wherever it is, in front or behind. */
    #markInside(m) {
        if (m.userData.marksInside) return
        m.userData.marksInside = true
        m.colorWrite = false
        m.depthWrite = false
        m.depthTest = false
        m.stencilWrite = true
        m.stencilRef = MARK
        m.stencilFunc = THREE.AlwaysStencilFunc
        m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.ReplaceStencilOp
        m.needsUpdate = true
    }

    /** Only the rim: not where the thinner hand marked. */
    static #rimOnly(m) {
        m.stencilWrite = true
        m.stencilRef = MARK
        m.stencilFunc = THREE.NotEqualStencilFunc
        m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp
        m.needsUpdate = true
    }

    /** Beside the outline, on the same skeleton: the part of it that is behind something, faint. */
    #addXray(outline) {
        const m = outline.material
        if (!m.userData.rimOnly) {
            m.userData.rimOnly = true
            HandOutline.#rimOnly(m)
        }
        if (!this.xray) {
            const x = m.clone()
            x.userData.xray = true
            x.fragmentShader = x.fragmentShader.replace('gl_FragColor = vec4(outlineColor, alpha);', `gl_FragColor = vec4(outlineColor, alpha * ${XRAY_OPACITY.toFixed(2)});`)
            // drawn only where something nearer is already there
            x.depthFunc = THREE.GreaterDepth
            x.depthWrite = false
            HandOutline.#rimOnly(x)
            this.xray = x
        }
        const copy = outline.clone()
        copy.material = this.xray
        copy.frustumCulled = false
        copy.renderOrder = 999
        copy.userData.xrayCopy = true
        outline.userData.xrayCopy = copy
        outline.parent?.add(copy)
    }
}
