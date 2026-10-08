import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { sharedMaterial } from './materials.js'
import { canvasTexture, cloudTexture, crossTexture, radialTexture } from './procedural/textures.js'
import { stylize } from './stylize.js'

/**
 * Small, respectful environmental cues for the session's emergency context.
 * They suggest the situation (relief tents, a structural check, distant smoke,
 * puddles, sandbags) without damage or spectacle.
 */

/* ---------------- shared builders ---------------- */

export function reliefTent(scale = 1) {
    const g = new THREE.Group()
    const white = stylize(sharedMaterial('cue:canvas', { color: '#F7F5F0', roughness: 0.85, side: THREE.DoubleSide }))
    const pole = sharedMaterial('cue:pole', { color: '#5D6A72', roughness: 0.6, metalness: 0.3 })
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.1, 4, 1, true), white)
    roof.rotation.y = Math.PI / 4
    roof.position.y = 2.55
    const valance = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.32, 4, 1, true), white)
    valance.rotation.y = Math.PI / 4
    valance.position.y = 1.86
    valance.scale.set(1, 1, 1)
    g.add(roof, valance)
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), pole)
        p.position.set(x, 1.0, z)
        g.add(p)
    }
    const badge = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.62),
        new THREE.MeshStandardMaterial({ map: crossTexture({ scale: 0.6 }), roughness: 0.8 })
    )
    badge.position.set(0, 1.86, 1.22)
    g.add(badge)
    // table + boxes
    const wood = stylize(sharedMaterial('cue:box', { color: '#C9A77C', roughness: 0.9 }))
    const table = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.08, 0.8, 2, 0.03), sharedMaterial('cue:table', { color: '#ECEAE4', roughness: 0.7 }))
    table.position.set(0, 0.8, 0.2)
    g.add(table)
    for (const [x, y, z, s] of [[-0.5, 0.98, 0.2, 0.32], [0.1, 0.98, 0.25, 0.3], [0.5, 1.0, 0.1, 0.36], [-1.0, 0.18, -0.6, 0.36], [-0.6, 0.18, -0.8, 0.34]]) {
        const b = new THREE.Mesh(new RoundedBoxGeometry(s * 1.2, s, s, 2, 0.03), wood)
        b.position.set(x, y, z)
        g.add(b)
    }
    g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true))
    g.scale.setScalar(scale)
    return g
}

export function barrier() {
    const g = new THREE.Group()
    const stripes = new THREE.MeshStandardMaterial({
        map: canvasTexture(256, 64, (ctx, w, h) => {
            ctx.fillStyle = '#F2C14E'
            ctx.fillRect(0, 0, w, h)
            ctx.fillStyle = '#3B3F45'
            for (let x = -h; x < w; x += 48) {
                ctx.beginPath()
                ctx.moveTo(x, h)
                ctx.lineTo(x + 24, h)
                ctx.lineTo(x + 24 + h, 0)
                ctx.lineTo(x + h, 0)
                ctx.fill()
            }
        }),
        roughness: 0.7,
    })
    const leg = sharedMaterial('cue:leg', { color: '#E9E6DF', roughness: 0.8 })
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.26, 0.06), stripes)
    bar.position.y = 0.9
    g.add(bar)
    for (const x of [-0.9, 0.9]) {
        for (const z of [-0.22, 0.22]) {
            const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), leg)
            l.position.set(x, 0.48, z * 0.5)
            l.rotation.x = z > 0 ? 0.22 : -0.22
            g.add(l)
        }
    }
    const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.5),
        new THREE.MeshStandardMaterial({
            map: canvasTexture(140, 100, (ctx, w, h) => {
                ctx.fillStyle = '#FFFFFF'
                ctx.fillRect(0, 0, w, h)
                ctx.strokeStyle = '#3B3F45'
                ctx.lineWidth = 6
                ctx.strokeRect(3, 3, w - 6, h - 6)
                ctx.fillStyle = '#3B3F45'
                ctx.font = '700 22px sans-serif'
                ctx.textAlign = 'center'
                ctx.fillText('REVISIÓN', w / 2, 46)
                ctx.font = '600 16px sans-serif'
                ctx.fillText('estructural', w / 2, 72)
            }),
            roughness: 0.8,
        })
    )
    sign.position.set(0, 1.35, 0.04)
    g.add(sign)
    g.traverse((o) => o.isMesh && (o.castShadow = true))
    return g
}

