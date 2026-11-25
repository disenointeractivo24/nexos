import { createSystem, DepthOccludable, GrabSystem, Grabbed, Hovered, OcclusionShadersMode, OneHandGrabbable, Pressed, RayInteractable, VisibilityState, XRAnchor, XRMesh, XRPlane } from '@iwsdk/core'
import { clearance, fitTent, toWorld } from './world/fit.js'
import { takeThumbs } from './world/thumbs.js'
import { areaBetween, areaMesh, HandRays, surfaceShadow } from './world/handRays.js'
import gsap from 'gsap'
import * as THREE from 'three'
import { AssetLoader } from '../../src/three/AssetLoader.js'
import { GuideCharacter } from '../../src/three/GuideCharacter.js'
import { CATEGORIES, SUPPLIES } from '../../src/data/catalog.js'
import { InventoryStore, sheetsEndpoint } from '../../src/app/inventoryStore.js'
import { Workable } from './components.js'
import { Haptics } from './haptics.js'
import { COMPLAINS_BELOW, complaintFor } from './sim/temper.js'
import { ORDERS, SHIFT_STOCK, TRUCK_GAP, Workday } from './sim/workday.js'
import { Sound } from './sound.js'
import { Atmosphere } from './world/atmosphere.js'
import { DesktopView } from './world/desktopView.js'
import { Glow } from './world/glow.js'
import { bigBoard, buttonPanel, orderPhotoCard, fontsReady, messageBoard, nextPanel, receivePanel, speechBubble, taskList } from './world/panels.js'
import { BOX_HEIGHT, onRealSurface, surfaceBias, buildStation, cardboardBox, cartonLayout, crateLayout, hangFromRoof, preloadSupplies, supplyObject, WORKER } from './world/station.js'
import { Temper } from './world/temper.js'
import { buildTruck } from './world/truck.js'

/** The inventory this experience works on: its own point, never one the donors see. */
const DEMO_POINT = 'demo-ar'
/** How near (m) something must be let go to count as left on the mat, in a crate, in the kit. */
const MAT_REACH = 0.34
const CRATE_REACH = 0.32
const KIT_REACH = 0.32
const KIT_TAPE = '#2E8B57'
/** The shared characters are a head taller than a person across a counter; children, smaller still. */
const PERSON_SCALE = 0.85
const CHILD_SCALE = 0.64
/** Where whoever is attended stands, just past the counter, and where the rest wait in line. */
const COUNTER_Z = -2.55
const LINE_Z = -3.4
/** To the right the further back: the truck drives along the left, and nobody may stand in its way. */
const LINE_SLOTS = [{ x: -0.95, z: LINE_Z }, { x: 0.95, z: LINE_Z }, { x: 2.85, z: LINE_Z }, { x: 1.9, z: LINE_Z - 1.2 }]
const ENTRY_Z = -7
/** Over the heads, and above the signs that hang in front of them. */
const CARD_Y = 2.02
const WALK_SPEED = 1.5
/** How far (m) from the person the truck stops, on the side opposite the shelf, just behind the panel that receives it. */
const TRUCK_REACH = 1.2
const TRUCK_PARK_Z = WORKER.z + 0.2
const TRUCK_FROM_Z = -18
const TRUCK_TO_Z = 18
const TRUCK_IN_SECONDS = 4.5
const TRUCK_OUT_SECONDS = 4
/** How far (m) from the person, to their side, the panel of the truck floats. */
const RECEIVE_REACH = 0.6
/** How large the signs over the table are in the room against how they were drawn, and the buttons on it. */
const SIGN_SCALE = 1.15
const BUTTON_SCALE = 0.8
/** How far under the eyes (m) the panel's middle is: right in the view, without looking up. */
const RECEIVE_BELOW_EYES = 0.05
/** What someone being carried on a computer floats at, from the eyes. */
const HOLD_DISTANCE = 0.72
/** How close, on screen, the pointer must be to count as over something it was let go on. */
const DROP_NEAR = 0.2
/** The same, for a ray in the headset: how far from it, in metres. */
const RAY_NEAR = 0.24
/** How far a hand's ray reaches (m), and how often what it points at is looked for (s). */
const RAY_LENGTH = 3
const RAY_LOOK = 0.12
/** What the order still needs floats over its carton, see-through, going round: how high over it, how wide, how fast. */
const GHOST_OVER = 0.16
const GHOST_RADIUS = 0.2
const GHOST_TURN = 0.7
const GHOST_OPACITY = 0.45
/** How long a message stays up before a lesser one can take its place, and how long an alert does. */
const MESSAGE_HOLD = 2.5
const ALERT_HOLD = 7
const WARN_HOLD = 3.5
/** How often one more of the signs that change with time gets a look, in seconds. */
const SIGN_TURN = 0.2
/** A bar that goes in steps: no one reads a change smaller than this, and each one costs an upload. */
const barStep = (left) => Math.round(Math.max(0, left) * 20) / 20
/** A catalog name too long for the front of a crate. */
const SHELF_NAME = { cans: 'Enlatados' }
/** How long someone complains for, and how long until the next one does: they take turns, there is one bubble. */
const COMPLAINT_SECONDS = 3
const COMPLAINT_PAUSE = 1.4
/** How much of what is left of the wait each family has, for its faces and its bar alike. */
const leftOf = (order) => Math.max(0, 1 - order.waited / order.patience)
/** What is pressed, rather than carried. */
const BUTTONS = new Set(['action', 'list', 'receive', 'next'])

const temp = new THREE.Vector3()
const temp2 = new THREE.Vector3()
const up = new THREE.Vector3()

