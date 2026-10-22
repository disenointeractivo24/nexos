// The opening act, frame by frame: run in the dev page (see fuentes_3d/LEEME.md, "Apertura").
// It poses the guide with the app's own character code (its face, its gestures), films it
// with its own camera, and sends every frame to tools/apertura/recibir.mjs. Two clips:
//   intro (6.2 s): a close-up of the face, a glance turning to camera, the camera pulling out
//     on an arc, a wave, a nod, and the guide settles;
//   loop (4 s): the settled guide breathing, for as long as loading takes; it starts exactly
//     where the intro ends and ends where it starts.
;(async () => {
    const n = window.nexos
    const SERVER = 'http://127.0.0.1:5199'
    const W = 1600, H = 900, FPS = 60
    const INTRO = 6.2, LOOP = 4

    /* ---------------- curves ---------------- */
    const clamp01 = (x) => Math.min(1, Math.max(0, x))
    const seg = (T, a, b) => clamp01((T - a) / (b - a))
    const lerp = (a, b, u) => a + (b - a) * u
    const sm = (u) => u * u * (3 - 2 * u)
    const inOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
    const outCubic = (u) => 1 - Math.pow(1 - u, 3)
    const outBack = (u, s = 1.4) => (u >= 1 ? 1 : 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2))
    const bump = (T, a, b) => (T <= a || T >= b ? 0 : Math.sin(((T - a) / (b - a)) * Math.PI))
    /** CSS-style cubic-bezier easing. */
    const bezier = (x1, y1, x2, y2) => {
        const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
        const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
        const X = (s) => ((ax * s + bx) * s + cx) * s
        const dX = (s) => (3 * ax * s + 2 * bx) * s + cx
        return (x) => {
            if (x <= 0 || x >= 1) return clamp01(x)
            let s = x
            for (let i = 0; i < 8; i++) s -= (X(s) - x) / (dX(s) || 1e-6)
            return ((ay * s + by) * s + cy) * s
        }
    }
    // the crane: a quick start, then a long soft landing
    const crane = bezier(0.5, 0, 0.1, 1)

    /* ---------------- the camera ---------------- */
    // around the guide: azimuth (0 = straight in front), elevation, distance, the point it looks at
    const CLOSE = 2.3, WIDE = 5.8
    function shot(T) {
        const push = outCubic(seg(T, 0, 1.7))
        const u = crane(seg(T, 1.5, 5.8))
        const lead = crane(seg(T, 1.4, 5.5))
        const dist = lerp(2.6, CLOSE, push) * Math.pow(WIDE / CLOSE, u)
        const az = lerp(lerp(0.22, 0.16, push), -0.18, u)
        // an arc: rising while it pulls out, settling a little lower at the end
        const el = lerp(0.04, 0.08, u) + 0.07 * Math.sin(Math.PI * u)
        const ty = lerp(1.12, 0.86, lead)
        return {
            pos: [Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist],
            target: [0, ty, 0],
        }
    }

    /* ---------------- the guide ---------------- */
    // breathing, weight shift and the wandering look, all on the loop's 4 s, so the loop is seamless
    const ambient = (T) => {
        const p = ((T - INTRO) / LOOP) * Math.PI * 2
        return { breath: Math.sin(p * 2), shift: Math.sin(p), drift: 0.05 * Math.sin(p + 1.2) }
    }
    function introPose(T) {
        // the glance: eyes first, then the head turns to camera on a dipping arc (with a touch of
        // overshoot), and the body follows last
        const turn = outBack(seg(T, 0.72, 1.38), 1.5)
        const eyes = inOutCubic(seg(T, 0.6, 0.9))
        const bodyFollow = inOutCubic(seg(T, 0.85, 1.6))
        // the wave: a lift that overshoots, the hand waving, the arm coming down softly
        const lift = outBack(seg(T, 3.0, 3.45), 1.3) * (1 - inOutCubic(seg(T, 4.45, 5.0)))
        const env = sm(seg(T, 3.3, 3.5)) * (1 - sm(seg(T, 4.25, 4.5)))
        const tilt = 0.04 * sm(seg(T, 0.9, 1.5))
        const o = {
            ...ambient(T),
            headY: lerp(-0.5, 0, turn) + 0.15 * lift,
            headX: 0.07 * bump(T, 0.72, 1.38) + 0.12 * bump(T, 5.0, 5.5),
            headZ: lerp(-0.07, 0, sm(seg(T, 0.72, 1.4))) + tilt * (1 - lift) + 0.12 * lift,
            bodyY: lerp(-0.12, 0, bodyFollow),
            bodyZ: -0.05 * lift,
            eyeX: lerp(-0.9, 0, eyes),
            eyeY: 0,
            armRUp: 1.55 * lift,
            armRWave: 0.28 * Math.sin(Math.PI * 2 * 2 * (T - 3.3)) * env,
            // a little dip before the wave (anticipation), then a hop into it
            hop: -0.02 * bump(T, 2.7, 3.02) + 0.05 * bump(T, 3.0, 3.38),
            mood: T < 1.15 ? 'calm' : T > 3.25 && T < 4.4 ? 'joy' : 'happy',
        }
        return o
    }
    function loopPose(T) {
        return { ...ambient(T), headZ: 0.04, eyeX: 0, eyeY: 0, mood: 'happy' }
    }
    // blinks: once while still looking away, once as the camera settles, once in the loop
    const BLINKS = { intro: [0.5, 2.4, 5.3], loop: [1.9] }

    /* ---------------- filming ---------------- */
    const it = n.items
    const V = n.stage.camera.position.constructor
    const tpl = await n.loader.load('guide')
    const g = new n.guide.constructor(n.loader.instanceSync(tpl), tpl.animations, { face: true, lively: true })
    g.place(new V(0, 0, 0), 0)
    g.root.visible = true
    it.scene.add(g.root)

    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const r = new n.stage.renderer.constructor({ canvas, antialias: true, preserveDrawingBuffer: true })
    r.setPixelRatio(1)
    r.setSize(W, H, false)
    r.outputColorSpace = it.renderer.outputColorSpace
    r.toneMapping = it.renderer.toneMapping
    r.toneMappingExposure = it.renderer.toneMappingExposure
    r.setClearColor(0xffffff, 1)
    const cam = new n.stage.camera.constructor(24, W / H, 0.1, 100)

    const frame = (T, pose, blinkAt) => {
        const o = pose(T)
        g.face.nextBlink = 99
        o.blink = blinkAt.some((b) => Math.abs(T - b) < 0.5 / FPS)
        g.script = o
        g.update(1 / FPS, T)
        const s = shot(T)
        cam.position.set(...s.pos)
        cam.lookAt(...s.target)
        cam.updateMatrixWorld()
        r.render(it.scene, cam)
    }
    const send = async (name) => {
        // toDataURL rather than toBlob: some browsers hold toBlob back to about once a second
        await fetch(`${SERVER}/frame/${name}`, { method: 'POST', body: canvas.toDataURL('image/png') })
    }

    // preview: a contact sheet of the given moments (seconds into the intro), nothing sent
    const preview = window.__aperturaPreview
    if (preview) {
        const sheet = document.createElement('canvas')
        const cols = 3, tw = 533, th = 300
        sheet.width = cols * tw
        sheet.height = Math.ceil(preview.length / cols) * th
        const ctx = sheet.getContext('2d')
        for (let i = 0; i < FPS; i++) frame(0, introPose, [])
        let k = 0
        for (let f = 0; f <= Math.round(Math.max(...preview) * FPS); f++) {
            const T = f / FPS
            frame(T, T < INTRO ? introPose : loopPose, BLINKS.intro)
            if (preview.some((p) => Math.abs(p - T) < 0.5 / FPS)) {
                ctx.drawImage(canvas, (k % cols) * tw, Math.floor(k / cols) * th, tw, th)
                ctx.fillStyle = '#c00'
                ctx.font = '20px sans-serif'
                ctx.fillText(T.toFixed(2) + ' s', (k % cols) * tw + 8, Math.floor(k / cols) * th + 24)
                k++
            }
        }
        it.scene.remove(g.root)
        r.dispose()
        window.__aperturaSheet = sheet.toDataURL('image/jpeg', 0.85)
        return
    }
    // the map is not drawn meanwhile: the computer's time goes to filming
    n.stage.hold = true
    window.__apertura = { done: 0, total: Math.round(INTRO * FPS) + Math.round(LOOP * FPS) }
    // a second of the first pose first, so the eyes and the mood are in place at frame 0
    for (let i = 0; i < FPS; i++) frame(0, introPose, [])
    for (let f = 0; f < Math.round(INTRO * FPS); f++) {
        frame(f / FPS, introPose, BLINKS.intro)
        await send(`intro_${String(f).padStart(4, '0')}.png`)
        window.__apertura.done++
    }
    // the loop runs on from the intro's last frame
    for (let f = 0; f < Math.round(LOOP * FPS); f++) {
        frame(INTRO + f / FPS, (T) => loopPose(T), BLINKS.loop.map((b) => b + INTRO))
        await send(`loop_${String(f).padStart(4, '0')}.png`)
        window.__apertura.done++
    }
    it.scene.remove(g.root)
    r.dispose()
    n.stage.hold = false
    await fetch(`${SERVER}/done`, { method: 'POST' })
    window.__apertura.finished = true
})()
