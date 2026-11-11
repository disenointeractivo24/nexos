import * as THREE from 'three'
import { SUPPLIES } from '../../../src/data/catalog.js'

export const BRAND = {
    navy: '#011E41',
    navySoft: '#1B3556',
    red: '#F5333F',
    // white text only reaches WCAG AA on the pressed red, so buttons with text use it
    redText: '#D92632',
    redSoft: '#FDE7E8',
    amber: '#E39B1B',
    amberInk: '#7A4B00',
    amberSoft: '#FCEFD6',
    greenInk: '#1E5B36',
    greenSoft: '#E4F1E9',
    muted: '#5B6573',
    line: 'rgba(1,30,65,0.12)',
}
export const FONT = '"Atkinson Hyperlegible Next", "Segoe UI", system-ui, sans-serif'
const PX = 2400 // what the drawing code counts in, per metre
/** What a canvas really has of that: sharper than any headset shows, and far lighter to upload. */
const RES = 0.67

/** The canvases need the real typeface, or the first panels would be drawn in a fallback. */
export const fontsReady = () =>
    Promise.all([700, 800, 400].map((w) => document.fonts?.load(`${w} 40px "Atkinson Hyperlegible Next"`))).catch(() => {})

function rr(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
}

function fillRR(ctx, x, y, w, h, r, fill) {
    rr(ctx, x, y, w, h, r)
    ctx.fillStyle = fill
    ctx.fill()
}

function wrap(ctx, text, maxWidth) {
    const lines = []
    let line = ''
    for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word
        if (ctx.measureText(next).width > maxWidth && line) {
            lines.push(line)
            line = word
        } else line = next
    }
    if (line) lines.push(line)
    return lines
}

/** A round mark with a small drawing in it: what kind of thing this is, at a glance. */
function badge(ctx, x, y, r, kind, fill, ink) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = ink
    ctx.fillStyle = ink
    ctx.lineWidth = r * 0.17
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const s = r * 0.5
    ctx.beginPath()
    if (kind === 'check') {
        ctx.moveTo(x - s, y + s * 0.05)
        ctx.lineTo(x - s * 0.2, y + s * 0.75)
        ctx.lineTo(x + s, y - s * 0.65)
        ctx.stroke()
    } else if (kind === 'warn') {
        ctx.moveTo(x, y - s * 1.05)
        ctx.lineTo(x, y + s * 0.2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x, y + s * 0.85, r * 0.11, 0, Math.PI * 2)
        ctx.fill()
    } else if (kind === 'radio') {
        ctx.arc(x - s * 0.7, y + s * 0.6, r * 0.12, 0, Math.PI * 2)
        ctx.fill()
        for (const k of [0.8, 1.45]) {
            ctx.beginPath()
            ctx.arc(x - s * 0.7, y + s * 0.6, s * k, -Math.PI / 2 + 0.05, -0.05)
            ctx.stroke()
        }
    } else if (kind === 'box') {
        ctx.rect(x - s * 0.9, y - s * 0.6, s * 1.8, s * 1.4)
        ctx.moveTo(x - s * 0.9, y - s * 0.1)
        ctx.lineTo(x + s * 0.9, y - s * 0.1)
        ctx.stroke()
    } else if (kind === 'person') {
        ctx.arc(x, y - s * 0.5, s * 0.45, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(x, y + s * 0.95, s * 0.85, Math.PI, 0)
        ctx.fill()
    } else {
        ctx.moveTo(x - s * 0.8, y)
        ctx.lineTo(x + s * 0.8, y)
        ctx.moveTo(x + s * 0.2, y - s * 0.6)
        ctx.lineTo(x + s * 0.8, y)
        ctx.lineTo(x + s * 0.2, y + s * 0.6)
        ctx.stroke()
    }
}

/**
 * A flat sign in the room, drawn on a canvas: one mesh per panel, redrawn only when it
 * changes. Sizes are in metres. With `measure`, its height follows its content, so a sign
 * is never larger than what it has to say.
 */
