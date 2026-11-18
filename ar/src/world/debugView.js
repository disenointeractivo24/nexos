import * as THREE from 'three'

/**
 * The debug view (?debug in the address, or G on a computer): what the shift knows and decided,
 * drawn where it is in the room.
 *   red      the experience's area           yellow   the shelves' zone
 *   green    tables the cartons may go on    cyan     surfaces the headset reported (id, label)
 *   blue     floor taken (walls, furniture, outside the area), from the floor plan
 *   white +  where each carton was set       magenta +  each stand       orange +  people's places
 * and a panel with the state of depth, the anchor, what each hand holds and what could not be placed.
 */

const COLORS = { area: '#FF3B3B', shelf: '#FFD400', table: '#2ECC71', detected: '#22D3EE', blocked: '#2F6BFF', box: '#FFFFFF', stand: '#FF3BD4', person: '#FF9F1C', bad: '#FF0000' }

function lineMaterial(color) {
    return new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false })
}

function noPointer(object) {
    object.traverse((o) => {
        o.raycast = () => {}
        o.pointerEvents = 'none'
        o.renderOrder = 40
    })
    return object
}

function label(text, color = '#FFFFFF', scale = 0.18) {
    const canvas = document.createElement('canvas')
    const c = canvas.getContext('2d')
    const font = 'bold 34px system-ui, sans-serif'
    c.font = font
    const w = Math.ceil(c.measureText(text).width) + 24
    canvas.width = w
    canvas.height = 52
    c.font = font
    c.fillStyle = 'rgba(0,0,0,0.72)'
    c.fillRect(0, 0, w, 52)
    c.fillStyle = color
    c.textBaseline = 'middle'
    c.fillText(text, 12, 27)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, transparent: true, toneMapped: false }))
    sprite.scale.set((scale * w) / 52, scale, 1)
    return sprite
}

export class DebugView {
    constructor(scene) {
        this.scene = scene
        this.group = noPointer(new THREE.Group())
        this.group.name = 'debug'
        this.layoutGroup = new THREE.Group()
        this.liveGroup = new THREE.Group()
        this.group.add(this.layoutGroup, this.liveGroup)
        scene.add(this.group)
        this.panel = this.#panel()
        this.clock = 0
        this.visible = true
    }

    setVisible(on) {
        this.visible = on
        this.group.visible = on
        this.panel.mesh.visible = on
    }

