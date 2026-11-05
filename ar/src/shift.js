import { createSystem, Grabbed, Hovered, OneHandGrabbable, Pressed, RayInteractable, VisibilityState, XRAnchor } from '@iwsdk/core'
import gsap from 'gsap'
import * as THREE from 'three'
import { AssetLoader } from '../../src/three/AssetLoader.js'
import { GuideFace } from '../../src/three/guideFace.js'
import { CATEGORIES, SUPPLIES } from '../../src/data/catalog.js'
import { InventoryStore, sheetsEndpoint } from '../../src/app/inventoryStore.js'
import { Workable } from './components.js'
import { ORDERS, SHIFT_STOCK, Workday } from './sim/workday.js'
import { Sound } from './sound.js'
import { Atmosphere } from './world/atmosphere.js'
import { DesktopView } from './world/desktopView.js'
import { bigBoard, buttonPanel, familyCard, fontsReady, messageBoard, orderCard, taskBoard } from './world/panels.js'
import { buildStation, cardboardBox, cartonLayout, crateLayout, hangFromRoof, preloadSupplies, standOnPole, supplyObject, WORKER } from './world/station.js'

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
const LINE_SLOTS = [-0.95, 0.95, -2.7, 2.7]
const ENTRY_Z = -7

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
 *
 * Headset: boxes and supplies are taken with a hand or the grip (a grabbable object ignores
 * rays by design); buttons, crates and cards answer to a ray too.
 * Computer: there is no hand, so pressing does it all: pressing an item picks it, pressing a
 * crate or the kit then puts it there. Dragging looks around, the keys walk.
 */
