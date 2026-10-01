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

function barrier() {
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

function sandbags() {
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

function waterTanks() {
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
                void main() { gl_FragColor = vec4(0.88, 0.92, 0.96, uOpacity * vA); }`,
        })
        this.mesh = new THREE.LineSegments(geo, mat)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 5
    }
    update(dt, center) {
        this.uniforms.uTime.value += dt
        this.uniforms.uCenter.value.copy(center)
    }
}

/* ---------------- neighborhood cues ---------------- */

/**
 * @param theme   session theme
 * @param ctx     { layout, doors:[Vector3], fillers:[{x,z,yaw}], open:[x,z], pathPoints:[Vector3], rand }
 * @returns {{group: THREE.Group, update: (dt:number)=>void}}
 */
export function buildBarrioCues(theme, ctx) {
    const group = new THREE.Group()
    group.name = 'theme-cues'
    const updaters = []
    const cues = theme.cues.barrio
    const [ox, oz] = ctx.open

    if (cues.includes('reliefTent')) {
        const t = reliefTent()
        t.position.set(ox, 0, oz)
        t.rotation.y = Math.atan2(-ox, 6 - oz) // face the street
        group.add(t)
        if (cues.includes('waterTanks')) {
            const w = waterTanks()
            w.position.set(ox + 2.6, 0, oz - 1.2)
            group.add(w)
        }
    }
    if (cues.includes('inspection') && ctx.fillers.length) {
        const f = ctx.fillers[0]
        const b = barrier()
        const front = new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw))
        b.position.set(f.x + front.x * 4.4, 0, f.z + front.z * 4.4)
        b.rotation.y = f.yaw
        group.add(b)
    }
    if (cues.includes('sandbags')) {
        ctx.doors.slice(0, 3).forEach((d, i) => {
            const s = sandbags()
            const side = i % 2 ? 1 : -1
            s.position.set(d.x + side * 1.9, 0, d.z - 0.9)
            s.rotation.y = d.yaw ?? 0
            group.add(s)
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
        for (let i = 0; i < 9 && pts.length; i++) {
            const p = pts[Math.floor(ctx.rand() * pts.length)]
            const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), mat)
            m.position.set(p.x + (ctx.rand() - 0.5) * 1.5, 0.025, p.z + (ctx.rand() - 0.5) * 1.5)
            m.scale.set(0.8 + ctx.rand() * 1.1, 1, 0.5 + ctx.rand() * 0.6)
            m.rotation.y = ctx.rand() * Math.PI
            m.renderOrder = 1
            group.add(m)
        }
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
