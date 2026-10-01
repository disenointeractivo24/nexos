import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { labelTexture, crossTexture, drawCross, canvasTexture } from './textures.js'

/**
 * Procedural supply items — calm, product-like miniatures used until the
 * supply GLBs are provided. Each builder returns a Group; the loader centres,
 * grounds and scales it.
 */

const std = (color, params = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...params })

function lathe(points, segments = 40) {
    return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments)
}

/* ---------------- Arroz: cloth sack ---------------- */
export function buildRice() {
    const g = new THREE.Group()
    const cloth = std('#ECE3D0', { roughness: 0.95 })
    const sack = new THREE.Mesh(
        lathe([
            [0.0, 0.0], [0.42, 0.01], [0.56, 0.08], [0.62, 0.3], [0.62, 0.62], [0.56, 0.86],
            [0.36, 1.02], [0.2, 1.1], [0.17, 1.16], [0.24, 1.26], [0.28, 1.36], [0.2, 1.4], [0.0, 1.38],
        ]),
        cloth
    )
    sack.scale.z = 0.82
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 8, 24), std('#B29A73'))
    tie.rotation.x = Math.PI / 2
    tie.position.y = 1.13
    tie.scale.y = 0.82
    const label = new THREE.Mesh(
        new THREE.CylinderGeometry(0.626, 0.626, 0.36, 32, 1, true, -0.75, 1.5),
        std('#FFFFFF', {
            map: labelTexture({ bg: '#FBF8F1', text: 'ARROZ', fg: '#011E41', size: 0.3, stripes: [{ y: 0.06, h: 0.07, color: '#F5333F' }, { y: 0.87, h: 0.07, color: '#F5333F' }] }),
            roughness: 0.9,
        })
    )
    label.position.y = 0.48
    label.scale.z = 0.82
    g.add(sack, tie, label)
    return g
}

/* ---------------- Agua: bottle ---------------- */
export function buildWater() {
    const g = new THREE.Group()
    const profile = [
        [0.0, 0.0], [0.27, 0.0], [0.3, 0.04], [0.3, 0.2], [0.27, 0.26], [0.3, 0.32], [0.3, 0.86],
        [0.27, 0.92], [0.3, 0.98], [0.3, 1.12], [0.22, 1.32], [0.12, 1.44], [0.11, 1.52],
    ]
    const shell = new THREE.Mesh(
        lathe(profile, 48),
        new THREE.MeshStandardMaterial({ color: '#D7EAF6', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 })
    )
    const water = new THREE.Mesh(
        lathe([[0, 0.03], [0.27, 0.03], [0.275, 0.2], [0.275, 1.05], [0, 1.05]], 40),
        std('#8FC1E3', { roughness: 0.2, transparent: true, opacity: 0.62 })
    )
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 28), std('#1F4E86', { roughness: 0.45 }))
    cap.position.y = 1.58
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.018, 8, 28), std('#1F4E86'))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 1.49
    const label = new THREE.Mesh(
        new THREE.CylinderGeometry(0.303, 0.303, 0.42, 40, 1, true),
        std('#FFFFFF', {
            map: labelTexture({ bg: '#FFFFFF', text: 'AGUA', fg: '#1F4E86', size: 0.34, w: 1024, stripes: [{ y: 0.78, h: 0.22, color: '#2F69A3' }] }),
            roughness: 0.6,
        })
    )
    label.position.y = 0.6
    g.add(water, shell, cap, ring, label)
    return g
}

/* ---------------- Alimentos enlatados: three cans ---------------- */
export function buildCans() {
    const g = new THREE.Group()
    const metal = std('#C9CDD2', { roughness: 0.32, metalness: 0.75 })
    const designs = [
        { bg: '#C9473F', text: 'FRÍJOL', fg: '#FFFFFF', band: '#F2E6CF' },
        { bg: '#E9D7A8', text: 'ATÚN', fg: '#011E41', band: '#2F69A3' },
        { bg: '#B9553A', text: 'TOMATE', fg: '#FFFFFF', band: '#F2E6CF' },
    ]
    const can = (d, r, h) => {
        const c = new THREE.Group()
        const body = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, h * 0.84, 36, 1, true),
            std('#FFFFFF', { map: labelTexture({ bg: d.bg, text: d.text, fg: d.fg, size: 0.28, w: 1024, stripes: [{ y: 0.08, h: 0.08, color: d.band }, { y: 0.84, h: 0.08, color: d.band }] }), roughness: 0.55 })
        )
        const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, h * 0.08, 36), metal)
        top.position.y = h * 0.46
        const bottom = top.clone()
        bottom.position.y = -h * 0.46
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.012, 36), metal)
        lid.position.y = h * 0.5
        c.add(body, top, bottom, lid)
        c.position.y = h / 2
        return c
    }
    const a = can(designs[0], 0.34, 0.56)
    a.position.set(-0.36, 0.28, 0.12)
    const b = can(designs[1], 0.36, 0.34)
    b.position.set(0.38, 0.17, 0.2)
    const c = can(designs[2], 0.32, 0.6)
    c.position.set(0.06, 0.3, -0.36)
    a.rotation.y = 0.5
    c.rotation.y = -0.4
    g.add(a, b, c)
    return g
}

