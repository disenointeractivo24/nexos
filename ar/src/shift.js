import {
    CameraSource,
    CameraUtils,
    createSystem,
    DepthOccludable,
    EnvironmentRaycastTarget,
    Grabbed,
    OneHandGrabbable,
    PanelDocument,
    PhysicsBody,
    PhysicsManipulation,
    PhysicsShape,
    PhysicsState,
    PhysicsSystem,
    Pressed,
    RaycastSpace,
    RayInteractable,
    VisibilityState,
    XRMesh,
    XRPlane,
} from '@iwsdk/core'
import gsap from 'gsap'
import * as THREE from 'three'
import { AssetLoader } from '../../src/three/AssetLoader.js'
import { GuideCharacter } from '../../src/three/GuideCharacter.js'
import { CATEGORIES, SUPPLIES } from '../../src/data/catalog.js'
import { InventoryStore, sheetsEndpoint } from '../../src/app/inventoryStore.js'
import { Workable } from './components.js'
import { Haptics } from './haptics.js'
import { Hands } from './hands.js'
import { COMPLAINS_BELOW, complaintFor } from './sim/temper.js'
import { ORDERS, SHIFT_STOCK, Workday } from './sim/workday.js'
import { Sound } from './sound.js'
import { Atmosphere } from './world/atmosphere.js'
import { DesktopView } from './world/desktopView.js'
import { Glow } from './world/glow.js'
import { familyCard, fontsReady, orderTag, speechBubble } from './world/panels.js'
import { comfortableTop, isWorktop, rayHits, surfaceAt, surfaceFromMesh, surfaceFromPlane, surfaceMarker, WorkFrame } from './world/room.js'
import { SpatialPanel } from './world/spatialUI.js'
import { BOX, cardboardBox, cartonLayout, categoryCrate, CRATE, crateLayout, lowShelf, PALLET, pallet, preloadSupplies, supplyObject, virtualTable } from './world/station.js'
import { Temper } from './world/temper.js'

/** The inventory this experience works on: its own point, never one the donors see. */
const DEMO_POINT = 'demo-ar'
/** The categories on each side of the person: food and water to the left, the rest to the right. */
const LEFT_SIDE = ['alimentos', 'agua']
const RIGHT_SIDE = ['medicinas', 'higiene', 'refugio']
/** People at their real height, in metres. */
const HEIGHT = { adult: 1.66, elder: 1.57, child: 1.12 }
const WALK_SPEED = 1.15
/** How near (m) something must be let go of to count as put in a crate, in the kit, back in a carton. */
const CRATE_REACH = 0.26
const KIT_REACH = 0.24
/** How near the family's carton must be handed to whoever is at the counter. */
const HAND_OVER = 0.6
/** Faster than this, what is let go of is slowed down: things are set down or passed, never thrown. */
const MAX_THROW = 1.4
/** A pinch on a carton shorter than this, without moving it, is a tap: it opens. */
const TAP_SECONDS = 0.32
const TAP_MOVE = 0.04
/** How far along the tape a fingertip must run to tear it. */
const TEAR = 0.06
/** How long a message stays up before a lesser one can take its place, and how long an alert does. */
const MESSAGE_HOLD = 2.5
const ALERT_HOLD = 6
const WARN_HOLD = 3.5
/** How long someone complains for, and how long until the next one does: they take turns, there is one bubble. */
const COMPLAINT_SECONDS = 3
const COMPLAINT_PAUSE = 1.6
/** A bar that goes in steps: no one reads a change smaller than this, and each one costs an upload. */
const barStep = (left) => Math.round(Math.max(0, left) * 20) / 20
const leftOf = (order) => Math.max(0, 1 - order.waited / order.patience)
const KIT_TAPE = '#2E8B57'
const MESSAGE_LOOK = {
    info: { fill: '#FFFFFF', badge: '#011E41', ink: '#011E41', icon: 'i-info' },
    radio: { fill: '#FFFFFF', badge: '#011E41', ink: '#011E41', icon: 'i-info' },
    warn: { fill: '#FCEFD6', badge: '#E39B1B', ink: '#7A4B00', icon: 'i-warn' },
    done: { fill: '#E4F1E9', badge: '#1E5B36', ink: '#1E5B36', icon: 'i-done' },
    alert: { fill: '#D92632', badge: '#FFFFFF', ink: '#FFFFFF', icon: 'i-alert' },
}
const DOT = { alert: '#D92632', warn: '#E39B1B', work: '#011E41' }

const temp = new THREE.Vector3()
const temp2 = new THREE.Vector3()
const temp3 = new THREE.Vector3()
const up = new THREE.Vector3(0, 1, 0)
const yawQ = (yaw) => new THREE.Quaternion().setFromAxisAngle(up, yaw)

const list = (names) => {
    if (names.length < 2) return names.join('')
    return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}
const low = (id) => SUPPLIES[id].label.toLowerCase()

/**
 * One shift at the collection point, in the person's own room. They choose a table; the cartons
 * people gave are already there, piled on the floor and on whatever surfaces there are. They open
 * them where they are, sort what comes out onto the crates at either side, and pack what each
 * family asks for into a carton they hand over across the table. Only hands: a pinch takes, a
 * fingertip along the tape opens, the inside of the wrist turned to the eyes shows what is left.
 * Everything has weight and falls, but nothing can be lost or thrown at anyone.
 */
