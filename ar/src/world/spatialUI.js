import { PanelDocument, PanelUI, PokeInteractable, RayInteractable, UIKit } from '@iwsdk/core'
import * as THREE from 'three'

/**
 * The project's typeface, with what Spanish needs. UIKit turns a TTF into its glyph atlas only
 * for plain ASCII unless told otherwise, which leaves out every accent, ñ and ¿: so the atlas is
 * made here, once, with those too, and handed to every panel.
 */
const CHARSET = ` \tABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,;:'"()-[]{}@#$%&*+=/\\<>áéíóúÁÉÍÓÚñÑüÜ¿¡·–—…«»°×`
const FONT_FILES = { normal: './fonts/AtkinsonHyperlegibleNext-Regular.ttf', bold: './fonts/AtkinsonHyperlegibleNext-Bold.ttf' }
let typeface = null
function loadTypeface() {
    typeface ??= (async () => {
        const loader = new UIKit.TTFLoader()
        const family = {}
        // one at a time: generating two atlases at once can leave one incomplete
        for (const [weight, url] of Object.entries(FONT_FILES)) {
            const generated = await loader.loadAsync({ url, charset: CHARSET, textureSize: [1024, 1024] })
            family[weight] = Object.values(Object.values(generated)[0])[0]
        }
        return { atkinson: family }
    })().catch((err) => {
        console.warn('[ar] the typeface did not load; panels keep the default one', err)
        return null
    })
    return typeface
}

/**
 * A panel written in UIKitML (public/ui/*.uikitml), placed in the room. What it shows is changed
 * by id, as on a web page; anything asked before the file has loaded is done once it has.
 */
export class SpatialPanel {
    /** @param {{ width: number, height: number, parent?: any, interactive?: boolean }} opts */
    constructor(world, config, { width, height, parent = null, interactive = false }) {
        this.object = new THREE.Group()
        this.entity = world.createTransformEntity(this.object, parent ? { parent } : undefined)
        this.entity.addComponent(PanelUI, { config })
        if (interactive) {
            this.entity.addComponent(RayInteractable)
            this.entity.addComponent(PokeInteractable)
        }
        this.width = width
        this.height = height
        this.doc = null
        this.pending = []
        this.shown = new Map()
        this.visible = true
    }

    /** Called once the panel's document exists. */
    attach() {
        if (this.doc) return
        this.doc = this.entity.getValue(PanelDocument, 'document')
        if (!this.doc) return
        this.doc.setTargetDimensions(this.width, this.height)
        for (const fn of this.pending) fn()
        this.pending = []
        loadTypeface().then((fontFamilies) => {
            if (fontFamilies && !this.doc.disposed) this.doc.rootElement.setProperties({ fontFamilies, fontFamily: 'atkinson' })
        })
    }

    #when(fn) {
        if (this.doc) fn()
        else this.pending.push(fn)
    }

    /** Properties of one element, only when they change: each change re-lays the panel out. */
    set(id, props) {
        const slot = `${id}:${Object.keys(props).join(',')}`
        const key = JSON.stringify(props)
        if (this.shown.get(slot) === key) return
        this.shown.set(slot, key)
        this.#when(() => this.doc.getElementById(id)?.setProperties(props))
    }

    text(id, text) {
        this.set(id, { text: String(text) })
    }

    display(id, on) {
        this.set(id, { display: on ? 'flex' : 'none' })
    }

    onClick(id, fn) {
        this.#when(() => this.doc.getElementById(id)?.addEventListener('click', fn))
    }

    /** Hidden is also out of reach of the rays. */
    show(on) {
        this.visible = on
        this.object.visible = on
        this.object.pointerEvents = on ? 'auto' : 'none'
    }
}
