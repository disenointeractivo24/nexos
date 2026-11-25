import * as THREE from 'three'

/**
 * The person's real hands, over what is virtual, and the white outline the SDK draws around them,
 * always to be seen, both telling what is in front of what:
 *
 * - where the hand is in front of what is virtual, a mask: the tracked hand's mesh draws nothing,
 *   not even alpha, so the headset shows the room there, that is, the real hand, solid and sharp;
 * - the outline as the SDK draws it, where the hand is in front (or in the open);
 * - where something virtual is in front of the hand, no mask (it covers the hand, as it would),
 *   and the same outline, fainter: an x-ray.
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

const isThinHand = (m) => m?.isShaderMaterial && m.uniforms?.outlineThickness && !m.userData.mask
const isOutline = (m) => m?.isShaderMaterial && m.uniforms?.outlineColor && !m.userData.xray

/**
 * The hand's mesh, punched out of what is drawn: no colour and no alpha (it replaces, not blends),
 * so passthrough shows. Tested against depth, so only where the hand is nearer than what is virtual.
 * Drawn after everything else in the scene, before the outlines.
 */
function maskMaterial(thin) {
    const m = new THREE.ShaderMaterial({
        uniforms: { outlineThickness: { value: 0 } },
        vertexShader: thin.vertexShader,
        fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
        blending: THREE.NoBlending,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.FrontSide,
    })
    m.userData.mask = true
    return m
}

export class HandOutline {
    constructor(scene) {
        this.scene = scene
        this.since = LOOK_EVERY
        this.xray = null
        this.mask = null
    }

    update(dt) {
        this.since += dt
        if (this.since < LOOK_EVERY) return
        this.since = 0
        const outlines = []
        const masks = []
        this.scene.traverse((o) => {
            if (!o.isSkinnedMesh) return
            if (isThinHand(o.material)) {
                this.#markInside(o.material)
                o.renderOrder = 998
                if (!o.userData.maskCopy) masks.push(o)
            } else if (isOutline(o.material) && !o.userData.xrayCopy) outlines.push(o)
        })
        for (const outline of outlines) this.#addXray(outline)
        for (const thin of masks) this.#addMask(thin)
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

    /** Beside the thinner hand, on the same skeleton, at the hand's full size: the mask. */
    #addMask(thin) {
        this.mask ??= maskMaterial(thin.material)
        const copy = thin.clone()
        copy.material = this.mask
        copy.frustumCulled = false
        // after all that is virtual (so its depth is there to test against), before the outlines
        copy.renderOrder = 997
        copy.userData.maskCopy = true
        thin.userData.maskCopy = copy
        thin.parent?.add(copy)
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
