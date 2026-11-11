import { createSystem, GrabSystem, Grabbed, Hovered, OneHandGrabbable, Pressed, RayInteractable, VisibilityState, XRAnchor } from '@iwsdk/core'
import gsap from 'gsap'
import * as THREE from 'three'
import { AssetLoader } from '../../src/three/AssetLoader.js'
import { GuideCharacter } from '../../src/three/GuideCharacter.js'
import { CATEGORIES, SUPPLIES } from '../../src/data/catalog.js'
import { InventoryStore, sheetsEndpoint } from '../../src/app/inventoryStore.js'
import { Workable } from './components.js'
import { Haptics } from './haptics.js'
import { COMPLAINS_BELOW, complaintFor } from './sim/temper.js'
import { SHIFT_STOCK, TRUCK_GAP, VISITORS, Workday } from './sim/workday.js'
import { Sound } from './sound.js'
import { Atmosphere } from './world/atmosphere.js'
import { DesktopView } from './world/desktopView.js'
import { Glow } from './world/glow.js'
import { bigBoard, buttonPanel, familyCard, fontsReady, messageBoard, nextPanel, orderCard, receivePanel, speechBubble, taskList } from './world/panels.js'
import { buildStation, cardboardBox, cartonLayout, crateLayout, hangFromRoof, preloadSupplies, supplyObject, WORKER } from './world/station.js'
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
/** The truck stops just outside the tent, at the person's left, and drives along that side. */
const TRUCK_X = -4
const TRUCK_PARK_Z = WORKER.z + 0.2
const TRUCK_FROM_Z = -18
const TRUCK_TO_Z = 18
const TRUCK_IN_SECONDS = 4.5
const TRUCK_OUT_SECONDS = 4
/** How far from the person, to their left, the panel of the truck floats. */
const RECEIVE_REACH = 1
/** What someone being carried on a computer floats at, from the eyes. */
const HOLD_DISTANCE = 0.72
/** How close, on screen, the pointer must be to count as over something it was let go on. */
const DROP_NEAR = 0.2
/** The same, for a ray in the headset: how far from it, in metres. */
const RAY_NEAR = 0.24
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
        if (!this.paused) this.#complaints(delta)
        this.#followCards()
        this.#carry(delta)
        this.#markHeld()
        this.#followGuide()
        this.#pollButtons()
        this.#placeList(delta)
        // what is expected next breathes: it can be found without reading the whole table
        this.action.halo.material.opacity = 0.6 + 0.4 * Math.sin(this.elapsed * 3.2)
        this.signClock += delta
        if (this.signClock > SIGN_TURN) {
            this.signClock = 0
            this.#refreshSigns()
        }
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
        const [stand, supplies, people] = await Promise.all([
            this.loader.load('collection-point'),
            preloadSupplies(this.loader),
            Promise.all(VISITORS.map((id) => this.loader.load(id).then((t) => [id, t]))),
        ])
        this.stand = stand
        this.supplies = supplies
        this.people = new Map(people)
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
            solids: this.station.solids,
            bounds: { minX: -2.4, maxX: 2.4, minZ: -2.4, maxZ: 1.7 },
            roof: (on) => this.station.tent.traverse((o) => o.userData.roof && (o.visible = on)),
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
        if (name === 'persona') return this.view.stand(WORKER.x, WORKER.z + 0.55, 0, -0.2)
        if (name === 'arriba') return this.view.lookFrom(temp.set(0, 6.6, 1.9), temp2.set(0, 0.3, -0.9), true)
        if (name === 'frente') return this.view.lookFrom(temp.set(1.6, 1.9, -7), temp2.set(0, 1.1, -1), false)
    }

    /** In the headset: wherever the person stands and looks when they press is behind the counter. */
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
        hint.refresh({ kind: 'info', text: 'Busca unos 3 metros libres, mira hacia el frente y presiona para levantar tu carpa.' })
        this.world.scene.add(hint.mesh)
        const head = new THREE.Vector3()
        const dir = new THREE.Vector3()
        // leaving before the tent is up: it can start over on coming back
        this.cancelPlacement = () => {
            this.cancelPlacement = null
            stop()
            this.world.scene.remove(hint.mesh)
            this.placing = false
        }
        const stop = this.world.onXRFrame(() => {
            const cam = this.world.camera
            cam.getWorldPosition(head)
            cam.getWorldDirection(dir)
            hint.mesh.position.copy(head).addScaledVector(dir, 0.9)
            hint.mesh.lookAt(head)
        })
        const confirm = () => {
            session.removeEventListener('select', confirm)
            this.cancelPlacement = null
            stop()
            this.world.scene.remove(hint.mesh)
            // the tent's -Z along the gaze, the person's spot under their feet
            const yaw = Math.atan2(-dir.x, -dir.z)
            const offset = WORKER.clone().applyAxisAngle(temp.set(0, 1, 0), yaw)
            this.#place(new THREE.Vector3(head.x - offset.x, 0, head.z - offset.z), yaw)
        }
        session.addEventListener('select', confirm)
    }

    #place(at, yaw) {
        this.placed = true
        const rootObject = new THREE.Group()
        rootObject.position.copy(at)
        rootObject.rotation.y = yaw
        this.root = this.world.createTransformEntity(rootObject)
        this.rootObject = rootObject
        this.station = buildStation(rootObject, this.loader, this.stand)
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
        this.#intro()
    }

    /* ---------------- the room's signs ---------------- */

    #boards() {
        const root = this.rootObject
        const top = this.station.deskTop
        const far = this.station.deskFar + 0.22
        const x = WORKER.x
        // leaving the middle free for whoever is at the counter
        this.message = messageBoard()
        this.message.mesh.position.set(x - 0.76, 0, far)
        this.message.mesh.rotation.y = 0.26
        hangFromRoof(this.message, top + 0.88)
        root.add(this.message.mesh)
        this.order = orderCard()
        this.order.mesh.position.set(x + 0.76, 0, far)
        this.order.mesh.rotation.y = -0.26
        hangFromRoof(this.order, top + 0.88)
        this.order.mesh.visible = false
        root.add(this.order.mesh)
        this.big = bigBoard()
        this.big.mesh.position.set(x, 0, far)
        this.big.mesh.visible = false
        hangFromRoof(this.big, top + 1.0)
        root.add(this.big.mesh)
        // right at the person's left, with the truck behind it. It looks at the person.
        this.receive = receivePanel()
        this.#thing(this.receive.mesh, { kind: 'receive' }, { grab: false })
        this.receive.mesh.position.set(x - RECEIVE_REACH, 1.3, WORKER.z)
        this.receive.mesh.rotation.y = Math.PI / 2
        this.#setActive(this.receive.mesh, false)
        this.truck = buildTruck()
        this.truck.object.visible = false
        root.add(this.truck.object)
        // the buttons: the one that hands over, between the mats; the list, to one side
        this.action = buttonPanel('Empezar el turno', { width: 0.32, height: 0.095, halo: '#FFD34D' })
        this.#thing(this.action.mesh, { kind: 'action' }, { grab: false })
        this.action.mesh.position.set(x, top + 0.05, this.station.matZ + 0.09)
        this.action.mesh.rotation.x = -0.9
        this.#setActive(this.action.mesh, false)
        // up in the middle, between the signs, while there is someone in line to bring forward
        this.nextButton = nextPanel()
        this.#thing(this.nextButton.mesh, { kind: 'next' }, { grab: false })
        this.nextButton.mesh.position.set(x, 0, far)
        hangFromRoof(this.nextButton, top + 0.88)
        this.#setActive(this.nextButton.mesh, false)
        this.glow = new Glow(this.world.scene)
        this.bubble = speechBubble()
        this.bubble.mesh.visible = false
        this.bubble.mesh.pointerEvents = 'none'
        this.bubble.mesh.scale.setScalar(1.25)
        root.add(this.bubble.mesh)
        this.complaintIn = 0
        this.complaintTurn = 0
        // something to shine on where a carton goes: the mat itself cannot be pressed or carried
        this.matSpot = new THREE.Object3D()
        this.matSpot.position.copy(this.station.mat)
        root.add(this.matSpot)
        this.listButton = buttonPanel('Por hacer', { width: 0.22, height: 0.085, fill: '#011E41' })
        this.#thing(this.listButton.mesh, { kind: 'list' }, { grab: false })
        this.listButton.mesh.position.set(x, top + 0.05, this.station.matZ - 0.1)
        this.listButton.mesh.rotation.x = -0.9
        // called up with a button; the world's child rather than the tent's, it goes with the person
        this.list = taskList()
        this.list.mesh.visible = false
        this.world.scene.add(this.list.mesh)
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
        object.position.set(TRUCK_X, 0, fromZ)
        gsap.to(object.position, { z: toZ, duration: seconds, ease, onComplete: then })
        for (const wheel of wheels) gsap.to(wheel.rotation, { x: `+=${(toZ - fromZ) / wheelRadius}`, duration: seconds, ease })
        this.sound.play('truck', this.rootObject.localToWorld(new THREE.Vector3(TRUCK_X, 1, TRUCK_PARK_Z)))
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
            this.#say('radio', 'Llegó el camión. Recibe las donaciones en el panel de tu izquierda.')
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
        this.order.mesh.visible = false
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
            return { phase: 'receive', targets: [this.receive.mesh], text: 'Llegó el camión. Presiona el panel que brilla, a tu izquierda, para recibir las donaciones.' }
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
            if (onShelf.length === missing.length) return { phase: 'shelf', targets, text: `Falta ${wants}: brilla en el estante, a tu espalda. Llévalo a su caja, en «Arma el pedido».` }
            const where = onShelf.length ? 'en la caja abierta y en el estante, a tu espalda' : 'en la caja abierta'
            return { phase: 'order', targets, text: `${day.current.family} necesita ${wants}. Lo que brilla está ${where}: llévalo a su caja, en «Arma el pedido».` }
        }
        // handed over, time runs again: only what was left in the carton still gets a hand
        const left = things.filter((t) => t.kind === 'item')
        if (!left.length || day.current) return null
        let targets = left.map((t) => t.object)
        if (held) targets = held.kind === 'item' ? [this.station.zones.find((z) => z.categoryId === SUPPLIES[held.itemId].category).crate] : []
        return { phase: 'sort', targets, text: 'Lo que quedó en la caja va a su lugar en el estante, a tu espalda. Desde ahora el tiempo corre.' }
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

    /** An object the person works with: pressable, and grabbable in the headset unless told otherwise. */
    #thing(object, info, { grab = true, parent = null } = {}) {
        const entity = this.world.createTransformEntity(object, { parent: parent ?? this.root })
        entity.addComponent(Workable)
        entity.addComponent(RayInteractable)
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
            if (target && !this.onMat) return this.#moveToMat(entity, t)
            if (target) this.#say('warn', 'La mesa está ocupada: termina primero la caja abierta.')
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
            if (!this.onMat) return this.#moveToMat(entity, t)
            this.haptics.play('wrong')
            this.#say('warn', 'La mesa está ocupada: termina primero la caja abierta.')
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
        this.#say('info', `Caja de ${t.box.from}. Lleva cada insumo a su caja del estante, a tu espalda, o directo a un pedido.`)
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
            this.#say('radio', `Llegó ${order.family}. Pasará cuando termines, o con «Que pase el siguiente».`)
        }
    }

    /** The card over the head of whoever is in line. */
    #giveCard(f) {
        const { order, leader } = f
        const card = familyCard()
        card.mesh.position.set(leader.position.x, CARD_Y, leader.position.z)
        card.mesh.scale.setScalar(1.6)
        card.refresh({ family: order.family, people: order.people, urgent: order.urgent, left: barStep(1 - order.waited / order.patience) })
        this.rootObject.add(card.mesh)
        f.card = card
        if (order.urgent) gsap.to(card.mesh.scale, { x: 1.78, y: 1.78, duration: 1.2, repeat: -1, yoyo: true, ease: 'sine.inOut' })
    }

    /** Sent back to wait: their carton goes, and they return to a place in the line. */
    #familyStepsBack() {
        const f = this.familyAtCounter
        this.familyAtCounter = null
        this.kit.entity.destroy()
        this.kit = null
        this.order.mesh.visible = false
        f.slot = this.#freeSlot()
        this.#giveCard(f)
        this.#walkTo(f.leader, f.slot.x, f.slot.z, () => (f.leader.targetYaw = 0))
    }

    #followCards() {
        for (const f of this.families.values()) {
            if (f.card) f.card.mesh.position.set(f.leader.position.x, CARD_Y, f.leader.position.z)
        }
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
            const { family, people, urgent, waited, patience } = f.order
            f.card.refresh({ family, people, urgent, left: barStep(1 - waited / patience) })
        }
    }

    #removeCard(f) {
        if (!f.card) return
        gsap.killTweensOf(f.card.mesh.scale)
        f.card.mesh.removeFromParent()
        f.card = null
    }

    /** What they asked for, and for what is missing, whether it is anywhere to be had. */
    #refreshOrder(order) {
        const { day } = this
        const status = Object.fromEntries(Object.keys(order.items).map((id) => [id, day.available(id) > 0 ? 'shelf' : day.inOpenCartons(id) > 0 ? 'box' : 'out']))
        const { family, people, urgent, items, packed } = order
        this.order.refresh({ order: { family, people, urgent, items, packed }, status, left: barStep(1 - order.waited / order.patience) })
    }

    /** It is their turn: they come up, what they ask for appears, and a new carton opens on the kit mat. */
    #familyComes(order) {
        const f = this.families.get(order.id)
        f.slot = null
        this.familyAtCounter = f
        this.#removeCard(f)
        this.#walkTo(f.leader, WORKER.x, COUNTER_Z, () => (f.leader.targetYaw = 0))

        const kitObject = cardboardBox(KIT_TAPE)
        kitObject.position.copy(this.station.kitMat)
        gsap.from(kitObject.scale, { x: 0.5, y: 0.5, z: 0.5, duration: 0.45, ease: 'back.out(2)' })
        kitObject.userData.seal.visible = false
        for (const hinge of kitObject.userData.flaps) hinge.rotation.x = hinge.userData.side * 2.75
        kitObject.name = order.id
        const entity = this.world.createTransformEntity(kitObject, { parent: this.root })
        const units = Object.entries(order.items).flatMap(([id, q]) => Array(q).fill(id))
        this.kit = { entity, object: kitObject, layout: cartonLayout(this.supplies, units), used: new Set() }
        this.#refreshOrder(order)
        this.order.mesh.visible = true
        gsap.fromTo(this.order.mesh.scale, { x: 0.86, y: 0.86 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.4)' })
        this.sound.play('radio')
        this.#say(order.urgent ? 'alert' : 'radio', `${order.family} pasó al mostrador. Busca lo que pide en los estantes, a tu espalda, o en las cajas que abras.`)
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
        // they take the kit with them
        gsap.to(kit.object.position, {
            x: WORKER.x,
            z: COUNTER_Z + 0.5,
            y: 0.72,
            duration: 0.7,
            ease: 'power2.inOut',
            onComplete: () => {
                kit.entity.destroy()
                this.#sendAway(f, WORKER.x + 3, ENTRY_Z)
            },
        })
        this.kit = null
        this.order.mesh.visible = false
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
            this.order.mesh.visible = false
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
        // a whole shift's worth of families does not fit on the board: a few names, then the count
        const names = (orders) => {
            if (orders.length <= 3) return list(orders.map((o) => o.family))
            return `${orders.slice(0, 3).map((o) => o.family).join(', ')} y ${orders.length - 3} más`
        }
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