export class Panel {
    constructor(width, height, draw, { measure = null, overlay = false } = {}) {
        this.width = width
        this.height = height
        this.draw = draw
        this.measure = measure
        this.drawWidth = Math.round(width * PX)
        this.drawHeight = Math.round(height * PX)
        this.canvas = document.createElement('canvas')
        this.canvas.width = Math.round(this.drawWidth * RES)
        this.canvas.height = Math.round(this.drawHeight * RES)
        this.ctx = this.canvas.getContext('2d')
        this.texture = new THREE.CanvasTexture(this.canvas)
        this.texture.colorSpace = THREE.SRGBColorSpace
        this.texture.anisotropy = 4
        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(width, height),
            new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthTest: !overlay, depthWrite: !overlay })
        )
        if (overlay) this.mesh.renderOrder = 999
        this.onResize = null
    }

    /** Redraws only if there is something different to say: each upload costs a headset a frame. */
    refresh(data) {
        const key = JSON.stringify(data) ?? ''
        if (key === this.shown) return
        this.shown = key
        const { ctx, canvas } = this
        ctx.setTransform(RES, 0, 0, RES, 0, 0)
        if (this.measure) {
            const h = Math.ceil(this.measure(ctx, this.drawWidth, data))
            if (h !== this.drawHeight) {
                this.drawHeight = h
                canvas.height = Math.round(h * RES)
                ctx.setTransform(RES, 0, 0, RES, 0, 0)
                this.height = h / PX
                this.texture.dispose()
                this.mesh.geometry.dispose()
                this.mesh.geometry = new THREE.PlaneGeometry(this.width, this.height)
                this.onResize?.(this.height)
            }
        }
        ctx.clearRect(0, 0, this.drawWidth, this.drawHeight)
        this.draw?.(ctx, this.drawWidth, this.drawHeight, data)
        this.texture.needsUpdate = true
    }
}

/* ---------------- what is happening now ---------------- */

const MESSAGE_LOOK = {
    radio: { fill: BRAND.navy, ink: '#FFFFFF', tag: 'Radio', mark: 'radio', tile: 'rgba(255,255,255,0.14)', tagInk: 'rgba(255,255,255,0.72)' },
    warn: { fill: BRAND.amberSoft, ink: BRAND.amberInk, tag: 'Ojo', mark: 'warn', tile: BRAND.amber, markInk: BRAND.navy, tagInk: BRAND.amberInk },
    done: { fill: BRAND.greenSoft, ink: BRAND.greenInk, tag: 'Listo', mark: 'check', tile: BRAND.greenInk, tagInk: BRAND.greenInk },
    info: { fill: '#FFFFFF', ink: BRAND.navy, tag: 'Ahora', mark: 'arrow', tile: BRAND.navy, tagInk: BRAND.muted },
    alert: { fill: BRAND.redText, ink: '#FFFFFF', tag: 'Urgente', mark: 'warn', tile: '#FFFFFF', markInk: BRAND.redText, tagInk: 'rgba(255,255,255,0.85)' },
}

export function messageBoard() {
    const textWidth = (w) => w - 280
    const lines = (ctx, w, m) => {
        ctx.font = `700 54px ${FONT}`
        return wrap(ctx, m?.text ?? '', textWidth(w)).slice(0, 4)
    }
    return new Panel(
        0.56,
        0.16,
        (ctx, w, h, m = {}) => {
            const look = MESSAGE_LOOK[m.kind ?? 'info']
            fillRR(ctx, 2, 2, w - 4, h - 4, 44, look.fill)
            badge(ctx, 124, h / 2, 74, look.mark, look.tile, look.markInk ?? '#FFFFFF')
            ctx.textBaseline = 'alphabetic'
            ctx.fillStyle = look.tagInk
            ctx.font = `800 34px ${FONT}`
            ctx.fillText(look.tag.toUpperCase(), 232, 76)
            ctx.fillStyle = look.ink
            const text = lines(ctx, w, m)
            text.forEach((line, i) => ctx.fillText(line, 232, 142 + i * 68))
        },
        { measure: (ctx, w, m) => Math.max(230, 110 + lines(ctx, w, m).length * 68 + 26) }
    )
}

/* ---------------- what there is to do ---------------- */

const TODO_LOOK = {
    alert: { fill: BRAND.redText, ink: '#FFFFFF', mark: 'warn', row: BRAND.redSoft },
    work: { fill: BRAND.navy, ink: '#FFFFFF', mark: 'arrow', row: null },
    warn: { fill: BRAND.amber, ink: BRAND.navy, mark: 'box', row: BRAND.amberSoft },
}

