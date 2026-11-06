import { createSystem, Grabbed, Hovered, OneHandGrabbable, Pressed, RayInteractable, VisibilityState, XRAnchor } from '@iwsdk/core'
import gsap from 'gsap'
import * as THREE from 'three'
import { AssetLoader } from '../../src/three/AssetLoader.js'
import { GuideCharacter } from '../../src/three/GuideCharacter.js'
import { CATEGORIES, SUPPLIES } from '../../src/data/catalog.js'
import { InventoryStore, sheetsEndpoint } from '../../src/app/inventoryStore.js'
import { Workable } from './components.js'
import { ORDERS, SHIFT_STOCK, Workday } from './sim/workday.js'
import { Sound } from './sound.js'
import { Atmosphere } from './world/atmosphere.js'
import { DesktopView } from './world/desktopView.js'
import { bigBoard, buttonPanel, familyCard, fontsReady, messageBoard, orderCard, taskList } from './world/panels.js'
import { buildStation, cardboardBox, cartonLayout, crateLayout, hangFromRoof, preloadSupplies, supplyObject, WORKER } from './world/station.js'

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
const WALK_SPEED = 1.5
/** What someone being carried on a computer floats at, from the eyes. */
const HOLD_DISTANCE = 0.72
/** How close, on screen, the pointer must be to count as over something it was let go on. */
const DROP_NEAR = 0.2

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
        this.crowd = new Set() // every person standing or walking about
        this.sound = new Sound()
        this.placed = false
        this.loader = new AssetLoader()
        this.ready = this.#prepare()
        this.elapsed = gsap.ticker.time
        this.cardClock = 0
        this.raycaster = new THREE.Raycaster()
        this.holdTarget = new THREE.Vector3()

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
        this.atmosphere.update(delta, this.running ? this.day.pressure : 0)
        this.sound.ambient(this.atmosphere.level, delta)
        for (const person of this.crowd) person.update(delta, this.elapsed)
        this.#followCards()
        this.#carry(delta)
        this.#pollButtons()
        this.#placeList(delta)
        this.cardClock += delta
        if (this.cardClock > 1) {
            this.cardClock = 0
            this.#refreshCards()
            if (this.list.mesh.visible) this.#refreshList()
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
        this.atmosphere = new Atmosphere(sky, sun)
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
            grab: {
                pick: (ndc) => this.#pick(ndc),
                move: (ndc) => this.#holdAt(ndc),
                drop: (ndc) => this.#dropAt(ndc),
            },
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
        // the buttons: the one that hands over, between the mats; the list, to one side
        this.action = buttonPanel('Empezar el turno')
        this.#thing(this.action.mesh, { kind: 'action' }, { grab: false })
        this.action.mesh.position.set(x, top + 0.045, this.station.matZ + 0.06)
        this.action.mesh.rotation.x = -0.9
        this.action.mesh.visible = false
        this.listButton = buttonPanel('Por hacer', { width: 0.2, fill: '#011E41' })
        this.#thing(this.listButton.mesh, { kind: 'list' }, { grab: false })
        this.listButton.mesh.position.set(x + 0.86, top + 0.045, this.station.matZ + 0.06)
        this.listButton.mesh.rotation.x = -0.9
        // called up with a button; the world's child rather than the tent's, it goes with the person
        this.list = taskList()
        this.list.mesh.visible = false
        this.world.scene.add(this.list.mesh)
    }

    #say(kind, text) {
        this.message.refresh({ kind, text })
    }

    /** The one button says what can be handed over, or disappears. */
    #refreshAction() {
        const { day } = this
        const choose = () => {
            if (this.pendingStart) return ['start', 'Empezar el turno']
            if (this.ending) return ['again', 'Hacer otro turno']
            if (day.canDeliver) return ['deliver', Object.keys(day.missing).length ? 'Entregar lo que hay' : 'Entregar el pedido']
            return [null, '']
        }
        const [action, label] = choose()
        this.pendingAction = action
        this.action.mesh.visible = !!action
        if (action) this.action.refresh(label)
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

    #begin() {
        // only here, not on loading the page: opening it must not change the sheet
        for (const [id, qty] of Object.entries(SHIFT_STOCK)) this.store.set(id, qty)
        this.pendingStart = false
        this.running = true
        this.big.mesh.visible = false
        this.message.mesh.visible = true
        this.day.start()
        this.sound.play('radio')
        this.#say('radio', 'Llegaron cajas al mostrador. Las familias vienen en camino.')
        this.#refreshShelf()
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
        zone.entity = this.#thing(zone.crate, { kind: 'crate', zone }, { grab: false, parent: shelfEntity })
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
            const rows = [...zone.stock.keys()].map((id) => ({ label: SUPPLIES[id].label, count: this.day.available(id) }))
            zone.label.refresh(rows)
            for (const [id, entity] of zone.stock) {
                const t = this.things.get(entity)
                if (t !== this.holding?.t) t.object.visible = this.day.available(id) > 0
            }
        }
    }

    /** Cartons land on the counter, in the free places of its left end, the lower ones first. */
    #dropBoxes(boxes) {
        const taken = [...this.things.values()].filter((t) => t.kind === 'box' && !t.onMat).map((t) => t.home)
        const free = this.station.intake.filter((spot) => !taken.some((h) => h.distanceTo(spot) < 0.01))
        boxes.forEach((b, i) => {
            const spot = free[i]
            if (!spot) return
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
        this.#offerTopBoxes()
    }

    /* ---------------- pressing ---------------- */

    /** Pressed: on a computer, a click only counts once it turned out not to be a drag. */
    #press(entity) {
        if (this.view?.down) {
            this.view.onClick = () => this.#act(entity)
            return
        }
        this.#act(entity)
    }

    /** What is pressed rather than carried. What is grabbable is pressed by the very gesture that takes it. */
    #act(entity) {
        const t = this.things.get(entity)
        if (!t || t.moving || entity.hasComponent(OneHandGrabbable)) return
        if (t.kind === 'action') return this.#pressAction()
        if (t.kind === 'list') return this.toggleList()
        if (t.kind === 'box' && t.onMat) return this.#openBox(t)
        if (t.kind === 'call') return this.#callFamily(t.order)
    }

    #pressAction() {
        const pending = this.pendingAction
        if (!pending) return
        this.sound.play('tap')
        if (pending === 'start') return this.#begin()
        if (pending === 'again') return location.reload()
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
        const hits = this.#rayAt(ndc).intersectObjects(carriable.map((t) => t.object), true)
        const found = hits.length ? this.#entityOf(hits[0]) : null
        if (!found) return false
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
        const ray = this.#rayAt(ndc)
        const onScreen = (object) => {
            const p = this.#worldOf(object).project(this.world.camera)
            return p.z < 1 ? Math.hypot(p.x - ndc.x, p.y - ndc.y) : Infinity
        }
        const over = (object) => ray.intersectObject(object, true).length > 0
        if (t.kind === 'item') {
            // what the pointer is on; failing that, the nearest crate within reach of it
            const { zones } = this.station
            const nearest = [...zones].sort((a, b) => onScreen(a.crate) - onScreen(b.crate))[0]
            return zones.find((z) => over(z.crate)) ?? (onScreen(nearest.crate) < DROP_NEAR ? nearest : null)
        }
        if (t.kind === 'stock') return this.kit && (over(this.kit.object) || onScreen(this.kit.object) < DROP_NEAR) ? this.kit : null
        if (t.kind === 'box') {
            const m = this.rootObject.localToWorld(temp2.copy(this.station.mat))
            const p = m.clone().project(this.world.camera)
            return p.z < 1 && Math.hypot(p.x - ndc.x, p.y - ndc.y) < DROP_NEAR * 1.6 ? this.station.mat : null
        }
        return null
    }

    /** What it would land in swells a little, to say so. */
    #markTarget(ndc) {
        const target = this.#targetAt(ndc, this.holding.t)
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
            return this.#say('info', `Mantén presionado y arrástralo hasta ${where}.`)
        }
        if (t.kind === 'box') {
            if (target && !this.onMat) return this.#moveToMat(entity, t)
            if (target) this.#say('warn', 'La mesa está ocupada: termina primero la caja abierta.')
            return this.#goHome(t)
        }
        if (t.kind === 'item') {
            if (target) return this.#stow(entity, t, target)
            return this.#goHome(t)
        }
        if (t.kind === 'stock') {
            if (target) return this.#giveToKit(t)
            if (!this.kit) this.#say('info', 'Nadie espera un pedido en el mostrador: llama a alguien de la fila.')
            return this.#goHome(t)
        }
    }

    /* ---------------- carrying, with a hand ---------------- */

    #take(entity) {
        const t = this.things.get(entity)
        if (t) gsap.killTweensOf(t.object.position)
    }

    /** Let go with a hand: what it counts as depends on where it was let go. */
    #release(entity) {
        const t = this.things.get(entity)
        if (!t) return
        if (t.kind === 'box') return this.#releaseBox(entity, t)
        if (t.kind === 'item') return this.#releaseItem(entity, t)
        if (t.kind === 'stock') return this.#releaseStock(t)
    }

    #releaseBox(entity, t) {
        const m = this.station.mat
        temp.copy(t.object.position)
        if (Math.hypot(temp.x - m.x, temp.z - m.z) < MAT_REACH) {
            if (!this.onMat) return this.#moveToMat(entity, t)
            this.#say('warn', 'La mesa está ocupada: termina primero la caja abierta.')
        }
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
            if (temp.distanceTo(this.#worldOf(this.kit.object)) < KIT_REACH) return this.#giveToKit(t)
        }
        this.#goHome(t)
    }

    #goHome(t) {
        gsap.to(t.object.rotation, { x: 0, y: 0, z: 0, duration: 0.25 })
        gsap.to(t.object.position, { x: t.home.x, y: t.home.y, z: t.home.z, duration: 0.35, ease: 'power2.inOut', onComplete: () => this.#refreshShelf() })
    }

    /* ---------------- what happens to what is carried ---------------- */

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
        gsap.to(t.object.rotation, { x: 0, y: 0, z: 0, duration: 0.3, ease: 'power2.out' })
        gsap.to(t.object.position, { x: m.x, y: m.y, z: m.z, duration: 0.35, ease: 'power2.inOut', onComplete: settled })
        this.#offerTopBoxes()
        this.#say('info', this.world.session ? 'Presiona la caja para quitarle la cinta.' : 'Haz clic en la caja para quitarle la cinta.')
    }

    #openBox(t) {
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
        this.#say('info', `Caja de ${t.box.from}. ${this.world.session ? 'Agarra cada insumo y suéltalo en su caja del estante, a tu espalda.' : 'Mantén presionado cada insumo y llévalo a su caja del estante, a tu espalda.'}`)
    }

    /** An item goes into its crate, or back to its carton with a word about where it goes. */
    #stow(entity, t, zone) {
        const result = this.day.sort(t.box.id, t.itemId, zone.categoryId)
        if (!result.ok) {
            this.#goHome(t)
            this.sound.play('wrong', this.#worldOf(zone.crate))
            this.#say('warn', `${SUPPLIES[t.itemId].label} no va en ${CATEGORIES[zone.categoryId].label}: va en ${result.wanted}.`)
            return
        }
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
            if (result.reason === 'extra') this.#say('warn', `${label}: ya está completo o no está en este pedido.`)
            if (result.reason === 'stock') this.#say('warn', `No queda ${label.toLowerCase()} en los estantes.`)
            return this.#goHome(t)
        }
        const slot = this.kit.layout.findIndex((s, i) => s.itemId === t.itemId && !this.kit.used.has(i))
        this.kit.used.add(slot)
        const { fit, position } = this.kit.layout[slot]
        const object = supplyObject(this.loader, this.supplies.get(t.itemId), t.itemId, fit)
        object.position.copy(position)
        this.kit.object.add(object)
        this.sound.play('item', this.#worldOf(this.kit.object))
        // the crate's sample is back in its place at once: there are more of them
        t.object.position.copy(t.home)
        t.object.rotation.set(0, 0, 0)
        this.#refreshShelf()
    }

    /* ---------------- people ---------------- */

    /** They move as they do in the web experience: the same puppet, the same walk and the same little idle things. */
    #person(id, position, yaw) {
        const child = id.includes('nino')
        const elder = id.includes('mayor')
        const person = new GuideCharacter(this.loader.instanceSync(this.people.get(id)), [], { face: true, stoop: elder ? 0.12 : 0 })
        person.root.scale.setScalar(child ? CHILD_SCALE : PERSON_SCALE)
        person.place(position, yaw)
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

    /** Someone new at the back of the point, with their card over their head. */
    #familyJoins(order) {
        const slot = this.#freeSlot()
        const { leader, members } = this.#familyPeople(order, slot)
        const card = familyCard()
        card.mesh.position.set(slot, 1.9, ENTRY_Z)
        card.mesh.scale.setScalar(1.6)
        const entity = this.#thing(card.mesh, { kind: 'call', order }, { grab: false })
        card.refresh({ ...order, left: 1 })
        this.families.set(order.id, { leader, members, card, entity, slot, order })
        this.#walkTo(leader, slot, LINE_Z, () => (leader.targetYaw = 0))
        if (order.urgent) {
            gsap.to(card.mesh.scale, { x: 1.78, y: 1.78, duration: 1.2, repeat: -1, yoyo: true, ease: 'sine.inOut' })
            this.sound.play('alert')
            this.#say('alert', `${order.family} necesita ${this.#wants(order)} ya. Presiona su tarjeta para atenderla.`)
        } else {
            this.sound.play('radio')
            this.#say('radio', `Llegó ${order.family}. Presiona su tarjeta cuando quieras atenderla.`)
        }
    }

    #followCards() {
        for (const f of this.families.values()) {
            if (f.card.mesh.parent) f.card.mesh.position.set(f.leader.position.x, 1.9, f.leader.position.z)
        }
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

    #removeCard(f) {
        this.things.delete(f.entity)
        gsap.killTweensOf(f.card.mesh.scale)
        f.entity.destroy()
        f.card.mesh.removeFromParent()
    }

    #refreshOrder(order) {
        this.order.refresh({ order, available: (id) => this.day.available(id) })
    }

    /** Called to the counter: they come, and a new carton opens on the kit mat. */
    #familyComes(order) {
        const f = this.families.get(order.id)
        f.slot = null
        this.familyAtCounter = f
        this.#removeCard(f)
        this.#walkTo(f.leader, WORKER.x, COUNTER_Z, () => (f.leader.targetYaw = 0))

        const kitObject = cardboardBox(KIT_TAPE)
        kitObject.position.copy(this.station.kitMat)
        kitObject.userData.seal.visible = false
        for (const hinge of kitObject.userData.flaps) hinge.rotation.x = hinge.userData.side * 2.75
        kitObject.name = order.id
        const entity = this.#thing(kitObject, { kind: 'kit', order }, { grab: false })
        const units = Object.entries(order.items).flatMap(([id, q]) => Array(q).fill(id))
        this.kit = { entity, object: kitObject, layout: cartonLayout(this.supplies, units), used: new Set() }
        this.#refreshOrder(order)
        this.order.mesh.visible = true
        if (!order.urgent) this.sound.play('radio')
        this.#say(order.urgent ? 'alert' : 'radio', `${order.family} necesita ${this.#wants(order)}. Está en los estantes, a tu espalda.`)
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
        const { kit } = this
        this.things.delete(kit.entity)
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
                this.familyAtCounter = null
            },
        })
        this.kit = null
        this.order.mesh.visible = false
        this.sound.play('done')
        const short = Object.entries(order.short ?? {})
        if (short.length) this.#say('warn', `${order.family} se fue sin ${list(short.map(([id, n]) => `${n} de ${SUPPLIES[id].label.toLowerCase()}`))}.`)
        else this.#say('done', `${order.family} recibió todo su pedido.`)
    }

    /** They could not wait any more. */
    #familyGivesUp(order) {
        const f = this.families.get(order.id)
        this.#removeCard(f)
        f.slot = null
        this.#sendAway(f, f.leader.position.x, ENTRY_Z)
        this.sound.play('wrong')
        this.#say('alert', `${order.family} no pudo esperar más y se fue sin nada.`)
    }

    /* ---------------- what the day answers ---------------- */

    #onDay(event, detail) {
        if (event === 'truck') {
            if (this.running) this.sound.play('truck')
            this.#dropBoxes(detail)
        }
        if (event === 'sorted' && detail.box.state === 'empty') this.#clearBox(detail.box)
        if (event === 'joined') this.#familyJoins(detail)
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
        this.running = false
        this.ending = true
        this.message.mesh.visible = false
        this.list.mesh.visible = false
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
                { value: String(r.sorted), label: 'insumos ordenados' },
            ],
            lines,
            note: 'Cada donación que ves en la app pasó por este trabajo.',
        })
        this.big.mesh.visible = true
        this.sound.play('done')
        this.#refreshAction()
    }
}