    #panel() {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 640
        const map = new THREE.CanvasTexture(canvas)
        map.colorSpace = THREE.SRGBColorSpace
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, toneMapped: false }))
        noPointer(mesh)
        mesh.renderOrder = 45
        this.scene.add(mesh)
        return { canvas, map, mesh }
    }

    /** A closed outline of floor points ({ x, z } in the frame) at a height, in the room. */
    #outline(frame, poly, y, color, group = this.layoutGroup) {
        const points = [...poly, poly[0]].map((p) => frame.at(p.x, y, p.z))
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial(color))
        group.add(noPointer(line))
        return line
    }

    #cross(frame, x, y, z, color, size = 0.06, group = this.liveGroup) {
        const pts = [frame.at(x - size, y, z), frame.at(x + size, y, z), frame.at(x, y, z - size), frame.at(x, y, z + size), frame.at(x, y, z), frame.at(x, y + size * 2, z)]
        const geo = new THREE.BufferGeometry().setFromPoints(pts)
        geo.setIndex([0, 1, 2, 3, 4, 5])
        const seg = new THREE.LineSegments(geo, lineMaterial(color))
        group.add(noPointer(seg))
    }

    #text(frame, text, x, y, z, color) {
        const s = label(text, color, 0.035)
        frame.at(x, y, z, s.position)
        this.layoutGroup.add(noPointer(s))
    }

    /** Detected surfaces (in the room), while choosing or after. */
    showSurfaces(surfaces) {
        for (const o of [...(this.surfaceGroup?.children ?? [])]) o.removeFromParent()
        this.surfaceGroup ??= new THREE.Group()
        this.group.add(this.surfaceGroup)
        for (const s of surfaces) {
            const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => s.center.clone().addScaledVector(s.u, a * s.hu).addScaledVector(s.v, b * s.hv).setY(s.top + 0.006))
            this.surfaceGroup.add(noPointer(new THREE.Line(new THREE.BufferGeometry().setFromPoints(corners), lineMaterial(COLORS.detected))))
            const tag = label(`${s.id ?? '?'} ${s.label} ${(s.hu * 2).toFixed(2)}x${(s.hv * 2).toFixed(2)} y=${s.top.toFixed(2)}${s.merged ? ` (=${s.merged.join(',')})` : ''}`, COLORS.detected, 0.03)
            tag.position.copy(s.center).setY(s.top + 0.05)
            this.surfaceGroup.add(noPointer(tag))
        }
    }

    /** The layout and the floor plan, once the table is chosen. */
    showLayout(frame, layout, plan) {
        for (const o of [...this.layoutGroup.children]) o.removeFromParent()
        this.#outline(frame, layout.area, 0.012, COLORS.area)
        this.#text(frame, `ÁREA (${layout.source})`, layout.area[0].x + 0.1, 0.05, layout.area[0].z + 0.1, COLORS.area)
        this.#outline(frame, layout.shelfZone, 0.02, COLORS.shelf)
        this.#text(frame, 'ESTANTERÍAS', layout.shelfZone[0].x + 0.1, 0.06, layout.shelfZone[0].z + 0.1, COLORS.shelf)
        for (const t of layout.tables) {
            const c = Math.cos(t.yaw)
            const s = Math.sin(t.yaw)
            const poly = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: t.cx + a * t.hw * c + b * t.hd * s, z: t.cz - a * t.hw * s + b * t.hd * c }))
            this.#outline(frame, poly, t.top + 0.008, COLORS.table)
            this.#text(frame, `${t.id} · ${t.label} · ${(t.hw * 2).toFixed(2)}x${(t.hd * 2).toFixed(2)}`, t.cx, t.top + 0.07, t.cz, COLORS.table)
        }
        if (plan) {
            // the floor that is taken, a dot every 10 cm, near the area only
            const pts = []
            const xs = layout.area.map((p) => p.x)
            const zs = layout.area.map((p) => p.z)
            for (let x = Math.min(...xs) - 0.4; x <= Math.max(...xs) + 0.4; x += 0.1) {
                for (let z = Math.min(...zs) - 0.4; z <= Math.max(...zs) + 0.4; z += 0.1) if (plan.isBlocked(x, z)) pts.push(frame.at(x, 0.008, z))
            }
            const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color: COLORS.blocked, size: 0.02, depthTest: false, transparent: true, opacity: 0.7, toneMapped: false }))
            this.layoutGroup.add(noPointer(dots))
        }
    }

    /** Where things were set, and what could not be. */
    showSpawns(frame, { boxes = [], stands = [], people = [] }) {
        for (const o of [...this.liveGroup.children]) o.removeFromParent()
        for (const b of boxes) this.#cross(frame, b.x, b.y, b.z, COLORS.box, 0.05)
        for (const s of stands) this.#cross(frame, s.x, 0.01, s.z, COLORS.stand, 0.08)
        for (const p of people) this.#cross(frame, p.x, 0.01, p.z, COLORS.person, 0.1)
    }

    /** The panel, a little below and to the left of the gaze, a few times a second. */
    update(dt, camera, lines) {
        if (!this.visible) return
        const head = camera.getWorldPosition(new THREE.Vector3())
        const dir = camera.getWorldDirection(new THREE.Vector3())
        const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
        this.panel.mesh.position.copy(head).addScaledVector(dir, 0.7).addScaledVector(right, -0.24).add(new THREE.Vector3(0, -0.2, 0))
        this.panel.mesh.lookAt(head)
        this.clock += dt
        if (this.clock < 0.25) return
        this.clock = 0
        const { canvas, map } = this.panel
        const c = canvas.getContext('2d')
        c.clearRect(0, 0, canvas.width, canvas.height)
        c.fillStyle = 'rgba(10,14,22,0.82)'
        c.fillRect(0, 0, canvas.width, canvas.height)
        c.font = '22px ui-monospace, monospace'
        c.textBaseline = 'top'
        let y = 12
        for (const line of lines) {
            const [text, color] = Array.isArray(line) ? line : [line, '#E8EEF6']
            c.fillStyle = color
            for (const part of wrap(c, String(text), canvas.width - 24)) {
                if (y > canvas.height - 26) break
                c.fillText(part, 12, y)
                y += 26
            }
        }
        map.needsUpdate = true
    }

    dispose() {
        this.group.removeFromParent()
        this.panel.mesh.removeFromParent()
    }
}

function wrap(c, text, width) {
    const words = text.split(' ')
    const out = []
    let line = ''
    for (const w of words) {
        const next = line ? `${line} ${w}` : w
        if (c.measureText(next).width > width && line) {
            out.push(line)
            line = w
        } else line = next
    }
    if (line) out.push(line)
    return out
}