/** Called up with a button of the controls: the to-do list, in front of the person. */
export function taskList() {
    const rowHeight = (ctx, w, row) => {
        ctx.font = `400 38px ${FONT}`
        return 118 + (wrap(ctx, row.detail, w - 210).length - 1) * 46
    }
    const HEADER = 150
    return new Panel(
        0.46,
        0.3,
        (ctx, w, h, d) => {
            if (!d) return
            fillRR(ctx, 2, 2, w - 4, h - 4, 48, '#FFFFFF')
            ctx.save()
            rr(ctx, 2, 2, w - 4, HEADER, [48, 48, 0, 0])
            ctx.fillStyle = BRAND.navy
            ctx.fill()
            ctx.restore()
            ctx.textBaseline = 'middle'
            ctx.fillStyle = '#FFFFFF'
            ctx.font = `800 62px ${FONT}`
            ctx.fillText('Por hacer', 56, 80)
            ctx.textAlign = 'right'
            ctx.font = `700 38px ${FONT}`
            ctx.fillStyle = 'rgba(255,255,255,0.78)'
            ctx.fillText(`${d.progress.done} de ${d.progress.total} atendidos`, w - 56, 80)
            ctx.textAlign = 'start'
            let y = HEADER + 16
            for (const row of d.rows) {
                const rh = rowHeight(ctx, w, row)
                const look = TODO_LOOK[row.tone] ?? TODO_LOOK.work
                if (look.row) fillRR(ctx, 20, y + 4, w - 40, rh - 8, 26, look.row)
                badge(ctx, 92, y + 54, 34, look.mark, look.fill, look.ink)
                ctx.textBaseline = 'alphabetic'
                ctx.fillStyle = BRAND.navy
                ctx.font = `800 44px ${FONT}`
                ctx.fillText(row.label, 150, y + 52)
                ctx.font = `400 38px ${FONT}`
                ctx.fillStyle = BRAND.muted
                wrap(ctx, row.detail, w - 210).forEach((line, i) => ctx.fillText(line, 150, y + 98 + i * 46))
                y += rh
            }
            ctx.textAlign = 'center'
            ctx.font = `400 34px ${FONT}`
            ctx.fillStyle = BRAND.muted
            ctx.fillText(d.hint, w / 2, h - 34)
            ctx.textAlign = 'start'
        },
        {
            overlay: true,
            measure: (ctx, w, d) => (d ? d.rows.reduce((n, r) => n + rowHeight(ctx, w, r), HEADER + 16) + 84 : 300),
        }
    )
}

/* ---------------- buttons and marks ---------------- */

/** A soft ring of light around a button, behind it. One drawing, its strength changed from outside. */
function buttonHalo(width, height, color) {
    const reach = 0.035 // metres it extends past the button, on every side
    const scale = 900 // pixels per metre: it is all blur, it needs no detail
    const canvas = document.createElement('canvas')
    canvas.width = Math.round((width + reach * 2) * scale)
    canvas.height = Math.round((height + reach * 2) * scale)
    const ctx = canvas.getContext('2d')
    const inset = reach * scale * 0.72
    ctx.shadowColor = color
    ctx.shadowBlur = reach * scale * 0.7
    ctx.fillStyle = color
    for (let i = 0; i < 3; i++) fillRR(ctx, inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, (canvas.height - inset * 2) / 2, color)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(width + reach * 2, height + reach * 2),
        new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false })
    )
    halo.position.z = -0.002
    return halo
}

/**
 * A button in the room; the caller wires what it does. A white edge and a thick lower lip make
 * it stand off whatever it lies on. With `halo`, it also has a ring of light, for the one
 * thing the person is expected to press next.
 */