export function sandbags() {
    const g = new THREE.Group()
    const mat = stylize(sharedMaterial('cue:sand', { color: '#CDB993', roughness: 1 }), { ao: 0.25, aoHeight: 0.6 })
    const geo = new RoundedBoxGeometry(0.62, 0.22, 0.36, 3, 0.1)
    let i = 0
    for (let row = 0; row < 2; row++) {
        for (let k = 0; k < 4 - row; k++) {
            const b = new THREE.Mesh(geo, mat)
            b.position.set((k - (3 - row) / 2) * 0.62, 0.11 + row * 0.2, 0)
            b.rotation.y = ((i++ % 3) - 1) * 0.05
            b.castShadow = b.receiveShadow = true
            g.add(b)
        }
    }
    return g
}

export function waterTanks() {
    const g = new THREE.Group()
    const blue = stylize(sharedMaterial('cue:tank', { color: '#3F7FB8', roughness: 0.5 }))
    for (const [x, z, s] of [[0, 0, 1], [1.25, 0.3, 0.85]]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * s, 0.55 * s, 1.2 * s, 20), blue)
        t.position.set(x, 0.6 * s, z)
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * s, 0.3 * s, 0.12, 16), blue)
        lid.position.set(x, 1.24 * s, z)
        t.castShadow = t.receiveShadow = true
        g.add(t, lid)
    }
    return g
}

/** Slow, soft smoke column (sprites). Distant only. */
function smokeColumn({ height = 40, width = 14, count = 9, color = '#8F8B86', opacity = 0.28 } = {}) {
    const g = new THREE.Group()
    const tex = cloudTexture(7)
    const puffs = []
    for (let i = 0; i < count; i++) {
        const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0, depthWrite: false, fog: true })
        const s = new THREE.Sprite(m)
        s.userData = { t: i / count, seed: Math.random() * 10 }
        g.add(s)
        puffs.push(s)
    }
    g.userData.update = (dt) => {
        for (const s of puffs) {
            const u = s.userData
            u.t = (u.t + dt * 0.018) % 1
            const k = u.t
            const w = width * (0.45 + k * 0.9)
            s.position.set(Math.sin(u.seed + k * 3) * width * 0.25 + k * width * 0.6, k * height, Math.cos(u.seed) * width * 0.15)
            s.scale.set(w, w * 0.7, 1)
            s.material.opacity = opacity * Math.sin(Math.PI * k) * (k < 0.1 ? k / 0.1 : 1)
        }
    }
    return g
}

