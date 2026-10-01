import * as THREE from 'three'

/** Small helpers to paint textures on a canvas (labels, decals, soft sprites). */

export function canvasTexture(width, height, draw, { srgb = true, repeat = false } = {}) {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    const ctx = c.getContext('2d')
    draw(ctx, width, height)
    const tex = new THREE.CanvasTexture(c)
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 4
    return tex
}

const FONT = '"Atkinson Hyperlegible Next", "Segoe UI", system-ui, sans-serif'

/** Wrap-around product label: background, optional stripes, centred word. */
export function labelTexture({ bg = '#FFFFFF', text = '', fg = '#011E41', stripes = [], size = 0.34, weight = 800, w = 512, h = 256, extra } = {}) {
    return canvasTexture(w, h, (ctx) => {
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        for (const s of stripes) {
            ctx.fillStyle = s.color
            ctx.fillRect(0, s.y * h, w, s.h * h)
        }
        extra?.(ctx, w, h)
        if (text) {
            ctx.fillStyle = fg
            ctx.font = `${weight} ${Math.round(h * size)}px ${FONT}`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(text, w / 2, h / 2)
        }
    })
}

/** Red cross on a square tile (used on boxes, helmet and backpack). */
export function crossTexture({ bg = '#FFFFFF', color = '#F5333F', scale = 0.62, w = 256 } = {}) {
    return canvasTexture(w, w, (ctx) => {
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, w)
        drawCross(ctx, w / 2, w / 2, w * scale, color)
    })
}

export function drawCross(ctx, cx, cy, size, color) {
    const t = size / 3
    ctx.fillStyle = color
    ctx.fillRect(cx - t / 2, cy - size / 2, t, size)
    ctx.fillRect(cx - size / 2, cy - t / 2, size, t)
}

/** Soft radial blob — shadows, halos, glow. */
export function radialTexture({ inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)', w = 128, stop = 0 } = {}) {
    return canvasTexture(w, w, (ctx) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.5 * stop, w / 2, w / 2, w / 2)
        g.addColorStop(0, inner)
        g.addColorStop(1, outer)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, w)
    })
}

/** Soft ring (destination cue on the ground). */
export function ringTexture({ color = '255,255,255', w = 256, width = 0.12, alpha = 1 } = {}) {
    return canvasTexture(w, w, (ctx) => {
        const r = w / 2
        const g = ctx.createRadialGradient(r, r, r * (0.78 - width), r, r, r * 0.98)
        g.addColorStop(0, `rgba(${color},0)`)
        g.addColorStop(0.45, `rgba(${color},${alpha})`)
        g.addColorStop(0.6, `rgba(${color},${alpha})`)
        g.addColorStop(1, `rgba(${color},0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, w)
        const fill = ctx.createRadialGradient(r, r, 0, r, r, r * 0.8)
        fill.addColorStop(0, `rgba(${color},${alpha * 0.22})`)
        fill.addColorStop(1, `rgba(${color},0)`)
        ctx.fillStyle = fill
        ctx.fillRect(0, 0, w, w)
    })
}

/** Cloud puff made of overlapping soft circles. */
export function cloudTexture(seed = 1) {
    let s = seed * 9301 + 49297
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    return canvasTexture(256, 256, (ctx, w, h) => {
        for (let i = 0; i < 16; i++) {
            const x = w * (0.22 + rnd() * 0.56)
            const y = h * (0.4 + rnd() * 0.22)
            const r = w * (0.12 + rnd() * 0.16)
            const g = ctx.createRadialGradient(x, y, 0, x, y, r)
            const shade = 250 - Math.round(rnd() * 8)
            g.addColorStop(0, `rgba(${shade},${shade + 2 > 255 ? 255 : shade + 2},255,0.55)`)
            g.addColorStop(0.55, `rgba(${shade},${shade},${shade + 3 > 255 ? 255 : shade + 3},0.32)`)
            g.addColorStop(1, 'rgba(255,255,255,0)')
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.fill()
        }
    })
}