export function buttonPanel(label, { width = 0.3, height = 0.08, fill = BRAND.redText, ink = '#FFFFFF', halo = null } = {}) {
    const p = new Panel(width, height, (ctx, w, h, text = label) => {
        const edge = 12
        const lip = 22
        const bodyH = h - lip - edge
        fillRR(ctx, edge / 2, edge / 2 + lip, w - edge, bodyH, bodyH / 2, BRAND.navy)
        fillRR(ctx, edge / 2, edge / 2, w - edge, bodyH, bodyH / 2, fill)
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = edge
        rr(ctx, edge / 2, edge / 2, w - edge, bodyH, bodyH / 2)
        ctx.stroke()
        ctx.fillStyle = ink
        // the longest labels shrink to stay on the button
        let size = Math.round(h * 0.36)
        ctx.font = `800 ${size}px ${FONT}`
        while (ctx.measureText(text).width > w * 0.82) ctx.font = `800 ${(size -= 2)}px ${FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, w / 2, edge / 2 + bodyH / 2 + 3)
        ctx.textAlign = 'start'
    })
    if (halo) {
        p.halo = buttonHalo(width, height, halo)
        p.mesh.add(p.halo)
        // the sign in front of its own light, whichever is nearer by a hair
        p.mesh.renderOrder = 1
    }
    p.refresh(label)
    return p
}

/** A mat printed on the counter: a dashed place to set something down, and what it is for. */
export function matPanel(label, color) {
    const p = new Panel(0.52, 0.5, (ctx, w, h) => {
        fillRR(ctx, 0, 0, w, h, 40, color)
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'
        ctx.lineWidth = 8
        ctx.setLineDash([34, 26])
        rr(ctx, 34, 34, w - 68, h - 68, 26)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.font = `800 62px ${FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, w / 2, h - 96)
        ctx.textAlign = 'start'
    })
    p.refresh()
    return p
}

/** The panel at the person's left while no truck is there: how long until the next one. */
function drawNextTruck(ctx, w, cx, cy, radius, { seconds, gap }) {
    ctx.lineCap = 'round'
    ctx.lineWidth = 46
    ctx.strokeStyle = BRAND.line
    ctx.beginPath()
    ctx.arc(cx, cy, radius - 23, 0, Math.PI * 2)
    ctx.stroke()
    // what is left of the wait: it shrinks towards the top as the truck gets closer
    ctx.strokeStyle = BRAND.navy
    ctx.beginPath()
    ctx.arc(cx, cy, radius - 23, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, seconds / gap))
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = BRAND.navy
    ctx.font = `800 170px ${FONT}`
    ctx.fillText(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, cx, cy + 8)
    ctx.textBaseline = 'alphabetic'
    ctx.font = `800 92px ${FONT}`
    ctx.fillText('Próximo camión', cx, 742)
    ctx.font = `700 64px ${FONT}`
    ctx.fillStyle = BRAND.muted
    ctx.fillText('Mientras, sigue trabajando', cx, 880)
    ctx.textAlign = 'start'
}