/** Light rain streaks that follow the camera; drawn as thin lines. */
export class Rain {
    constructor({ count = 2200, area = 60, height = 40, length = 0.9, opacity = 0.32 } = {}) {
        const pos = new Float32Array(count * 6)
        const seeds = new Float32Array(count * 2)
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * area
            const z = (Math.random() - 0.5) * area
            const y = Math.random() * height
            pos.set([x, y, z, x - 0.04 * length, y - length, z], i * 6)
            seeds[i * 2] = seeds[i * 2 + 1] = Math.random()
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
        this.count = count
        this.baseOpacity = opacity
        this.uniforms = { uTime: { value: 0 }, uHeight: { value: height }, uOpacity: { value: opacity }, uCenter: { value: new THREE.Vector3() } }
        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: this.uniforms,
            vertexShader: /* glsl */ `
                attribute float aSeed;
                uniform float uTime; uniform float uHeight; uniform vec3 uCenter;
                varying float vA;
                void main() {
                    vec3 p = position;
                    float fall = mod(p.y - uTime * (18.0 + aSeed * 6.0) * (uHeight / 40.0), uHeight);
                    p.y = fall;
                    p += uCenter;
                    vA = smoothstep(0.0, 4.0, fall) * smoothstep(uHeight, uHeight - 6.0, fall);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
                }`,
            fragmentShader: /* glsl */ `
                uniform float uOpacity; varying float vA;
                void main() { gl_FragColor = vec4(0.76, 0.82, 0.88, uOpacity * vA); }`,
        })
        this.mesh = new THREE.LineSegments(geo, mat)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 5
    }
    update(dt, center) {
        this.uniforms.uTime.value += dt
        this.uniforms.uCenter.value.copy(center)
    }

    /**
     * How hard it rains: 0.15 a drizzle (a few faint drops), about 0.55 steady
     * rain, 1 a downpour. Only that share of the drops is drawn.
     */
    setLevel(k) {
        const level = Math.min(1, Math.max(0.05, k))
        this.mesh.geometry.setDrawRange(0, Math.max(2, Math.round(this.count * level) * 2))
        this.uniforms.uOpacity.value = this.baseOpacity * (0.55 + 0.45 * level)
    }
}

/** Safety cones — a lane kept clear while a building is checked. */
export function cones(n = 3) {
    const g = new THREE.Group()
    const body = stylize(sharedMaterial('cue:cone', { color: '#E4683C', roughness: 0.75 }))
    const band = stylize(sharedMaterial('cue:coneBand', { color: '#F6F2EA', roughness: 0.7 }))
    for (let i = 0; i < n; i++) {
        const c = new THREE.Group()
        const base = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.06, 0.46, 2, 0.02), body)
        base.position.y = 0.03
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.62, 12), body)
        cone.position.y = 0.36
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.145, 0.1, 12), band)
        ring.position.y = 0.4
        c.add(base, cone, ring)
        c.position.set((i - (n - 1) / 2) * 1.15, 0, (i % 2) * 0.25)
        c.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true))
        g.add(c)
    }
    return g
}

/** "Punto de encuentro" sign — where neighbours gather, calm and informative. */
export function meetingPoint() {
    const g = new THREE.Group()
    const post = sharedMaterial('cue:post', { color: '#5D6A72', roughness: 0.6, metalness: 0.3 })
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.3, 8), post)
    p.position.y = 1.15
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.1, 12), post)
    foot.position.y = 0.05
    const board = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 0.85),
        new THREE.MeshStandardMaterial({
            map: canvasTexture(230, 170, (ctx, w, h) => {
                ctx.fillStyle = '#0F6B45'
                ctx.fillRect(0, 0, w, h)
                ctx.fillStyle = '#FFFFFF'
                ctx.fillRect(7, 7, w - 14, h - 14)
                ctx.fillStyle = '#0F6B45'
                ctx.fillRect(13, 13, w - 26, h - 26)
                // two simple figures under a roof line
                ctx.fillStyle = '#FFFFFF'
                for (const cx of [w / 2 - 26, w / 2 + 26]) {
                    ctx.beginPath()
                    ctx.arc(cx, h / 2 - 22, 11, 0, Math.PI * 2)
                    ctx.fill()
                    ctx.beginPath()
                    ctx.roundRect(cx - 13, h / 2 - 7, 26, 36, 9)
                    ctx.fill()
                }
                ctx.font = '700 19px sans-serif'
                ctx.textAlign = 'center'
                ctx.fillText('PUNTO DE', w / 2, h - 36)
                ctx.fillText('ENCUENTRO', w / 2, h - 16)
            }),
            roughness: 0.8,
            side: THREE.DoubleSide,
        })
    )
    board.position.set(0, 1.95, 0.04)
    g.add(p, foot, board)
    g.traverse((o) => o.isMesh && (o.castShadow = true))
    return g
}