export class ShiftSystem extends createSystem({
    pressed: { required: [Workable, Pressed] },
    held: { required: [Workable, Grabbed] },
    planes: { required: [XRPlane] },
    meshes: { required: [XRMesh] },
    docs: { required: [PanelDocument] },
}) {
    init() {
        this.things = new Map() // entity → { kind, object, ... }
        this.families = new Map() // order id → its people, and their card
        this.panels = new Set()
        this.sayQueue = []
        this.sayUntil = 0
        this.signClock = 0
        this.crowd = new Set()
        this.sound = new Sound()
        this.haptics = new Haptics()
        this.hands = new Hands()
        this.placed = false
        this.loader = new AssetLoader()
        this.ready = this.#prepare()
        this.elapsed = gsap.ticker.time
        this.raycaster = new THREE.Raycaster()
        this.holdTarget = new THREE.Vector3()
        this.eyeSamples = []
        this.recoverClock = 0
        this.lightClock = 0
        this.room = 1 // how bright the room is, from the cameras: 1 is a lit room

        // GSAP on the frame loop: a headset can stop the page's own animation frames
        gsap.ticker.remove(gsap.updateRoot)
        this.cleanupFuncs.push(this.world.onXRFrame((frame) => (this.frame = frame)))

        this.queries.pressed.subscribe('disqualify', (entity) => this.#press(entity))
        this.queries.held.subscribe('qualify', (entity) => this.#take(entity))
        this.queries.held.subscribe('disqualify', (entity) => this.#release(entity))
        this.queries.docs.subscribe('qualify', (entity) => {
            for (const panel of this.panels) if (panel.entity === entity) panel.attach()
        })

        this.cleanupFuncs.push(
            this.world.visibilityState.subscribe((state) => {
                const inHeadset = state !== VisibilityState.NonImmersive
                if (inHeadset) {
                    this.wasInHeadset = true
                    this.paused = false
                    if (!this.placed) this.#beginChoosing()
                } else if (this.wasInHeadset) {
                    // out of the headset the shift waits, and the person can come back to it
                    this.paused = true
                    this.cancelChoosing?.()
                }
            })
        )
    }

    /** A UIKitML panel this shift keeps track of, so it learns when its document is there. */
    #panel(config, opts) {
        const panel = new SpatialPanel(this.world, config, opts)
        this.panels.add(panel)
        if (panel.entity.hasComponent(PanelDocument)) panel.attach()
        return panel
    }

    update(delta) {
        this.elapsed += delta
        gsap.updateRoot(this.elapsed)
        this.view?.update(delta)
        this.haptics.watch(this.world.session)
        const cam = this.world.camera
        cam.getWorldPosition(temp)
        cam.getWorldDirection(temp2)
        this.head = (this.head ?? new THREE.Vector3()).copy(temp)
        up.set(0, 1, 0)
        this.sound.listen(temp, temp2, temp3.set(0, 1, 0).applyQuaternion(cam.quaternion))
        if (this.world.session) this.hands.read(this.frame, this.world.renderer.xr.getReferenceSpace?.(), delta, this.head)
        if (this.choosing) this.#choose(delta)
        if (!this.placed || !this.day) return

        if (this.running && !this.paused) this.day.tick(delta)
        this.#nextMessage()
        this.atmosphere.update(delta, this.running ? this.day.pressure : 0, this.room)
        this.sound.ambient(this.atmosphere.level, delta)
        this.#feelings()
        for (const person of this.crowd) {
            person.update(delta, this.elapsed)
            person.temper.update(delta, this.elapsed)
        }
        if (!this.paused) this.#complaints(delta)
        this.#followCards()
        this.#carry(delta)
        this.#tame(delta)
        this.#tearTape(delta)
        this.#followGuide()
        this.#placeWatch(delta)
        this.#placeGhost()
        this.#roomLight(delta)
        this.recoverClock += delta
        if (this.recoverClock > 0.25) {
            this.recoverClock = 0
            this.#recover()
        }
        this.signClock += delta
        if (this.signClock > 0.25) {
            this.signClock = 0
            this.#refreshSigns()
        }
    }

    async #prepare() {
        await fontsReady()
        const visitors = [...new Set(ORDERS.flatMap((o) => o.visitors))]
        const [supplies, people] = await Promise.all([preloadSupplies(this.loader), Promise.all(visitors.map((id) => this.loader.load(id).then((t) => [id, t])))])
        this.supplies = supplies
        this.people = new Map(people)
        this.personHeight = new Map()
        // published: the demonstration tab of the sheet. On this computer, only this browser.
        const endpoint = import.meta.env.PROD ? sheetsEndpoint() : ''
        this.store = new InventoryStore({ pointId: DEMO_POINT, endpoint })
        await this.store.start()
        const scene = this.world.scene
        const sky = new THREE.HemisphereLight('#FFF4E6', '#8A8172', 1.6)
        scene.add(sky)
        const sun = new THREE.DirectionalLight('#FFE9CF', 1.8)
        sun.position.set(-1.5, 3, 2)
        scene.add(sun)
        this.atmosphere = new Atmosphere(sky, sun)
    }

    /* ---------------- choosing the table ---------------- */

    /** In the headset: what in the room could be a table lights up, and the person picks one. */
    async #beginChoosing() {
        await this.ready
        const { session } = this.world
        if (!session || this.placed || this.choosing) return
        this.choosing = true
        this.sound.unlock()
        // a headset that cannot show the room gets a floor and sky of its own
        if (session.environmentBlendMode === 'opaque') this.#backdrop()
        else this.world.scene.background = null
        this.hint = this.#panel('./ui/message.uikitml', { width: 0.5, height: 0.08 })
        this.#message(this.hint, 'info', 'Mira tu mesa y pellízcala')
        this.markers = new Map()
        // where the hand points, on whatever real surface it meets
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.9, depthTest: false }))
        ring.renderOrder = 20
        this.reticle = this.world.createTransformEntity(ring)
        this.reticle.addComponent(EnvironmentRaycastTarget, { space: RaycastSpace.Right, maxDistance: 6 })
        this.chooseStarted = this.elapsed
        const onSelect = (event) => this.#picked(event)
        session.addEventListener('select', onSelect)
        this.cancelChoosing = () => {
            session.removeEventListener('select', onSelect)
            this.#endChoosing()
        }
    }

    #endChoosing() {
        this.choosing = false
        this.cancelChoosing = null
        for (const marker of this.markers?.values() ?? []) marker.removeFromParent()
        this.markers?.clear()
        this.reticle?.destroy()
        this.reticle = null
        if (this.hint) this.hint.show(false)
    }

    /** What the room has that can be worked at, as it is known now. */
    #surfaces() {
        const found = []
        for (const entity of this.queries.planes.entities) {
            const s = surfaceFromPlane(entity, entity.getValue(XRPlane, '_plane'))
            if (s) found.push(s)
        }
        for (const entity of this.queries.meshes.entities) {
            const s = surfaceFromMesh(entity, {
                semanticLabel: entity.getValue(XRMesh, 'semanticLabel'),
                min: entity.getValue(XRMesh, 'min'),
                max: entity.getValue(XRMesh, 'max'),
                isBounded3D: entity.getValue(XRMesh, 'isBounded3D'),
            })
            if (s) found.push(s)
        }
        return found
    }

    /** Each frame of choosing: the person's height, and the tables the headset has found so far. */
    #choose() {
        const cam = this.world.camera
        cam.getWorldPosition(temp)
        cam.getWorldDirection(temp2)
        // standing as they are: the eyes' height over the floor, taken many times
        this.eyeSamples.push(temp.y)
        if (this.eyeSamples.length > 240) this.eyeSamples.shift()
        this.hint.object.position.copy(temp).addScaledVector(temp2, 0.75).add(temp3.set(0, -0.18, 0))
        this.hint.object.lookAt(temp)
        const surfaces = this.#surfaces().filter((s) => isWorktop(s))
        this.candidates = surfaces
        const seen = new Set()
        for (const s of surfaces) {
            const key = `${s.center.x.toFixed(2)},${s.center.z.toFixed(2)},${s.top.toFixed(2)}`
            seen.add(key)
            if (!this.markers.has(key)) {
                const marker = surfaceMarker(s)
                this.world.scene.add(marker)
                this.markers.set(key, marker)
            }
        }
        for (const [key, marker] of this.markers) {
            if (seen.has(key)) marker.material.opacity = 0.65 + 0.35 * Math.sin(this.elapsed * 3)
            else {
                marker.removeFromParent()
                this.markers.delete(key)
            }
        }
        if (this.elapsed - this.chooseStarted > 8 && !surfaces.length) this.#message(this.hint, 'info', 'Pellizca donde quieras tu mesa')
    }

    /** A pinch while choosing: the table it points at, else the surface under the ray, else a table of our own. */
    #picked(event) {
        const space = this.world.renderer.xr.getReferenceSpace?.()
        const pose = space && event.frame?.getPose?.(event.inputSource.targetRaySpace, space)
        const ray = new THREE.Ray()
        if (pose) {
            const { position: p, orientation: q } = pose.transform
            ray.origin.set(p.x, p.y, p.z)
            ray.direction.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w))
        } else {
            this.world.camera.getWorldPosition(ray.origin)
            this.world.camera.getWorldDirection(ray.direction)
        }
        const head = this.world.camera.getWorldPosition(new THREE.Vector3())
        const eye = this.#eyeHeight(head.y)
        let chosen = null
        let best = Infinity
        for (const s of this.candidates ?? []) {
            const t = rayHits(ray, s)
            if (t < best) {
                best = t
                chosen = s
            }
        }
        if (!chosen) {
            const hit = this.reticle?.object3D?.visible ? this.reticle.object3D.position.clone() : null
            if (hit && hit.y > 0.4 && hit.y < 1.25) chosen = surfaceAt(hit, head, { width: 1.0, depth: 0.6, label: 'hit', real: true })
            else {
                // no table to be had: one of our own, at the height of this person's hands
                const top = comfortableTop(eye)
                const at = hit && hit.y < 0.3 ? hit.setY(top) : ray.origin.clone().addScaledVector(temp.copy(ray.direction).setY(0).normalize(), 0.55).setY(top)
                chosen = surfaceAt(at, head, { width: 1.2, depth: 0.65 })
            }
        }
        this.cancelChoosing?.()
        this.#place(chosen, head, eye)
    }

    /** The eyes' usual height, from what was seen while choosing. */
    #eyeHeight(fallback = 1.6) {
        if (!this.eyeSamples.length) return fallback
        const sorted = [...this.eyeSamples].sort((a, b) => a - b)
        return THREE.MathUtils.clamp(sorted[Math.floor(sorted.length / 2)], 1.0, 2.0)
    }

    /** On a computer: the same, with a table of our own and a person of average height. */
    async startOnDesktop() {
        await this.ready
        this.sound.unlock()
        this.#backdrop()
        const eye = 1.6
        const head = new THREE.Vector3(0, eye, 0.35)
        const s = surfaceAt(new THREE.Vector3(0, comfortableTop(eye), 0), head, { width: 1.2, depth: 0.65 })
        this.#place(s, head, eye)
        const camera = this.world.camera
        const canvas = this.world.renderer.domElement
        this.view = new DesktopView({
            camera,
            canvas,
            solids: [{ minX: this.frame3.minX, maxX: this.frame3.maxX, minZ: -this.frame3.depth, maxZ: 0 }],
            bounds: { minX: -1.6, maxX: 1.6, minZ: -0.2, maxZ: 1.4 },
            roof: () => {},
            grab: {
                pick: (ndc) => this.#pick(ndc),
                move: (ndc) => this.#holdAt(ndc),
                drop: (ndc) => this.#dropAt(ndc),
                rotate: (angle) => this.holding?.t.object.rotateOnWorldAxis(up.set(0, 1, 0), angle),
            },
        })
        canvas.style.cursor = 'grab'
        this.showView('persona')
    }

    /** Sky and ground, where the real room cannot be seen. */
    #backdrop() {
        const scene = this.world.scene
        scene.background = new THREE.Color('#DDE3EA')
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2).translate(0, -0.002, 0), new THREE.MeshStandardMaterial({ color: '#B9C2CC', roughness: 1 })))
    }

    /** The views offered on a computer. */
    showView(name) {
        if (!this.view) return
        if (name === 'persona') return this.view.stand(0, 0.4, 0, -0.45)
        if (name === 'arriba') return this.view.lookFrom(temp.set(0, 4.2, 1.2), temp2.set(0, 0.3, -0.9), true)
        if (name === 'frente') return this.view.lookFrom(temp.set(1.4, 1.8, -4.2), temp2.set(0, 1, -0.4), false)
    }

    /* ---------------- setting up around the table ---------------- */

    #place(surface, head, eye) {
        this.placed = true
        this.eye = eye
        const F = new WorkFrame(surface, head, 0)
        this.frame3 = F
        const rootObject = new THREE.Group()
        rootObject.position.copy(F.origin)
        rootObject.rotation.y = F.yaw
        rootObject.updateMatrixWorld(true)
        this.rootObject = rootObject
        this.root = this.world.createTransformEntity(rootObject)
        this.top = F.top
        this.depth = Math.min(F.depth, 1.2)

        // the table: the real one only needs to be solid; a virtual one has to be seen too
        if (!surface.real) {
            const width = F.maxX - F.minX
            const table = virtualTable(width, F.depth, F.top)
            table.position.set((F.minX + F.maxX) / 2, 0, -F.depth / 2)
            rootObject.add(table)
            this.surfaceMeshes = [table]
        } else this.surfaceMeshes = []
        this.#solid(F.at((F.minX + F.maxX) / 2, F.top - 0.025, -F.depth / 2), F.yaw, [F.maxX - F.minX, 0.05, F.depth])
        // the floor, and whatever else in the room something could be set down on
        this.#solid(F.at(0, -0.05, 0), F.yaw, [14, 0.1, 14])
        this.otherSurfaces = []
        if (this.world.session) {
            for (const s of this.#surfaces()) {
                if (s.center.distanceTo(surface.center) < 0.05) continue
                this.#solid(temp.copy(s.center).setY(s.top - 0.02), Math.atan2(-s.u.z, s.u.x), [s.hu * 2, 0.04, s.hv * 2])
                this.otherSurfaces.push(s)
            }
        }
        // what a mouse can point at to set something down
        const floorPick = new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }))
        rootObject.add(floorPick)
        const topPick = new THREE.Mesh(new THREE.PlaneGeometry(F.maxX - F.minX, F.depth).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }))
        topPick.position.set((F.minX + F.maxX) / 2, F.top + 0.001, -F.depth / 2)
        rootObject.add(topPick)
        this.surfaceMeshes.push(floorPick, topPick)

        this.#shelves()
        this.#signs()
        // only here, not on loading the page: opening it must not change the sheet
        for (const [id, qty] of Object.entries(SHIFT_STOCK)) this.store.set(id, qty)
        // only the first shift since the page opened is guided
        this.#newDay(!this.hadGuide)
        this.hadGuide = true
        this.#intro()
        this.#cameraLight()
    }

    /** Something that stops what falls: an invisible box, still. */
    #solid(center, yaw, dimensions) {
        const object = new THREE.Object3D()
        object.position.copy(center)
        object.quaternion.copy(yawQ(yaw))
        const entity = this.world.createTransformEntity(object)
        entity.addComponent(PhysicsShape, { shape: 'Box', dimensions, friction: 0.9 })
        entity.addComponent(PhysicsBody, { state: PhysicsState.Static })
        return entity
    }

    /** Things with weight: they fall, stack and rest on what is real. */
    #dynamic(entity, size, { density = 0.6 } = {}) {
        if (entity.hasComponent(PhysicsBody)) return
        entity.addComponent(PhysicsShape, { shape: 'Box', dimensions: [size.w, size.h, size.d], density, friction: 0.85, restitution: 0.02 })
        entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic, linearDamping: 0.35, angularDamping: 0.8 })
    }

    /** Real hands go in front of it: the headset's depth hides what is behind them. */
    #occlude(entity) {
        if (!this.world.session || entity.hasComponent(DepthOccludable)) return
        try {
            entity.addComponent(DepthOccludable)
        } catch {
            // a device with no depth simply draws it on top
        }
    }

    /**
     * The inventory, at either side and never behind: food and water on a low shelf to the left,
     * health, hygiene and shelter to the right. Always the same, so it can be remembered.
     */
    #shelves() {
        const F = this.frame3
        this.zones = []
        const side = (categories, sign) => {
            // two crates a board at most: a short shelf, so it stays beside the person and not behind
            const perBoard = 2
            const width = perBoard * (CRATE.w + 0.03) + 0.06
            const edge = sign < 0 ? Math.min(F.minX, -0.45) : Math.max(F.maxX, 0.45)
            // a little ahead to either side, past the piles of cartons on the floor
            let x = sign * Math.max(Math.abs(edge) + 0.4, 1.0)
            let z = -0.7
            // a long table reaches there: the shelf stands at the person's side instead
            if (Math.abs(x) > 1.3) {
                x = sign * 1.35
                z = 0
            }
            const shelfTop = Math.min(this.top, 0.95)
            const lower = Math.max(0.4, shelfTop - 0.42)
            const shelf = lowShelf(width, CRATE.d + 0.06, [lower, shelfTop])
            shelf.position.set(x, 0, z)
            // turned to face where the person stands
            shelf.rotation.y = Math.atan2(0 - x, 0.35 - z)
            this.rootObject.add(shelf)
            shelf.updateMatrixWorld(true)
            const shelfEntity = this.world.createTransformEntity(shelf, { parent: this.root })
            for (const y of [lower, shelfTop]) this.#solid(this.rootObject.localToWorld(temp.set(x, y - 0.01, z)), F.yaw + shelf.rotation.y, [width, 0.02, CRATE.d + 0.06])
            categories.forEach((categoryId, i) => {
                const { crate, label } = categoryCrate(categoryId)
                const column = i % perBoard
                const board = i < perBoard ? shelfTop : lower
                crate.position.set(-width / 2 + 0.06 + CRATE.w / 2 + column * (CRATE.w + 0.03), board, 0)
                shelf.add(crate)
                const entity = this.world.createTransformEntity(crate, { parent: shelfEntity })
                const zone = { categoryId, crate, label, entity, stock: new Map() }
                for (const { itemId, fit, position } of crateLayout(this.supplies, categoryId)) {
                    const object = supplyObject(this.loader, this.supplies.get(itemId), itemId, fit)
                    object.position.copy(position)
                    // a sample stays in the crate; taking it means taking one of many
                    const stock = this.#thing(object, { kind: 'stock', itemId, zone, home: position.clone() }, { parent: entity })
                    zone.stock.set(itemId, stock)
                }
                this.zones.push(zone)
            })
        }
        side(LEFT_SIDE, -1)
        side(RIGHT_SIDE, 1)
    }

    /** The panels: one line of what to do over the table, the list on the arm, the boards, the bubble. */
    #signs() {
        const D = this.depth
        // over the far half of the table, below the faces of whoever is across it
        this.message = this.#panel('./ui/message.uikitml', { width: 0.5, height: 0.08, parent: this.root })
        this.message.object.position.set(0, this.eye - 0.34, -Math.min(D * 0.75, 0.55))
        this.message.object.rotation.x = -0.18
        this.message.show(false)
        this.board = this.#panel('./ui/board.uikitml', { width: 0.62, height: 0.62, parent: this.root, interactive: true })
        this.board.object.position.set(0, this.eye - 0.1, -D - 0.15)
        this.board.onClick('action', () => this.#pressAction())
        this.next = this.#panel('./ui/next.uikitml', { width: 0.2, height: 0.07, parent: this.root, interactive: true })
        // lying near the front left corner of the table, tilted up to the person
        this.next.object.position.set(Math.max(this.frame3.minX + 0.14, -0.55), this.top + 0.05, -0.1)
        this.next.object.rotation.x = -0.95
        this.next.onClick('next', () => this.#pressNext())
        this.next.show(false)
        this.watch = this.#panel('./ui/watch.uikitml', { width: 0.17, height: 0.16 })
        this.watch.show(false)
        this.glow = new Glow(this.world.scene)
        this.bubble = speechBubble()
        this.bubble.mesh.visible = false
        this.bubble.mesh.pointerEvents = 'none'
        this.rootObject.add(this.bubble.mesh)
        this.complaintIn = 0
        this.complaintTurn = 0
        this.tag = orderTag()
        this.tag.mesh.visible = false
        this.tag.mesh.pointerEvents = 'none'
        this.world.scene.add(this.tag.mesh)
        this.ghost = new THREE.Group()
        this.ghost.visible = false
        this.world.scene.add(this.ghost)
    }

    /** One message panel says something, in the look of its kind. */
    #message(panel, kind, text) {
        const look = MESSAGE_LOOK[kind] ?? MESSAGE_LOOK.info
        panel.set('root', { backgroundColor: look.fill })
        panel.set('badge', { backgroundColor: look.badge })
        panel.set('text', { text, color: look.ink })
        for (const id of ['i-info', 'i-warn', 'i-done', 'i-alert']) panel.display(id, id === look.icon)
        for (const id of ['i-info', 'i-warn', 'i-done', 'i-alert']) panel.set(id, { color: kind === 'alert' ? '#D92632' : '#FFFFFF' })
        panel.show(true)
    }

    /**
     * There is one line: what matters must get read before something else takes its place.
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
        this.#message(this.message, kind, text)
        const hold = kind === 'alert' ? ALERT_HOLD : kind === 'warn' ? WARN_HOLD : MESSAGE_HOLD
        this.sayUntil = Math.max(this.sayUntil, this.elapsed + hold)
    }

    #nextMessage() {
        if (!this.sayQueue.length || this.elapsed < this.sayUntil) return
        const { kind, text } = this.sayQueue.shift()
        this.#show(kind, text)
    }

    /* ---------------- the day ---------------- */

    #newDay(guided) {
        this.day = new Workday({ store: this.store, guided })
        this.day.on((event, detail) => this.#onDay(event, detail))
        // the cartons are there from the start, closed, wherever people left them
        this.day.start()
    }

    #intro() {
        this.pendingStart = true
        const hands = !!this.world.session
        this.#board({
            kicker: 'NEXOS · UN TURNO EN EL PUNTO DE ACOPIO',
            title: 'Hoy este punto es tuyo',
            lines: [
                'Abre las cajas y guarda cada cosa en su lado.',
                hands ? 'Mira tu muñeca para ver qué falta.' : 'Con T ves qué falta.',
                'No alcanzará para todo.',
            ],
            action: 'Empezar',
        })
        this.message.show(false)
    }

    #board({ kicker, title, lines = [], stats = null, action }) {
        const b = this.board
        b.text('kicker', kicker)
        b.text('title', title)
        b.display('stats', !!stats)
        stats?.forEach((s, i) => {
            b.text(`v${i}`, s.value)
            b.text(`l${i}`, s.label)
        })
        for (let i = 0; i < 3; i++) {
            b.display(`line${i}`, !!lines[i])
            if (lines[i]) b.text(`line${i}`, lines[i])
        }
        b.text('action', action)
        b.show(true)
    }

    #pressAction() {
        if (!this.board.visible) return
        this.sound.play('tap')
        if (this.pendingStart) return this.#begin()
        if (this.ending) return this.#newShift()
    }

    #begin() {
        this.pendingStart = false
        this.running = true
        this.board.show(false)
        this.guide = this.day.calm ? { phase: null } : null
        this.#refreshNext()
    }

    /** Another shift, right here: the same table, the same shelves, new cartons. */
    #newShift() {
        for (const f of this.families.values()) this.#removeCard(f)
        for (const animation of gsap.globalTimeline.getChildren(false, true, true)) animation.progress(1)
        for (const [entity, t] of this.things) {
            if (t.kind === 'stock') continue
            this.things.delete(entity)
            entity.destroy()
        }
        for (const person of this.crowd) person.root.removeFromParent()
        this.crowd.clear()
        this.families.clear()
        this.kit = null
        this.familyAtCounter = null
        this.#hushed()
        this.sayQueue = []
        this.sayUntil = 0
        this.ghost.visible = false
        this.tag.mesh.visible = false
        this.ending = false
        for (const [id, qty] of Object.entries(SHIFT_STOCK)) this.store.set(id, qty)
        this.#newDay(false)
        this.#begin()
    }

    /* ---------------- the cartons about the room ---------------- */

    /**
     * Where the cartons were left: in piles on the floor at either side of the table, on the
     * person's side, and one on each other surface the room has in sight. The work table starts
     * clear: nothing is on it until the person brings it there.
     */
    #pileSpots() {
        const F = this.frame3
        const spots = []
        // one on each other real surface in sight, two surfaces at most: never across the table, never behind
        let onSurfaces = 0
        for (const s of this.otherSurfaces ?? []) {
            const l = F.local(s.center, new THREE.Vector3())
            const height = s.top - F.floorY
            if (onSurfaces >= 2 || height < 0.3 || height > 1.4 || l.z < -F.depth || l.z > 0.7 || Math.hypot(l.x, l.z) > 3) continue
            spots.push({ local: new THREE.Vector3(l.x, height, l.z), yaw: (Math.random() - 0.5) * 0.25, column: `S${onSurfaces++}` })
        }
        const pile = (x, z, column) => ({ x, z, base: 0, column })
        // always on the floor, on the person's side of the table, just past its ends, left and right
        // a long table reaches past them: the piles stand in front of its edge, never under it
        const long = F.minX < -0.8 || F.maxX > 0.8
        const leftX = long ? -0.75 : Math.min(F.minX, -0.45) - 0.3
        const rightX = long ? 0.75 : Math.max(F.maxX, 0.45) + 0.3
        const second = long ? 0.45 : -0.24
        const columns = [pile(leftX, 0.12, 'L1'), pile(rightX, 0.12, 'R1'), pile(leftX, second, 'L2'), pile(rightX, second, 'R2')]
        const height = new Map()
        let level = 0
        while (spots.length < this.day.boxes.length && level < 4) {
            for (const c of columns) {
                if (spots.length >= this.day.boxes.length) break
                // three high at most: the top one at the height of a hand
                if (level >= 3) continue
                const n = height.get(c.column) ?? 0
                height.set(c.column, n + 1)
                spots.push({ local: new THREE.Vector3(c.x, c.base + n * (BOX.h + 0.004), c.z), yaw: (Math.random() - 0.5) * 0.25, column: c.column })
            }
            level++
        }
        return spots
    }

    /** The cartons appear where they were left, and settle under their own weight. */
    #spawnBoxes(boxes) {
        const spots = this.#pileSpots()
        // the first carton (the one the first time teaches with) is on top of the left pile, free to open
        const topLeft = spots.reduce((best, s, i) => (s.column === 'L1' && (best < 0 || s.local.y > spots[best].local.y) ? i : best), -1)
        if (topLeft > 0) spots.unshift(spots.splice(topLeft, 1)[0])
        boxes.forEach((b, i) => {
            const spot = spots[i] ?? spots[spots.length - 1]
            const object = cardboardBox()
            object.name = b.id
            this.frame3.at(spot.local.x, spot.local.y + BOX.h / 2 + 0.003, spot.local.z, object.position)
            object.quaternion.copy(yawQ(this.frame3.yaw + spot.yaw))
            const t = { kind: 'box', box: b }
            const entity = this.#thing(object, t, { parent: null })
            this.#dynamic(entity, BOX, { density: 0.35 })
            this.#occlude(entity)
            t.home = object.position.clone()
        })
    }

    /* ---------------- things ---------------- */

    /** Something the person works with: pressable, and taken by hand unless told otherwise. */
    #thing(object, info, { grab = true, parent = this.root } = {}) {
        const entity = this.world.createTransformEntity(object, parent ? { parent } : undefined)
        entity.addComponent(Workable)
        entity.addComponent(RayInteractable)
        if (grab) this.#makeGrabbable(entity)
        this.things.set(entity, info)
        info.object = object
        info.entity = entity
        return entity
    }

    #makeGrabbable(entity) {
        if (!this.world.session || entity.hasComponent(OneHandGrabbable)) return
        entity.addComponent(OneHandGrabbable, { rotate: true, translate: true })
        // not only with a hand up close: a pinch along the ray takes it too
        entity.object3D.pointerEventsType = 'all'
    }

    #worldOf(object) {
        return object.getWorldPosition(new THREE.Vector3())
    }

    /** The counts on the crates, and what can be taken from them. */
    #refreshShelf() {
        for (const zone of this.zones) {
            const rows = [...zone.stock.keys()].map((id) => ({ label: SUPPLIES[id].label, count: this.day.available(id) }))
            zone.label.refresh(rows)
            for (const [id, entity] of zone.stock) {
                const t = this.things.get(entity)
                if (!t || t.held) continue
                const on = this.day.available(id) > 0
                t.object.visible = on
                t.object.pointerEvents = on ? 'auto' : 'none'
            }
        }
    }

    /* ---------------- taking and letting go ---------------- */

    #take(entity) {
        const t = this.things.get(entity)
        if (!t) return
        t.held = true
        t.takenAt = this.elapsed
        t.takenFrom = this.#worldOf(t.object)
        gsap.killTweensOf(t.object.position)
        gsap.killTweensOf(t.object.scale)
        this.haptics.play('grab')
        // out of its carton it has weight, from the moment it is taken
        if (t.kind === 'item' && t.inCarton) {
            t.inCarton.slots.delete(t.slot)
            t.inCarton = null
            this.#dynamic(entity, t.object.userData.size, { density: 0.5 })
        }
    }

    /** Let go: where it is decides what it counts as; anywhere else it simply falls. */
    #release(entity) {
        const t = this.things.get(entity)
        if (!t) return
        t.held = false
        const where = this.#worldOf(t.object)
        const quick = this.elapsed - (t.takenAt ?? 0) < TAP_SECONDS && where.distanceTo(t.takenFrom ?? where) < TAP_MOVE
        if (t.kind === 'box') {
            if (quick) return this.#openBox(t)
            return this.#watchThrow(entity)
        }
        if (t.kind === 'item') return this.#releaseItem(entity, t, where)
        if (t.kind === 'stock') return this.#releaseStock(t, where)
        if (t.kind === 'kit') {
            if (this.#handedOver(where)) {
                if (this.day.canDeliver) return this.day.deliver()
                this.#say('warn', 'La caja está vacía')
            }
            return this.#watchThrow(entity)
        }
    }

    /** Over the far edge of the table, or close to whoever is at the counter. */
    #handedOver(where) {
        const f = this.familyAtCounter
        if (!f || !this.kit) return false
        const local = this.frame3.local(where, temp3)
        if (local.z < -this.frame3.depth + 0.1) return true
        const leader = this.rootObject.localToWorld(f.leader.position.clone())
        return Math.hypot(where.x - leader.x, where.z - leader.z) < HAND_OVER
    }

    #releaseItem(entity, t, where) {
        if (this.kit && this.#inKit(where)) return this.#packFromBox(entity, t)
        const zone = this.#crateAt(where)
        if (zone) return this.#stow(entity, t, zone)
        const carton = this.#cartonAt(where)
        if (carton) return this.#backInCarton(entity, t, carton)
        this.#watchThrow(entity)
    }

    #releaseStock(t, where) {
        if (this.kit && this.#inKit(where)) return this.#giveToKit(t)
        this.#goHome(t)
    }

    #inKit(where) {
        const kitAt = this.#worldOf(this.kit.object)
        return Math.hypot(where.x - kitAt.x, where.z - kitAt.z) < KIT_REACH && where.y > kitAt.y - 0.12 && where.y < kitAt.y + 0.5
    }

    #crateAt(where) {
        let best = null
        let bestDist = CRATE_REACH
        for (const zone of this.zones) {
            zone.crate.getWorldPosition(temp2)
            temp2.y += CRATE.h * 0.6
            const d = where.distanceTo(temp2)
            if (d < bestDist) {
                best = zone
                bestDist = d
            }
        }
        return best
    }

    /** An open carton under where it was let go. */
    #cartonAt(where) {
        for (const t of this.things.values()) {
            if (t.kind !== 'open') continue
            const local = t.object.worldToLocal(temp2.copy(where))
            if (Math.abs(local.x) < BOX.w / 2 + 0.03 && Math.abs(local.z) < BOX.d / 2 + 0.03 && local.y > -BOX.h / 2 && local.y < BOX.h / 2 + 0.3) return t
        }
        return null
    }

    #goHome(t) {
        gsap.to(t.object.rotation, { x: 0, y: 0, z: 0, duration: 0.25 })
        gsap.to(t.object.position, { x: t.home.x, y: t.home.y, z: t.home.z, duration: 0.35, ease: 'power2.inOut', onComplete: () => this.#refreshShelf() })
    }

    /** For a moment after being let go, nothing flies faster than a hand sets it down. */
    #watchThrow(entity) {
        const t = this.things.get(entity)
        if (t) t.tameUntil = this.elapsed + 0.4
    }

    #tame() {
        const forward = this.frame3.forward
        for (const [entity, t] of this.things) {
            if (!t.tameUntil || this.elapsed > t.tameUntil || !entity.hasComponent(PhysicsBody) || entity.hasComponent(PhysicsManipulation)) continue
            const v = entity.getVectorView(PhysicsBody, '_linearVelocity')
            const speed = Math.hypot(v[0], v[1], v[2])
            // towards the people across the table it stops short: only their carton may go to them
            const atPeople = t.kind !== 'kit' && v[0] * forward.x + v[2] * forward.z > 0.7
            if (speed <= MAX_THROW && !atPeople) continue
            const k = atPeople ? 0.1 : MAX_THROW / speed
            entity.addComponent(PhysicsManipulation, { linearVelocity: [v[0] * k, Math.min(v[1] * k, 0.4), v[2] * k], angularVelocity: [0, 0, 0] })
        }
    }

    /**
     * Nothing gets lost: what falls out of reach, through the floor, behind the person or over
     * among the people comes back onto the table, softly.
     */
    #recover() {
        const F = this.frame3
        for (const [entity, t] of this.things) {
            if (t.held || t.kind === 'open' || !entity.hasComponent(PhysicsBody) || entity.hasComponent(Grabbed)) continue
            const p = this.#worldOf(t.object)
            const l = F.local(p, temp3)
            const fell = p.y < -0.4
            const far = Math.abs(l.x) > 3.2 || l.z > 1.1 || l.z < -F.depth - 2.5
            const amongPeople = l.z < -F.depth - 0.25
            if (!fell && !far && !amongPeople) continue
            const spot = F.at(THREE.MathUtils.clamp(l.x, F.minX + 0.2, F.maxX - 0.2) * 0.5, this.top + 0.25, -Math.min(this.depth / 2, 0.3))
            this.world.getSystem(PhysicsSystem)?.setBodyTransform(entity, { position: spot, quaternion: yawQ(F.yaw) })
            this.sound.play('item', spot)
        }
    }

    /* ---------------- opening ---------------- */

    /** A fingertip run along a carton's tape tears it. */
    #tearTape() {
        if (!this.hands.tracked || !this.running) return
        for (const t of this.things.values()) {
            if (t.kind !== 'box' || t.held) continue
            let touching = null
            for (const side of Object.values(this.hands.sides)) {
                if (!side.seen) continue
                const local = t.object.worldToLocal(temp.copy(side.joints['index-finger-tip']))
                if (Math.abs(local.x) < BOX.w / 2 + 0.02 && Math.abs(local.z) < 0.06 && local.y > BOX.h / 2 - 0.02 && local.y < BOX.h / 2 + 0.04) touching = local.x
            }
            if (touching === null) {
                t.tearFrom = null
                continue
            }
            t.tearFrom ??= touching
            if (Math.abs(touching - t.tearFrom) > TEAR) {
                t.tearFrom = null
                this.#openBox(t)
            }
        }
    }

    /** Something resting on top of a carton keeps it shut. */
    #underneath(t) {
        const p = this.#worldOf(t.object)
        for (const o of this.things.values()) {
            if (o === t || (o.kind !== 'box' && o.kind !== 'open')) continue
            const q = this.#worldOf(o.object)
            if (q.y > p.y + BOX.h * 0.6 && Math.hypot(q.x - p.x, q.z - p.z) < 0.3) return true
        }
        return false
    }

    /**
     * Torn open where it stands: the carton stays there, open, and what it holds shows.
     * It becomes part of the room: something to search, not to carry about.
     */
    #openBox(t) {
        if (!this.running || t.kind !== 'box') return
        if (this.#underneath(t)) {
            this.haptics.play('wrong')
            return this.#say('warn', 'Primero baja la caja de arriba')
        }
        if (!this.day.openBox(t.box.id)) return
        this.haptics.play('tap')
        // upright where it was, still
        const object = cardboardBox()
        object.name = t.object.name
        object.position.copy(this.#worldOf(t.object))
        const e = new THREE.Euler().setFromQuaternion(t.object.getWorldQuaternion(new THREE.Quaternion()), 'YXZ')
        object.quaternion.copy(yawQ(e.y))
        this.things.delete(t.entity)
        t.entity.destroy()
        const open = { kind: 'open', box: t.box, slots: new Map() }
        const entity = this.#thing(object, open, { grab: false, parent: null })
        this.#occlude(entity)
        entity.addComponent(PhysicsShape, { shape: 'Box', dimensions: [BOX.w, BOX.h, BOX.d], friction: 0.9 })
        entity.addComponent(PhysicsBody, { state: PhysicsState.Static })
        object.pointerEvents = 'none'
        const { flaps, seal } = object.userData
        seal.visible = false
        this.sound.play('tape', object.position)
        for (const hinge of flaps) gsap.to(hinge.rotation, { x: hinge.userData.side * 2.75, duration: 0.55, ease: 'power2.out' })
        open.layout = cartonLayout(this.supplies, t.box.items)
        open.layout.forEach(({ itemId, fit, position }, slot) => this.#itemInCarton(open, itemId, fit, position, slot))
        this.#say('info', 'Guarda cada cosa en su lado')
    }

    /** A supply sitting in an open carton: no weight until it is taken. */
    #itemInCarton(open, itemId, fit, position, slot) {
        const object = supplyObject(this.loader, this.supplies.get(itemId), itemId, fit)
        object.position.copy(position)
        open.object.localToWorld(object.position)
        object.quaternion.copy(open.object.quaternion)
        const t = { kind: 'item', itemId, box: open.box, inCarton: open, slot }
        const entity = this.#thing(object, t, { parent: null })
        this.#occlude(entity)
        open.slots.set(slot, entity)
        return entity
    }

    /** Let go over an open carton: it goes back in, in a free place. */
    #backInCarton(entity, t, carton) {
        const free = carton.layout?.findIndex((s, i) => !carton.slots.has(i)) ?? -1
        if (free < 0) return this.#watchThrow(entity)
        this.things.delete(entity)
        entity.destroy()
        const { fit, position } = carton.layout[free]
        this.#itemInCarton(carton, t.itemId, fit, position, free)
        this.sound.play('item', this.#worldOf(carton.object))
    }

    /** Into its crate, or a word about where it goes. */
    #stow(entity, t, zone) {
        const result = this.day.sort(t.box.id, t.itemId, zone.categoryId)
        if (!result.ok) {
            this.sound.play('wrong', this.#worldOf(zone.crate))
            this.haptics.play('wrong')
            this.#say('warn', `${SUPPLIES[t.itemId].label} va en ${result.wanted}`)
            return this.#watchThrow(entity)
        }
        this.haptics.play('right')
        this.things.delete(entity)
        const into = this.#worldOf(zone.crate).add(temp.set(0, CRATE.h * 0.5, 0))
        // the body goes at once; what is seen drops in
        const look = t.object.clone()
        look.position.copy(this.#worldOf(t.object))
        look.quaternion.copy(t.object.getWorldQuaternion(new THREE.Quaternion()))
        entity.destroy()
        this.world.scene.add(look)
        gsap.to(look.scale, { x: 0.4, y: 0.4, z: 0.4, duration: 0.28, ease: 'power2.in' })
        gsap.to(look.position, { x: into.x, y: into.y, z: into.z, duration: 0.28, ease: 'power2.in', onComplete: () => look.removeFromParent() })
        this.sound.play('item', into)
    }

    #giveToKit(t) {
        const label = SUPPLIES[t.itemId].label
        const result = this.day.addToKit(t.itemId)
        if (!result.ok) {
            this.sound.play('wrong', this.#worldOf(this.kit.object))
            this.haptics.play('wrong')
            if (result.reason === 'extra') this.#say('warn', `${label}: no está en el pedido`)
            if (result.reason === 'stock') this.#say('warn', `No queda ${label.toLowerCase()}`)
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
            this.#say('warn', `${SUPPLIES[t.itemId].label}: no está en el pedido`)
            return this.#watchThrow(entity)
        }
        this.things.delete(entity)
        entity.destroy()
        this.#showInKit(t.itemId)
    }

    /** One more unit in the kit, in the place kept for it. */
    #showInKit(itemId) {
        this.haptics.play('right')
        const slot = this.kit.layout.findIndex((s, i) => s.itemId === itemId && !this.kit.used.has(i))
        if (slot < 0) return
        this.kit.used.add(slot)
        const { fit, position } = this.kit.layout[slot]
        const object = supplyObject(this.loader, this.supplies.get(itemId), itemId, fit)
        object.position.copy(position)
        this.kit.object.add(object)
        this.sound.play('item', this.#worldOf(this.kit.object))
    }

    /* ---------------- pressing (a mouse) ---------------- */

    /** Cartons open by a tap that takes them (see #release); with a mouse, by a click (see #dropAt). */
    #press(entity) {
        if (this.view || this.holding) return
        const t = this.things.get(entity)
        if (!t || entity.hasComponent(OneHandGrabbable)) return
        if (t.kind === 'box') this.#openBox(t)
    }

    #pressNext() {
        if (!this.next.visible) return
        const previous = this.day.current
        const hadItems = this.day.canDeliver
        if (!this.day.callNext()) return
        this.sound.play('tap')
        if (hadItems) this.#say('warn', `Lo de ${previous.family} volvió al inventario`)
    }

    /* ---------------- carrying, with a mouse ---------------- */

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
        const carriable = [...this.things.values()].filter((t) => t.object.visible && t.kind !== 'open')
        const hits = this.#rayAt(ndc).intersectObjects(carriable.map((t) => t.object), true)
        const found = hits.length ? this.#entityOf(hits[0]) : null
        if (!found) return false
        this.holding = { entity: found.entity, t: found.t, moved: false, distance: Math.min(hits[0].distance, 0.9) }
        // the physics follows the hand that holds it, here the mouse
        found.entity.addComponent(Grabbed)
        this.#holdAt(ndc, true)
        return true
    }

    #holdAt(ndc, first = false) {
        if (!this.holding) return
        if (!first) this.holding.moved = true
        const { ray } = this.#rayAt(ndc)
        this.holdTarget.copy(ray.origin).addScaledVector(ray.direction, Math.max(0.55, this.holding.distance))
    }

    #carry(dt) {
        if (!this.holding?.moved) return
        const { object } = this.holding.t
        const local = object.parent.worldToLocal(temp.copy(this.holdTarget))
        object.position.lerp(local, 1 - Math.exp(-dt * 22))
    }

    /**
     * Let go with the mouse: if over a crate, the kit or an open carton, it goes there; over
     * the table or the floor, it is set down there and falls the last few centimetres.
     */
    #dropAt(ndc) {
        if (!this.holding) return
        const { entity, t, moved } = this.holding
        this.holding = null
        if (!moved) {
            entity.removeComponent(Grabbed)
            // a click: a carton opens, whatever else was picked goes back on its own
            if (t.kind === 'box') this.#openBox(t)
            return
        }
        const ray = this.#rayAt(ndc)
        const object = t.object
        const put = (world) => object.position.copy(object.parent.worldToLocal(world.clone()))
        const zoneHit = this.zones.find((z) => ray.intersectObject(z.crate, true).length)
        const kitHit = this.kit && ray.intersectObject(this.kit.object, true).length
        const cartonHit = [...this.things.values()].find((o) => o.kind === 'open' && ray.intersectObject(o.object, true).length)
        if (kitHit) put(this.#worldOf(this.kit.object).add(temp.set(0, 0.1, 0)))
        else if (zoneHit) put(this.#worldOf(zoneHit.crate).add(temp.set(0, CRATE.h * 0.6, 0)))
        else if (cartonHit) put(this.#worldOf(cartonHit.object).add(temp.set(0, 0.1, 0)))
        else if (t.kind === 'kit' && this.familyAtCounter && ray.intersectObject(this.familyAtCounter.leader.root, true).length) put(this.rootObject.localToWorld(this.familyAtCounter.leader.position.clone()).setY(this.top + 0.2))
        else {
            const surface = ray.intersectObjects(this.surfaceMeshes, false)[0]
            if (surface) put(surface.point.add(temp.set(0, (object.userData.size?.h ?? 0.2) / 2 + 0.05, 0)))
        }
        object.updateMatrixWorld(true)
        entity.removeComponent(Grabbed)
    }

    /* ---------------- the first time ---------------- */

    /** What shines and what the line says, read from how things stand: any order of doing them works. */
    #guideStep() {
        const { day } = this
        const hands = !!this.world.session
        const things = [...this.things.values()]
        const held = things.find((t) => t.held) ?? this.holding?.t
        if (day.calm && !day.current) {
            const first = things.find((t) => t.kind === 'box' && t.box === day.boxes[0])
            return { phase: 'open', targets: first ? [first.object] : [], text: hands ? 'Abre la caja: pasa el dedo por la cinta' : 'Haz clic en la caja para abrirla' }
        }
        if (day.calm) {
            const missing = Object.keys(day.missing)
            if (!missing.length) return { phase: 'deliver', targets: [this.kit.object], text: 'Pásale la caja por encima de la mesa' }
            let targets = []
            if (held && (held.kind === 'item' || held.kind === 'stock')) targets = missing.includes(held.itemId) ? [this.kit.object] : []
            else {
                targets = missing.flatMap((id) => {
                    const loose = things.filter((t) => t.kind === 'item' && t.itemId === id).map((t) => t.object)
                    if (loose.length) return loose
                    const zone = this.zones.find((z) => z.stock.has(id))
                    return zone ? [this.things.get(zone.stock.get(id)).object] : []
                })
            }
            return { phase: 'order', targets, text: 'Pon en su caja lo que pide' }
        }
        // handed over, time runs again: only what was left in the open carton still gets a hand
        const left = things.filter((t) => t.kind === 'item' && t.box === day.boxes[0])
        if (!left.length || day.current) return null
        let targets = left.map((t) => t.object)
        if (held?.kind === 'item') targets = [this.zones.find((z) => z.categoryId === SUPPLIES[held.itemId].category).crate]
        return { phase: 'sort', targets, text: 'Guarda el resto: comida a la izquierda' }
    }

    #followGuide() {
        if (!this.guide || !this.running) return
        const step = this.#guideStep()
        if (!step) return this.#endGuide(true)
        this.glow.show(step.targets)
        this.glow.update(this.elapsed)
        if (step.phase !== this.guide.phase) {
            this.guide.phase = step.phase
            this.sayUntil = 0
            this.#show('info', step.text)
        } else if (step.text !== this.shownText && this.elapsed >= this.sayUntil) this.#show('info', step.text)
    }

    #endGuide(finished = false) {
        if (!this.guide) return
        this.guide = null
        this.glow.show([])
        if (finished && this.running) this.#say('done', 'Ya sabes cómo es. Ahora llega más gente')
    }

    /* ---------------- the list, on the arm ---------------- */

    /** Shows or hides it in front of the eyes, on a computer. */
    toggleList(on = !this.listOn) {
        if (!this.placed || !this.running) return
        this.sound.play('tap')
        this.listOn = on
        this.listFresh = true
    }

    #refreshWatch() {
        const rows = this.day.todo.slice(0, 4)
        const { done, total } = this.day.progress
        this.watch.text('progress', `${done} de ${total}`)
        for (let i = 0; i < 4; i++) {
            const row = rows[i]
            this.watch.display(`row${i}`, !!row)
            if (!row) continue
            this.watch.text(`label${i}`, row.label)
            this.watch.text(`detail${i}`, row.detail)
            this.watch.set(`dot${i}`, { backgroundColor: DOT[row.tone] ?? DOT.work })
        }
    }

    /** Along the forearm while the wrist is turned to the eyes; in front of them on a computer. */
    #placeWatch(dt) {
        const palm = this.running ? this.hands.openPalm : null
        const on = !!palm || (!this.world.session && this.listOn && this.running)
        if (on !== this.watch.visible) {
            this.watch.show(on)
            if (on) {
                this.sound.play('tap')
                this.#refreshWatch()
                this.listFresh = true
            }
        }
        if (!on) return
        const target = temp
        if (palm) target.copy(palm.over)
        else {
            const cam = this.world.camera
            cam.getWorldDirection(temp2)
            target.copy(this.head).addScaledVector(temp2, 0.5).add(temp3.set(0, -0.05, 0))
        }
        const { object } = this.watch
        if (this.listFresh) object.position.copy(target)
        else object.position.lerp(target, 1 - Math.exp(-dt * 18))
        this.listFresh = false
        object.lookAt(this.head)
    }

    /* ---------------- the order, as the things themselves ---------------- */

    /** Over the family's carton: see-through copies of what is still missing, and whose it is. */
    #rebuildGhost() {
        const order = this.day.current
        this.ghost.clear()
        if (!order || !this.kit) {
            this.ghost.visible = false
            this.tag.mesh.visible = false
            return
        }
        const missing = Object.entries(this.day.missing).flatMap(([id, n]) => Array(n).fill(id))
        const status = (id) => (this.day.available(id) > 0 ? 'shelf' : this.day.inOpenCartons(id) > 0 ? 'box' : 'unknown')
        const models = missing.map((id) => {
            const object = supplyObject(this.loader, this.supplies.get(id), id, 0.7)
            object.traverse((o) => {
                if (!o.isMesh) return
                o.material = [o.material].flat().map((m) => {
                    const c = m.clone()
                    c.transparent = true
                    c.opacity = 0.55
                    c.depthWrite = false
                    return c
                })
                if (o.material.length === 1) o.material = o.material[0]
            })
            object.userData.status = status(id)
            return object
        })
        let x = -models.reduce((n, m) => n + m.userData.size.w + 0.025, -0.025) / 2
        for (const m of models) {
            m.position.x = x + m.userData.size.w / 2
            m.position.y = m.userData.size.h / 2
            x += m.userData.size.w + 0.025
            this.ghost.add(m)
        }
        this.ghost.visible = models.length > 0
        this.tag.refresh({ family: order.family, urgent: !!order.urgent })
        this.tag.mesh.visible = true
    }

    #placeGhost() {
        if (!this.kit || !this.tag.mesh.visible) return
        const at = this.#worldOf(this.kit.object)
        this.ghost.position.copy(at).add(temp.set(0, BOX.h / 2 + 0.12 + Math.sin(this.elapsed * 2) * 0.01, 0))
        this.ghost.rotation.y = Math.atan2(this.head.x - at.x, this.head.z - at.z)
        const tagY = this.ghost.visible ? 0.24 : 0.08
        this.tag.mesh.position.copy(at).add(temp.set(0, BOX.h / 2 + tagY, 0))
        this.tag.mesh.lookAt(this.head)
        for (const m of this.ghost.children) m.rotation.y += 0.01
    }

    /* ---------------- people ---------------- */

    /** At their real height: the shared characters are built bigger than life. */
    #person(id, position, yaw) {
        const child = id.includes('nino')
        const elder = id.includes('mayor')
        const model = this.loader.instanceSync(this.people.get(id))
        if (!this.personHeight.has(id)) this.personHeight.set(id, new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y || 1)
        const height = (child ? HEIGHT.child : elder ? HEIGHT.elder : HEIGHT.adult) * (0.97 + Math.random() * 0.06)
        const person = new GuideCharacter(model, [], { face: true, stoop: elder ? 0.12 : 0 })
        person.root.scale.setScalar(height / this.personHeight.get(id))
        person.height = height
        person.place(position, yaw)
        person.temper = new Temper(person)
        person.appear()
        this.rootObject.add(person.root)
        this.crowd.add(person)
        return person
    }

    /** Where they wait: across the table, the first ones closer. */
    #lineSlots() {
        const D = this.depth
        return [
            { x: -0.5, z: -D - 1.1 },
            { x: 0.5, z: -D - 1.15 },
            { x: -1.0, z: -D - 1.7 },
            { x: 0.05, z: -D - 1.75 },
            { x: 1.05, z: -D - 1.7 },
            { x: -0.5, z: -D - 2.3 },
            { x: 0.55, z: -D - 2.35 },
        ]
    }

    #counterSpot() {
        return { x: 0, z: -this.depth - 0.42 }
    }

    /** A family keeps together: the first walks, the rest go beside them. */
    #familyPeople(order, x) {
        const [first, ...rest] = order.visitors
        const entryZ = -this.depth - 3.4
        const leader = this.#person(first, new THREE.Vector3(x, 0, entryZ), 0)
        const members = [leader]
        let beside = 0.22
        for (const id of rest) {
            const person = this.#person(id, new THREE.Vector3(x + beside + 0.2, 0, entryZ), 0)
            person.follow(leader, { x: -(beside + 0.2), z: 0.05 }, { x: -(beside + 0.2) * 0.8, z: -0.2 })
            beside += 0.4
            members.push(person)
        }
        return { leader, members }
    }

    #walkTo(leader, x, z, then) {
        leader.walk([leader.position.clone(), new THREE.Vector3(x, 0, z)], { speed: WALK_SPEED }).then((arrived) => {
            if (arrived !== false) then?.()
        })
    }

    #freeSlot() {
        const taken = [...this.families.values()].map((f) => f.slot)
        return this.#lineSlots().find((s) => !taken.some((t) => t && t.x === s.x && t.z === s.z)) ?? this.#lineSlots()[0]
    }

    #familyJoins(order) {
        const slot = this.#freeSlot()
        const { leader, members } = this.#familyPeople(order, slot.x)
        const f = { leader, members, card: null, slot, order }
        this.families.set(order.id, f)
        this.#giveCard(f)
        this.#walkTo(leader, slot.x, slot.z, () => (leader.targetYaw = 0))
        if (order.urgent) {
            this.sound.play('alert')
            this.#say('alert', `Urgente: ${order.family}`)
        } else if (this.day.current) this.sound.play('radio')
        this.#refreshNext()
    }

    /** The card over the head of whoever is in line. */
    #giveCard(f) {
        const card = familyCard()
        card.mesh.pointerEvents = 'none'
        this.rootObject.add(card.mesh)
        f.card = card
        this.#refreshCard(f)
    }

    #refreshCard(f) {
        const { family, urgent } = f.order
        f.card.refresh({ family, urgent, left: barStep(leftOf(f.order)) })
    }

    #followCards() {
        for (const f of this.families.values()) {
            if (!f.card) continue
            const speaking = this.speaker === f
            f.card.mesh.visible = !speaking
            f.card.mesh.position.set(f.leader.position.x, f.leader.height + 0.2, f.leader.position.z)
            f.card.mesh.lookAt(this.head)
        }
    }

    #familyStepsBack() {
        const f = this.familyAtCounter
        this.familyAtCounter = null
        this.#dropKit()
        f.slot = this.#freeSlot()
        this.#giveCard(f)
        this.#walkTo(f.leader, f.slot.x, f.slot.z, () => (f.leader.targetYaw = 0))
    }

    #dropKit() {
        if (!this.kit) return
        this.things.delete(this.kit.entity)
        this.kit.entity.destroy()
        this.kit = null
        this.#rebuildGhost()
    }

    #feelings() {
        for (const { order, members } of this.families.values()) {
            const left = leftOf(order)
            for (const person of members) person.temper.left = left
        }
    }

    /** One at a time, whoever is worst off says so, in a bubble over their head: never over the table. */
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
        this.bubble.refresh({ text: complaintFor(next.order, leftOf(next.order), this.complaintTurn++), side: 1 })
        this.#placeBubble()
        this.bubble.mesh.visible = true
        this.sound.play('grumble', this.rootObject.localToWorld(next.leader.position.clone()))
    }

    #placeBubble() {
        const { leader } = this.speaker
        this.bubble.mesh.position.set(leader.position.x, leader.height + 0.32, leader.position.z)
        this.bubble.mesh.scale.setScalar(0.7)
        this.bubble.mesh.lookAt(this.head)
    }

    #hushed() {
        this.speaker = null
        if (this.bubble) this.bubble.mesh.visible = false
    }

    #removeCard(f) {
        if (!f.card) return
        f.card.mesh.removeFromParent()
        f.card = null
    }

    /** Their turn: they come up to the table, and an empty carton for them appears on it. */
    #familyComes(order) {
        const f = this.families.get(order.id)
        f.slot = null
        this.familyAtCounter = f
        this.#removeCard(f)
        const spot = this.#counterSpot()
        this.#walkTo(f.leader, spot.x, spot.z, () => (f.leader.targetYaw = 0))
        const F = this.frame3
        const kitObject = cardboardBox(KIT_TAPE)
        kitObject.userData.seal.visible = false
        for (const hinge of kitObject.userData.flaps) hinge.rotation.x = hinge.userData.side * 2.75
        kitObject.name = order.id
        F.at(Math.min(F.maxX - BOX.w / 2 - 0.05, 0.32), this.top + BOX.h / 2 + 0.01, -Math.min(this.depth / 2, 0.3), kitObject.position)
        kitObject.quaternion.copy(yawQ(F.yaw))
        gsap.from(kitObject.scale, { x: 0.5, y: 0.5, z: 0.5, duration: 0.45, ease: 'back.out(2)' })
        const t = { kind: 'kit' }
        const entity = this.#thing(kitObject, t, { parent: null })
        this.#dynamic(entity, BOX, { density: 0.4 })
        this.#occlude(entity)
        const units = Object.entries(order.items).flatMap(([id, q]) => Array(q).fill(id))
        this.kit = { entity, object: kitObject, layout: cartonLayout(this.supplies, units), used: new Set() }
        this.#rebuildGhost()
        this.sound.play('radio')
        if (!this.guide) this.#say(order.urgent ? 'alert' : 'radio', `Pasa ${order.family}`)
        this.#refreshNext()
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

    /** They take their carton in their arms and go. */
    #familyLeaves(order) {
        const f = this.familyAtCounter
        this.familyAtCounter = null
        if (this.kit) {
            const carried = this.kit.object.clone()
            carried.scale.setScalar(1 / f.leader.root.scale.x)
            carried.position.set(0, (f.leader.height * 0.55) / f.leader.root.scale.x, 0.22 / f.leader.root.scale.x)
            carried.quaternion.identity()
            f.leader.root.add(carried)
            this.#dropKit()
        }
        this.sound.play('done')
        const short = Object.entries(order.short ?? {})
        for (const person of f.members) {
            person.temper.settled = short.length ? 'worried' : 'happy'
            if (!short.length) person.celebrate()
        }
        this.#sendAway(f, 2.6, -this.depth - 3.4)
        if (order.gaveUp) this.#say('warn', `${order.family} se cansó de esperar`)
        else if (short.length) this.#say('warn', `${order.family} se fue sin ${list(short.map(([id, n]) => `${n} ${low(id)}`))}`)
        else this.#say('done', `${order.family} recibió todo`)
    }

    #familyGivesUp(order) {
        const f = this.families.get(order.id)
        this.#removeCard(f)
        f.slot = null
        for (const person of f.members) person.temper.settled = 'angry'
        if (this.familyAtCounter === f) {
            this.familyAtCounter = null
            this.#dropKit()
        }
        this.#sendAway(f, f.leader.position.x, -this.depth - 3.4)
        this.sound.play('wrong')
        this.#say('alert', `${order.family} se fue sin nada`)
    }

    /** The button that brings someone forward: only while someone is waiting and the counter is busy. */
    #refreshNext() {
        const next = this.running ? this.day.nextInLine : null
        const on = !!next && !!this.day.current
        this.next.show(on)
        if (on) {
            this.next.text('family', next.family)
            this.next.text('title', next.urgent ? 'Urgente' : 'Que pase')
        }
    }

    /** One group of signs at a time. */
    #refreshSigns() {
        this.signTurn = ((this.signTurn ?? 0) + 1) % 3
        if (this.signTurn === 0) for (const f of this.families.values()) if (f.card && f.order.state === 'waiting') this.#refreshCard(f)
        if (this.signTurn === 1 && this.watch.visible) this.#refreshWatch()
        if (this.signTurn === 2) this.#refreshNext()
    }

    /* ---------------- what the day answers ---------------- */

    #onDay(event, detail) {
        if (event === 'received') this.#spawnBoxes(detail)
        if (event === 'emptied') this.#clearBox(detail)
        if (event === 'joined') this.#familyJoins(detail)
        if (event === 'backToLine') this.#familyStepsBack()
        if (event === 'order') this.#familyComes(detail)
        if (event === 'packed') {
            this.#rebuildGhost()
            if (detail.complete) {
                this.sound.play('done')
                if (!this.guide) this.#say('info', 'Completo: pásale la caja')
            }
        }
        if (event === 'impatient') this.sound.play('radio')
        if (event === 'delivered') this.#familyLeaves(detail)
        if (event === 'left') this.#familyGivesUp(detail)
        if (event === 'finished') this.#closing(detail)
        if (this.zones) {
            this.#refreshShelf()
            if (this.watch?.visible) this.#refreshWatch()
            this.#refreshNext()
        }
    }

    /** An emptied carton is folded away, and leaves its place free. */
    #clearBox(box) {
        for (const [entity, t] of this.things) {
            if (t.kind !== 'open' || t.box !== box) continue
            this.things.delete(entity)
            gsap.to(t.object.scale, { y: 0.05, duration: 0.35, ease: 'power2.in', onComplete: () => entity.destroy() })
            this.sound.play('box', this.#worldOf(t.object))
        }
    }

    /* ---------------- closing ---------------- */

    #closing(r) {
        this.#endGuide()
        this.#hushed()
        this.running = false
        this.ending = true
        this.message.show(false)
        this.watch.show(false)
        this.next.show(false)
        this.sayQueue = []
        const names = (orders) => list(orders.map((o) => o.family))
        const lines = []
        if (r.left.length) lines.push(`Se fueron sin nada: ${names(r.left)}`)
        if (r.partial.length) lines.push(`Incompletos: ${names(r.partial)}`)
        if (r.boxesLeft) lines.push(`Quedaron ${r.boxesLeft} ${r.boxesLeft === 1 ? 'caja' : 'cajas'} sin abrir`)
        if (lines.length < 3) lines.push('Cada donación que ves en la app pasó por este trabajo.')
        const minutes = Math.max(1, Math.round(r.seconds / 60))
        this.#board({
            kicker: `${minutes} ${minutes === 1 ? 'MINUTO' : 'MINUTOS'} DE TURNO`,
            title: 'Así fue tu turno',
            stats: [
                { value: String(r.people), label: 'personas atendidas' },
                { value: `${r.whole.length}/${r.orders}`, label: 'pedidos completos' },
                { value: String(r.sorted), label: 'insumos guardados' },
            ],
            lines,
            action: 'Hacer otro turno',
        })
        this.sound.play('done')
    }

    /* ---------------- the room's own light ---------------- */

    /** The headset's cameras, if the person allows them: only to know how bright the room is. */
    #cameraLight() {
        if (!this.world.session || this.cameraEntity) return
        try {
            this.cameraEntity = this.world.createEntity()
            this.cameraEntity.addComponent(CameraSource, { facing: 'back', width: 320, height: 240, frameRate: 5 })
        } catch (err) {
            console.warn('[ar] no camera for the room light', err)
        }
    }

    /** Every few seconds, the virtual light follows the room's: a dim room, dimmer things. */
    #roomLight(dt) {
        this.lightClock += dt
        if (!this.cameraEntity || this.lightClock < 2) return
        this.lightClock = 0
        let canvas = null
        try {
            if (this.cameraEntity.getValue(CameraSource, 'state') !== 'active') return
            canvas = CameraUtils.captureFrame(this.cameraEntity)
        } catch {
            return
        }
        if (!canvas) return
        const small = (this.lightCanvas ??= Object.assign(document.createElement('canvas'), { width: 8, height: 8 }))
        const ctx = small.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(canvas, 0, 0, 8, 8)
        const { data } = ctx.getImageData(0, 0, 8, 8)
        let sum = 0
        for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        const luminance = sum / (data.length / 4) / 255
        this.room = THREE.MathUtils.clamp(0.35 + luminance * 1.4, 0.45, 1.25)
    }
}