/** A truck on its way in: nothing to press yet. */
function drawTruckComing(ctx, cx, cy, radius, count) {
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fillStyle = BRAND.navy
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    fillRR(ctx, cx - 160, cy - 86, 200, 140, 12, '#FFFFFF')
    fillRR(ctx, cx + 52, cy - 36, 108, 90, 18, '#FFFFFF')
    for (const x of [cx - 96, cx + 96]) {
        ctx.beginPath()
        ctx.arc(x, cy + 62, 38, 0, Math.PI * 2)
        ctx.fillStyle = '#FFFFFF'
        ctx.fill()
        ctx.lineWidth = 16
        ctx.strokeStyle = BRAND.navy
        ctx.stroke()
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = BRAND.navy
    ctx.font = `800 92px ${FONT}`
    ctx.fillText('Camión llegando', cx, 742)
    ctx.font = `700 64px ${FONT}`
    ctx.fillStyle = BRAND.muted
    ctx.fillText(`Trae ${count} ${count === 1 ? 'caja' : 'cajas'}`, cx, 880)
    ctx.textAlign = 'start'
}

/**
 * At the person's left, by where the truck stops: the big green mark that lets in what it
 * brought, and how much it is. With no truck there, how long until the next one.
 */
export function receivePanel() {
    return new Panel(0.46, 0.44, (ctx, w, h, d) => {
        if (!d) return
        fillRR(ctx, 2, 2, w - 4, h - 4, 64, '#FFFFFF')
        if (d.mode === 'waiting') return drawNextTruck(ctx, w, w / 2, 356, 262, d)
        if (d.mode === 'coming') return drawTruckComing(ctx, w / 2, 356, 262, d.count)
        const full = d.room === 0
        const green = full ? '#9AA3AE' : '#1F8A4C'
        const cx = w / 2
        const cy = 356
        const radius = 262
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fillStyle = green
        ctx.fill()
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 58
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(cx - 126, cy + 8)
        ctx.lineTo(cx - 32, cy + 104)
        ctx.lineTo(cx + 140, cy - 96)
        ctx.stroke()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = BRAND.navy
        ctx.font = `800 92px ${FONT}`
        ctx.fillText('Recibir donaciones', cx, 742)
        const n = d.count
        // the number first, large: that is what the person comes here to read
        ctx.font = `800 150px ${FONT}`
        const number = String(n)
        const tail = full ? 'sin espacio: abre una caja' : n === 1 ? 'caja por entrar' : 'cajas por entrar'
        const numberWidth = ctx.measureText(number).width
        ctx.font = `700 64px ${FONT}`
        const tailWidth = ctx.measureText(tail).width
        const start = cx - (numberWidth + 28 + tailWidth) / 2
        ctx.textAlign = 'left'
        ctx.font = `800 150px ${FONT}`
        ctx.fillStyle = full ? BRAND.muted : '#1F8A4C'
        ctx.fillText(number, start, 930)
        ctx.font = `700 64px ${FONT}`
        ctx.fillStyle = full ? BRAND.muted : BRAND.navy
        ctx.fillText(tail, start + numberWidth + 28, 930)
        ctx.textAlign = 'start'
    })
}

/* ---------------- people ---------------- */

/** Up over the counter, to read from anywhere: who is next, and the press that brings them forward. */
export function nextPanel() {
    return new Panel(0.5, 0.14, (ctx, w, h, d) => {
        if (!d) return
        const fill = '#1F8A4C' // the same green as the mark that receives the truck
        // the lower edge gives it a little body, so it reads as something to press
        fillRR(ctx, 2, 14, w - 4, h - 16, 84, '#14603A')
        fillRR(ctx, 2, 2, w - 4, h - 22, 84, fill)
        const middle = (h - 20) / 2
        badge(ctx, 150, middle, 100, d.urgent ? 'warn' : 'person', '#FFFFFF', fill)
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = '#FFFFFF'
        ctx.font = `800 50px ${FONT}`
        ctx.fillText(d.urgent ? 'QUE PASE LA URGENCIA' : 'QUE PASE EL SIGUIENTE', 290, middle - 38)
        ctx.fillStyle = '#FFFFFF'
        let size = 92
        ctx.font = `800 ${size}px ${FONT}`
        while (ctx.measureText(d.family).width > w - 350) ctx.font = `800 ${(size -= 2)}px ${FONT}`
        ctx.fillText(d.family, 290, middle + 62)
    })
}

/** A person's order at the counter: what they asked for, what is in the kit, what is left to take. */
export function orderCard() {
    const HEADER = 170
    const ROW = 104
    const FOOTER = 124
    return new Panel(
        0.44,
        0.3,
        (ctx, w, h, d) => {
            if (!d) return
            const { order, status } = d
            fillRR(ctx, 2, 2, w - 4, h - 4, 48, '#FFFFFF')
            rr(ctx, 2, 2, w - 4, HEADER, [48, 48, 0, 0])
            ctx.fillStyle = order.urgent ? BRAND.redText : BRAND.navy
            ctx.fill()
            ctx.textBaseline = 'alphabetic'
            ctx.fillStyle = 'rgba(255,255,255,0.78)'
            ctx.font = `800 32px ${FONT}`
            ctx.fillText(order.urgent ? 'PEDIDO URGENTE' : 'PEDIDO', 52, 62)
            ctx.fillStyle = '#FFFFFF'
            ctx.font = `800 58px ${FONT}`
            ctx.fillText(order.family, 52, 128)
            ctx.textAlign = 'right'
            ctx.font = `700 38px ${FONT}`
            ctx.fillStyle = 'rgba(255,255,255,0.85)'
            ctx.fillText(`${order.people} personas`, w - 52, 128)
            ctx.textAlign = 'start'
            Object.entries(order.items).forEach(([id, qty], i) => {
                const y = HEADER + 62 + i * ROW
                const have = order.packed[id] ?? 0
                const done = have >= qty
                const out = !done && status[id] === 'out'
                const inBox = !done && status[id] === 'box'
                if (done) badge(ctx, 84, y, 30, 'check', BRAND.greenInk, '#FFFFFF')
                else {
                    ctx.beginPath()
                    ctx.arc(84, y, 28, 0, Math.PI * 2)
                    ctx.lineWidth = 6
                    ctx.strokeStyle = out ? BRAND.redText : inBox ? BRAND.amber : 'rgba(1,30,65,0.28)'
                    ctx.stroke()
                }
                ctx.textBaseline = 'middle'
                ctx.fillStyle = done ? BRAND.greenInk : BRAND.navy
                ctx.font = `700 48px ${FONT}`
                ctx.fillText(SUPPLIES[id].label, 136, y + 2)
                ctx.textAlign = 'right'
                ctx.fillStyle = out ? BRAND.redText : inBox ? BRAND.amberInk : done ? BRAND.greenInk : BRAND.muted
                ctx.font = `800 44px ${FONT}`
                ctx.fillText(`${have} de ${qty}${out ? ' · agotado' : inBox ? ' · en la caja' : ''}`, w - 52, y + 2)
                ctx.textAlign = 'start'
            })
            // the one thing to do about all this, and how long they can wait for it
            const y = h - FOOTER
            ctx.textBaseline = 'middle'
            ctx.fillStyle = BRAND.navy
            ctx.font = `800 46px ${FONT}`
            ctx.fillText('Pon cada insumo en la caja de abajo', 52, y + 34)
            const bar = w - 104
            fillRR(ctx, 52, y + 72, bar, 20, 10, BRAND.line)
            fillRR(ctx, 52, y + 72, Math.max(20, bar * d.left), 20, 10, d.left < 0.35 ? BRAND.redText : d.left < 0.65 ? BRAND.amber : BRAND.greenInk)
        },
        { measure: (ctx, w, d) => (d ? HEADER + 24 + Object.keys(d.order.items).length * ROW + FOOTER : 300) }
    )
}

/** Over the heads of whoever is in line: who they are and how long they can still wait, nothing more. */
export function familyCard() {
    return new Panel(0.34, 0.1, (ctx, w, h, d) => {
        if (!d) return
        const ink = d.urgent ? '#FFFFFF' : BRAND.navy
        fillRR(ctx, 2, 2, w - 4, h - 4, 40, d.urgent ? BRAND.redText : '#FFFFFF')
        ctx.textBaseline = 'alphabetic'
        ctx.textAlign = 'center'
        ctx.fillStyle = ink
        let size = 66
        ctx.font = `800 ${size}px ${FONT}`
        while (ctx.measureText(d.family).width > w - 60) ctx.font = `800 ${(size -= 2)}px ${FONT}`
        ctx.fillText(d.family, w / 2, 100)
        ctx.textAlign = 'start'
        // the time left, as a bar: its length says it, the colour only backs it up
        const x = 36
        const y = h - 66
        const bar = w - 72
        fillRR(ctx, x, y, bar, 34, 17, d.urgent ? 'rgba(255,255,255,0.3)' : BRAND.line)
        fillRR(ctx, x, y, Math.max(34, bar * d.left), 34, 17, d.urgent ? '#FFFFFF' : d.left < 0.35 ? BRAND.redText : d.left < 0.65 ? BRAND.amber : BRAND.greenInk)
    })
}

/** Over the order's carton: whose it is, small. What it needs is shown by the supplies themselves. */
export function orderTag() {
    return new Panel(0.3, 0.06, (ctx, w, h, d) => {
        if (!d) return
        fillRR(ctx, 2, 2, w - 4, h - 4, h / 2, d.urgent ? BRAND.redText : BRAND.navy)
        ctx.fillStyle = '#FFFFFF'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        let size = 58
        ctx.font = `800 ${size}px ${FONT}`
        while (ctx.measureText(d.family).width > w - 50) ctx.font = `800 ${(size -= 2)}px ${FONT}`
        ctx.fillText(d.family, w / 2, h / 2 + 3)
        ctx.textAlign = 'start'
    })
}
/** What someone is complaining about, beside their head: its tail points at them. */
export function speechBubble() {
    return new Panel(0.62, 0.22, (ctx, w, h, d) => {
        if (!d) return
        ctx.clearRect(0, 0, w, h)
        const tail = 92
        const body = h - tail
        const x = d.side > 0 ? w * 0.2 : w * 0.8
        ctx.beginPath()
        ctx.moveTo(x - 60, body - 10)
        ctx.lineTo(x + d.side * -70, h - 6)
        ctx.lineTo(x + 60, body - 10)
        ctx.closePath()
        ctx.fillStyle = BRAND.redText
        ctx.fill()
        fillRR(ctx, 4, 4, w - 8, body - 8, 70, BRAND.redText)
        ctx.fillStyle = '#FFFFFF'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        let size = 118
        let lines
        do {
            ctx.font = `800 ${(size -= 4)}px ${FONT}`
            lines = wrap(ctx, d.text, w - 150)
        } while (lines.length > 2 && size > 70)
        const lineHeight = size * 1.12
        lines.forEach((line, i) => ctx.fillText(line, w / 2, body / 2 + (i - (lines.length - 1) / 2) * lineHeight))
        ctx.textAlign = 'left'
        // whoever complains may be standing behind someone: what they say still has to be read
    }, { overlay: true })
}

/* ---------------- the shelves ---------------- */

/** What each category is at a glance, drawn white on its colour. */
function categoryIcon(ctx, x, y, r, categoryId) {
    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = '#FFFFFF'
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = r * 0.16
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const s = r
    ctx.beginPath()
    if (categoryId === 'agua') {
        // a drop
        ctx.moveTo(0, -s * 0.8)
        ctx.bezierCurveTo(s * 0.55, -s * 0.15, s * 0.62, s * 0.2, s * 0.6, s * 0.3)
        ctx.arc(0, s * 0.3, s * 0.6, 0, Math.PI)
        ctx.bezierCurveTo(-s * 0.62, s * 0.2, -s * 0.55, -s * 0.15, 0, -s * 0.8)
        ctx.fill()
    } else if (categoryId === 'medicinas') {
        // a cross
        ctx.fillRect(-s * 0.2, -s * 0.7, s * 0.4, s * 1.4)
        ctx.fillRect(-s * 0.7, -s * 0.2, s * 1.4, s * 0.4)
    } else if (categoryId === 'higiene') {
        // soap and bubbles
        ctx.roundRect(-s * 0.7, -s * 0.05, s * 1.1, s * 0.65, s * 0.18)
        ctx.fill()
        for (const [bx, by, br] of [[s * 0.45, -s * 0.45, 0.22], [s * 0.05, -s * 0.55, 0.15], [s * 0.62, -s * 0.05, 0.12]]) {
            ctx.beginPath()
            ctx.arc(bx, by, s * br, 0, Math.PI * 2)
            ctx.stroke()
        }
    } else if (categoryId === 'refugio') {
        // a house
        ctx.moveTo(-s * 0.75, -s * 0.05)
        ctx.lineTo(0, -s * 0.72)
        ctx.lineTo(s * 0.75, -s * 0.05)
        ctx.lineTo(s * 0.55, -s * 0.05)
        ctx.lineTo(s * 0.55, s * 0.68)
        ctx.lineTo(-s * 0.55, s * 0.68)
        ctx.lineTo(-s * 0.55, -s * 0.05)
        ctx.closePath()
        ctx.fill()
    } else {
        // a bowl of grain
        ctx.arc(0, -s * 0.05, s * 0.72, 0, Math.PI)
        ctx.closePath()
        ctx.fill()
        for (const gx of [-0.35, 0, 0.35]) {
            ctx.beginPath()
            ctx.ellipse(gx * s, -s * 0.28, s * 0.13, s * 0.2, 0, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    ctx.restore()
}

/**
 * On the front of a crate, in its category's colour: its icon, and how many there are of each
 * supply in it, to keep count. What ran out shows as a red zero.
 */
export function crateLabel(title, color, tint, categoryId) {
    const p = new Panel(0.34, 0.12, (ctx, w, h, rows = []) => {
        fillRR(ctx, 2, 2, w - 4, h - 4, 30, color)
        const iconW = h * 0.92
        categoryIcon(ctx, iconW / 2 + 6, h / 2, h * 0.3, categoryId)
        const x0 = iconW + 10
        const cell = (w - x0 - 16) / Math.max(rows.length, 1)
        rows.forEach(({ label, count }, i) => {
            const x = x0 + i * cell
            const out = count === 0
            fillRR(ctx, x + 6, 22, cell - 12, h - 44, 22, out ? BRAND.redSoft : '#FFFFFF')
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = out ? BRAND.redText : BRAND.navy
            ctx.font = `800 ${Math.round(h * 0.36)}px ${FONT}`
            ctx.fillText(String(count), x + cell / 2, h * 0.43)
            let size = Math.round(h * 0.15)
            ctx.font = `700 ${size}px ${FONT}`
            while (ctx.measureText(label).width > cell - 28 && size > 18) ctx.font = `700 ${(size -= 2)}px ${FONT}`
            ctx.fillStyle = out ? BRAND.redText : BRAND.muted
            ctx.fillText(label, x + cell / 2, h * 0.73)
            ctx.textAlign = 'start'
        })
    })
    p.title = title
    return p
}
/* ---------------- opening and closing ---------------- */

/**
 * The large board that opens and closes the shift, as tall as what it says.
 * @param {{ kicker: string, title: string, stats?: {value: string, label: string, tone?: string}[],
 *           lines?: {text: string, mark?: string, tone?: string}[], note?: string }} d
 */
export function bigBoard() {
    const LEFT = 84
    const tones = {
        good: { value: '#8FE0B0' },
        warn: { value: '#F7C25C' },
        bad: { value: '#FF9AA0' },
    }
    const layout = (ctx, w, d, paint) => {
        const inner = w - LEFT * 2
        let y = 92
        if (paint) {
            ctx.textBaseline = 'alphabetic'
            ctx.font = `800 44px ${FONT}`
            ctx.fillStyle = '#FFFFFF'
            ctx.fillText('NE', LEFT, y)
            const ne = ctx.measureText('NE').width
            ctx.fillStyle = BRAND.red
            ctx.fillText('X', LEFT + ne, y)
            const x = ctx.measureText('X').width
            ctx.fillStyle = '#FFFFFF'
            ctx.fillText('OS', LEFT + ne + x, y)
            ctx.textAlign = 'right'
            ctx.font = `700 36px ${FONT}`
            ctx.fillStyle = 'rgba(255,255,255,0.65)'
            ctx.fillText(d.kicker, w - LEFT, y)
            ctx.textAlign = 'start'
        }
        y += 118
        ctx.font = `800 112px ${FONT}`
        if (paint) {
            ctx.fillStyle = '#FFFFFF'
            ctx.fillText(d.title, LEFT, y)
        }
        y += 56
        if (d.stats?.length) {
            const gap = 24
            const tile = (inner - gap * (d.stats.length - 1)) / d.stats.length
            d.stats.forEach((s, i) => {
                if (!paint) return
                const x = LEFT + i * (tile + gap)
                fillRR(ctx, x, y, tile, 216, 30, 'rgba(255,255,255,0.09)')
                ctx.fillStyle = tones[s.tone]?.value ?? '#FFFFFF'
                ctx.font = `800 96px ${FONT}`
                ctx.fillText(s.value, x + 34, y + 112)
                ctx.fillStyle = 'rgba(255,255,255,0.8)'
                ctx.font = `400 38px ${FONT}`
                ctx.fillText(s.label, x + 34, y + 176)
            })
            y += 216 + 44
        }
        ctx.font = `400 60px ${FONT}`
        for (const line of d.lines ?? []) {
            const indent = line.mark ? 84 : 0
            const lines = wrap(ctx, line.text, inner - indent)
            if (paint) {
                if (line.mark) badge(ctx, LEFT + 30, y + 26, 30, line.mark, tones[line.tone]?.value ?? 'rgba(255,255,255,0.25)', BRAND.navy)
                ctx.fillStyle = 'rgba(255,255,255,0.94)'
                ctx.textBaseline = 'alphabetic'
                ctx.font = `400 60px ${FONT}`
                lines.forEach((t, i) => ctx.fillText(t, LEFT + indent, y + 46 + i * 76))
            }
            y += lines.length * 76 + 18
        }
        if (d.note) {
            y += 14
            ctx.font = `800 60px ${FONT}`
            const lines = wrap(ctx, d.note, inner)
            if (paint) {
                ctx.fillStyle = '#F7C25C'
                lines.forEach((t, i) => ctx.fillText(t, LEFT, y + 46 + i * 76))
            }
            y += lines.length * 76
        }
        return y + 62
    }
    return new Panel(
        0.92,
        0.5,
        (ctx, w, h, d) => {
            if (!d) return
            fillRR(ctx, 2, 2, w - 4, h - 4, 60, BRAND.navy)
            layout(ctx, w, d, true)
        },
        { measure: (ctx, w, d) => (d ? layout(ctx, w, d, false) : 400) }
    )
}