/** A raised water tank with taps — the barrio's drinking point. */
export function waterPoint() {
    const g = new THREE.Group()
    const frame = sharedMaterial('cue:frame', { color: '#5D6A72', roughness: 0.6, metalness: 0.35 })
    const blue = stylize(sharedMaterial('cue:tank', { color: '#3F7FB8', roughness: 0.5 }))
    const white = stylize(sharedMaterial('cue:canvas', { color: '#F7F5F0', roughness: 0.85, side: THREE.DoubleSide }))
    for (const [x, z] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.1, 0.09), frame)
        leg.position.set(x, 0.55, z)
        g.add(leg)
    }
    const deck = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.1, 1.6, 2, 0.03), frame)
    deck.position.y = 1.14
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 1.15, 22), blue)
    tank.position.y = 1.78
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.12, 16), blue)
    lid.position.y = 2.41
    g.add(deck, tank, lid)
    for (const x of [-0.26, 0.26]) {
        const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 8), frame)
        tap.rotation.x = Math.PI / 2
        tap.position.set(x, 1.3, 0.66)
        g.add(tap)
    }
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardMaterial({ map: crossTexture({ scale: 0.6 }), roughness: 0.8 }))
    cross.position.set(0, 1.84, 0.68)
    g.add(cross)
    // a couple of jerricans waiting underneath
    for (const [x, z, r] of [[-0.95, 0.95, 0.4], [-0.5, 1.15, -0.3]]) {
        const can = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.42, 0.22, 2, 0.05), white)
        can.position.set(x, 0.21, z)
        can.rotation.y = r
        g.add(can)
    }
    g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true))
    return g
}

/** Supply pallets under a tarp — aid that has already arrived. */
export function pallets() {
    const g = new THREE.Group()
    const wood = stylize(sharedMaterial('cue:pallet', { color: '#B48E63', roughness: 0.95 }))
    const box = stylize(sharedMaterial('cue:box', { color: '#C9A77C', roughness: 0.9 }))
    const tarp = stylize(sharedMaterial('cue:tarp', { color: '#4E7FA6', roughness: 0.8, side: THREE.DoubleSide }))
    for (const [px, pz] of [[0, 0], [1.5, 0.35]]) {
        const base = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.14, 1.0, 2, 0.03), wood)
        base.position.set(px, 0.07, pz)
        g.add(base)
        for (let k = 0; k < 3; k++) {
            const b = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.4, 0.42, 2, 0.04), box)
            b.position.set(px + (k % 2 ? 0.3 : -0.3), 0.34 + Math.floor(k / 2) * 0.42, pz + (k === 2 ? 0.1 : -0.05))
            b.rotation.y = (k - 1) * 0.12
            g.add(b)
        }
    }
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.5), tarp)
    cover.rotation.set(-Math.PI / 2 + 0.18, 0.1, 0)
    cover.position.set(1.5, 0.92, 0.3)
    g.add(cover)
    g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true))
    return g
}

/** A washing line — ordinary life carrying on after the rain. */
export function clothesLine(rand = Math.random) {
    const g = new THREE.Group()
    const post = stylize(sharedMaterial('cue:linePost', { color: '#9A836A', roughness: 0.9 }))
    const rope = sharedMaterial('cue:rope', { color: '#D8D2C4', roughness: 1 })
    const span = 4.2
    for (const x of [-span / 2, span / 2]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.2, 8), post)
        p.position.set(x, 1.1, 0)
        g.add(p)
    }
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, span, 6).rotateZ(Math.PI / 2), rope)
    line.position.y = 2.0
    g.add(line)
    const colors = ['#E6E1D6', '#C9D8DE', '#E9C9B6', '#CBD9C2', '#E3D2E0']
    for (let i = 0; i < 5; i++) {
        const w = 0.5 + rand() * 0.25
        const h = 0.65 + rand() * 0.4
        const cloth = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h, 1, 2),
            stylize(sharedMaterial(`cue:cloth${i}`, { color: colors[i % colors.length], roughness: 0.95, side: THREE.DoubleSide }), { sway: 0 })
        )
        cloth.position.set(-span / 2 + 0.6 + i * 0.78, 2.0 - h / 2, 0)
        cloth.rotation.y = (rand() - 0.5) * 0.25
        g.add(cloth)
    }
    g.traverse((o) => o.isMesh && (o.castShadow = true))
    return g
}