/* ---------------- Leche: gable-top carton ---------------- */
export function buildMilk() {
    const g = new THREE.Group()
    const w = 0.62
    const h = 1.0
    const front = labelTexture({
        bg: '#FFFFFF',
        text: 'LECHE',
        fg: '#011E41',
        size: 0.16,
        w: 256,
        h: 400,
        extra: (ctx, cw, ch) => {
            ctx.fillStyle = '#2F69A3'
            ctx.beginPath()
            ctx.moveTo(0, ch * 0.78)
            ctx.bezierCurveTo(cw * 0.3, ch * 0.7, cw * 0.6, ch * 0.86, cw, ch * 0.74)
            ctx.lineTo(cw, ch)
            ctx.lineTo(0, ch)
            ctx.fill()
        },
    })
    const side = labelTexture({
        bg: '#FFFFFF',
        w: 256,
        h: 400,
        extra: (ctx, cw, ch) => {
            ctx.fillStyle = '#2F69A3'
            ctx.fillRect(0, ch * 0.8, cw, ch * 0.2)
        },
    })
    const faceFront = std('#FFFFFF', { map: front, roughness: 0.55 })
    const faceSide = std('#FFFFFF', { map: side, roughness: 0.55 })
    const plain = std('#F6F6F3', { roughness: 0.55 })
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), [faceSide, faceSide, plain, plain, faceFront, faceFront])
    box.position.y = h / 2
    // Gable top: triangular prism
    const shape = new THREE.Shape()
    shape.moveTo(-w / 2, 0)
    shape.lineTo(w / 2, 0)
    shape.lineTo(0, 0.3)
    shape.closePath()
    const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }), plain)
    gable.position.set(0, h, -w / 2)
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, w * 1.0), plain)
    fin.position.set(0, h + 0.33, 0)
    // Rotate gable so the slopes face front/back
    const top = new THREE.Group()
    top.add(gable, fin)
    top.rotation.y = Math.PI / 2
    g.add(box, top)
    return g
}

/* ---------------- Medicinas: box + blister ---------------- */
export function buildMedicine() {
    const g = new THREE.Group()
    const front = std('#FFFFFF', {
        map: canvasTexture(512, 320, (ctx, w, h) => {
            ctx.fillStyle = '#FFFFFF'
            ctx.fillRect(0, 0, w, h)
            ctx.fillStyle = '#EDEDED'
            ctx.fillRect(0, h * 0.82, w, h * 0.18)
            drawCross(ctx, w * 0.3, h * 0.44, h * 0.46, '#F5333F')
            ctx.fillStyle = '#011E41'
            ctx.fillRect(w * 0.55, h * 0.3, w * 0.32, h * 0.06)
            ctx.fillRect(w * 0.55, h * 0.42, w * 0.24, h * 0.06)
            ctx.fillRect(w * 0.55, h * 0.54, w * 0.28, h * 0.06)
        }),
        roughness: 0.6,
    })
    const plain = std('#FAFAF8', { roughness: 0.6 })
    const box = new THREE.Mesh(new RoundedBoxGeometry(1.05, 0.66, 0.42, 2, 0.03), [plain, plain, plain, plain, front, plain])
    box.position.set(-0.05, 0.33, -0.12)
    box.rotation.y = 0.12
    // Blister pack leaning in front
    const blister = new THREE.Group()
    const foil = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.04, 0.42, 2, 0.015), std('#D7DADF', { metalness: 0.7, roughness: 0.32 }))
    blister.add(foil)
    const pill = new THREE.SphereGeometry(0.06, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)
    const pillMats = [std('#FFFFFF', { roughness: 0.35 }), std('#E7A1A4', { roughness: 0.35 })]
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
            const p = new THREE.Mesh(pill, pillMats[(i + j) % 2])
            p.scale.set(1.3, 0.7, 1)
            p.position.set(-0.24 + i * 0.16, 0.02, -0.09 + j * 0.18)
            blister.add(p)
        }
    }
    blister.position.set(0.25, 0.2, 0.32)
    blister.rotation.set(-1.0, -0.25, 0.05)
    g.add(box, blister)
    return g
}

