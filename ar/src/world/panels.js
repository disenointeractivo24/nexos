import * as THREE from 'three'
import { SUPPLIES } from '../../../src/data/catalog.js'

export const BRAND = {
    navy: '#011E41',
    red: '#F5333F',
    // white text only reaches WCAG AA on the pressed red, so buttons with text use it
    redText: '#D92632',
    amber: '#E39B1B',
    amberInk: '#7A4B00',
    amberSoft: '#FCEBCB',
    greenInk: '#1E5B36',
    greenSoft: '#E7F1EB',
    muted: '#5B6573',
}
export const FONT = '"Atkinson Hyperlegible Next", "Segoe UI", system-ui, sans-serif'

/** The canvases need the real typeface, or the first panels would be drawn in a fallback. */
export const fontsReady = () =>
    Promise.all([700, 800, 400].map((w) => document.fonts?.load(`${w} 40px "Atkinson Hyperlegible Next"`))).catch(() => {})

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
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

/**
 * A flat sign in the room, drawn on a canvas: one mesh per panel, redrawn only when it
 * changes. Sizes are in metres; the canvas keeps 2400 px per metre so text stays sharp.
 */
export class Panel {
    constructor(width, height, draw) {
        this.width = width
        this.height = height
        this.draw = draw
        this.canvas = document.createElement('canvas')
        this.canvas.width = Math.round(width * 2400)
        this.canvas.height = Math.round(height * 2400)
        this.ctx = this.canvas.getContext('2d')
        this.texture = new THREE.CanvasTexture(this.canvas)
        this.texture.colorSpace = THREE.SRGBColorSpace
        this.texture.anisotropy = 4
        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(width, height),
            new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
        )
        this.refresh()
    }

    refresh(data) {
        const { ctx, canvas } = this
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        this.draw?.(ctx, canvas.width, canvas.height, data)
        this.texture.needsUpdate = true
    }
}

/** A surface with the panels' soft card look. */
export function card(ctx, w, h, fill = '#FFFFFF', r = 44) {
    roundRect(ctx, 4, 4, w - 8, h - 8, r)
    ctx.fillStyle = fill
    ctx.fill()
}

/** The checklist on the workbench. */
export function taskBoard() {
    return new Panel(0.36, 0.4, (ctx, w, h, tasks = []) => {
        card(ctx, w, h)
        ctx.textBaseline = 'middle'
        ctx.fillStyle = BRAND.navy
        ctx.font = `800 62px ${FONT}`
        ctx.fillText('Tareas del turno', 44, 78)
        tasks.forEach((t, i) => {
            const y = 172 + i * 125
            ctx.beginPath()
            ctx.arc(76, y, 32, 0, Math.PI * 2)
            if (t.done) {
                ctx.fillStyle = BRAND.greenInk
                ctx.fill()
                ctx.strokeStyle = '#FFFFFF'
                ctx.lineWidth = 9
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(62, y + 1)
                ctx.lineTo(73, y + 12)
                ctx.lineTo(92, y - 12)
                ctx.stroke()
            } else {
                ctx.strokeStyle = 'rgba(1,30,65,0.3)'
                ctx.lineWidth = 6
                ctx.stroke()
            }
            ctx.fillStyle = t.done ? BRAND.muted : BRAND.navy
            ctx.font = `700 46px ${FONT}`
            ctx.fillText(t.label, 130, y - (t.progress ? 20 : 0))
            if (t.progress) {
                ctx.font = `400 38px ${FONT}`
                ctx.fillStyle = BRAND.muted
                ctx.fillText(t.progress, 130, y + 30)
            }
        })
    })
}

/** What is happening now: the radio's message, or what to do next. */
export function messageBoard() {
    return new Panel(0.52, 0.17, (ctx, w, h, m = {}) => {
        const look = {
            radio: { fill: BRAND.navy, ink: '#FFFFFF', tag: 'RADIO' },
            warn: { fill: BRAND.amberSoft, ink: BRAND.amberInk, tag: 'OJO' },
            done: { fill: BRAND.greenSoft, ink: BRAND.greenInk, tag: 'LISTO' },
            info: { fill: '#FFFFFF', ink: BRAND.navy, tag: 'AHORA' },
            alert: { fill: BRAND.redText, ink: '#FFFFFF', tag: 'URGENTE' },
        }[m.kind ?? 'info']
        card(ctx, w, h, look.fill)
        ctx.fillStyle = look.ink
        ctx.textBaseline = 'alphabetic'
        ctx.font = `800 34px ${FONT}`
        ctx.fillText(look.tag, 48, 70)
        ctx.font = `700 50px ${FONT}`
        wrap(ctx, m.text ?? '', w - 96)
            .slice(0, 4)
            .forEach((line, i) => ctx.fillText(line, 48, 138 + i * 64))
    })
}

