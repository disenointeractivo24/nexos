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
const PX = 2400 // per metre: text stays sharp from a person's distance

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
        this.canvas = document.createElement('canvas')
        this.canvas.width = Math.round(width * PX)
        this.canvas.height = Math.round(height * PX)
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

    refresh(data) {
        const { ctx, canvas } = this
        if (this.measure) {
            const h = Math.ceil(this.measure(ctx, canvas.width, data))
            if (h !== canvas.height) {
                canvas.height = h
                this.height = h / PX
                this.texture.dispose()
                this.mesh.geometry.dispose()
                this.mesh.geometry = new THREE.PlaneGeometry(this.width, this.height)
                this.onResize?.(this.height)
            }
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        this.draw?.(ctx, canvas.width, canvas.height, data)
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

/** A button in the room; the caller wires what it does. */
export function buttonPanel(label, { width = 0.3, height = 0.08, fill = BRAND.redText, ink = '#FFFFFF' } = {}) {
    const p = new Panel(width, height, (ctx, w, h, text = label) => {
        // the lower edge gives it a little body, so it reads as something to press
        fillRR(ctx, 2, 8, w - 4, h - 10, (h - 10) / 2, 'rgba(1,30,65,0.35)')
        fillRR(ctx, 2, 2, w - 4, h - 14, (h - 14) / 2, fill)
        ctx.fillStyle = ink
        // the longest labels shrink to stay on the button
        let size = Math.round(h * 0.38)
        ctx.font = `800 ${size}px ${FONT}`
        while (ctx.measureText(text).width > w * 0.84) ctx.font = `800 ${(size -= 2)}px ${FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, w / 2, (h - 12) / 2 + 3)
        ctx.textAlign = 'start'
    })
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
        const fill = d.urgent ? BRAND.redText : BRAND.navy
        // the lower edge gives it a little body, so it reads as something to press
        fillRR(ctx, 2, 14, w - 4, h - 16, 84, 'rgba(1,30,65,0.35)')
        fillRR(ctx, 2, 2, w - 4, h - 22, 84, fill)
        const middle = (h - 20) / 2
        badge(ctx, 150, middle, 100, d.urgent ? 'warn' : 'person', '#FFFFFF', fill)
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = 'rgba(255,255,255,0.82)'
        ctx.font = `800 44px ${FONT}`
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
            const { order, available } = d
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
                const out = !done && available(id) === 0
                if (done) badge(ctx, 84, y, 30, 'check', BRAND.greenInk, '#FFFFFF')
                else {
                    ctx.beginPath()
                    ctx.arc(84, y, 28, 0, Math.PI * 2)
                    ctx.lineWidth = 6
                    ctx.strokeStyle = out ? BRAND.redText : 'rgba(1,30,65,0.28)'
                    ctx.stroke()
                }
                ctx.textBaseline = 'middle'
                ctx.fillStyle = done ? BRAND.greenInk : BRAND.navy
                ctx.font = `700 48px ${FONT}`
                ctx.fillText(SUPPLIES[id].label, 136, y + 2)
                ctx.textAlign = 'right'
                ctx.fillStyle = out ? BRAND.redText : done ? BRAND.greenInk : BRAND.muted
                ctx.font = `800 44px ${FONT}`
                ctx.fillText(out ? `${have} de ${qty} · agotado` : `${have} de ${qty}`, w - 52, y + 2)
                ctx.textAlign = 'start'
            })
            // the one thing to do about all this, and how long they can wait for it
            const y = h - FOOTER
            ctx.textBaseline = 'middle'
            ctx.fillStyle = BRAND.navy
            ctx.font = `800 42px ${FONT}`
            ctx.fillText('Pon cada insumo en la caja de abajo', 52, y + 34)
            const bar = w - 104
            fillRR(ctx, 52, y + 72, bar, 20, 10, BRAND.line)
            fillRR(ctx, 52, y + 72, Math.max(20, bar * d.left), 20, 10, d.left < 0.35 ? BRAND.redText : d.left < 0.65 ? BRAND.amber : BRAND.greenInk)
        },
        { measure: (ctx, w, d) => (d ? HEADER + 24 + Object.keys(d.order.items).length * ROW + FOOTER : 300) }
    )
}

/** Over the heads of whoever is in line: who they are and how long they can still wait. They come up by themselves. */
export function familyCard() {
    const p = new Panel(0.42, 0.17, (ctx, w, h, d) => {
        if (!d) return
        const ink = d.urgent ? '#FFFFFF' : BRAND.navy
        fillRR(ctx, 2, 2, w - 4, h - 4, 48, d.urgent ? BRAND.redText : '#FFFFFF')
        badge(ctx, 104, 118, 66, d.urgent ? 'warn' : 'person', d.urgent ? '#FFFFFF' : BRAND.navy, d.urgent ? BRAND.redText : '#FFFFFF')
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = ink
        let size = 58
        ctx.font = `800 ${size}px ${FONT}`
        while (ctx.measureText(d.family).width > w - 240) ctx.font = `800 ${(size -= 2)}px ${FONT}`
        ctx.fillText(d.family, 198, 102)
        ctx.font = `400 40px ${FONT}`
        ctx.fillText(d.urgent ? `Urgente · pasa primero` : `En la fila · ${d.people} personas`, 198, 158)
        // the time left, as a bar: its length says it, the colour only backs it up
        const x = 36
        const y = h - 76
        const bar = w - 72
        fillRR(ctx, x, y, bar, 38, 19, d.urgent ? 'rgba(255,255,255,0.3)' : BRAND.line)
        fillRR(ctx, x, y, Math.max(38, bar * d.left), 38, 19, d.urgent ? '#FFFFFF' : d.left < 0.35 ? BRAND.redText : d.left < 0.65 ? BRAND.amber : BRAND.greenInk)
    })
    return p
}

/* ---------------- the shelves ---------------- */

/**
 * On the front of a crate, in its category's colours: what is in it, and how much. What ran
 * out says so, on any shelf at a glance.
 */
export function crateLabel(title, color, tint) {
    const p = new Panel(0.48, 0.16, (ctx, w, h, rows = []) => {
        fillRR(ctx, 2, 2, w - 4, h - 4, 30, tint)
        rr(ctx, 2, 2, w - 4, 104, [30, 30, 0, 0])
        ctx.fillStyle = color
        ctx.fill()
        ctx.fillStyle = '#FFFFFF'
        ctx.font = `800 60px ${FONT}`
        ctx.textBaseline = 'middle'
        ctx.fillText(title, 40, 58)
        const cell = (w - 40) / Math.max(rows.length, 1)
        rows.forEach(({ label, count }, i) => {
            const x = 20 + i * cell
            const out = count === 0
            fillRR(ctx, x + 8, 122, cell - 16, h - 142, 20, out ? BRAND.redSoft : '#FFFFFF')
            ctx.fillStyle = out ? BRAND.redText : BRAND.navy
            ctx.textAlign = 'center'
            // a crate of a single supply already says its name above
            const single = rows.length === 1
            if (!single) {
                let size = 36
                ctx.font = `700 ${size}px ${FONT}`
                while (ctx.measureText(label).width > cell - 36) ctx.font = `700 ${(size -= 2)}px ${FONT}`
                ctx.fillText(label, x + cell / 2, 158)
            }
            const y = single ? 122 + (h - 142) / 2 + 4 : 226
            let big = out ? (single ? 76 : 50) : single ? 110 : 76
            ctx.font = `800 ${big}px ${FONT}`
            while (out && ctx.measureText('Agotado').width > cell - 36) ctx.font = `800 ${(big -= 2)}px ${FONT}`
            ctx.fillText(out ? 'Agotado' : String(count), x + cell / 2, y)
            ctx.textAlign = 'start'
        })
    })
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
