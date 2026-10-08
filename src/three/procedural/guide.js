import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { canvasTexture, drawCross } from './textures.js'

/**
 * Guide character built from the NEXOS model sheet (turnaround, 4.5 "c" units tall):
 *   0–1c legs and feet · 1–2.4c pear-shaped body · 2.1–4c head · helmet up to 4.5c.
 * Orange ribbed hard hat with a white Red Cross emblem, cream body, dot eyes and a
 * small smile, dark-green backpack with orange piping, orange harness + chest buckle.
 *
 * Built in "c" units, facing +Z; the asset loader scales it to its final height.
 * Named pivots (body, head, armL/R, legL/R) drive the procedural animation.
 */
export function buildGuide() {
    const M = {
        skin: new THREE.MeshStandardMaterial({ color: '#F4EFE7', roughness: 0.58 }),
        helmet: new THREE.MeshStandardMaterial({ color: '#F2A13A', roughness: 0.42 }),
        helmetIn: new THREE.MeshStandardMaterial({ color: '#D9862A', roughness: 0.6, side: THREE.DoubleSide }),
        pack: new THREE.MeshStandardMaterial({ color: '#2E4842', roughness: 0.7 }),
        packDark: new THREE.MeshStandardMaterial({ color: '#233833', roughness: 0.75 }),
        strap: new THREE.MeshStandardMaterial({ color: '#E8892F', roughness: 0.6 }),
        buckle: new THREE.MeshStandardMaterial({ color: '#2B2F33', roughness: 0.45 }),
        face: new THREE.MeshStandardMaterial({ color: '#1C1E22', roughness: 0.3 }),
    }
    for (const [name, m] of Object.entries(M)) m.name = `guia_${name}`
    const emblem = new THREE.MeshStandardMaterial({
        name: 'guia_emblema',
        map: canvasTexture(256, 256, (ctx, w) => {
            ctx.clearRect(0, 0, w, w)
            ctx.fillStyle = '#FFFFFF'
            ctx.beginPath()
            ctx.arc(w / 2, w / 2, w * 0.47, 0, Math.PI * 2)
            ctx.fill()
            drawCross(ctx, w / 2, w / 2, w * 0.56, '#E5333B')
        }),
        transparent: true,
        roughness: 0.5,
        polygonOffset: true,
        polygonOffsetFactor: -4,
    })

    const root = new THREE.Group()
    root.name = 'guide'
    const body = new THREE.Group()
    body.name = 'body'
    root.add(body)

    /* ---- legs + feet ---- */
    for (const side of [-1, 1]) {
        const hip = new THREE.Group()
        hip.name = side < 0 ? 'legL' : 'legR'
        hip.position.set(side * 0.27, 0.92, 0)
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.3, 8, 16), M.skin)
        leg.position.y = -0.38
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), M.skin)
        foot.scale.set(1, 0.6, 1.3)
        foot.position.set(0, -0.72, 0.08)
        hip.add(leg, foot)
        body.add(hip)
    }

    /* ---- pear-shaped torso ---- */
    const torsoProfile = [
        [0, 0.76], [0.52, 0.78], [0.8, 0.98], [0.88, 1.28], [0.84, 1.6], [0.72, 1.92], [0.54, 2.18], [0.34, 2.36], [0, 2.42],
    ].map(([r, y]) => new THREE.Vector2(r, y))
    const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 40), M.skin)
    torso.scale.z = 0.9
    body.add(torso)

    /* ---- arms ---- */
    for (const side of [-1, 1]) {
        const sh = new THREE.Group()
        sh.name = side < 0 ? 'armL' : 'armR'
        sh.position.set(side * 0.7, 2.0, 0.02)
        sh.rotation.z = side * 0.32
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.48, 8, 16), M.skin)
        arm.position.y = -0.4
        arm.scale.set(1, 1, 0.92)
        sh.add(arm)
        body.add(sh)
    }

    /* ---- head + face ---- */
    const head = new THREE.Group()
    head.name = 'head'
    head.position.y = 2.42
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1.0, 48, 32), M.skin)
    skull.scale.set(1.14, 0.98, 1.04)
    skull.position.y = 0.64
    head.add(skull)

    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), M.face)
        eye.scale.set(0.78, 1.25, 0.42)
        eye.position.set(side * 0.4, 0.56, 0.975)
        eye.lookAt(eye.position.clone().multiplyScalar(2))
        head.add(eye)
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.03, 8, 20, Math.PI * 0.6), M.face)
    smile.rotation.z = Math.PI + Math.PI * 0.2
    smile.position.set(0, 0.36, 1.0)
    smile.rotation.x = -0.18
    head.add(smile)

    /* ---- helmet ---- */
    const helmet = new THREE.Group()
    helmet.position.y = 0.8
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), M.helmet)
    dome.scale.set(1.1, 0.84, 1.08)
    const underside = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48).rotateX(Math.PI / 2), M.helmetIn)
    underside.scale.set(1.1, 1, 1.08)
    underside.position.y = 0.0
    // Brim: wider at the front, like the sheet's visor
    const brimShape = new THREE.Shape()
    const N = 64
    for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2
        const front = Math.max(0, Math.sin(a)) // +Z after rotation
        const r = 1.36 + 0.16 * front
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        if (i === 0) brimShape.moveTo(x, z)
        else brimShape.lineTo(x, z)
    }
    const brimGeo = new THREE.ExtrudeGeometry(brimShape, { depth: 0.09, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 3, curveSegments: 48 })
    brimGeo.rotateX(Math.PI / 2)
    const brim = new THREE.Mesh(brimGeo, M.helmet)
    brim.scale.z = -1 // keep the wider part at +Z after the X rotation
    brim.position.y = 0.06
    // Ribs over the top, front to back
    for (const x of [-0.42, 0, 0.42]) {
        const r = Math.sqrt(1.1 * 1.1 - x * x) + 0.02
        const rib = new THREE.Mesh(new THREE.TorusGeometry(r, x === 0 ? 0.05 : 0.04, 8, 32, Math.PI), M.helmet)
        rib.rotation.y = Math.PI / 2
        rib.position.x = x * 1.1
        rib.scale.set(1.08, 0.84, 1.08)
        helmet.add(rib)
    }
    // Small side slots
    for (const side of [-1, 1]) {
        const slot = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.12, 0.3, 2, 0.02), M.helmetIn)
        slot.position.set(side * 1.16, 0.2, 0.1)
        helmet.add(slot)
    }
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), emblem)
    badge.position.set(0, 0.5, 1.02)
    badge.rotation.x = -0.56
    helmet.add(dome, underside, brim, badge)
    head.add(helmet)
    body.add(head)

    /* ---- backpack ---- */
    const pack = new THREE.Group()
    pack.position.set(0, 1.62, -0.72)
    const piping = new THREE.Mesh(new RoundedBoxGeometry(1.03, 1.07, 0.36, 4, 0.18), M.strap)
    piping.position.z = -0.05
    const bag = new THREE.Mesh(new RoundedBoxGeometry(1.0, 1.04, 0.52, 4, 0.2), M.pack)
    bag.position.z = -0.05
    const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.46, 0.16, 3, 0.08), M.packDark)
    pocket.position.set(0, -0.22, -0.34)
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.025, 0.02), M.strap)
    zip.position.set(0, -0.04, -0.42)
    const tag = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.07, 0.04, 2, 0.015), M.strap)
    tag.position.set(0, 0.26, -0.33)
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 8, 18, Math.PI), M.packDark)
    handle.position.set(0, 0.52, -0.05)
    pack.add(piping, bag, pocket, zip, tag, handle)
    body.add(pack)

    /* ---- harness: shoulder straps + chest strap with buckle ---- */
    for (const side of [-1, 1]) {
        const over = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.075, 8, 28, Math.PI * 0.85), M.strap)
        over.rotation.y = -Math.PI / 2
        over.rotation.z = 0.1
        over.position.set(side * 0.42, 1.62, -0.05)
        over.scale.set(1, 0.92, 1)
        const front = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.6, 0.07, 2, 0.03), M.strap)
        front.position.set(side * 0.43, 1.55, 0.74)
        front.rotation.x = -0.12
        body.add(over, front)
    }
    const chest = new THREE.Mesh(new RoundedBoxGeometry(0.82, 0.08, 0.05, 2, 0.02), M.buckle)
    chest.position.set(0, 1.62, 0.79)
    const buckle = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.15, 0.07, 2, 0.03), M.buckle)
    buckle.position.set(0, 1.62, 0.8)
    body.add(chest, buckle)

    root.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = o.material !== emblem
            o.receiveShadow = true
        }
    })
    return root
}