export class ShiftSystem extends createSystem({
    pressed: { required: [Workable, Pressed] },
    held: { required: [Workable, Grabbed] },
    hovered: { required: [Workable, Hovered] },
}) {
    init() {
        this.things = new Map() // entity → { kind, ... }
        this.families = new Map() // order id → its people, and their card
        this.selected = null
        this.sound = new Sound()
        this.placed = false
        this.loader = new AssetLoader()
        this.ready = this.#prepare()
        this.elapsed = gsap.ticker.time
        this.cardClock = 0

        // GSAP on the frame loop: a headset can stop the page's own animation frames
        gsap.ticker.remove(gsap.updateRoot)

        this.queries.pressed.subscribe('qualify', (entity) => this.#press(entity))
        this.queries.held.subscribe('qualify', (entity) => this.#take(entity))
        this.queries.held.subscribe('disqualify', (entity) => this.#release(entity))
        const cursor = () => {
            if (this.view) this.view.canvas.style.cursor = this.queries.hovered.entities.size ? 'pointer' : 'grab'
        }
        this.queries.hovered.subscribe('qualify', cursor)
        this.queries.hovered.subscribe('disqualify', cursor)

        this.cleanupFuncs.push(
            this.world.visibilityState.subscribe((state) => {
                if (state !== VisibilityState.NonImmersive && !this.placed) this.#beginPlacement()
            })
        )
    }

    update(delta) {
        this.elapsed += delta
        gsap.updateRoot(this.elapsed)
        this.view?.update(delta)
        const cam = this.world.camera
        cam.getWorldPosition(temp)
        cam.getWorldDirection(temp2)
        up.set(0, 1, 0).applyQuaternion(cam.quaternion)
        this.sound.listen(temp, temp2, up)
        if (!this.placed || !this.day) return
        if (this.running) this.day.tick(delta)
        const pressure = this.running ? this.day.pressure : 0
        this.atmosphere.update(delta, pressure)
        this.sound.ambient(this.atmosphere.level, delta)
        this.cardClock += delta
        if (this.cardClock > 1) {
            this.cardClock = 0
            this.#refreshCards()
        }
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
        // published: the demonstration tab of the sheet. On this computer, only this browser.
        const endpoint = import.meta.env.PROD ? sheetsEndpoint() : ''
        this.store = new InventoryStore({ pointId: DEMO_POINT, endpoint })
        await this.store.start()
        this.day = new Workday({ store: this.store })
        this.day.on((event, detail) => this.#onDay(event, detail))
        const scene = this.world.scene
        const sky = new THREE.HemisphereLight('#FFF4E6', '#8A8172', 1.6)
        scene.add(sky)
        const sun = new THREE.DirectionalLight('#FFE9CF', 1.8)
        sun.position.set(-1.5, 3, 2)
        scene.add(sun)
        this.atmosphere = new Atmosphere(scene, this.world.camera, sky, sun)
    }

    /* ---------------- starting ---------------- */

    /** On a computer: the same tent, at a person's height, walking with the keys. */
    async startOnDesktop() {
        await this.ready
        this.sound.unlock()
        const scene = this.world.scene
        scene.background = new THREE.Color('#DDE3EA')
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2).translate(0, -0.26, 0), new THREE.MeshStandardMaterial({ color: '#B9C2CC', roughness: 1 })))
        this.#place(new THREE.Vector3(0, 0, 0), 0)
        const camera = this.world.camera
        const canvas = this.world.renderer.domElement
        this.view = new DesktopView({
            camera,
            canvas,
            solids: this.station.solids,
            bounds: { minX: -2.4, maxX: 2.4, minZ: -2.4, maxZ: 1.7 },
            roof: (on) => this.station.tent.traverse((o) => o.userData.roof && (o.visible = on)),
        })
        canvas.style.cursor = 'grab'
        this.showView('persona')
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
        this.world.scene.background = null

        const hint = messageBoard()
        hint.refresh({ kind: 'info', text: 'Busca unos 3 metros libres, mira hacia el frente y presiona para levantar tu carpa.' })
        this.world.scene.add(hint.mesh)
        const head = new THREE.Vector3()
        const dir = new THREE.Vector3()
        const stop = this.world.onXRFrame(() => {
            const cam = this.world.camera
            cam.getWorldPosition(head)
            cam.getWorldDirection(dir)
            hint.mesh.position.copy(head).addScaledVector(dir, 0.9)
            hint.mesh.lookAt(head)
        })
        const confirm = () => {
            session.removeEventListener('select', confirm)
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
        this.#intro()
    }

    /* ---------------- the room's signs ---------------- */

    #boards() {
        const root = this.rootObject
        const top = this.station.deskTop
        const far = this.station.deskFar + 0.22
        const x = WORKER.x
        this.board = taskBoard()
        // to the right on the counter, on its own pole
        this.board.mesh.position.set(x + 1.2, top + 0.34, far)
        this.board.mesh.rotation.y = -0.42
        standOnPole(this.board.mesh, 0.4, top)
        root.add(this.board.mesh)
        this.message = messageBoard()
        // leaving the middle free for whoever is at the counter
        this.message.mesh.position.set(x - 0.72, top + 0.72, far)
        this.message.mesh.scale.setScalar(1.15)
        this.message.mesh.rotation.y = 0.26
        hangFromRoof(this.message.mesh, 0.52, 0.17)
        root.add(this.message.mesh)
        // the one button, between the two mats, where no carton or flap reaches it
        this.action = buttonPanel('Empezar el turno')
        this.#thing(this.action.mesh, { kind: 'action' }, { grab: false })
        this.action.mesh.position.set(x, top + 0.04, this.station.matZ + 0.06)
        this.action.mesh.rotation.x = -0.9
        this.action.mesh.visible = false
        this.order = orderCard()
        this.order.mesh.position.set(x + 0.72, top + 0.62, far)
        this.order.mesh.rotation.y = -0.2
        hangFromRoof(this.order.mesh, 0.4, 0.26)
        this.order.mesh.visible = false
        root.add(this.order.mesh)
        this.big = bigBoard()
        this.big.mesh.position.set(x, top + 0.72, far)
        this.big.mesh.visible = false
        hangFromRoof(this.big.mesh, 0.86, 0.58)
        root.add(this.big.mesh)
        this.#refreshBoard()
    }

    #refreshBoard() {
        this.board.refresh(this.day.tasks)
    }

    #say(kind, text) {
        this.message.refresh({ kind, text })
    }

    /** The one button says the most pressing thing there is to confirm, or disappears. */
    #refreshAction() {
        const { day } = this
        const choose = () => {
            if (this.pendingStart) return ['start', 'Empezar el turno']
            if (this.ending) return ['again', 'Hacer otro turno']
            if (this.boxesWaiting) return ['arrival', 'Confirmar llegada']
            if (day.current?.state === 'ready') return ['deliver', 'Entregar el pedido']
            if (day.onlyPartial) return ['deliver', 'Entregar lo que hay']
            if (day.readyToCommit) return ['commit', 'Actualizar inventario']
            return [null, '']
        }
        const [action, label] = choose()
        this.pendingAction = action
        this.action.mesh.visible = !!action
        if (action) this.action.refresh(label)
    }

    /* ---------------- opening ---------------- */

    #intro() {
        this.pendingStart = true
        this.big.refresh({
            title: 'Hoy este punto es tuyo',
            lines: [
                { text: 'Eres la persona responsable de este centro de acopio en Cali.' },
                { text: 'Recibe lo que llega, ordénalo en los estantes, actualiza el inventario y atiende a quienes vengan.' },
                { text: 'No alcanzará para todo. Tú decides.', bold: true, color: '#F7C25C' },
            ],
        })
        this.big.mesh.visible = true
        this.message.mesh.visible = false
        this.#refreshAction()
    }

    #begin() {
        // only here, not on loading the page: opening it must not change the sheet
        for (const [id, qty] of Object.entries(SHIFT_STOCK)) this.store.set(id, qty)
        this.pendingStart = false
        this.running = true
        this.big.mesh.visible = false
        this.message.mesh.visible = true
        this.#dropBoxes(this.day.boxes)
        this.sound.play('radio')
        this.#say('radio', `Llegó un camión con ${this.day.boxes.length} cajas. Revísalas y confirma que las recibiste.`)
        this.boxesWaiting = true
        this.#refreshAction()
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
        if (this.world.session && !entity.hasComponent(OneHandGrabbable)) entity.addComponent(OneHandGrabbable, { rotate: true, translate: true })
    }

    /** Of the pile, only what has nothing on top can be lifted. */
    #offerTopBoxes() {
        if (!this.day.arrived) return
        const pile = [...this.things.entries()].filter(([, t]) => t.kind === 'box' && !t.onMat)
        for (const [entity, t] of pile) {
            const covered = pile.some(([, o]) => o !== t && o.home.x === t.home.x && o.home.y > t.home.y)
            if (!covered) this.#makeGrabbable(entity)
        }
    }

    #worldOf(object) {
        return object.getWorldPosition(new THREE.Vector3())
    }

    /** A crate on the shelf, with one of each of its supplies showing on top. */
    #stockCrate(zone) {
        const shelfEntity = (this.shelfEntity ??= this.world.createTransformEntity(this.station.shelf, { parent: this.root }))
        zone.entity = this.#thing(zone.crate, { kind: 'crate', zone }, { grab: false, parent: shelfEntity })
        zone.stock = new Map()
        for (const { itemId, fit, position } of crateLayout(this.supplies, zone.categoryId)) {
            const object = supplyObject(this.loader, this.supplies.get(itemId), itemId, fit)
            object.position.copy(position)
            // a sample stays in the crate; taking it means taking one of many
            const entity = this.#thing(object, { kind: 'stock', itemId, zone, home: position.clone(), fit }, { grab: false, parent: zone.entity })
            zone.stock.set(itemId, entity)
        }
    }

    /** Cartons land on the counter, in the free places of its left end. */
    #dropBoxes(boxes) {
        const taken = [...this.things.values()].filter((t) => t.kind === 'box').map((t) => t.home)
        const free = this.station.intake.filter((spot) => !taken.some((h) => h.distanceTo(spot) < 0.01))
        boxes.forEach((b, i) => {
            const spot = free[i]
            const object = cardboardBox()
            object.position.set(spot.x, spot.y + 0.6, spot.z)
            object.name = b.id
            this.#thing(object, { kind: 'box', box: b, home: spot.clone() }, { grab: false })
            gsap.to(object.position, {
                y: spot.y,
                duration: 0.5,
                delay: 0.3 + i * 0.5,
                ease: 'bounce.out',
                onStart: () => setTimeout(() => this.sound.play('box', this.#worldOf(object)), 180),
            })
        })
    }

    /* ---------------- what the person does ---------------- */

    /** Pressed: on a computer, a click only counts once it turned out not to be a drag. */
    #press(entity) {
        if (this.view?.down) {
            this.view.onClick = () => this.#act(entity)
            return
        }
        this.#act(entity)
    }

    #act(entity) {
        const t = this.things.get(entity)
        // what is grabbable is pressed by the very gesture that takes it: that one is a grab
        if (!t || t.moving || entity.hasComponent(OneHandGrabbable)) return
        if (t.kind === 'action') return this.#pressAction()
        if (t.kind === 'box') return this.#pressBox(entity, t)
        if (t.kind === 'item') return this.#selectItem(entity, t)
        if (t.kind === 'crate') return this.#pressCrate(t.zone)
        if (t.kind === 'stock') return this.day.current ? this.#selectItem(entity, t) : this.#pressCrate(t.zone)
        if (t.kind === 'kit') return this.#pressKit()
        if (t.kind === 'call') return this.#callFamily(t.order)
    }

    #pressAction() {
        const pending = this.pendingAction
        if (!pending) return
        this.sound.play('tap')
        if (pending === 'start') return this.#begin()
        if (pending === 'again') return location.reload()
        if (pending === 'arrival') {
            this.boxesWaiting = false
            this.day.confirmArrival()
        }
        if (pending === 'commit') this.day.commit()
        if (pending === 'deliver') this.day.deliver()
        this.#refreshAction()
    }

    #pressBox(entity, t) {
        if (t.box.state !== 'received') return
        if (t.onMat) return this.#openBox(entity, t)
        if (this.onMat) return this.#say('warn', 'Termina primero la caja que tienes abierta.')
        // only what has nothing on top can be lifted
        const covered = [...this.things.values()].some((o) => o.kind === 'box' && !o.onMat && o.home.x === t.home.x && o.home.y > t.home.y)
        if (covered) return this.#say('warn', 'Empieza por la caja de arriba.')
        this.#moveToMat(entity, t)
    }

    #moveToMat(entity, t) {
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
        gsap.to(t.object.rotation, { x: 0, y: 0, z: 0, duration: 0.5, ease: 'power2.out' })
        gsap.to(t.object.position, { x: m.x, y: m.y, z: m.z, duration: 0.6, ease: 'power2.inOut', onComplete: settled })
        this.#offerTopBoxes()
        this.#say('info', 'Quita la cinta: presiona la caja para abrirla.')
    }

    #openBox(entity, t) {
        if (!this.day.openBox(t.box.id)) return
        const { flaps, seal } = t.object.userData
        seal.visible = false
        this.sound.play('tape', this.#worldOf(t.object))
        for (const hinge of flaps) gsap.to(hinge.rotation, { x: hinge.userData.side * 2.75, duration: 0.55, ease: 'power2.out' })
        const m = this.station.mat
        for (const { itemId, fit, position } of cartonLayout(this.supplies, t.box.items)) {
            const object = supplyObject(this.loader, this.supplies.get(itemId), itemId, fit)
            const home = position.clone().add(m)
            object.position.copy(home)
            this.#thing(object, { kind: 'item', itemId, box: t.box, home })
        }
        this.#say('info', `Caja de ${t.box.from}. ${this.world.session ? 'Lleva cada insumo a su caja del estante, a tu espalda.' : 'Presiona un insumo y luego su caja del estante, a tu espalda.'}`)
    }

    #selectItem(entity, t) {
        if (this.selected === entity) return this.#deselect()
        this.#deselect()
        this.selected = entity
        gsap.to(t.object.position, { y: t.home.y + 0.1, duration: 0.2, ease: 'power2.out' })
        this.sound.play('tap')
        const where = t.kind === 'stock' ? '¿lo pones en el pedido?' : '¿en qué caja del estante va?'
        this.#say('info', `${SUPPLIES[t.itemId].label}: ${where}`)
    }

    #deselect() {
        const t = this.things.get(this.selected)
        if (t) gsap.to(t.object.position, { y: t.home.y, duration: 0.2, ease: 'power2.out' })
        this.selected = null
    }

    #pressCrate(zone) {
        const entity = this.selected
        const t = this.things.get(entity)
        if (!t || t.kind !== 'item') return this.#say('info', `Aquí va lo de ${CATEGORIES[zone.categoryId].label}. Primero toma un insumo.`)
        this.selected = null
        this.#stow(entity, t, zone)
    }

    #pressKit() {
        const t = this.things.get(this.selected)
        if (!t || t.kind !== 'stock') return this.#say('info', 'Toma de los estantes lo que está en el pedido.')
        this.#deselect()
        this.#giveToKit(t)
    }

    #take(entity) {
        const t = this.things.get(entity)
        if (!t) return
        if (this.selected) this.#deselect()
        gsap.killTweensOf(t.object.position)
    }

    /** Let go with a hand: what it counts as depends on where it was let go. */
    #release(entity) {
        const t = this.things.get(entity)
        if (!t) return
        if (t.kind === 'box') return this.#releaseBox(entity, t)
        if (t.kind === 'item') return this.#releaseItem(entity, t)
        if (t.kind === 'stock') return this.#releaseStock(t)
    }

    #goHome(t) {
        gsap.to(t.object.rotation, { x: 0, y: 0, z: 0, duration: 0.25 })
        gsap.to(t.object.position, { x: t.home.x, y: t.home.y, z: t.home.z, duration: 0.4, ease: 'power2.inOut' })
    }

    #releaseBox(entity, t) {
        const m = this.station.mat
        temp.copy(t.object.position)
        if (!this.onMat && t.box.state === 'received' && Math.hypot(temp.x - m.x, temp.z - m.z) < MAT_REACH) return this.#moveToMat(entity, t)
        if (this.onMat && this.onMat !== entity) this.#say('warn', 'Termina primero la caja que tienes abierta.')
        this.#goHome(t)
    }

    #releaseItem(entity, t) {
        t.object.getWorldPosition(temp)
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

    #releaseStock(t) {
        if (this.kit) {
            t.object.getWorldPosition(temp)
            if (temp.distanceTo(this.#worldOf(this.kit.object)) < KIT_REACH) this.#giveToKit(t)
        }
        this.#goHome(t)
    }

    /** An item goes into its crate, or back to its carton with a word about where it goes. */
    #stow(entity, t, zone) {
        const result = this.day.sort(t.box.id, t.itemId, zone.categoryId)
        if (!result.ok) {
            this.#goHome(t)
            this.sound.play('wrong', this.#worldOf(zone.crate))
            this.#say('warn', `${SUPPLIES[t.itemId].label} no va ahí: va con ${result.wanted}.`)
            return
        }
        this.things.delete(entity)
        const object = t.object
        // it flies to its crate and joins what is there
        const into = object.parent.worldToLocal(this.#worldOf(zone.crate).setY(this.#worldOf(zone.crate).y + 0.14))
        gsap.to(object.scale, { x: 0.3, y: 0.3, z: 0.3, duration: 0.35, ease: 'power2.in' })
        gsap.to(object.position, {
            x: into.x,
            y: into.y,
            z: into.z,
            duration: 0.35,
            ease: 'power2.in',
            onComplete: () => {
                this.sound.play('item', this.#worldOf(zone.crate))
                entity.destroy()
            },
        })
    }

    /* ---------------- families ---------------- */

    /** Their people, side by side by real width so nobody stands inside anybody. */
    #familyGroup(order) {
        const group = new THREE.Group()
        const scaleOf = (id) => (id.includes('nino') ? CHILD_SCALE : PERSON_SCALE)
        const widths = order.visitors.map((id) => this.people.get(id).size.x * scaleOf(id))
        let x = -(widths.reduce((a, b) => a + b, 0) + 0.05 * (widths.length - 1)) / 2
        order.visitors.forEach((id, i) => {
            const person = this.loader.instanceSync(this.people.get(id))
            person.scale.multiplyScalar(scaleOf(id))
            person.position.x = x + widths[i] / 2
            x += widths[i] + 0.05
            group.add(person)
            person.updateMatrixWorld(true)
            const head = person.getObjectByName('head')
            if (head) GuideFace.attach(person, head)
        })
        return group
    }

    /** They walk with a small step, and stop dead still when they arrive. */
    #walk(group, to, { duration = 2.4, delay = 0, onComplete } = {}) {
        gsap.killTweensOf(group.position)
        const steps = Math.max(2, Math.round(duration / 0.26))
        gsap.to(group.position, { x: to.x, z: to.z, duration, delay, ease: 'power1.inOut', onComplete })
        gsap.to(group.position, { y: 0.04, duration: duration / steps, delay, repeat: steps - 1, yoyo: true, ease: 'sine.inOut', onComplete: () => (group.position.y = 0) })
    }

    #freeSlot() {
        const taken = [...this.families.values()].map((f) => f.slot)
        return LINE_SLOTS.find((x) => !taken.includes(x)) ?? LINE_SLOTS[0]
    }

    /** Someone new at the back of the point, with their card over their head. */
    #familyJoins(order) {
        const slot = this.#freeSlot()
        const group = this.#familyGroup(order)
        group.position.set(slot, 0, ENTRY_Z)
        const people = this.world.createTransformEntity(group, { parent: this.root })
        const card = familyCard()
        card.mesh.position.set(0, 1.86, 0)
        card.mesh.scale.setScalar(1.7)
        const entity = this.#thing(card.mesh, { kind: 'call', order }, { grab: false, parent: people })
        card.refresh({ ...order, left: 1 })
        this.families.set(order.id, { group, people, card, entity, slot, order })
        this.#walk(group, { x: slot, z: LINE_Z })
        if (order.urgent) {
            gsap.to(card.mesh.scale, { x: 1.85, y: 1.85, duration: 1.2, repeat: -1, yoyo: true, ease: 'sine.inOut' })
            this.sound.play('alert')
            this.#say('alert', `${order.family}: necesitan ${this.#wants(order)} ya. Presiona su tarjeta para atenderlos.`)
        } else if (this.day.line.length + (this.day.current ? 1 : 0) > 1) {
            this.sound.play('radio')
            this.#say('radio', `Llegó ${order.family}. Son ${order.people}. Tú decides a quién atender primero.`)
        }
        // with nobody else there, there is nothing to choose
        if (!this.day.current && this.day.line.length === 1 && !this.familyAtCounter) this.day.call(order.id)
    }

    #wants(order) {
        return list(Object.entries(order.items).map(([id, q]) => `${q} de ${SUPPLIES[id].label.toLowerCase()}`))
    }

    #refreshCards() {
        for (const f of this.families.values()) {
            if (f.order.state !== 'waiting') continue
            f.card.refresh({ ...f.order, left: Math.max(0, 1 - f.order.waited / f.order.patience) })
        }
    }

    #callFamily(order) {
        if (this.day.current || this.familyAtCounter) return this.#say('warn', 'Primero termina con quien está en el mostrador.')
        this.sound.play('tap')
        this.day.call(order.id)
    }

    /** Called to the counter: they come, and a new carton opens on the kit mat. */
    #familyComes(order) {
        const f = this.families.get(order.id)
        f.slot = null
        this.familyAtCounter = f
        this.things.delete(f.entity)
        gsap.killTweensOf(f.card.mesh.scale)
        f.entity.destroy()
        this.#walk(f.group, { x: WORKER.x, z: COUNTER_Z }, { duration: 1.8 })

        const kitObject = cardboardBox(KIT_TAPE)
        kitObject.position.copy(this.station.kitMat)
        kitObject.userData.seal.visible = false
        for (const hinge of kitObject.userData.flaps) hinge.rotation.x = hinge.userData.side * 2.75
        kitObject.name = order.id
        const entity = this.#thing(kitObject, { kind: 'kit', order }, { grab: false })
        const units = Object.entries(order.items).flatMap(([id, q]) => Array(q).fill(id))
        this.kit = { entity, object: kitObject, layout: cartonLayout(this.supplies, units), used: new Set() }
        this.order.refresh(order)
        this.order.mesh.visible = true
        for (const zone of this.station.zones) for (const e of zone.stock.values()) this.#makeGrabbable(e)
        if (!order.urgent) this.sound.play('radio')
        this.#say(order.urgent ? 'alert' : 'radio', `${order.family}: ${this.#wants(order)}. Tómalo de los estantes, a tu espalda.`)
        this.#refreshAction()
    }

    #giveToKit(t) {
        const label = SUPPLIES[t.itemId].label
        const result = this.day.addToKit(t.itemId)
        if (!result.ok) {
            this.sound.play('wrong', this.#worldOf(this.kit.object))
            if (result.reason === 'extra') this.#say('warn', `${label}: ya está completo o no está en este pedido.`)
            if (result.reason === 'stock') {
                const more = this.day.readyToCommit ? ' Actualiza el inventario con lo que clasificaste.' : ''
                this.#say('warn', `No queda ${label.toLowerCase()} en el inventario.${more}`)
            }
            return
        }
        const slot = this.kit.layout.findIndex((s, i) => s.itemId === t.itemId && !this.kit.used.has(i))
        this.kit.used.add(slot)
        const { fit, position } = this.kit.layout[slot]
        const object = supplyObject(this.loader, this.supplies.get(t.itemId), t.itemId, fit)
        object.position.copy(position)
        this.kit.object.add(object)
        this.sound.play('item', this.#worldOf(this.kit.object))
    }

    #familyLeaves(order) {
        const f = this.familyAtCounter
        const { kit } = this
        this.things.delete(kit.entity)
        // they take the kit with them
        gsap.to(kit.object.position, {
            x: WORKER.x,
            z: COUNTER_Z + 0.55,
            y: 0.72,
            duration: 0.7,
            ease: 'power2.inOut',
            onComplete: () => kit.entity.destroy(),
        })
        this.#walk(f.group, { x: WORKER.x + 3, z: ENTRY_Z }, {
            duration: 3,
            delay: 0.7,
            onComplete: () => {
                f.people.destroy()
                this.families.delete(order.id)
            },
        })
        this.kit = null
        this.order.mesh.visible = false
        // the counter is free as soon as they step away; whoever is alone in line comes
        setTimeout(() => {
            this.familyAtCounter = null
            const { line, current } = this.day
            if (!current && line.length === 1) this.day.call(line[0].id)
            else if (!current && line.length > 1) this.#say('radio', 'Hay más gente en la fila. Presiona la tarjeta de quien vas a atender.')
            this.#refreshAction()
        }, 1500)
        this.sound.play('done')
        const short = Object.entries(order.short ?? {})
        if (short.length) this.#say('warn', `${order.family} se fue sin ${list(short.map(([id, n]) => `${n} de ${SUPPLIES[id].label.toLowerCase()}`))}. No había más.`)
        else this.#say('done', `${order.family} recibió todo su pedido.`)
    }

    /** They could not wait any more. */
    #familyGivesUp(order) {
        const f = this.families.get(order.id)
        this.things.delete(f.entity)
        gsap.killTweensOf(f.card.mesh.scale)
        f.entity.destroy()
        f.slot = null
        this.#walk(f.group, { x: f.group.position.x, z: ENTRY_Z }, {
            onComplete: () => {
                f.people.destroy()
                this.families.delete(order.id)
            },
        })
        this.sound.play('wrong')
        this.#say('alert', `${order.family} no pudo esperar más y se fue sin nada.`)
    }

    /* ---------------- what the day answers ---------------- */

    #onDay(event, detail) {
        if (event === 'arrived') {
            this.sound.play('done')
            this.#offerTopBoxes()
            this.#say('info', this.world.session ? 'Toma una caja de la izquierda del mostrador y ponla sobre la mesa azul.' : 'Presiona una caja de la izquierda para llevarla a la mesa azul.')
        }
        if (event === 'sorted') {
            this.#say('info', `Bien. Quedan ${this.day.total - this.day.sortedCount} insumos por clasificar.`)
            if (detail.box.state === 'empty') this.#clearBox(detail.box)
        }
        if (event === 'allSorted') {
            this.sound.play('done')
            this.#say('info', 'Todo está en su lugar. Falta registrarlo: lo que no está en el inventario no se puede entregar.')
        }
        if (event === 'committed') {
            this.sound.play('done')
            this.#say('done', detail.first ? 'Inventario actualizado. Ya viene gente.' : `Inventario actualizado: ${this.day.received} unidades en este turno.`)
        }
        if (event === 'truck') {
            this.sound.play('truck')
            this.#dropBoxes(detail)
            this.#offerTopBoxes()
            this.#say('radio', `Otro camión: ${detail.length} cajas más. Mientras no las registres, no puedes entregar lo que traen.`)
        }
        if (event === 'joined') this.#familyJoins(detail)
        if (event === 'order') this.#familyComes(detail)
        if (event === 'packed') {
            this.order.refresh(detail.order)
            if (detail.complete) {
                this.sound.play('done')
                this.#say('info', `El pedido de ${detail.order.family} está completo.`)
            } else if (this.day.onlyPartial) {
                this.#say('warn', 'No queda más de lo que falta. Solo puedes entregar lo que hay.')
            }
        }
        if (event === 'impatient') {
            this.sound.play('radio')
            this.#say('warn', `${detail.family} lleva mucho esperando.`)
        }
        if (event === 'delivered') this.#familyLeaves(detail)
        if (event === 'left') this.#familyGivesUp(detail)
        if (event === 'finished') this.#closing(detail)
        this.#refreshBoard()
        this.#refreshAction()
    }

    /** An emptied carton is broken down and leaves the mat free for the next one. */
    #clearBox(box) {
        for (const [entity, t] of this.things) {
            if (t.kind !== 'box' || t.box !== box) continue
            this.things.delete(entity)
            if (this.onMat === entity) this.onMat = null
            gsap.to(t.object.scale, { y: 0.02, duration: 0.35, ease: 'power2.in', onComplete: () => entity.destroy() })
            this.sound.play('box', this.#worldOf(t.object))
            if (this.day.boxes.some((b) => b.state === 'received')) setTimeout(() => this.#say('info', 'Caja vacía. Trae la siguiente.'), 1600)
        }
    }

    /* ---------------- closing ---------------- */

    /** The shift, in numbers and in people. */
    #closing(r) {
        this.running = false
        this.ending = true
        this.message.mesh.visible = false
        const names = (orders) => list(orders.map((o) => o.family))
        const minutes = Math.max(1, Math.round(r.seconds / 60))
        const lines = [
            { text: `${r.people} personas recibieron algo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}. Registraste ${r.received} unidades.` },
            { text: `Pedidos completos: ${r.whole.length} de ${r.orders}.` },
        ]
        if (r.partial.length) lines.push({ text: `Incompletos, porque no alcanzó: ${names(r.partial)}.`, color: '#F7C25C' })
        if (r.left.length) lines.push({ text: `Se fueron sin nada: ${names(r.left)} (${r.peopleLeft} personas).`, color: '#FF9AA0' })
        const urgent = { whole: 'La clínica móvil recibió todo a tiempo.', partial: 'La clínica móvil se llevó solo una parte.', left: 'La clínica móvil no pudo esperar.' }[r.urgent]
        if (urgent) lines.push({ text: urgent })
        if (r.mistakes) lines.push({ text: `Insumos puestos en la caja equivocada: ${r.mistakes}.` })
        lines.push({ text: 'Cada donación que ves en la app pasó por este trabajo.', bold: true })
        this.big.refresh({ title: 'Así fue tu turno', lines })
        this.big.mesh.visible = true
        this.sound.play('done')
    }
}