/* ---------------- Jabón: bar of soap ---------------- */
export function buildSoap() {
    const g = new THREE.Group()
    const topTex = canvasTexture(512, 320, (ctx, w, h) => {
        ctx.fillStyle = '#F2E4C4'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = 'rgba(160,130,90,0.45)'
        ctx.font = `800 ${Math.round(h * 0.26)}px "Atkinson Hyperlegible Next", "Segoe UI", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('JABÓN', w / 2, h / 2 + 4)
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.fillText('JABÓN', w / 2 - 2, h / 2 + 1)
    })
    const soapMat = std('#F2E4C4', { roughness: 0.42 })
    const topMat = std('#FFFFFF', { map: topTex, roughness: 0.42 })
    const geo = new RoundedBoxGeometry(1.1, 0.38, 0.68, 5, 0.17)
    const bar = new THREE.Mesh(geo, soapMat)
    bar.position.y = 0.19
    const top = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.44), topMat)
    top.rotation.x = -Math.PI / 2
    top.position.y = 0.381
    // Lay the bar slightly tilted toward the viewer
    const holder = new THREE.Group()
    holder.add(bar, top)
    holder.rotation.x = 0.45
    holder.position.y = 0.1
    g.add(holder)
    return g
}

/* ---------------- Cobija: folded blanket stack ---------------- */
export function buildBlanket() {
    const g = new THREE.Group()
    const stripeTex = canvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#6B7079'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#A9ADB3'
        ctx.fillRect(w * 0.62, 0, w * 0.07, h)
        ctx.fillRect(w * 0.74, 0, w * 0.04, h)
        for (let i = 0; i < 1400; i++) {
            ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`
            ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
        }
    })
    const wool = std('#FFFFFF', { map: stripeTex, roughness: 1 })
    const layers = 3
    for (let i = 0; i < layers; i++) {
        const fold = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.2, 0.8, 4, 0.09), wool)
        fold.position.set((i % 2 ? 0.03 : -0.02), 0.1 + i * 0.19, (i % 2 ? -0.02 : 0.02))
        fold.rotation.y = (i - 1) * 0.04
        g.add(fold)
    }
    // Rolled front edge on top layer
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.18, 20), wool)
    roll.rotation.z = Math.PI / 2
    roll.position.set(0, 0.6, 0.35)
    g.add(roll)
    return g
}

/* ---------------- Kit de higiene: clear pouch ---------------- */
export function buildHygieneKit() {
    const g = new THREE.Group()
    const pouch = new THREE.Mesh(
        new RoundedBoxGeometry(1.25, 0.82, 0.56, 4, 0.16),
        new THREE.MeshStandardMaterial({ color: '#E6F1F8', transparent: true, opacity: 0.3, roughness: 0.12, depthWrite: false, envMapIntensity: 1.4 })
    )
    pouch.position.y = 0.41
    const zipper = new THREE.Mesh(new RoundedBoxGeometry(1.18, 0.07, 0.6, 2, 0.03), std('#1F4E86', { roughness: 0.6 }))
    zipper.position.y = 0.8
    const pull = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.16, 0.03, 2, 0.012), std('#C9CDD2', { metalness: 0.7, roughness: 0.3 }))
    pull.position.set(0.42, 0.72, 0.3)

    // Contents
    const brush = new THREE.Group()
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.95, 0.05, 2, 0.02), std('#3E86C6', { roughness: 0.4 }))
    const bristles = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), std('#FFFFFF', { roughness: 0.9 }))
    bristles.position.set(0, 0.38, 0.05)
    brush.add(handle, bristles)
    brush.position.set(-0.38, 0.6, 0.02)
    brush.rotation.z = 0.12

    const bottle = new THREE.Group()
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 24), std('#FFFFFF', { roughness: 0.4 }))
    const bc = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 20), std('#2F69A3', { roughness: 0.45 }))
    bc.position.y = 0.3
    bottle.add(b, bc)
    bottle.position.set(0.32, 0.32, 0.0)

    const tube = new THREE.Group()
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 6, 16), std('#FFFFFF', { roughness: 0.45 }))
    t.scale.z = 0.55
    const tc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 16), std('#F5333F', { roughness: 0.5 }))
    tc.position.y = -0.3
    tube.add(t, tc)
    tube.position.set(-0.02, 0.36, -0.06)
    tube.rotation.z = -1.25

    const towel = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.22, 0.3, 3, 0.07), std('#F0F0EC', { roughness: 1 }))
    towel.position.set(0.06, 0.14, 0.08)

    g.add(brush, bottle, tube, towel, pouch, zipper, pull)
    return g
}

export const crossDecal = crossTexture
