// The opening act, frame by frame: run in the dev page (see fuentes_3d/LEEME.md, "Apertura").
// It films the guide at the collection point with the app's own pieces — the guide (its face,
// its gestures), the point's stand and shelves, the stage's light and ink — and sends every
// frame to tools/apertura/recibir.mjs. Two clips:
//   intro (8.8 s): a close-up of the face as the guide looks up from the box in its arms and
//     smiles; the camera pulls out on an arc while it carries the box to the nearest shelf,
//     leans in and slides it onto the bottom board, turns round and waves (the logo comes in),
//     nods and settles;
//   loop (4 s): the settled guide breathing, for as long as loading takes; it starts exactly
//     where the intro ends and ends where it starts.
// Nothing jumps: every move eases in and out, the camera's moves overlap instead of stopping
// between them, and the box never leaves the guide's hands until it rests on the shelf.
// The page must be 1600 × 900 (the frames are the page's own canvas).
;(async () => {
    const n = window.nexos
    const SERVER = 'http://127.0.0.1:5199'
    const FPS = 60
    const INTRO = 8.8, LOOP = 4

    /* ---------------- curves ---------------- */
    const clamp01 = (x) => Math.min(1, Math.max(0, x))
    const seg = (T, a, b) => clamp01((T - a) / (b - a))
    const lerp = (a, b, u) => a + (b - a) * u
    const lerp3 = (a, b, u) => a.map((v, i) => lerp(v, b[i], u))
    const sm = (u) => u * u * (3 - 2 * u)
    const inOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
    const inOutSine = (u) => -(Math.cos(Math.PI * u) - 1) / 2
    const outCubic = (u) => 1 - Math.pow(1 - u, 3)
    const outBack = (u, s = 1.4) => (u >= 1 ? 1 : 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2))
    const bump = (T, a, b) => (T <= a || T >= b ? 0 : Math.sin(((T - a) / (b - a)) * Math.PI))
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
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

    /* ---------------- the set ---------------- */
    const SCALE = 0.85 // the guide among the shelves: some 1.6 m
    const START = [-2.6, 0, 1.25] // where it stands with the box
    const BAY = 'soap' // the nearest bottom shelf; the box goes in its middle slot, between two others
    const HEAD = 1.12 * SCALE

    /* ---------------- timing ---------------- */
    const WALK = 2.0 // sets off
    const FACE = [3.75, 4.35] // turns to face the shelf
    const PLACE = [4.35, 5.45] // leans in, slides the box onto the board
    const BACK = [5.45, 6.05] // lets go, straightens up
    const TURN = [5.95, 6.75] // turns round to the camera
    const WAVE = 6.75 // and waves; the logo comes in (LOGO_AT in src/boot.js)

    /* ---------------- the camera ---------------- */
    // around a point it looks at: azimuth (0 = straight in front), elevation, distance. Three
    // shots, each move starting before the last has quite settled, so the camera never stops
    function shot(T, gp) {
        const push = outCubic(seg(T, 0, 1.8))
        const close = { t: [gp.x, HEAD, gp.z], az: lerp(0.3, 0.24, push), el: 0.03, d: lerp(2.3, 2.0, push) }
        // nearly side on while the box goes in: the slot is between the camera and the guide, so the
        // box shows all the way onto the board (and the camera stays inside the stand's
        // poles, which would stand in the way from further out)
        const side = { t: [-1.1, 0.62, 0.0], az: 1.2, el: 0.16, d: 3.8 }
        // round to the front for the wave
        const end = { t: [-1.2, 0.98, 0.4], az: 0.2, el: 0.08, d: 6.0 }
        const u1 = crane(seg(T, 1.5, 5.2))
        const u2 = inOutCubic(seg(T, 4.5, 8.6))
        const mix = (k) => lerp(lerp(close[k], side[k], u1), end[k], u2)
        const t = lerp3(lerp3(close.t, side.t, u1), end.t, u2)
        // an arc: rising while it pulls out
        const el = mix('el') + 0.05 * Math.sin(Math.PI * u1) * (1 - u2)
        // distance in steps of ratio, so the pull-out feels even all the way
        const d = Math.exp(lerp(lerp(Math.log(close.d), Math.log(side.d), u1), Math.log(end.d), u2))
        const az = mix('az')
        return { pos: [t[0] + Math.sin(az) * Math.cos(el) * d, t[1] + Math.sin(el) * d, t[2] + Math.cos(az) * Math.cos(el) * d], target: t }
    }

    /* ---------------- the guide ---------------- */
    const ambient = (T) => {
        const p = ((T - INTRO) / LOOP) * Math.PI * 2
        return { breath: Math.sin(p * 2), shift: Math.sin(p), drift: 0.05 * Math.sin(p + 1.2) }
    }
    const place = (T) => inOutSine(seg(T, ...PLACE))
    const back = (T) => inOutCubic(seg(T, ...BACK))
    function introPose(T) {
        // looking up from the box: eyes first, then the head on a little arc, then a smile
        const up = outBack(seg(T, 0.7, 1.35), 1.3)
        const eyesUp = inOutCubic(seg(T, 0.6, 0.9))
        const P = place(T)
        const B = back(T)
        const carry = 1 - B
        // the lean in and out: in as the box goes forward, up again as the arms let go
        const lean = sm(seg(T, PLACE[0], PLACE[0] + 0.7)) * (1 - B)
        // the wave: a lift that overshoots, the hand waving, the arm coming down softly
        const wave = outBack(seg(T, WAVE, WAVE + 0.45), 1.3) * (1 - inOutCubic(seg(T, WAVE + 1.35, WAVE + 1.8)))
        const env = sm(seg(T, WAVE + 0.3, WAVE + 0.5)) * (1 - sm(seg(T, WAVE + 1.15, WAVE + 1.4)))
        // looking at the box going in, then up again
        const watch = sm(seg(T, PLACE[0] - 0.2, PLACE[0] + 0.3)) * (1 - sm(seg(T, BACK[0], BACK[1])))
        return {
            ...ambient(T),
            carry,
            // both arms round the box, reaching forward with it as it goes onto the board
            arms: -(0.95 + 0.3 * P) * carry,
            armsOut: -0.12 * carry,
            bodyX: 0.24 * lean,
            headX: lerp(0.28, 0, up) + 0.18 * watch + 0.12 * bump(T, 8.15, 8.55),
            headY: 0.1 * bump(T, 0.7, 1.35) + 0.15 * wave,
            headZ: 0.04 * sm(seg(T, 0.9, 1.5)) * (1 - wave) + 0.12 * wave,
            eyeX: 0,
            eyeY: lerp(-0.8, 0, eyesUp) - 0.6 * watch,
            armRUp: 1.55 * wave,
            armRWave: 0.28 * Math.sin(Math.PI * 2 * 2 * (T - WAVE - 0.3)) * env,
            bodyZ: -0.05 * wave,
            // a little dip before the wave, and a hop into it
            hop: -0.02 * bump(T, WAVE - 0.3, WAVE + 0.02) + 0.05 * bump(T, WAVE, WAVE + 0.38),
            mood: T < 1.2 ? 'calm' : T > WAVE + 0.25 && T < WAVE + 1.35 ? 'joy' : 'happy',
        }
    }
    function loopPose(T) {
        return { ...ambient(T), headZ: 0.04, eyeX: 0, eyeY: 0, mood: 'happy' }
    }
    // blinks: once while still looking down at the box, once on the way, once in the loop
    const BLINKS = { intro: [0.45, 3.0, 7.3], loop: [1.9] }

    /* ---------------- dressing the set ---------------- */
    const st = n.stage
    const V = st.camera.position.constructor
    n.sky.setOverride({ minutes: 10 * 60 + 30, kind: 'despejado' })
    n.city.group.visible = false
    n.clouds.group.visible = false
    if (n.hood) n.hood.group.visible = false
    const depot = n.depot
    depot.setPoint({ name: 'Punto de acopio Centro' })
    depot.reset()
    // the shelves part full, as on any day
    const qty = new Map([...depot.bays.keys()].map((id, i) => [id, [40, 14, 30, 60, 8, 22, 50, 12][i % 8]]))
    depot.sync(qty, { instant: true })
    const SHOWN = [4, 3, 2, 5, 1, 3, 4, 2]
    let i = 0
    for (const [id, bay] of depot.bays) {
        const show = id === BAY ? [0, 2] : [...Array(SHOWN[i % 8]).keys()]
        bay.boxes.forEach((b, k) => {
            b.visible = show.includes(k)
            b.scale.setScalar(b.visible ? b.userData.full : 0)
        })
        i++
    }
    depot.group.visible = true
    st.setShadowFrame(new V(0, 1.5, -0.6), 11, { mapSize: 2048, normalBias: 0.05 })
    st.setShadowsLive(true)
    st.setClip(0.3, 300)
    st.setFog(40, 160)
    // the box it carries, and where it goes
    const bay = depot.bays.get(BAY)
    const slot = bay.boxes[1]
    const box = slot.clone()
    box.visible = true
    box.scale.setScalar(slot.userData.full)
    st.scene.add(box)
    slot.parent.updateMatrixWorld(true)
    const slotAt = slot.getWorldPosition(new V())
    // where it stands to reach it: in front of the board, a little to the left so the box shows
    const SPOT = [slotAt.x - 0.32, 0, 0.36]
    const slotYaw = Math.atan2(slotAt.x - SPOT[0], slotAt.z - SPOT[2])

    const tpl = await n.loader.load('guide')
    const g = new n.guide.constructor(n.loader.instanceSync(tpl), tpl.animations, { face: true, lively: true })
    g.place(new V(...START), 0.35)
    g.root.scale.setScalar(SCALE)
    g.root.visible = true
    g.root.traverse((o) => o.isMesh && o !== g.blob && (o.castShadow = o.receiveShadow = true))
    st.scene.add(g.root)
    let walking = null
    let walkYaw = null
    const carried = new V()
    const boxInArms = () => {
        // against the belly, rising and falling with the body as the guide walks (its own space)
        const lift = (g.parts.body.position.y - g.bodyBase.y + g.model.position.y)
        return g.root.localToWorld(carried.set(0, 0.42 + lift, 0.52))
    }

    const cam = st.camera
    const frame = (T, pose, blinkAt) => {
        const o = pose(T)
        g.face.nextBlink = 99
        o.blink = blinkAt.some((b) => Math.abs(T - b) < 0.5 / FPS)
        g.script = o
        if (T >= WALK && !walking && T < INTRO) walking = g.walk([g.position.clone(), new V(-2.1, 0, 0.75), new V(...SPOT)], { speed: 1.4 })
        // the turns: eased, never snapped
        if (T >= FACE[0] && T < TURN[0]) {
            walkYaw ??= g.yaw
            g.targetYaw = walkYaw + wrap(slotYaw - walkYaw) * inOutCubic(seg(T, ...FACE))
        } else if (T >= TURN[0]) {
            g.targetYaw = slotYaw + wrap(0.2 - slotYaw) * inOutCubic(seg(T, ...TURN))
        }
        g.update(1 / FPS, T)
        g.root.updateMatrixWorld(true)
        // the box: in the arms, then slid forward and down onto the board, where it stays
        const P = place(T)
        const held = boxInArms()
        box.position.lerpVectors(held, slotAt, T < PLACE[0] ? 0 : P)
        const squareYaw = Math.round(g.root.rotation.y / Math.PI) * Math.PI
        box.rotation.y = lerp(g.root.rotation.y, squareYaw, T < PLACE[0] ? 0 : P)
        if (T >= PLACE[1]) {
            box.position.copy(slotAt)
            box.rotation.y = 0
        }
        const s = shot(T, g.position)
        cam.position.set(...s.pos)
        cam.lookAt(...s.target)
        cam.updateMatrixWorld()
        st.skyDome.position.copy(cam.position)
        st.stars.position.copy(cam.position)
        const r = st.renderer
        r.setRenderTarget(st.rt)
        r.render(st.scene, cam)
        r.setRenderTarget(null)
        r.render(st.postScene, st.postCamera)
    }
    const send = async (name) => {
        // toDataURL rather than toBlob: some browsers hold toBlob back to about once a second
        await fetch(`${SERVER}/frame/${name}`, { method: 'POST', body: st.renderer.domElement.toDataURL('image/png') })
    }

    // the stage's own loop is held: only this draws
    st.hold = true
    st.viewOffset.x = st.viewOffset.y = 0
    cam.fov = 24
    cam.aspect = st.size.w / st.size.h
    cam.updateProjectionMatrix()
    // the sky and its light settle on the chosen hour
    await new Promise((r) => setTimeout(r, 1500))

    // preview: a contact sheet of the given moments (seconds), nothing sent
    const preview = window.__aperturaPreview
    for (let f = 0; f < FPS; f++) frame(0, introPose, [])
    if (preview) {
        const sheet = document.createElement('canvas')
        const cols = 3, tw = 533, th = 300
        sheet.width = cols * tw
        sheet.height = Math.ceil(preview.length / cols) * th
        const ctx = sheet.getContext('2d')
        let k = 0
        for (let f = 0; f <= Math.round(Math.max(...preview) * FPS); f++) {
            const T = f / FPS
            frame(T, T < INTRO ? introPose : loopPose, T < INTRO ? BLINKS.intro : BLINKS.loop.map((b) => b + INTRO))
            if (preview.some((p) => Math.abs(p - T) < 0.5 / FPS)) {
                ctx.drawImage(st.renderer.domElement, (k % cols) * tw, Math.floor(k / cols) * th, tw, th)
                ctx.fillStyle = '#c00'
                ctx.font = '20px sans-serif'
                ctx.fillText(T.toFixed(2) + ' s', (k % cols) * tw + 8, Math.floor(k / cols) * th + 24)
                k++
            }
        }
        window.__aperturaSheet = sheet.toDataURL('image/jpeg', 0.85)
        return
    }

    window.__apertura = { done: 0, total: Math.round(INTRO * FPS) + Math.round(LOOP * FPS) }
    for (let f = 0; f < Math.round(INTRO * FPS); f++) {
        frame(f / FPS, introPose, BLINKS.intro)
        await send(`intro_${String(f).padStart(4, '0')}.png`)
        window.__apertura.done++
    }
    // the loop runs on from the intro's last frame
    for (let f = 0; f < Math.round(LOOP * FPS); f++) {
        frame(INTRO + f / FPS, loopPose, BLINKS.loop.map((b) => b + INTRO))
        await send(`loop_${String(f).padStart(4, '0')}.png`)
        window.__apertura.done++
    }
    await fetch(`${SERVER}/done`, { method: 'POST' })
    window.__apertura.finished = true
})()