/** A button in the room; the caller wires what it does. */
export function buttonPanel(label, { width = 0.28, height = 0.075, fill = BRAND.redText } = {}) {
    const p = new Panel(width, height, (ctx, w, h, text = label) => {
        card(ctx, w, h, fill, h / 2.6)
        ctx.fillStyle = '#FFFFFF'
        // the longest labels shrink to stay on the button
        let size = Math.round(h * 0.4)
        ctx.font = `800 ${size}px ${FONT}`
        while (ctx.measureText(text).width > w * 0.88) ctx.font = `800 ${(size -= 2)}px ${FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, w / 2, h / 2 + 2)
        ctx.textAlign = 'start'
    })
    return p
}

/** A family's order: what they need, ticking off as it goes in the kit. */
export function orderCard() {
    return new Panel(0.4, 0.26, (ctx, w, h, order) => {
        if (!order) return
        card(ctx, w, h)
        ctx.textBaseline = 'middle'
        ctx.fillStyle = BRAND.navy
        ctx.font = `800 54px ${FONT}`
        ctx.fillText(order.family, 40, 66)
        ctx.font = `400 36px ${FONT}`
        ctx.fillStyle = BRAND.muted
        ctx.fillText(`${order.people} personas${order.urgent ? ' · urgente' : ''}`, 40, 118)
        Object.entries(order.items).forEach(([id, qty], i) => {
            const y = 196 + i * 92
            const have = order.packed[id] ?? 0
            const done = have >= qty
            ctx.fillStyle = done ? BRAND.greenInk : BRAND.navy
            ctx.font = `700 46px ${FONT}`
            ctx.fillText(SUPPLIES[id].label, 40, y)
            ctx.textAlign = 'right'
            ctx.fillText(`${have} de ${qty}`, w - 40, y)
            ctx.textAlign = 'start'
        })
    })
}

/** The name on a crate, in its category's colours. */
export function crateLabel(text, color, tint) {
    return new Panel(0.2, 0.06, (ctx, w, h) => {
        card(ctx, w, h, tint, 30)
        ctx.fillStyle = color
        ctx.font = `800 58px ${FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, w / 2, h / 2 + 2)
        ctx.textAlign = 'start'
    })
}

/** Over the head of whoever is in line: who they are and how long they can still wait. Pressing it calls them. */
export function familyCard() {
    return new Panel(0.4, 0.17, (ctx, w, h, d) => {
        if (!d) return
        const ink = d.urgent ? '#FFFFFF' : BRAND.navy
        card(ctx, w, h, d.urgent ? BRAND.redText : '#FFFFFF', 40)
        ctx.textBaseline = 'middle'
        ctx.fillStyle = ink
        ctx.font = `800 58px ${FONT}`
        ctx.fillText(d.family, 36, 74)
        ctx.font = `400 40px ${FONT}`
        ctx.fillText(`${d.people} personas${d.urgent ? ' · urgente' : ''}`, 36, 142)
        // the time left, as a bar: the colour only backs up what its length already says
        const x = 36
        const y = h - 92
        const bar = w - 72
        roundRect(ctx, x, y, bar, 42, 21)
        ctx.fillStyle = d.urgent ? 'rgba(255,255,255,0.3)' : 'rgba(1,30,65,0.12)'
        ctx.fill()
        roundRect(ctx, x, y, Math.max(42, bar * d.left), 42, 21)
        ctx.fillStyle = d.urgent ? '#FFFFFF' : d.left < 0.35 ? BRAND.redText : d.left < 0.65 ? BRAND.amber : BRAND.greenInk
        ctx.fill()
    })
}

/** A large board that opens and closes the shift: a title, lines of text and a closing note. */
export function bigBoard(width = 0.86, height = 0.58) {
    return new Panel(width, height, (ctx, w, h, d) => {
        if (!d) return
        card(ctx, w, h, BRAND.navy, 60)
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = '#FFFFFF'
        ctx.font = `800 124px ${FONT}`
        ctx.fillText(d.title, 84, 170)
        let y = 296
        for (const line of d.lines ?? []) {
            ctx.fillStyle = line.color ?? 'rgba(255,255,255,0.92)'
            ctx.font = `${line.bold ? 800 : 400} 70px ${FONT}`
            for (const text of wrap(ctx, line.text, w - 168)) {
                ctx.fillText(text, 84, y)
                y += 88
            }
            y += 22
        }
    })
}