/** Ash drifting down, very slowly. Fire context only; never near the camera. */
function ashFall({ count = 180, area = 46, height = 16 } = {}) {
    const pos = new Float32Array(count * 3)
    const seeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * area
        pos[i * 3 + 1] = Math.random() * height
        pos[i * 3 + 2] = (Math.random() - 0.5) * area
        seeds[i] = Math.random()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    const uniforms = { uTime: { value: 0 }, uHeight: { value: height } }
    const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms,
        vertexShader: /* glsl */ `
            attribute float aSeed;
            uniform float uTime; uniform float uHeight;
            varying float vA;
            void main() {
                vec3 p = position;
                float fall = mod(p.y - uTime * (0.5 + aSeed * 0.5), uHeight);
                p.y = fall;
                p.x += sin(uTime * 0.4 + aSeed * 12.0) * 1.4;
                p.z += cos(uTime * 0.31 + aSeed * 9.0) * 1.1;
                vA = smoothstep(0.0, 2.0, fall) * smoothstep(uHeight, uHeight - 5.0, fall);
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_PointSize = (1.6 + aSeed * 2.2) * (26.0 / -mv.z);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: /* glsl */ `
            varying float vA;
            void main() {
                vec2 d = gl_PointCoord - 0.5;
                float m = smoothstep(0.5, 0.1, length(d));
                gl_FragColor = vec4(0.72, 0.70, 0.67, vA * m * 0.5);
            }`,
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    points.renderOrder = 4
    points.userData.update = (dt) => (uniforms.uTime.value += dt)
    return points
}

/* ---------------- neighborhood cues ---------------- */

/**
 * @param theme   session theme
 * @param ctx     { layout, doors:[Vector3], fillers:[{x,z,yaw}], open:[x,z],
 *                  pathPoints:[Vector3], spots:[{x,z}], heightAt(x,z), rand,
 *                  barrier?() → the textured obstacle model, if it loaded }
 * @returns {{group: THREE.Group, update: (dt:number)=>void}}
 */
export function buildBarrioCues(theme, ctx) {
    const group = new THREE.Group()
    group.name = 'theme-cues'
    const updaters = []
    const cues = theme.cues.barrio
    const [ox, oz] = ctx.open
    const ground = ctx.heightAt ?? (() => 0)
    /** Drop a prop onto the ground wherever the barrio's terrain puts it. */
    const place = (obj, x, z, yaw = 0, lift = 0) => {
        obj.position.set(x, ground(x, z) + lift, z)
        obj.rotation.y = yaw
        group.add(obj)
        return obj
    }
    // free spots, used in order, so two cues never land on top of each other
    const spots = [...(ctx.spots ?? [])]
    const nextSpot = (fallback) => spots.shift() ?? fallback

    if (cues.includes('reliefTent')) {
        place(reliefTent(), ox, oz, Math.atan2(-ox, 6 - oz)) // face the street
        if (cues.includes('waterTanks')) place(waterTanks(), ox + 2.6, oz - 1.2)
    }
    if (cues.includes('inspection') && ctx.fillers.length) {
        const f = ctx.fillers[0]
        const front = new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw))
        const bx = f.x + front.x * 4.4
        const bz = f.z + front.z * 4.4
        place(ctx.barrier?.() ?? barrier(), bx, bz, f.yaw)
        if (cues.includes('cones')) place(cones(3), bx + front.z * 2.2, bz - front.x * 2.2, f.yaw + Math.PI / 2)
    }
    if (cues.includes('meetingPoint')) {
        const p = nextSpot({ x: ox + 4.6, z: oz + 3.2 })
        place(meetingPoint(), p.x, p.z, Math.atan2(-p.x, 10 - p.z))
    }
    if (cues.includes('waterPoint')) {
        const p = nextSpot({ x: ox - 3.4, z: oz + 2.6 })
        place(waterPoint(), p.x, p.z, Math.atan2(-p.x, 10 - p.z))
    }
    if (cues.includes('pallets')) {
        const p = nextSpot({ x: ox - 3.8, z: oz - 2.4 })
        place(pallets(), p.x, p.z, ctx.rand() * Math.PI)
    }
    if (cues.includes('clothesLine')) {
        const p = nextSpot({ x: ox + 5.5, z: oz - 3.5 })
        place(clothesLine(ctx.rand), p.x, p.z, ctx.rand() * Math.PI)
    }
    if (cues.includes('sandbags')) {
        ctx.doors.slice(0, 3).forEach((d, i) => {
            const side = i % 2 ? 1 : -1
            place(sandbags(), d.x + side * 1.9, d.z - 0.9, d.yaw ?? 0)
        })
    }
    if (cues.includes('puddles')) {
        const mat = new THREE.MeshStandardMaterial({
            color: '#8E9AA4',
            roughness: 0.08,
            metalness: 0.0,
            transparent: true,
            opacity: 0.55,
            alphaMap: radialTexture({ inner: 'rgba(255,255,255,1)', outer: 'rgba(0,0,0,0)', stop: 0.45 }),
            depthWrite: false,
            envMapIntensity: 1.6,
        })
        const pts = ctx.pathPoints
        for (let i = 0; i < 11 && pts.length; i++) {
            const p = pts[Math.floor(ctx.rand() * pts.length)]
            const x = p.x + (ctx.rand() - 0.5) * 1.5
            const z = p.z + (ctx.rand() - 0.5) * 1.5
            const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), mat)
            m.position.set(x, ground(x, z) + 0.025, z)
            m.scale.set(0.8 + ctx.rand() * 1.1, 1, 0.5 + ctx.rand() * 0.6)
            m.rotation.y = ctx.rand() * Math.PI
            m.renderOrder = 1
            group.add(m)
        }
    }
    if (cues.includes('ashFall')) {
        const a = ashFall()
        a.position.set(0, 0, -10)
        group.add(a)
        updaters.push(a.userData.update)
    }
    if (cues.includes('distantSmoke')) {
        const s = smokeColumn({ height: 60, width: 26, count: 10, opacity: 0.22 })
        s.position.set(-110, 8, -170)
        group.add(s)
        updaters.push(s.userData.update)
    }
    return { group, update: (dt) => updaters.forEach((u) => u(dt)) }
}

/* ---------------- city cues ---------------- */

export function buildCityCues(theme, { parks = [], heightAt }) {
    const group = new THREE.Group()
    group.name = 'theme-cues-city'
    const updaters = []
    const cues = theme.cues.city

    if (cues.includes('tents')) {
        for (const p of parks.slice(0, 4)) {
            for (let k = 0; k < 3; k++) {
                const t = reliefTent(1.35)
                const a = (k / 3) * Math.PI * 2 + p.x
                t.position.set(p.x + Math.cos(a) * p.r * 0.45, 0, p.z + Math.sin(a) * p.r * 0.45)
                t.rotation.y = a
                group.add(t)
            }
        }
    }
    if (cues.includes('smoke')) {
        for (const [x, z, h] of [[-120, -58, 85], [-130, 22, 75], [-114, 78, 65]]) {
            const s = smokeColumn({ height: h, width: 34, count: 12, color: '#6E6761', opacity: 0.5 })
            s.position.set(x, heightAt(x, z) + 4, z)
            group.add(s)
            updaters.push(s.userData.update)
        }
    }
    return { group, update: (dt) => updaters.forEach((u) => u(dt)) }
}