const list = (names) => {
    if (names.length < 2) return names.join('')
    return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/**
 * One shift at the collection point: raises the tent around the person, then turns what they
 * do with the boxes and supplies into steps of the Workday, and shows what the Workday answers.
 * Nothing here sets an order: there are always cartons and there is always someone coming.
 *
 * What gets carried is held down to carry it: with a hand or the grip in the headset, with
 * the mouse button on a computer. Let go over where it goes, it stays there.
 */
export class ShiftSystem extends createSystem({
    pressed: { required: [Workable, Pressed] },
    held: { required: [Workable, Grabbed] },
    hovered: { required: [Workable, Hovered] },
    planes: { required: [XRPlane] },
    meshes: { required: [XRMesh] },
}) {
    init() {
        this.things = new Map() // entity → { kind, ... }
        this.families = new Map() // order id → its people, and their card
        this.sayQueue = []
        this.sayUntil = 0
        this.signTurn = 0
        this.crowd = new Set() // every person standing or walking about
        this.sound = new Sound()
        this.haptics = new Haptics()
        this.placed = false
        this.loader = new AssetLoader()
        this.ready = this.#prepare()
        this.elapsed = gsap.ticker.time
        this.signClock = 0
        this.raycaster = new THREE.Raycaster()
        this.holdTarget = new THREE.Vector3()

        // GSAP on the frame loop: a headset can stop the page's own animation frames
        gsap.ticker.remove(gsap.updateRoot)

        // a press counts when it ends: hiding what is being pressed before that strands the
        // pointer, and the next press of the trigger is lost
        this.queries.pressed.subscribe('qualify', (entity) => this.#pressIn(entity))
        this.queries.pressed.subscribe('disqualify', (entity) => this.#press(entity))
        this.queries.held.subscribe('qualify', (entity) => this.#take(entity))
        this.queries.held.subscribe('disqualify', (entity) => this.#release(entity))
        this.queries.hovered.subscribe('qualify', (entity) => this.#hover(entity, true))
        this.queries.hovered.subscribe('disqualify', (entity) => this.#hover(entity, false))

        this.cleanupFuncs.push(
            this.world.visibilityState.subscribe((state) => {
                const inHeadset = state !== VisibilityState.NonImmersive
                if (inHeadset) {
                    this.wasInHeadset = true
                    this.paused = false
                    if (!this.placed) this.#beginPlacement()
                } else if (this.wasInHeadset) {
                    // out of the headset the shift waits, and the person can come back to it
                    this.paused = true
                    this.cancelPlacement?.()
                }
            })
        )
    }

    update(delta) {
        this.elapsed += delta
        // the hands' rays (see handRays.js): while choosing the table, and then only towards what can be pressed or taken
        if (this.world.session) {
            if (!this.rays) {
                this.rays = new HandRays(this.world.scene)
                this.rays.only = (side, h) => this.#rayWanted(side, h)
            }
            if (this.elapsed - (this.rectsAt ?? -9) > 0.5) {
                this.rectsAt = this.elapsed
                this.rects = this.#surfaceRects()
            }
            this.rays.update(this.world.renderer.xr.getFrame?.(), this.world.renderer.xr.getReferenceSpace?.(), this.world.player, this.rects)
        }
        gsap.updateRoot(this.elapsed)
        this.view?.update(delta)
        this.haptics.watch(this.world.session)
        const cam = this.world.camera
        cam.getWorldPosition(temp)
        cam.getWorldDirection(temp2)
        up.set(0, 1, 0).applyQuaternion(cam.quaternion)
        this.sound.listen(temp, temp2, up)
        if (!this.placed || !this.day) return

        if (this.running && !this.paused) this.day.tick(delta)
        this.#nextMessage()
        this.atmosphere.update(delta, this.running ? this.day.pressure : 0)
        this.sound.ambient(this.atmosphere.level, delta)
        this.#feelings()
        for (const person of this.crowd) {
            person.update(delta, this.elapsed)
            person.temper.update(delta, this.elapsed)
        }
        this.#followCards()
        this.#carry(delta)
        this.#markHeld()
        this.#followGuide()
        this.#pollButtons()
        this.#placeList(delta)
        this.#turnGhosts(delta)
        // what is expected next breathes: it can be found without reading the whole table
        this.action.halo.material.opacity = 0.6 + 0.4 * Math.sin(this.elapsed * 3.2)
        this.signClock += delta
        if (this.signClock > SIGN_TURN) {
            this.signClock = 0
            this.#refreshSigns()
        }
    }

    /**
     * Once the point is up, a hand's ray shows only while it points at a button or at something it
     * can take (or holds it), and only as long as that. Looked for a few times a second, not every frame.
     */
    #rayWanted(side, h) {
        if (this.placing && !this.placed) return h.hit ? h.hit.t : RAY_LENGTH
        if (!this.placed) return null
        const seen = (this.rayLook ??= {})
        const last = seen[side]
        if (last && this.elapsed - last.at < RAY_LOOK) return last.length
        let length = null
        const targets = []
        for (const t of this.things.values()) {
            if (!t.object.visible || t.object.pointerEvents === 'none') continue
            if (BUTTONS.has(t.kind) || t.kind === 'box' || t.kind === 'item' || t.kind === 'stock') targets.push(t.object)
        }
        this.raycaster.ray.origin.copy(h.origin)
        this.raycaster.ray.direction.copy(h.dir)
        this.raycaster.far = RAY_LENGTH
        const hit = this.raycaster.intersectObjects(targets, true)[0]
        this.raycaster.far = Infinity
        if (hit) length = hit.distance
        // while carrying, the ray stays, to aim where it lands
        else if (this.queries.held.entities.size || this.queries.held.entities.length) length = h.pinching ? RAY_LENGTH * 0.4 : null
        seen[side] = { at: this.elapsed, length }
        return length
    }

    /** One group of signs at a time: all of them together would be a stumble, once a second. */
    #refreshSigns() {
        const turn = this.signTurn++ % 5
        if (turn === 0 && this.running) this.#refreshReceive()
        if (turn === 1 && this.day.current) this.#refreshOrder(this.day.current)
        if (turn === 2 && this.list.mesh.visible) this.#refreshList()
        if (turn >= 3) this.#refreshCards(turn - 3)
    }

    async #prepare() {
        await fontsReady()
        const visitors = [...new Set(ORDERS.flatMap((o) => o.visitors))]
        const [stand, supplies, people] = await Promise.all([
            this.loader.load('collection-point'),
            preloadSupplies(this.loader),
            Promise.all(visitors.map((id) => this.loader.load(id).then((t) => [id, t]))),
        ])
        this.stand = stand
        this.supplies = supplies
        this.people = new Map(people)
        // the photos on the order cards, taken once
        takeThumbs({ loader: this.loader, people: this.people, supplies, orders: ORDERS })
        // published: the demonstration tab of the sheet. On this computer, only this browser.
        const endpoint = import.meta.env.PROD ? sheetsEndpoint() : ''
        this.store = new InventoryStore({ pointId: DEMO_POINT, endpoint })
        await this.store.start()
        // only the first shift since the page opened: whoever comes to try it next starts fresh with a reload
        this.day = new Workday({ store: this.store, guided: true })
        this.day.on((event, detail) => this.#onDay(event, detail))
        const scene = this.world.scene
        const sky = new THREE.HemisphereLight('#FFF4E6', '#8A8172', 1.6)
        scene.add(sky)
        const sun = new THREE.DirectionalLight('#FFE9CF', 1.8)
        sun.position.set(-1.5, 3, 2)
        scene.add(sun)
        this.atmosphere = new Atmosphere(sky, sun)
    }

    /* ---------------- starting ---------------- */

    /** On a computer: the same tent, at a person's height, walking with the keys. */
    async startOnDesktop() {
        await this.ready
        this.sound.unlock()
        this.#backdrop()
        this.#place(new THREE.Vector3(0, 0, 0), 0)
        const camera = this.world.camera
        const canvas = this.world.renderer.domElement
        this.view = new DesktopView({
            camera,
            canvas,
            solids: this.station.solids.map((r) => ({ minX: r.minX * this.scale, maxX: r.maxX * this.scale, minZ: r.minZ * this.scale, maxZ: r.maxZ * this.scale })),
            bounds: { minX: -2.4, maxX: 2.4, minZ: -2.4, maxZ: 1.7 },
            roof: (on) => this.station.tent.traverse((o) => o.userData.roof && !o.userData.hidden && (o.visible = on)),
            grab: {
                pick: (ndc) => this.#pick(ndc),
                move: (ndc) => this.#holdAt(ndc),
                drop: (ndc) => this.#dropAt(ndc),
            },
        })
        canvas.style.cursor = 'grab'
        this.showView('persona')
    }

    /** Sky and ground, where the real room cannot be seen behind the tent. */
    #backdrop() {
        const scene = this.world.scene
        scene.background = new THREE.Color('#DDE3EA')
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2).translate(0, -0.26, 0), new THREE.MeshStandardMaterial({ color: '#B9C2CC', roughness: 1 })))
    }

    /** The views offered on a computer. */
    showView(name) {
        if (!this.view) return
        if (name === 'persona') return this.view.stand(WORKER.x * this.scale, (WORKER.z + 0.55) * this.scale, 0, -0.35)
        if (name === 'arriba') return this.view.lookFrom(temp.set(0, 4, 1.2), temp2.set(0, 0.3, -0.6), true)
        if (name === 'frente') return this.view.lookFrom(temp.set(1.6, 1.9, -7), temp2.set(0, 1.1, -1), false)
    }

    /** In the headset: wherever the person stands and looks when they press is behind the counter. */
    /**
     * In the headset, in two gestures:
     *   1. the ray of either hand points at the real surface, and a pinch chooses it;
     *   2. both hands pinch on its near edge and move apart: the area between them, drawn as they
     *      move, is where the table goes, as wide as they are apart. Letting go of both sets it.
     */
    async #beginPlacement() {
        await this.ready
        const { session } = this.world
        if (!session || this.placed || this.placing) return
        this.placing = true
        this.sound.unlock()
        // a headset that cannot show the room gets the same backdrop as a computer
        if (session.environmentBlendMode === 'opaque') this.#backdrop()
        else this.world.scene.background = null

        const hint = messageBoard()
        const say = (kind, text) => hint.refresh({ kind, text })
        say('info', 'Paso 1: apunta con el rayo de tu mano a la mesa y pellizca para elegirla.')
        // entities of their own, so the hands cover them too; the area lies on the table
        const hintEntity = this.#occlude(this.world.createTransformEntity(hint.mesh))
        const area = areaMesh()
        onRealSurface(area)
        const areaEntity = this.#occlude(this.world.createTransformEntity(area))
        // the detected surface, as a shadow: under the ray while choosing, fixed once chosen
        const shadow = surfaceShadow()
        this.world.scene.add(shadow)
        let shadowEntity = null
        const head = new THREE.Vector3()
        const dir = new THREE.Vector3()
        const state = { step: 'surface', surface: null, marking: null, held: 0 }
        const end = () => {
            session.removeEventListener('select', onSelect)
            stop()
            hintEntity.destroy()
            areaEntity.destroy()
            if (shadowEntity) shadowEntity.destroy()
            shadow.removeFromParent()
            // the rays come back: the shift's buttons are pressed with them
            if (this.rays) this.rays.visible = true
            this.cancelPlacement = null
        }
        // leaving before the table is up: it can start over on coming back
        this.cancelPlacement = () => {
            end()
            this.placing = false
        }
        const onSelect = (event) => {
            if (state.step !== 'surface') return
            const side = event.inputSource?.handedness
            const hit = this.rays?.get(side)?.hit
            if (!hit) return say('warn', 'Ese rayo no toca ninguna mesa: apunta a su superficie y pellizca.')
            state.surface = hit.surface
            state.step = 'area'
            // the shadow stays on the chosen table, anchored to it, and the rays go: step 2 is with both hands
            shadow.show(hit.surface, { fixed: true })
            try {
                shadowEntity = this.world.createTransformEntity(shadow)
                onRealSurface(shadow)
                this.#occlude(shadowEntity)
                shadowEntity.addComponent(XRAnchor)
            } catch (err) {
                console.warn('[ar2] the surface shadow is not anchored', err)
            }
            this.rays.visible = false
            this.sound.play('tap')
            say('info', 'Paso 2: pellizca con las dos manos en el borde de la mesa y sepáralas para marcar su ancho. Suelta para terminar.')
        }
        const stop = this.world.onXRFrame(() => {
            const cam = this.world.camera
            cam.getWorldPosition(head)
            cam.getWorldDirection(dir)
            hint.mesh.position.copy(head).addScaledVector(dir, 0.9).add(temp.set(0, 0.12, 0))
            hint.mesh.lookAt(head)
            if (state.step === 'surface') {
                // the surface either ray is on, shown as it was detected
                const hit = this.rays?.get('right')?.hit ?? this.rays?.get('left')?.hit
                shadow.show(hit?.surface ?? null)
                return
            }
            const left = this.rays?.get('left')
            const right = this.rays?.get('right')
            const both = left?.pinching && right?.pinching
            if (both) {
                state.marking = areaBetween(left.pinch, right.pinch, state.surface, head)
                state.held += 1
                area.show(state.marking, state.marking && state.marking.width >= 0.35)
                return
            }
            if (!state.marking) return
            // let go of both: the area is set, if it was held a moment and is wide enough
            const marked = state.marking
            state.marking = null
            if (state.held < 10 || marked.width < 0.35) {
                state.held = 0
                area.show(null)
                return say('warn', 'Muy angosto: separa más las manos (al menos 35 cm) y suelta.')
            }
            end()
            this.sound.play('tap')
            const yaw = Math.atan2(marked.n.x, marked.n.z)
            this.#place(null, yaw, head.clone(), dir.clone(), marked)
        })
        session.addEventListener('select', onSelect)
    }

    /** The horizontal surfaces the headset knows of, at any height a table may have, as rectangles for the rays. */
    #surfaceRects() {
        const floor = this.#floorY()
        const out = []
        for (const entity of this.queries.planes.entities) {
            const plane = entity.getValue(XRPlane, '_plane')
            const object = entity.object3D
            if (!plane?.polygon || !object || plane.orientation !== 'horizontal') continue
            if (/floor|ceiling/i.test(plane.semanticLabel ?? '')) continue
            object.updateMatrixWorld(true)
            const pts = [...plane.polygon]
            const xs = pts.map((p) => p.x)
            const zs = pts.map((p) => p.z)
            const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
            const m = object.matrixWorld
            const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2).applyMatrix4(m)
            const h = center.y - floor
            if (h < 0.3 || h > 1.3) continue
            const ax = new THREE.Vector3(1, 0, 0).transformDirection(m).setY(0).normalize()
            const az = new THREE.Vector3(0, 0, 1).transformDirection(m).setY(0).normalize()
            out.push({ center, ax, az, ex: x1 - x0, ez: z1 - z0, top: center.y })
        }
        // nothing scanned: a surface at a usual table's height around the person, so it can still be done
        if (!out.length && !this.placed) {
            const cam = this.world.camera.getWorldPosition(new THREE.Vector3())
            out.push({ center: new THREE.Vector3(cam.x, floor + 0.74, cam.z), ax: new THREE.Vector3(1, 0, 0), az: new THREE.Vector3(0, 0, 1), ex: 4, ez: 4, top: floor + 0.74, virtual: true })
        }
        return out
    }

    /**
     * The collection point, small enough to see all of it, around the real table in front: a table
     * of its exact size and height covers it, and everything else is scaled to match. Without a
     * table the headset knows of, the same at a usual table's size, where the room has space.
     */
    #place(at, yaw, head = null, gaze = null, area = null) {
        this.placed = true
        const floorY = head ? this.#floorY() : 0
        // the person's eyes over the floor, for what has to be at their height
        this.eyeHeight = head ? THREE.MathUtils.clamp(head.y - floorY, 1.1, 2.0) : 1.6
        const real = area ?? (head ? this.#realTable(head, gaze) : null)
        const width = real?.width ?? 1.2
        const depth = real?.depth ?? 0.6
        const top = (real?.top ?? floorY + 0.75) - floorY
        // the whole point at this scale: the table holds the mats, the button and the cartons
        const S = THREE.MathUtils.clamp(width / 2.3, 0.4, 0.65)
        this.scale = S
        const table = { width: width / S, depth: depth / S, top: top / S }
        const obstacles = head ? this.#roomObstacles() : []
        const scaled = (r) => ({ minX: r.minX * S, maxX: r.maxX * S, minZ: r.minZ * S, maxZ: r.maxZ * S })
        const build = (side) => {
            const rootObject = new THREE.Group()
            rootObject.scale.setScalar(S)
            return { rootObject, station: buildStation(rootObject, this.loader, this.stand, { table, shelfSide: side, worldScale: S, eyeHeight: this.eyeHeight }) }
        }
        let { rootObject, station } = build(1)
        if (real) {
            // the tent's front away from the person, its table's near edge on the real one's
            yaw = Math.atan2(real.n.x, real.n.z)
            const near = toWorld({ x: WORKER.x * S, z: station.deskNear * S }, { x: 0, z: 0 }, yaw)
            at = new THREE.Vector3(real.near.x - near.x, floorY, real.near.z - near.z)
            // the shelf where it can be reached: to the right, or to the left if something is there
            const shelf = scaled(station.solids[1])
            if (obstacles.length && clearance(obstacles, [shelf], at, yaw) < 0.15) {
                ;({ rootObject, station } = build(-1))
                this.shelfMoved = true
            }
        } else if (head) {
            const footprints = [...station.solids, { minX: WORKER.x - 0.45, maxX: WORKER.x + 0.45, minZ: WORKER.z - 0.3, maxZ: WORKER.z + 0.6 }].map(scaled)
            const fit = fitTent({ head: { x: head.x, z: head.z }, gazeYaw: yaw, worker: { x: WORKER.x * S, z: WORKER.z * S }, footprints, obstacles })
            this.fit = { ...fit, obstacles: obstacles.length }
            at = new THREE.Vector3(fit.at.x, floorY, fit.at.z)
            yaw = fit.yaw
        }
        this.station = station
        this.realTable = real
        rootObject.position.copy(at)
        rootObject.rotation.y = yaw
        rootObject.updateMatrixWorld(true)
        this.root = this.world.createTransformEntity(rootObject)
        this.rootObject = rootObject
        if (head && !real) this.pendingSay = 'No encontré tu mesa en el escaneo: puse una virtual donde hay espacio. Escanea el cuarto en las gafas para que use la tuya.'
        else if (this.shelfMoved) this.pendingSay = 'El estante quedó a tu izquierda: a la derecha hay algo con lo que chocarías.'
        else if (this.fit && this.fit.moved > 0.05) this.pendingSay = 'Moví un poco el punto para que no choques con paredes ni muebles.'
        if (this.world.session) {
            try {
                this.root.addComponent(XRAnchor)
            } catch (err) {
                console.warn('[ar] no anchor for this device', err)
            }
        }
        this.#boards()
        for (const zone of this.station.zones) this.#stockCrate(zone)
        this.#refreshShelf()
        // all that is in the point now: the tent, the shelf, the signs. What comes later is its own entity
        this.#occlude(this.root)
        surfaceBias(this.rootObject)
        this.#intro()
    }

    /**
     * What the headset scanned of the room, as points on the floor that a body would bump into:
     * walls, doors and windows, furniture, and the room's own mesh between the ankles and the head.
     */
    #roomObstacles() {
        const out = []
        const low = 0.1
        const high = 1.9
        const floor = this.#floorY()
        const body = (y) => y - floor > low && y - floor < high
        const v = new THREE.Vector3()
        const edge = (a, b) => {
            const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.1))
            for (let i = 0; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n })
        }
        for (const entity of this.queries.planes.entities) {
            const plane = entity.getValue(XRPlane, '_plane')
            const object = entity.object3D
            if (!plane?.polygon || !object) continue
            object.updateMatrixWorld(true)
            const label = plane.semanticLabel ?? ''
            if (/floor|ceiling/i.test(label)) continue
            const pts = [...plane.polygon].map((p) => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(object.matrixWorld))
            const ys = pts.map((p) => p.y)
            const reaches = plane.orientation === 'vertical' ? Math.min(...ys) - floor < high && Math.max(...ys) - floor > low : body(ys[0])
            if (!reaches) continue
            pts.forEach((a, i) => edge(a, pts[(i + 1) % pts.length]))
        }
        for (const entity of this.queries.meshes.entities) {
            const object = entity.object3D
            if (!object) continue
            object.updateMatrixWorld(true)
            const label = entity.getValue(XRMesh, 'semanticLabel') ?? ''
            if (/floor|ceiling/i.test(label)) continue
            if (!entity.getValue(XRMesh, 'isBounded3D')) {
                const position = object.geometry?.getAttribute('position')
                if (!position) continue
                const stride = Math.max(1, Math.ceil(position.count / 20000))
                for (let i = 0; i < position.count; i += stride) {
                    v.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld)
                    if (body(v.y)) out.push({ x: v.x, z: v.z })
                }
                continue
            }
            const min = entity.getVectorView(XRMesh, 'min')
            const max = entity.getVectorView(XRMesh, 'max')
            const lowY = v.set(0, min[1], 0).applyMatrix4(object.matrixWorld).y
            const highY = v.set(0, max[1], 0).applyMatrix4(object.matrixWorld).y
            if (Math.max(lowY, highY) - floor < low || Math.min(lowY, highY) - floor > high) continue
            const c = [[min[0], min[2]], [max[0], min[2]], [max[0], max[2]], [min[0], max[2]]].map(([x, z]) => new THREE.Vector3(x, min[1], z).applyMatrix4(object.matrixWorld))
            c.forEach((a, i) => edge(a, c[(i + 1) % 4]))
        }
        return out
    }

    /**
     * The real table in front: the horizontal surface at a table's height that the gaze meets, or
     * the nearest one ahead. Its size, height, the middle of its near edge and the way to the person.
     */
    #realTable(head, gaze) {
        const floor = this.#floorY()
        const flat = new THREE.Vector3(gaze.x, 0, gaze.z).normalize()
        let best = null
        for (const entity of this.queries.planes.entities) {
            const plane = entity.getValue(XRPlane, '_plane')
            const object = entity.object3D
            if (!plane?.polygon || !object || plane.orientation !== 'horizontal') continue
            if (/floor|ceiling/i.test(plane.semanticLabel ?? '')) continue
            object.updateMatrixWorld(true)
            const pts = [...plane.polygon]
            const xs = pts.map((p) => p.x)
            const zs = pts.map((p) => p.z)
            const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
            const m = object.matrixWorld
            const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2).applyMatrix4(m)
            const h = center.y - floor
            if (h < 0.45 || h > 1.15) continue
            const ax = new THREE.Vector3(1, 0, 0).transformDirection(m).setY(0).normalize()
            const az = new THREE.Vector3(0, 0, 1).transformDirection(m).setY(0).normalize()
            const ex = x1 - x0
            const ez = z1 - z0
            if (Math.max(ex, ez) < 0.4 || Math.min(ex, ez) < 0.25) continue
            const to = center.clone().sub(head).setY(0)
            if (to.dot(flat) < 0 || to.length() > 2.2) continue
            // where the gaze meets its height, against how far that is from its middle
            let score = to.length()
            if (gaze.y < -0.05) {
                const t = (center.y - head.y) / gaze.y
                const hit = head.clone().addScaledVector(gaze, t)
                const d = hit.clone().sub(center)
                if (Math.abs(d.dot(ax)) <= ex / 2 && Math.abs(d.dot(az)) <= ez / 2) score -= 10
            }
            if (best && best.score <= score) continue
            const long = ex >= ez ? ax : az
            const width = Math.max(ex, ez)
            const depth = Math.min(ex, ez)
            const n = new THREE.Vector3(-long.z, 0, long.x)
            if (n.dot(head.clone().sub(center)) < 0) n.negate()
            best = { score, width, depth, top: center.y, n, near: center.clone().addScaledVector(n, depth / 2) }
        }
        return best
    }

    /** The floor's height, from the scan if it says so; 0 otherwise (local-floor). */
    #floorY() {
        for (const entity of this.queries.planes.entities) {
            const plane = entity.getValue(XRPlane, '_plane')
            if (/floor/i.test(plane?.semanticLabel ?? '') && entity.object3D) return entity.object3D.getWorldPosition(new THREE.Vector3()).y
        }
        return 0
    }

    /* ---------------- the room's signs ---------------- */

    #boards() {
        const root = this.rootObject
        const top = this.station.deskTop
        const far = this.station.deskFar + 0.22
        const x = WORKER.x
        // the signs are as large in the room as they were drawn (a little more), whatever the
        // point's scale: shrunk with it, they could not be read. Laid out in metres, over the table.
        const S = this.scale
        const m = (metres) => metres / S
        const sign = (panel, k) => panel.mesh.scale.setScalar(k / S)
        // leaving the middle free for whoever is at the counter
        this.message = messageBoard()
        sign(this.message, SIGN_SCALE)
        this.message.mesh.position.set(x - m(0.42), 0, far)
        this.message.mesh.rotation.y = 0.26
        hangFromRoof(this.message, top + m(0.68), top + m(0.74))
        root.add(this.message.mesh)
        this.big = bigBoard()
        sign(this.big, SIGN_SCALE)
        this.big.mesh.position.set(x, 0, far)
        this.big.mesh.visible = false
        hangFromRoof(this.big, top + m(0.8), top + m(0.86))
        root.add(this.big.mesh)
        // right at the person's left, with the truck behind it. It looks at the person.
        this.receive = receivePanel()
        sign(this.receive, 1)
        this.#thing(this.receive.mesh, { kind: 'receive' }, { grab: false })
        // on the truck's side, which is always the side opposite the shelf
        const t = this.#truckSide()
        // at the height of the person's eyes, whatever the point's scale
        this.receive.mesh.position.set(x + t * m(RECEIVE_REACH), (this.eyeHeight - RECEIVE_BELOW_EYES) / this.scale, WORKER.z)
        this.receive.mesh.rotation.y = (-t * Math.PI) / 2
        this.#setActive(this.receive.mesh, false)
        this.truck = buildTruck()
        // much smaller than the rest: it is only there to say the cartons came
        this.truck.object.scale.setScalar(0.45)
        this.truck.object.visible = false
        root.add(this.truck.object)
        // the buttons: the one that hands over, between the mats; the list, to one side
        this.action = buttonPanel('Empezar el turno', { width: 0.32, height: 0.095, halo: '#FFD34D' })
        sign(this.action, BUTTON_SCALE)
        this.#thing(this.action.mesh, { kind: 'action' }, { grab: false })
        this.action.mesh.position.set(x, top + 0.05, this.station.matZ + 0.09)
        this.action.mesh.rotation.x = -0.9
        this.#setActive(this.action.mesh, false)
        // up in the middle, between the signs, while there is someone in line to bring forward
        this.nextButton = nextPanel()
        sign(this.nextButton, SIGN_SCALE)
        this.#thing(this.nextButton.mesh, { kind: 'next' }, { grab: false })
        this.nextButton.mesh.position.set(x + m(0.42), 0, far)
        this.nextButton.mesh.rotation.y = -0.26
        hangFromRoof(this.nextButton, top + m(0.68), top + m(0.74))
        this.#setActive(this.nextButton.mesh, false)
        this.glow = new Glow(this.world.scene)
        this.bubble = speechBubble()
        this.bubble.mesh.visible = false
        this.bubble.mesh.pointerEvents = 'none'
        sign(this.bubble, 0.9)
        root.add(this.bubble.mesh)
        this.complaintIn = 0
        this.complaintTurn = 0
        // something to shine on where a carton goes: the mat itself cannot be pressed or carried
        this.matSpot = new THREE.Object3D()
        this.matSpot.position.copy(this.station.mat)
        root.add(this.matSpot)
        this.listButton = buttonPanel('Por hacer', { width: 0.22, height: 0.085, fill: '#011E41' })
        sign(this.listButton, BUTTON_SCALE)
        this.#thing(this.listButton.mesh, { kind: 'list' }, { grab: false })
        this.listButton.mesh.position.set(x, top + 0.05, this.station.matZ - 0.1)
        this.listButton.mesh.rotation.x = -0.9
        // called up with a button; the world's child rather than the tent's, it goes with the person
        this.list = taskList()
        this.list.mesh.visible = false
        this.listEntity = this.#occlude(this.world.createTransformEntity(this.list.mesh))
    }

    /**
     * There is one board: what matters must get read before something else takes its place.
     * A warning answers what the person just did, so it never waits; the rest take their turn.
     */
    #say(kind, text) {
        // while learning, the guide does the talking: only what corrects the person gets through
        if (this.guide && this.day.calm && kind !== 'warn' && kind !== 'alert') return
        if (kind !== 'warn' && kind !== 'alert' && this.elapsed < this.sayUntil) {
            this.sayQueue = [...this.sayQueue.slice(-1), { kind, text }]
            return
        }
        this.#show(kind, text)
    }

    #show(kind, text) {
        this.shownText = text
        this.message.refresh({ kind, text })
        const hold = kind === 'alert' ? ALERT_HOLD : kind === 'warn' ? WARN_HOLD : MESSAGE_HOLD
        this.sayUntil = Math.max(this.sayUntil, this.elapsed + hold)
    }

    #nextMessage() {
        if (!this.sayQueue.length || this.elapsed < this.sayUntil) return
        const { kind, text } = this.sayQueue.shift()
        this.#show(kind, text)
    }

    /** The one button says what can be handed over, or disappears. */
    #refreshAction() {
        const { day } = this
        const choose = () => {
            if (this.pendingStart) return ['start', 'Empezar el turno']
            if (this.ending) return ['again', 'Hacer otro turno']
            // the guided order is finished once: half of it is for when there is no time left
            if (this.guide && day.calm && Object.keys(day.missing).length) return [null, '']
            if (day.canDeliver) return ['deliver', Object.keys(day.missing).length ? 'Entregar lo que hay' : 'Entregar el pedido']
            return [null, '']
        }
        const [action, label] = choose()
        this.pendingAction = action
        this.#setActive(this.action.mesh, !!action)
        if (action) this.action.refresh(label)
        const next = this.running ? day.nextInLine : null
        this.#setActive(this.nextButton.mesh, !!next)
        if (next) this.nextButton.refresh({ family: next.family, urgent: next.urgent })
    }

    /** Hidden is also out of reach: a ray must not press, or stop at, what cannot be seen. */
    #setActive(object, on) {
        object.visible = on
        object.pointerEvents = on ? 'auto' : 'none'
    }

    /** The truck at the door and whether what it brings fits, or how long until the next. */
    #refreshReceive() {
        const { day } = this
        const count = day.incoming.length
        const mode = !count ? 'waiting' : this.truckParked ? 'ready' : 'coming'
        // with time standing still, a countdown to the next truck would only look broken
        this.receive.mesh.visible = this.running && !(day.calm && !count)
        // only with the truck there is anything to press
        this.receive.mesh.pointerEvents = this.running && mode === 'ready' ? 'auto' : 'none'
        this.receive.refresh({ mode, count, room: day.room, seconds: day.truckIn, gap: TRUCK_GAP })
    }

    /** Along the side of the tent, with its wheels turning. */
    #driveTruck(fromZ, toZ, seconds, ease, then) {
        const { object, wheels, wheelRadius } = this.truck
        object.visible = true
        object.position.set(this.#truckX(), 0, fromZ)
        gsap.to(object.position, { z: toZ, duration: seconds, ease, onComplete: then })
        for (const wheel of wheels) gsap.to(wheel.rotation, { x: `+=${(toZ - fromZ) / wheelRadius}`, duration: seconds, ease })
        this.sound.play('truck', this.rootObject.localToWorld(new THREE.Vector3(this.#truckX(), 1, TRUCK_PARK_Z)))
    }

    /** A truck comes in and stops by the panel. It stays until all it brought has been received. */
    #truckComes() {
        this.truckParked = false
        this.truck.setCargo(this.day.incoming.length)
        this.#driveTruck(TRUCK_FROM_Z, TRUCK_PARK_Z, TRUCK_IN_SECONDS, 'power2.out', () => {
            // the shift ended while it was on its way: it turns out it has nowhere to stop
            this.truckParked = true
            if (!this.running) return this.#truckLeaves()
            this.sound.play('radio')
            this.#say('radio', `Llegó el camión. Recibe las donaciones en el panel de tu ${this.#truckSide() < 0 ? 'izquierda' : 'derecha'}.`)
            this.#refreshReceive()
        })
    }

    #truckLeaves() {
        this.truckParked = false
        this.#driveTruck(TRUCK_PARK_Z, TRUCK_TO_Z, TRUCK_OUT_SECONDS, 'power2.in', () => {
            this.truck.object.visible = false
        })
    }

    /** Pressable things answer the pointer; what is carried swells a little under the hand. */
    #hover(entity, on) {
        const t = this.things.get(entity)
        if (this.view) {
            const active = [...this.queries.hovered.entities].some((e) => {
                const i = this.things.get(e)
                return i && (BUTTONS.has(i.kind) || i.kind === 'item' || i.kind === 'stock' || i.kind === 'box')
            })
            this.view.canvas.style.cursor = active ? 'pointer' : 'grab'
        }
        if (!t || t.urgentPulse || t.moving) return
        if (!(BUTTONS.has(t.kind) || t.kind === 'item' || t.kind === 'stock' || (t.kind === 'box' && !this.#isCovered(t)))) return
        t.baseScale ??= t.object.scale.x
        const k = t.baseScale * (on ? (BUTTONS.has(t.kind) ? 1.07 : 1.05) : 1)
        gsap.to(t.object.scale, { x: k, y: k, z: k, duration: 0.12, ease: 'power2.out', overwrite: true })
    }

    /** A pressed button gives a little, so the press is felt. */
    #giveWay(t) {
        if (t.urgentPulse) return
        const base = t.baseScale ?? t.object.scale.x
        gsap.to(t.object.scale, { x: base, y: base, z: base, duration: 0.22, ease: 'back.out(2)', overwrite: true })
    }

    /* ---------------- the list of what to do ---------------- */

    /** Shows or hides it, wherever the person is looking. */
    toggleList(on = !this.list.mesh.visible) {
        if (!this.placed || !this.running) return
        this.sound.play('tap')
        this.list.mesh.visible = on
        if (on) {
            this.listFresh = true
            this.#refreshList()
        }
    }

    #refreshList() {
        const { day } = this
        const closeHint = this.world.session ? 'Con A o X la cierras' : 'Con T la cierras'
        this.list.refresh({ rows: day.todo, progress: day.progress, hint: closeHint })
    }

    /** A little down and in front of the eyes, catching up gently, so it never swings with the head. */
    #placeList(dt) {
        const { mesh } = this.list
        if (!mesh.visible) return
        const cam = this.world.camera
        cam.getWorldPosition(temp)
        cam.getWorldDirection(temp2)
        const head = temp.clone()
        const target = temp.addScaledVector(temp2, 0.62)
        target.y -= 0.06
        if (this.listFresh) {
            mesh.position.copy(target)
            this.listFresh = false
        } else mesh.position.lerp(target, 1 - Math.exp(-dt * 7))
        mesh.lookAt(head)
    }

    #pollButtons() {
        const pads = this.input?.xr?.gamepads
        if (!pads) return
        if (pads.right?.getButtonDown('a-button') || pads.left?.getButtonDown('x-button')) this.toggleList()
    }

    /* ---------------- opening ---------------- */

    #intro() {
        if (this.pendingSay) this.#say('info', this.pendingSay)
        this.pendingSay = null
        this.pendingStart = true
        const button = this.world.session ? 'el botón A o X del control' : 'la tecla T'
        this.big.refresh({
            kicker: 'Un turno en el punto de acopio',
            title: 'Hoy este punto es tuyo',
            lines: [
                { text: 'Eres responsable de este centro de acopio en Cali. Siempre habrá cajas por abrir y gente por atender.' },
                { text: `Tú decides qué haces primero. Con ${button} ves lo que falta.` },
            ],
            note: 'No alcanzará para todo.',
        })
        this.big.mesh.visible = true
        this.message.mesh.visible = false
        this.#refreshAction()
    }

    /** The panel at the left: as much as fits on the counter comes in. */
    #pressReceive() {
        if (!this.day.room) {
            this.sound.play('wrong')
            this.haptics.play('wrong')
            return this.#say('warn', 'No hay espacio en el mostrador: abre alguna caja primero. El camión te espera.')
        }
        this.day.receive()
    }

    #begin() {
        // only here, not on loading the page: opening it must not change the sheet
        for (const [id, qty] of Object.entries(SHIFT_STOCK)) this.store.set(id, qty)
        this.pendingStart = false
        this.running = true
        this.big.mesh.visible = false
        this.message.mesh.visible = true
        this.guide = this.day.calm ? { phase: null } : null
        this.#say('radio', 'Viene un camión con donaciones, por tu izquierda.')
        this.day.start()
        this.#refreshReceive()
        this.#refreshShelf()
        this.#refreshAction()
    }

    /** Another shift, right here: no one has to leave the headset and raise the tent again. */
    #newShift() {
        for (const f of this.families.values()) this.#removeCard(f)
        // what was still moving arrives, so that it cleans up after itself
        for (const animation of gsap.globalTimeline.getChildren(false, true, true)) animation.progress(1)
        const { object, wheels } = this.truck
        gsap.killTweensOf(object.position)
        for (const wheel of wheels) gsap.killTweensOf(wheel.rotation)
        object.visible = false
        this.truckParked = false
        for (const [entity, t] of this.things) {
            if (t.kind !== 'box' && t.kind !== 'item') continue
            this.things.delete(entity)
            entity.destroy()
        }
        for (const person of this.crowd) person.root.removeFromParent()
        this.crowd.clear()
        this.families.clear()
        this.kit?.entity.destroy()
        this.kit = null
        this.onMat = null
        this.familyAtCounter = null
        this.#hushed()
        this.holding = null
        this.marked = null
        this.sayQueue = []
        this.sayUntil = 0
        this.ending = false
        this.day = new Workday({ store: this.store })
        this.day.on((event, detail) => this.#onDay(event, detail))
        this.#begin()
    }

    /* ---------------- the first time ---------------- */

    /** What shines and what the board says, all read from how things stand: any order of doing them works. */
    #guideStep() {
        const { day } = this
        const hands = this.world.session
        const [heldEntity] = this.queries.held.entities
        const held = this.holding?.t ?? this.things.get(heldEntity)
        const things = [...this.things.values()]

        if (day.calm && !day.boxes.length) {
            if (!this.truckParked) return { phase: 'truck', targets: [], text: 'Viene un camión con donaciones, por tu izquierda.' }
            return { phase: 'receive', targets: [this.receive.mesh], text: `Llegó el camión. Presiona el panel que brilla, a tu ${this.#truckSide() < 0 ? 'izquierda' : 'derecha'}, para recibir las donaciones.` }
        }
        if (day.calm && !day.current) {
            const box = things.find((t) => t.kind === 'box' && t.box === day.boxes[0])
            if (box?.onMat) return { phase: 'open', targets: [box.object], text: hands ? 'Presiona la caja para quitarle la cinta.' : 'Haz clic en la caja para quitarle la cinta.' }
            const targets = held === box ? [this.matSpot] : box && !box.moving ? [box.object] : []
            return { phase: 'box', targets, text: hands ? 'Lleva la caja que brilla a la mesa azul: agárrala o mantén el gatillo sobre ella.' : 'Mantén presionada la caja que brilla y llévala a la mesa azul.' }
        }
        if (day.calm) {
            const missing = Object.keys(day.missing)
            if (!missing.length) return { phase: 'deliver', targets: [this.action.mesh], text: 'Pedido completo. Presiona «Entregar el pedido», en la mesa.' }
            const loose = (id) => things.filter((t) => t.kind === 'item' && t.itemId === id)
            const onShelf = missing.filter((id) => !loose(id).length)
            const wants = list(Object.entries(day.missing).map(([id, n]) => `${n} de ${SUPPLIES[id].label.toLowerCase()}`))
            let targets = []
            if (held) {
                if (missing.includes(held.itemId)) targets = [this.kit.object]
            } else {
                targets = missing.flatMap((id) => {
                    const here = loose(id)
                    if (here.length) return here.map((t) => t.object)
                    const zone = this.station.zones.find((z) => z.stock.has(id))
                    return [this.things.get(zone.stock.get(id)).object]
                })
            }
            if (onShelf.length === missing.length) return { phase: 'shelf', targets, text: `Falta ${wants}: brilla en el estante, a tu ${this.#truckSide() < 0 ? 'derecha' : 'izquierda'}. Llévalo a su caja, en «Arma el pedido».` }
            const where = onShelf.length ? `en la caja abierta y en el estante, a tu ${this.#truckSide() < 0 ? 'derecha' : 'izquierda'}` : 'en la caja abierta'
            return { phase: 'order', targets, text: `${day.current.family} necesita ${wants}. Lo que brilla está ${where}: llévalo a su caja, en «Arma el pedido».` }
        }
        // handed over, time runs again: only what was left in the carton still gets a hand
        const left = things.filter((t) => t.kind === 'item')
        if (!left.length || day.current) return null
        let targets = left.map((t) => t.object)
        if (held) targets = held.kind === 'item' ? [this.station.zones.find((z) => z.categoryId === SUPPLIES[held.itemId].category).crate] : []
        return { phase: 'sort', targets, text: `Lo que quedó en la caja va a su lugar en el estante, a tu ${this.#truckSide() < 0 ? 'derecha' : 'izquierda'}. Desde ahora el tiempo corre.` }
    }

    #followGuide() {
        if (!this.guide) return
        const step = this.#guideStep()
        if (!step) return this.#endGuide(true)
        this.glow.show(step.targets)
        this.glow.update(this.elapsed)
        if (step.phase !== this.guide.phase) {
            this.guide.phase = step.phase
            if (this.day.calm) {
                this.sayUntil = 0
                this.#show('info', step.text)
            } else this.#say('info', step.text)
        } else if (this.day.calm && step.text !== this.shownText && this.elapsed >= this.sayUntil) {
            // back to it, once whatever came in between has been read
            this.#show('info', step.text)
        }
    }

    #endGuide(finished = false) {
        if (!this.guide) return
        this.guide = null
        this.glow.show([])
        if (finished && this.running) this.#say('done', 'Ya conoces el trabajo. Llegarán más camiones y más gente: tú decides qué haces primero.')
    }

    /* ---------------- objects ---------------- */

    /**
     * Hidden where something real is in front of it, the person's hands above all: the headset's
     * depth decides. What lies right on a real surface is left out (see noOcclusion).
     */
    #occlude(entity) {
        if (!entity || entity.hasComponent?.(DepthOccludable)) return entity
        try {
            entity.addComponent(DepthOccludable, { mode: OcclusionShadersMode.SoftOcclusion })
            // what lies on the table and was added later (the mats' cartons do not, but say so if they did)
            if (entity.object3D) surfaceBias(entity.object3D)
        } catch (err) {
            console.warn('[ar2] no depth occlusion for', entity.object3D?.name, err)
        }
        return entity
    }

    /** An object the person works with: pressable, and grabbable in the headset unless told otherwise. */
    #thing(object, info, { grab = true, parent = null } = {}) {
        const entity = this.world.createTransformEntity(object, { parent: parent ?? this.root })
        entity.addComponent(Workable)
        entity.addComponent(RayInteractable)
        this.#occlude(entity)
        if (grab) this.#makeGrabbable(entity)
        this.things.set(entity, info)
        info.object = object
        return entity
    }

    /**
     * From here on it is taken by hand. There is no way back: the grab system keeps its handle
     * on the object even without the component, and that handle keeps the rays away from it.
     */
    #makeGrabbable(entity) {
        if (!this.world.session || entity.hasComponent(OneHandGrabbable)) return
        entity.addComponent(OneHandGrabbable, { rotate: true, translate: true })
        // not only with a hand up close: holding the trigger on it with a ray carries it too
        entity.object3D.pointerEventsType = 'all'
    }

    #isCovered(t) {
        return [...this.things.values()].some((o) => o !== t && o.kind === 'box' && !o.onMat && o.home.x === t.home.x && o.home.y > t.home.y)
    }

    /** Of the pile, only what has nothing on top can be lifted. */
    #offerTopBoxes() {
        for (const [entity, t] of this.things) if (t.kind === 'box' && !t.onMat && !this.#isCovered(t)) this.#makeGrabbable(entity)
    }

    #worldOf(object) {
        return object.getWorldPosition(new THREE.Vector3())
    }

    /** A crate on the shelf, with one of each of its supplies showing while there is any. */
    #stockCrate(zone) {
        const shelfEntity = (this.shelfEntity ??= this.world.createTransformEntity(this.station.shelf, { parent: this.root }))
        // only holds things: nothing to press, and no wall to stop a ray on its way to what is inside
        zone.entity = this.world.createTransformEntity(zone.crate, { parent: shelfEntity })
        zone.stock = new Map()
        for (const { itemId, fit, position } of crateLayout(this.supplies, zone.categoryId)) {
            const object = supplyObject(this.loader, this.supplies.get(itemId), itemId, fit)
            object.position.copy(position)
            // a sample stays in the crate; taking it means taking one of many
            const entity = this.#thing(object, { kind: 'stock', itemId, zone, home: position.clone(), fit }, { parent: zone.entity })
            zone.stock.set(itemId, entity)
        }
    }

    /** The counts on the crates, and what can physically be seen in them. */
    #refreshShelf() {
        for (const zone of this.station.zones) {
            const rows = [...zone.stock.keys()].map((id) => ({ label: SHELF_NAME[id] ?? SUPPLIES[id].label, count: this.day.available(id) }))
            zone.label.refresh(rows)
            for (const [id, entity] of zone.stock) {
                const t = this.things.get(entity)
                if (t !== this.holding?.t) this.#setActive(t.object, this.day.available(id) > 0)
            }
        }
    }

    /**
     * From the truck to the free places of the counter's left end, the lower ones first, one
     * after another. When it has given all it brought, the truck goes.
     */
    #dropBoxes(boxes) {
        const taken = [...this.things.values()].filter((t) => t.kind === 'box' && !t.onMat).map((t) => t.home)
        const free = this.station.intake.filter((spot) => !taken.some((h) => h.distanceTo(spot) < 0.01))
        const from = this.truck.tailgate.clone().add(this.truck.object.position)
        const stillOnTruck = () => this.day.incoming.length
        let flying = boxes.length
        boxes.forEach((b, i) => {
            const spot = free[i]
            if (!spot) return
            const object = cardboardBox()
            object.position.copy(from)
            object.visible = false
            object.name = b.id
            const t = { kind: 'box', box: b, home: spot.clone(), moving: true }
            this.#thing(object, t, { grab: false })
            const path = { k: 0 }
            gsap.to(path, {
                k: 1,
                duration: 0.75,
                delay: 0.15 + i * 0.55,
                ease: 'sine.inOut',
                onStart: () => {
                    object.visible = true
                    this.truck.setCargo(stillOnTruck() + boxes.length - i - 1)
                },
                onUpdate: () => {
                    object.position.lerpVectors(from, spot, path.k)
                    object.position.y += Math.sin(path.k * Math.PI) * 0.45
                },
                onComplete: () => {
                    t.moving = false
                    this.sound.play('box', this.#worldOf(object))
                    this.#offerTopBoxes()
                    if (--flying === 0 && !stillOnTruck() && this.truckParked) gsap.delayedCall(0.5, () => this.#truckLeaves())
                },
            })
        })
    }

    /* ---------------- pressing ---------------- */

    /** A button gives way under the finger. */
    #pressIn(entity) {
        const t = this.things.get(entity)
        if (!t || !BUTTONS.has(t.kind) || t.urgentPulse) return
        this.haptics.play('tap')
        t.baseScale ??= t.object.scale.x
        const k = t.baseScale * 0.93
        gsap.to(t.object.scale, { x: k, y: k, z: k, duration: 0.08, overwrite: true })
    }

    /** On a computer, a click only counts if it did not turn out to be a drag. */
    #press(entity) {
        if (this.view?.moved) return
        this.#act(entity)
    }

    /** What is pressed rather than carried. What is grabbable is pressed by the very gesture that takes it. */
    #act(entity) {
        const t = this.things.get(entity)
        if (!t || t.moving || entity.hasComponent(OneHandGrabbable)) return
        if (BUTTONS.has(t.kind)) this.#giveWay(t)
        if (t.kind === 'action') return this.#pressAction()
        if (t.kind === 'list') return this.toggleList()
        if (t.kind === 'receive') return this.#pressReceive()
        if (t.kind === 'next') return this.#pressNext()
        if (t.kind === 'box' && t.onMat) return this.#openBox(t)
        if (t.kind === 'box' && this.#isCovered(t)) {
            this.haptics.play('wrong')
            return this.#say('warn', 'Primero toma la caja de arriba.')
        }
    }

    /** Whoever is next comes up now. If someone had things in their kit, that is worth saying. */
    #pressNext() {
        const previous = this.day.current
        const hadItems = this.day.canDeliver
        if (!this.day.callNext()) return
        this.sound.play('tap')
        if (hadItems) this.#say('warn', `${previous.family} volvió a la fila, y lo de su caja quedó en los estantes.`)
    }

    #pressAction() {
        const pending = this.pendingAction
        if (!pending) return
        this.sound.play('tap')
        if (pending === 'start') return this.#begin()
        if (pending === 'again') return this.#newShift()
        if (pending === 'deliver') this.day.deliver()
        this.#refreshAction()
    }

    /* ---------------- carrying, on a computer ---------------- */

    #rayAt(ndc) {
        this.raycaster.setFromCamera(ndc, this.world.camera)
        return this.raycaster
    }

    #entityOf(hit) {
        for (let o = hit.object; o; o = o.parent) {
            for (const [entity, t] of this.things) if (t.object === o) return { entity, t }
        }
        return null
    }

    /** Pressed on something that can be carried? Then it is in hand until let go. */
    #pick(ndc) {
        if (!this.running) return false
        const carriable = [...this.things.values()].filter((t) => {
            if (!t.object.visible || t.moving) return false
            if (t.kind === 'box') return !t.onMat
            return t.kind === 'item' || t.kind === 'stock'
        })
        const ray = this.#rayAt(ndc)
        const hits = ray.intersectObjects(carriable.map((t) => t.object), true)
        const found = hits.length ? this.#entityOf(hits[0]) : null
        if (!found) return false
        // a button or a closed carton in front is what was pressed, not what is behind it
        const pressable = [...this.things.values()].filter((t) => t.object.visible && (BUTTONS.has(t.kind) || (t.kind === 'box' && t.onMat && t.box.state === 'received')))
        const before = ray.intersectObjects(pressable.map((t) => t.object), true)[0]
        if (before && before.distance < hits[0].distance) return false
        const { t, entity } = found
        if (t.kind === 'box' && this.#isCovered(t)) {
            this.#say('warn', 'Primero toma la caja de arriba.')
            return false
        }
        gsap.killTweensOf(t.object.position)
        gsap.killTweensOf(t.object.rotation)
        this.holding = { entity, t, moved: false, start: t.object.position.clone() }
        this.#holdAt(ndc, true)
        return true
    }

    #holdAt(ndc, first = false) {
        if (!this.holding) return
        if (!first) this.holding.moved = true
        const { ray } = this.#rayAt(ndc)
        this.holdTarget.copy(ray.origin).addScaledVector(ray.direction, HOLD_DISTANCE)
        this.#markTarget(ndc)
    }

    /** It follows the pointer, a touch behind, so it has some weight. */
    #carry(dt) {
        if (!this.holding?.moved) return
        const { object } = this.holding.t
        const local = object.parent.worldToLocal(temp.copy(this.holdTarget))
        object.position.lerp(local, 1 - Math.exp(-dt * 22))
    }

    /** Where this one could be let go, if the pointer is over it. */
    #targetAt(ndc, t) {
        const raycaster = this.#rayAt(ndc)
        // how far the pointer is from a point, where under 1 counts as over it
        const away = (point) => {
            const p = point.clone().project(this.world.camera)
            return p.z < 1 ? Math.hypot(p.x - ndc.x, p.y - ndc.y) / DROP_NEAR : Infinity
        }
        return this.#targetFor(t, raycaster, away)
    }

    /** The same, along the ray of a controller or a hand. */
    #targetAlong(hand, t) {
        const space = this.input?.xr?.xrOrigin?.raySpaces?.[hand]
        if (!space) return null
        space.getWorldPosition(temp)
        this.raycaster.ray.origin.copy(temp)
        this.raycaster.ray.direction.set(0, 0, -1).transformDirection(space.matrixWorld)
        const { ray } = this.raycaster
        const away = (point) => (temp2.copy(point).sub(ray.origin).dot(ray.direction) > 0 ? ray.distanceToPoint(point) / RAY_NEAR : Infinity)
        return this.#targetFor(t, this.raycaster, away)
    }

    /** What a carried thing would land in: what the pointer is on; failing that, the nearest in reach of it. */
    #targetFor(t, raycaster, away) {
        const over = (object) => raycaster.intersectObject(object, true).length > 0
        const atKit = () => this.kit && (over(this.kit.object) || away(this.#worldOf(this.kit.object)) < 1)
        if (t.kind === 'item') {
            if (atKit()) return this.kit
            const { zones } = this.station
            const nearest = [...zones].sort((a, b) => away(this.#worldOf(a.crate)) - away(this.#worldOf(b.crate)))[0]
            return zones.find((z) => over(z.crate)) ?? (away(this.#worldOf(nearest.crate)) < 1 ? nearest : null)
        }
        if (t.kind === 'stock') return atKit() ? this.kit : null
        if (t.kind === 'box') {
            const m = this.rootObject.localToWorld(this.station.mat.clone())
            return away(m) < 1.6 ? this.station.mat : null
        }
        return null
    }

    /** With a ray, what it would land in swells too. */
    #markHeld() {
        if (!this.world.session) return
        const [entity] = this.queries.held.entities
        if (!entity) return this.marked && this.#mark(null)
        const t = this.things.get(entity)
        if (!t) return
        this.heldHand = this.world.getSystem(GrabSystem)?.getHolderHand(entity) ?? this.heldHand
        if (this.heldHand) this.#mark(this.#targetAlong(this.heldHand, t))
    }

    /** What it would land in swells a little, to say so. */
    #markTarget(ndc) {
        this.#mark(this.#targetAt(ndc, this.holding.t))
    }

    #mark(target) {
        const object = target?.crate ?? target?.object ?? null
        if (object === this.marked) return
        if (this.marked) gsap.to(this.marked.scale, { x: 1, y: 1, z: 1, duration: 0.14 })
        if (object) gsap.to(object.scale, { x: 1.05, y: 1.05, z: 1.05, duration: 0.14 })
        this.marked = object
    }

    #dropAt(ndc) {
        if (!this.holding) return
        const { entity, t, moved } = this.holding
        const target = moved ? this.#targetAt(ndc, t) : null
        this.holding = null
        if (this.marked) gsap.to(this.marked.scale, { x: 1, y: 1, z: 1, duration: 0.14 })
        this.marked = null
        if (!moved) {
            this.#goHome(t)
            const where = { box: 'la mesa azul', item: 'su caja del estante', stock: 'el pedido' }[t.kind]
            return this.#show('info', `Mantén presionado y arrástralo hasta ${where}.`)
        }
        if (t.kind === 'box') {
            if (target && !this.#matBusy()) return this.#moveToMat(entity, t)
            if (target) this.#say('warn', this.#matBusyText())
            return this.#goHome(t)
        }
        if (t.kind === 'item') {
            if (target && target === this.kit) return this.#packFromBox(entity, t)
            if (target) return this.#stow(entity, t, target)
            return this.#goHome(t)
        }
        if (t.kind === 'stock') {
            if (target) return this.#giveToKit(t)
            if (!this.kit) this.#show('info', 'Todavía no hay nadie en el mostrador: quien llegue pasará solo.')
            return this.#goHome(t)
        }
    }

    /* ---------------- carrying, with a hand ---------------- */

    #take(entity) {
        const t = this.things.get(entity)
        if (!t) return
        gsap.killTweensOf(t.object.position)
        this.haptics.play('grab')
    }

    /** Let go in the headset: what it counts as depends on where it, or the ray holding it, was. */
    #release(entity) {
        const t = this.things.get(entity)
        const hand = this.heldHand
        this.heldHand = null
        // what answers goes to the hand that let go, even if the other one pressed something meanwhile
        if (hand) this.haptics.hand = hand
        this.#mark(null)
        if (!t) return
        const pointedAt = hand ? this.#targetAlong(hand, t) : null
        if (t.kind === 'box') return this.#releaseBox(entity, t, pointedAt)
        if (t.kind === 'item') return this.#releaseItem(entity, t, pointedAt)
        if (t.kind === 'stock') return this.#releaseStock(t, pointedAt)
    }

    #releaseBox(entity, t, pointedAt) {
        const m = this.station.mat
        temp.copy(t.object.position)
        if (pointedAt || Math.hypot(temp.x - m.x, temp.z - m.z) < MAT_REACH) {
            if (!this.#matBusy()) return this.#moveToMat(entity, t)
            this.haptics.play('wrong')
            this.#say('warn', this.#matBusyText())
        }
        this.#goHome(t)
    }

    #releaseItem(entity, t, pointedAt) {
        t.object.getWorldPosition(temp)
        if (this.kit && (pointedAt === this.kit || temp.distanceTo(this.#worldOf(this.kit.object)) < KIT_REACH)) return this.#packFromBox(entity, t)
        if (pointedAt?.crate) return this.#stow(entity, t, pointedAt)
        let best = null
        let bestDist = CRATE_REACH
        for (const zone of this.station.zones) {
            zone.crate.getWorldPosition(temp2)
            const d = temp.distanceTo(temp2.setY(temp2.y + 0.15))
            if (d < bestDist) {
                best = zone
                bestDist = d
            }
        }
        if (best) return this.#stow(entity, t, best)
        // let go anywhere else, it goes back in its carton: nothing piles up on the counter
        this.#goHome(t)
    }

    #releaseStock(t, pointedAt) {
        if (this.kit) {
            t.object.getWorldPosition(temp)
            if (pointedAt === this.kit || temp.distanceTo(this.#worldOf(this.kit.object)) < KIT_REACH) return this.#giveToKit(t)
        }
        this.#goHome(t)
    }

    #goHome(t) {
        gsap.to(t.object.rotation, { x: 0, y: 0, z: 0, duration: 0.25 })
        gsap.to(t.object.position, { x: t.home.x, y: t.home.y, z: t.home.z, duration: 0.35, ease: 'power2.inOut', onComplete: () => this.#refreshShelf() })
    }

    /* ---------------- what happens to what is carried ---------------- */

    /**
     * Whether the mat has a carton to finish: one not yet opened, or open with something left in it.
     * Read from the day, not from what was last put there, so an emptied mat is always free.
     */
    #matBusy() {
        const t = this.onMat && this.things.get(this.onMat)
        const b = t?.box && this.day.box(t.box.id)
        if (!b || b.state === 'empty' || (b.state === 'open' && b.left <= 0)) {
            if (this.onMat && !t?.moving) this.onMat = null
            return !!this.onMat
        }
        return true
    }

    #matBusyText() {
        const t = this.onMat && this.things.get(this.onMat)
        const b = t?.box && this.day.box(t.box.id)
        if (!b) return 'La mesa azul está ocupada: espera un momento.'
        if (b.state === 'received') return 'La mesa azul está ocupada: presiona la caja que está ahí para abrirla.'
        // what is left goes back in the carton, where it can be seen, wherever it was let go
        for (const it of this.things.values()) if (it.kind === 'item' && it.box === t.box && !it.moving) this.#goHome(it)
        const left = Object.entries(b.loose.reduce((n, id) => ({ ...n, [id]: (n[id] ?? 0) + 1 }), {}))
        return `En la caja abierta todavía queda ${list(left.map(([id, q]) => `${q} de ${SUPPLIES[id].label.toLowerCase()}`))}: llévalo al estante o a un pedido.`
    }

    #moveToMat(entity, t) {
        this.haptics.play('right')
        t.onMat = true
        t.moving = true
        this.onMat = entity
        const m = this.station.mat
        const settled = () => {
            // on the mat it stops being carried and is worked on: a new carton, free of the grab
            // handle, so a ray or a hand can press it open
            const object = cardboardBox()
            object.position.copy(m)
            object.name = t.object.name
            this.things.delete(entity)
            entity.destroy()
            t.moving = false
            this.onMat = this.#thing(object, t, { grab: false })
            this.sound.play('box', this.#worldOf(object))
        }
        gsap.to(t.object.rotation, { x: 0, y: 0, z: 0, duration: 0.3, ease: 'power2.out' })
        gsap.to(t.object.position, { x: m.x, y: m.y, z: m.z, duration: 0.35, ease: 'power2.inOut', onComplete: settled })
        this.#offerTopBoxes()
        this.#say('info', this.world.session ? 'Presiona la caja para quitarle la cinta.' : 'Haz clic en la caja para quitarle la cinta.')
    }

    #openBox(t) {
        if (!this.day.openBox(t.box.id)) return
        this.haptics.play('tap')
        const { flaps, seal } = t.object.userData
        seal.visible = false
        // open, it has nothing more to be pressed for, and its flaps must not stop a ray on its way in
        t.object.pointerEvents = 'none'
        this.sound.play('tape', this.#worldOf(t.object))
        for (const hinge of flaps) gsap.to(hinge.rotation, { x: hinge.userData.side * 2.75, duration: 0.55, ease: 'power2.out' })
        const m = this.station.mat
        for (const { itemId, fit, position } of cartonLayout(this.supplies, t.box.items)) {
            const object = supplyObject(this.loader, this.supplies.get(itemId), itemId, fit)
            const home = position.clone().add(m)
            object.position.copy(home)
            this.#thing(object, { kind: 'item', itemId, box: t.box, home })
        }
        this.#say('info', `Caja de ${t.box.from}. Lleva cada insumo a su caja del estante, a tu ${this.#truckSide() < 0 ? 'derecha' : 'izquierda'}, o directo a un pedido.`)
    }

    /** An item goes into its crate, or back to its carton with a word about where it goes. */
    #stow(entity, t, zone) {
        const result = this.day.sort(t.box.id, t.itemId, zone.categoryId)
        if (!result.ok) {
            this.#goHome(t)
            this.sound.play('wrong', this.#worldOf(zone.crate))
            this.haptics.play('wrong')
            this.#say('warn', `${SUPPLIES[t.itemId].label} no va en ${CATEGORIES[zone.categoryId].label}: va en ${result.wanted}.`)
            return
        }
        this.haptics.play('right')
        this.things.delete(entity)
        const object = t.object
        // it flies to its crate and joins what is there
        const into = object.parent.worldToLocal(this.#worldOf(zone.crate).add(temp.set(0, 0.14, 0)))
        gsap.to(object.scale, { x: 0.3, y: 0.3, z: 0.3, duration: 0.3, ease: 'power2.in' })
        gsap.to(object.position, {
            x: into.x,
            y: into.y,
            z: into.z,
            duration: 0.3,
            ease: 'power2.in',
            onComplete: () => {
                this.sound.play('item', this.#worldOf(zone.crate))
                entity.destroy()
            },
        })
    }

    #giveToKit(t) {
        const label = SUPPLIES[t.itemId].label
        const result = this.day.addToKit(t.itemId)
        if (!result.ok) {
            this.sound.play('wrong', this.#worldOf(this.kit.object))
            this.haptics.play('wrong')
            if (result.reason === 'extra') this.#say('warn', `${label}: ya está completo o no está en este pedido.`)
            if (result.reason === 'stock') this.#say('warn', `No queda ${label.toLowerCase()} en los estantes.`)
            return this.#goHome(t)
        }
        this.#showInKit(t.itemId)
        // the crate's sample is back in its place at once: there are more of them
        t.object.position.copy(t.home)
        t.object.rotation.set(0, 0, 0)
        this.#refreshShelf()
    }

    /** From an open carton straight into the kit, without going by the shelves. */
    #packFromBox(entity, t) {
        const result = this.day.addFromBox(t.box.id, t.itemId)
        if (!result.ok) {
            this.sound.play('wrong', this.#worldOf(this.kit.object))
            this.haptics.play('wrong')
            this.#say('warn', `${SUPPLIES[t.itemId].label}: ya está completo o no está en este pedido.`)
            return this.#goHome(t)
        }
        this.things.delete(entity)
        entity.destroy()
        this.#showInKit(t.itemId)
    }

    /** One more unit in the kit, in the place kept for it. */
    #showInKit(itemId) {
        this.haptics.play('right')
        const slot = this.kit.layout.findIndex((s, i) => s.itemId === itemId && !this.kit.used.has(i))
        this.kit.used.add(slot)
        const { fit, position } = this.kit.layout[slot]
        const object = supplyObject(this.loader, this.supplies.get(itemId), itemId, fit)
        object.position.copy(position)
        this.kit.object.add(object)
        this.sound.play('item', this.#worldOf(this.kit.object))
    }

    /* ---------------- people ---------------- */

    /** They move as they do in the web experience: the same puppet, the same walk and the same little idle things. */
    #person(id, position, yaw) {
        const child = id.includes('nino')
        const elder = id.includes('mayor')
        const person = new GuideCharacter(this.loader.instanceSync(this.people.get(id)), [], { face: true, stoop: elder ? 0.12 : 0 })
        person.root.scale.setScalar(child ? CHILD_SCALE : PERSON_SCALE)
        person.place(position, yaw)
        person.temper = new Temper(person)
        person.appear()
        // orders, not people: who they are is on the card, with their photo
        person.root.visible = false
        this.rootObject.add(person.root)
        this.crowd.add(person)
        return person
    }

    /** A family keeps together: the first walks, the rest go beside them. */
    #familyPeople(order, x) {
        const scaleOf = (id) => (id.includes('nino') ? CHILD_SCALE : PERSON_SCALE)
        const [first, ...rest] = order.visitors
        const leader = this.#person(first, temp.set(x, 0, ENTRY_Z).clone(), 0)
        const members = [leader]
        let beside = (this.people.get(first).size.x * scaleOf(first)) / 2
        for (const id of rest) {
            const width = this.people.get(id).size.x * scaleOf(id)
            const person = this.#person(id, temp.set(x + beside + width / 2 + 0.05, 0, ENTRY_Z).clone(), 0)
            person.follow(leader, { x: -(beside + width / 2 + 0.05), z: 0 }, { x: -(beside + width / 2 + 0.05) * 0.8, z: -0.25 })
            beside += width + 0.05
            members.push(person)
        }
        return { leader, members }
    }

    /** They walk there, and once there they turn to where they are told to look. */
    #walkTo(leader, x, z, then) {
        leader.walk([leader.position.clone(), new THREE.Vector3(x, 0, z)], { speed: WALK_SPEED }).then((arrived) => {
            if (arrived !== false) then?.()
        })
    }

    #freeSlot() {
        const taken = [...this.families.values()].map((f) => f.slot)
        return LINE_SLOTS.find((x) => !taken.includes(x)) ?? LINE_SLOTS[0]
    }

    /**
     * Someone new at the back of the point, with their card over their head to read, not to
     * press: they walk up to the counter by themselves as soon as it is their turn.
     */
    #familyJoins(order) {
        const slot = this.#freeSlot()
        const { leader, members } = this.#familyPeople(order, slot.x)
        const f = { leader, members, card: null, slot, order }
        this.families.set(order.id, f)
        this.#giveCard(f)
        this.#walkTo(leader, slot.x, slot.z, () => (leader.targetYaw = 0))
        if (order.urgent) {
            this.sound.play('alert')
            this.#say('alert', `${order.family} necesita ${this.#wants(order)} ya. Pasa al entregar lo del mostrador, o con «Que pase el siguiente».`)
        } else if (this.day.current) {
            this.sound.play('radio')
            this.#say('radio', `Llegó una orden de ${order.family}. La atiendes cuando termines, o con «Que pase el siguiente».`)
        }
    }

    /** The card over the head of whoever is in line. */
    #giveCard(f) {
        const { order, leader } = f
        const card = orderPhotoCard()
        // about 42 cm wide where the person is, whatever the point's scale
        const k = 0.42 / (card.width * this.scale)
        card.base = k
        card.refresh(this.#cardData(order))
        // an entity of its own, so a hand in front of it covers it; scaled once it is one
        card.entity = this.#occlude(this.world.createTransformEntity(card.mesh, { parent: this.root }))
        card.mesh = card.entity.object3D
        card.mesh.scale.setScalar(k)
        f.card = card
        this.#followCards()
        gsap.fromTo(card.mesh.scale, { x: k * 0.3, y: k * 0.3 }, { x: k, y: k, duration: 0.4, ease: 'back.out(2)' })
        this.sound.play('radio')
    }

    /** Sent back to wait: their carton goes, and they return to a place in the line. */
    #familyStepsBack() {
        const f = this.familyAtCounter
        this.familyAtCounter = null
        this.kit.entity.destroy()
        this.kit = null
        f.slot = this.#freeSlot()
        if (f.card) f.card.refresh(this.#cardData(f.order))
        else this.#giveCard(f)
        this.#followCards()
        this.#walkTo(f.leader, f.slot.x, f.slot.z, () => (f.leader.targetYaw = 0))
    }

    /**
     * The orders, as bubbles in a row up high over the far edge of the table: the one being
     * attended first, then the urgent; turned to the person.
     */
    #followCards() {
        const rank = (f) => (f === this.familyAtCounter ? 2 : f.order.urgent ? 1 : 0)
        const waiting = [...this.families.values()].filter((f) => f.card).sort((a, b) => rank(b) - rank(a))
        const step = 0.45 / this.scale
        // above the other signs, a little behind the table, with their bottom over the eyes
        const y = this.station.deskTop + 0.95 / this.scale
        const z = this.station.deskFar - 0.2 / this.scale
        // four to a row; when the line grows, the next row goes above, a little further back
        const PER_ROW = 4
        waiting.forEach((f, i) => {
            const row = Math.floor(i / PER_ROW)
            const inRow = Math.min(PER_ROW, waiting.length - row * PER_ROW)
            const x = WORKER.x + ((i % PER_ROW) - (inRow - 1) / 2) * step
            f.card.mesh.position.set(x, y + (row * 0.27) / this.scale, z - (row * 0.12) / this.scale)
            f.card.mesh.rotation.set(0, Math.atan2(WORKER.x - x, WORKER.z + 0.4 - z) * 0.6, 0)
        })
    }

    /** Where the truck drives, in the point's units: close by, just behind the panel, whatever the point's scale. */
    #truckX() {
        return WORKER.x + (this.#truckSide() * TRUCK_REACH) / this.scale
    }

        /** -1 left, 1 right: the truck comes along the side the shelf is not on. */
    #truckSide() {
        return -(this.station?.shelfSide ?? 1)
    }

    #cardData(order) {
        const { id, family, urgent, items, packed, waited, patience } = order
        return { id, family, urgent, items, packed, left: barStep(1 - waited / patience) }
    }

    #wants(order) {
        return list(Object.entries(order.items).map(([id, q]) => `${q} de ${SUPPLIES[id].label.toLowerCase()}`))
    }

    /** Everyone feels what their family's wait is doing to them. */
    #feelings() {
        for (const { order, members } of this.families.values()) {
            const left = leftOf(order)
            for (const person of members) person.temper.left = left
        }
    }

    /** One at a time, whoever is worst off and not walking says so, out loud and in a bubble beside them. */
    #complaints(dt) {
        this.complaintIn -= dt
        const speaker = this.speaker
        if (speaker) {
            const stillThere = this.families.get(speaker.order.id) === speaker && (speaker.order.state === 'waiting' || speaker.order.state === 'packing')
            if (!stillThere || this.elapsed > this.speakerUntil) this.#hushed()
            else this.#placeBubble()
        }
        if (this.speaker || this.complaintIn > 0 || !this.running) return
        const candidates = [...this.families.values()].filter((f) => (f.order.state === 'waiting' || f.order.state === 'packing') && leftOf(f.order) < COMPLAINS_BELOW && f.leader.walkAmt < 0.3)
        candidates.sort((a, b) => (a === this.lastSpeaker) - (b === this.lastSpeaker) || leftOf(a.order) - leftOf(b.order))
        const next = candidates[0]
        if (!next) return
        this.speaker = this.lastSpeaker = next
        this.speakerUntil = this.elapsed + COMPLAINT_SECONDS
        this.complaintIn = COMPLAINT_SECONDS + COMPLAINT_PAUSE
        next.leader.temper.complain(COMPLAINT_SECONDS)
        this.bubbleSide = next.leader.position.x < -0.3 || next.leader.position.x > 2 ? -1 : 1
        this.bubble.refresh({ text: complaintFor(next.order, leftOf(next.order), this.complaintTurn++), side: this.bubbleSide })
        this.#placeBubble()
        this.bubble.mesh.visible = true
        this.sound.play('grumble', this.#worldOf(next.leader.root))
    }

    /** By the head of whoever is talking, and turned to the person. */
    #placeBubble() {
        const { position } = this.speaker.leader
        const atCounter = this.speaker.order.state === 'packing'
        this.bubble.mesh.position.set(position.x + this.bubbleSide * 0.74, atCounter ? 1.2 : 1.38, position.z + 0.25)
        this.bubble.mesh.lookAt(this.world.camera.getWorldPosition(temp))
    }

    #hushed() {
        this.speaker = null
        if (this.bubble) this.bubble.mesh.visible = false
    }

    /** Half of the cards at a time: `half` says which. */
    #refreshCards(half) {
        let n = 0
        for (const f of this.families.values()) {
            if (f.order.state !== 'waiting' || !f.card || n++ % 2 !== half) continue
            f.card.refresh(this.#cardData(f.order))
        }
    }

    #removeCard(f) {
        if (!f.card) return
        gsap.killTweensOf(f.card.mesh.scale)
        if (f.card.entity) f.card.entity.destroy()
        else f.card.mesh.removeFromParent()
        f.card = null
        this.#followCards()
    }

    /** What they asked for, and for what is missing, whether it is anywhere to be had. */
    #refreshOrder(order) {
        const { day } = this
        const status = Object.fromEntries(Object.keys(order.items).map((id) => [id, day.available(id) > 0 ? 'shelf' : day.inOpenCartons(id) > 0 ? 'box' : 'out']))
        const card = this.familyAtCounter?.order === order ? this.familyAtCounter.card : null
        card?.refresh({ ...this.#cardData(order), attending: true, status })
        if (card) this.#refreshGhosts(order)
    }

    /**
     * Over the carton of the order being attended, what it still needs: each missing unit, as a
     * see-through copy of itself, floating in a ring that goes round. Each one goes as it is packed.
     */
    #refreshGhosts(order) {
        const missing = Object.entries(order.items).flatMap(([id, q]) => Array(Math.max(0, q - (order.packed[id] ?? 0))).fill(id))
        const key = `${order.id}:${missing.join(',')}`
        if (key === this.ghostKey) return
        this.ghostKey = key
        if (!this.ghosts) {
            const group = new THREE.Group()
            group.name = 'lo-que-falta'
            this.ghostEntity = this.world.createTransformEntity(group, { parent: this.root })
            this.ghosts = this.ghostEntity.object3D
            this.ghostItems = []
        }
        const ring = this.ghosts
        for (const e of this.ghostItems) e.destroy()
        this.ghostItems = []
        ring.position.copy(this.station.kitMat).setY(this.station.kitMat.y + BOX_HEIGHT + GHOST_OVER / this.scale)
        const radius = (missing.length > 1 ? GHOST_RADIUS : 0) / this.scale
        missing.forEach((id, i) => {
            const ghost = supplyObject(this.loader, this.supplies.get(id), id, 1)
            ghost.traverse((o) => {
                if (!o.isMesh) return
                o.material = [o.material].flat().map((m) => {
                    const c = m.clone()
                    c.transparent = true
                    c.opacity = GHOST_OPACITY
                    c.depthWrite = false
                    return c
                })
                if (o.material.length === 1) o.material = o.material[0]
                // seen, never pointed at or picked
                o.raycast = () => {}
            })
            const a = (i / missing.length) * Math.PI * 2
            ghost.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius)
            ghost.userData.bob = a
            this.ghostItems.push(this.#occlude(this.world.createTransformEntity(ghost, { parent: this.ghostEntity })))
        })
    }

    #turnGhosts(dt) {
        // the order's carton keeps the size of every other carton; only swelling a touch when marked
        const kit = this.kit?.object
        if (kit && this.marked !== kit && kit.scale.x !== 1 && !gsap.isTweening(kit.scale)) kit.scale.setScalar(1)
        const ring = this.ghosts
        if (!ring) return
        ring.visible = !!this.kit && !!this.familyAtCounter && ring.children.length > 0
        if (!ring.visible) return
        ring.rotation.y += dt * GHOST_TURN
        for (const ghost of ring.children) {
            ghost.rotation.y -= dt * GHOST_TURN * 2.2
            ghost.position.y = (Math.sin(this.elapsed * 2 + ghost.userData.bob) * 0.015) / this.scale
        }
    }

    /** It is their turn: they come up, what they ask for appears, and a new carton opens on the kit mat. */
    #familyComes(order) {
        const f = this.families.get(order.id)
        f.slot = null
        this.familyAtCounter = f
        if (!f.card) this.#giveCard(f)
        this.#followCards()
        this.#walkTo(f.leader, WORKER.x, COUNTER_Z, () => (f.leader.targetYaw = 0))

        const kitObject = cardboardBox(KIT_TAPE)
        kitObject.position.copy(this.station.kitMat)
        kitObject.userData.seal.visible = false
        for (const hinge of kitObject.userData.flaps) hinge.rotation.x = hinge.userData.side * 2.75
        kitObject.name = order.id
        const entity = this.#occlude(this.world.createTransformEntity(kitObject, { parent: this.root }))
        // as large as every other carton, from the start: no growing in (a scale tween on a fresh
        // entity can be left behind by the entity's own scale, and the carton stays half size)
        entity.object3D.scale.setScalar(1)
        const units = Object.entries(order.items).flatMap(([id, q]) => Array(q).fill(id))
        this.kit = { entity, object: kitObject, layout: cartonLayout(this.supplies, units), used: new Set() }
        this.#refreshOrder(order)
        const k = f.card.base
        gsap.fromTo(f.card.mesh.scale, { x: k * 0.86, y: k * 0.86 }, { x: k, y: k, duration: 0.4, ease: 'back.out(2.4)' })
        this.sound.play('radio')
        this.#say(order.urgent ? 'alert' : 'radio', `Atiende la orden de ${order.family}: busca lo que pide en el estante o en las cajas que abras, y ponlo en la caja de «Arma el pedido».`)
        this.#refreshAction()
    }

    #sendAway(f, x, z) {
        const { order, leader, members } = f
        this.#walkTo(leader, x, z, () => {
            for (const person of members) {
                person.root.removeFromParent()
                this.crowd.delete(person)
            }
            this.families.delete(order.id)
        })
    }

    #familyLeaves(order) {
        const f = this.familyAtCounter
        // cleared now, not when they are gone: the next one may already be coming up
        this.familyAtCounter = null
        const { kit } = this
        // handed over where it is: it does not move, it closes, is taped, and pops out
        const { flaps, seal } = kit.object.userData
        // what is in it settles down inside first, so nothing pokes through the flaps as they close
        for (const item of kit.object.children) {
            if (!item.name?.startsWith('insumo:')) continue
            gsap.to(item.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.3, ease: 'power2.in' })
            gsap.to(item.position, { y: item.position.y - 0.08, duration: 0.3, ease: 'power2.in', onComplete: () => (item.visible = false) })
        }
        for (const hinge of flaps) gsap.to(hinge.rotation, { x: 0, delay: 0.15, duration: 0.4, ease: 'power2.inOut' })
        const fading = []
        kit.object.traverse((o) => {
            if (!o.isMesh) return
            // its own materials: the other cartons share theirs and must not fade with it
            o.material = [o.material].flat().map((m) => {
                const c = m.clone()
                c.transparent = true
                fading.push(c)
                return c
            })
            if (o.material.length === 1) o.material = o.material[0]
        })
        gsap.delayedCall(0.55, () => {
            seal.visible = true
            this.sound.play('tape', this.#worldOf(kit.object))
        })
        // then it pops out: a quick swell, and gone, shrinking as it fades
        const scale = kit.object.scale
        gsap.to(scale, { x: 1.18, y: 1.18, z: 1.18, delay: 0.8, duration: 0.14, ease: 'power2.out' })
        gsap.to(scale, { x: 0.01, y: 0.01, z: 0.01, delay: 0.94, duration: 0.26, ease: 'back.in(2)' })
        const fade = { k: 1 }
        gsap.to(fade, {
            k: 0,
            delay: 0.94,
            duration: 0.26,
            ease: 'power1.in',
            onUpdate: () => {
                for (const m of fading) m.opacity = fade.k
            },
            onComplete: () => {
                kit.entity.destroy()
                this.#sendAway(f, WORKER.x + 3, ENTRY_Z)
            },
        })
        this.kit = null
        this.#removeCard(f)
        this.sound.play('done')
        const short = Object.entries(order.short ?? {})
        // how it went is how they leave: only someone who got it all goes away glad
        for (const person of f.members) {
            person.temper.settled = short.length ? 'worried' : 'happy'
            if (!short.length) person.celebrate()
        }
        if (order.gaveUp) this.#say('warn', `${order.family} no pudo esperar más y se llevó lo que había en su caja.`)
        else if (short.length) this.#say('warn', `${order.family} se fue sin ${list(short.map(([id, n]) => `${n} de ${SUPPLIES[id].label.toLowerCase()}`))}.`)
        else this.#say('done', `${order.family} recibió todo su pedido.`)
    }

    /** They could not wait any more, in line or with nothing yet in their carton at the counter. */
    #familyGivesUp(order) {
        const f = this.families.get(order.id)
        this.#removeCard(f)
        f.slot = null
        for (const person of f.members) person.temper.settled = 'angry'
        if (this.familyAtCounter === f) {
            this.familyAtCounter = null
            this.kit.entity.destroy()
            this.kit = null
        }
        this.#sendAway(f, f.leader.position.x, ENTRY_Z)
        this.sound.play('wrong')
        this.#say('alert', `${order.family} no pudo esperar más y se fue sin nada.`)
    }

    /* ---------------- what the day answers ---------------- */

    #onDay(event, detail) {
        if (event === 'incoming') this.#truckComes()
        if (event === 'received') {
            this.sound.play('done')
            this.#dropBoxes(detail)
            this.#say('info', this.world.session ? 'Lleva una caja a la mesa azul: agárrala o mantén el gatillo sobre ella.' : 'Mantén presionada una caja y llévala a la mesa azul.')
        }
        if (event === 'emptied') this.#clearBox(detail)
        if (event === 'joined') this.#familyJoins(detail)
        if (event === 'backToLine') this.#familyStepsBack()
        if (event === 'order') this.#familyComes(detail)
        if (event === 'packed') {
            this.#refreshOrder(detail.order)
            if (detail.complete) {
                this.sound.play('done')
                this.#say('info', `El pedido de ${detail.order.family} está completo.`)
            }
        }
        if (event === 'impatient') {
            this.sound.play('radio')
            this.#say('warn', `${detail.family} lleva mucho esperando.`)
        }
        if (event === 'delivered') this.#familyLeaves(detail)
        if (event === 'left') this.#familyGivesUp(detail)
        if (event === 'finished') this.#closing(detail)
        if (this.station) {
            this.#refreshShelf()
            this.#refreshAction()
            if (this.running) this.#refreshReceive()
            if (this.day.current) this.#refreshOrder(this.day.current)
            if (this.list.mesh.visible) this.#refreshList()
        }
    }

    /** An emptied carton is broken down and leaves the mat free for the next one. */
    #clearBox(box) {
        for (const [entity, t] of this.things) {
            if (t.kind !== 'box' || t.box !== box) continue
            this.things.delete(entity)
            if (this.onMat === entity) this.onMat = null
            gsap.to(t.object.scale, { y: 0.02, duration: 0.35, ease: 'power2.in', onComplete: () => entity.destroy() })
            this.sound.play('box', this.#worldOf(t.object))
        }
    }

    /* ---------------- closing ---------------- */

    /** The shift, in numbers and in people. */
    #closing(r) {
        this.#endGuide()
        this.#hushed()
        this.running = false
        this.ending = true
        this.message.mesh.visible = false
        this.#setActive(this.receive.mesh, false)
        this.list.mesh.visible = false
        this.sayQueue = []
        // whatever it still carries goes back: the point closes for the day
        if (this.truckParked) this.#truckLeaves()
        const names = (orders) => list(orders.map((o) => o.family))
        const minutes = Math.max(1, Math.round(r.seconds / 60))
        const lines = []
        if (r.partial.length) lines.push({ mark: 'warn', tone: 'warn', text: `Incompletos: ${names(r.partial)}.` })
        if (r.left.length) lines.push({ mark: 'warn', tone: 'bad', text: `Se fueron sin nada: ${names(r.left)}.` })
        const urgent = {
            whole: { mark: 'check', tone: 'good', text: 'La clínica móvil recibió todo a tiempo.' },
            partial: { mark: 'warn', tone: 'warn', text: 'La clínica móvil se llevó solo una parte.' },
            left: { mark: 'warn', tone: 'bad', text: 'La clínica móvil no pudo esperar.' },
        }[r.urgent]
        if (urgent) lines.push(urgent)
        if (r.boxesLeft) lines.push({ mark: 'box', text: `Quedaron ${r.boxesLeft} ${r.boxesLeft === 1 ? 'caja' : 'cajas'} sin abrir.` })
        if (r.mistakes) lines.push({ mark: 'warn', text: `Insumos en la caja equivocada: ${r.mistakes}.` })
        this.big.refresh({
            kicker: `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} de turno`,
            title: 'Así fue tu turno',
            stats: [
                { value: String(r.people), label: 'personas recibieron algo', tone: 'good' },
                { value: `${r.whole.length}/${r.orders}`, label: 'pedidos completos', tone: r.whole.length === r.orders ? 'good' : 'warn' },
                { value: String(r.sorted), label: 'insumos recibidos' },
            ],
            lines,
            note: 'Cada donación que ves en la app pasó por este trabajo.',
        })
        this.big.mesh.visible = true
        this.sound.play('done')
        this.#refreshAction()
    }
}
