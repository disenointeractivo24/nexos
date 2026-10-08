import * as THREE from 'three'
import gsap from 'gsap'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Stage } from '../three/Stage.js'
import { CameraRig } from '../three/CameraRig.js'
import { AssetLoader } from '../three/AssetLoader.js'
import { CityOverview } from '../three/CityOverview.js'
import { CloudLayer } from '../three/CloudLayer.js'
import { NeighborhoodScene } from '../three/NeighborhoodScene.js'
import { GuideCharacter } from '../three/GuideCharacter.js'
import { ItemStage } from '../three/ItemStage.js'
import { Rain } from '../three/ThemeCues.js'
import { Families } from '../three/Families.js'
import { Depot, DEPOT_BOUNDS } from '../three/Depot.js'
import { HOUSE_MODELS, ASSETS } from '../data/assets.js'
import { ZONES, NEED_WORD, buildBarrio, zoneLevel, zoneNeeds, applyDonation, barrioCovered, useStock, refreshBarrioNeeds } from '../data/zones.js'
import { CATEGORIES, SUPPLIES, money } from '../data/catalog.js'
import { validateCredentials, pointForZone } from '../data/collectionPoints.js'
import { Labels, Bubble } from '../ui/Labels.js'
import { ZoneCard, DonorPanel, InventoryPanel, isNarrow } from '../ui/panels.js'
import { InventoryStore } from './inventoryStore.js'
import { StockBoard } from './stockBoard.js'
import { CaliSky, skyMood } from './caliSky.js'
import { SkyDebug, skyDebugEnabled } from '../ui/SkyDebug.js'
import { WINDOW_MATERIAL, makeNightWindow, setWindowGlow } from '../three/nightWindows.js'
import { stockState } from '../data/inventory.js'
import { Progress, STEPS } from '../ui/Progress.js'
import { icon, hydrateIcons } from '../ui/icons.js'
import { session } from './session.js'
import { Audio } from './audio.js'

/**
 * Flow
 *   role ─┬─ donor ───────── intro (descent) → city → zone → entering → barrio
 *         │                   → walking (to the collection point) → point (panel steps)
 *         └─ collector → login → intro (descent) → city → inventory
 *
 * The two roles part company at the map. A donor goes down into a barrio, where
 * there is exactly one place to act: the collection point. They leave supplies
 * at the counter and the families come out to collect them.
 *
 * A collection point never goes down. It answers for one zone — every other zone
 * is veiled on the map — and its work is the board: what is on the shelves, what
 * is running out. Whatever that board calls critical is what donors see first.
 *
 * Only what the current step needs is on screen. The 3D world loads behind the
 * clouds while the person chooses a role, so there is no dead pause after it.
 */

const CITY_VIEW = { pos: new THREE.Vector3(60, 232, 262), target: new THREE.Vector3(14, 0, 14) }
const INTRO_CURVE = new THREE.CatmullRomCurve3([
    new THREE.Vector3(8, 720, 70),
    new THREE.Vector3(26, 520, 150),
    new THREE.Vector3(46, 330, 210),
    CITY_VIEW.pos.clone(),
])
const INTRO_TARGET_FROM = new THREE.Vector3(12, 0, -10)
/**
 * A collection point's view of its own zone: camera distance, in zone radii,
 * and how much steeper than the city view it looks down, so the towers of the
 * centre do not stand in front of a zone behind them.
 */
const HOME_ZONE_FIT = 2.6
const HOME_ZONE_TILT = 1.5
/** Seconds the camera takes to move in from the whole city to the zone: slow on purpose. */
const HOME_ZONE_FLIGHT = 5
/**
 * On a phone, how much of the screen's width a chosen zone takes (1 = its farthest corners at the
 * edges; a little less lets the corners go so the zone reads larger), and how much more steeply
 * the camera looks down on it so its depth fills the tall band above the card.
 */
const ZONE_FIT_PHONE = 0.92
const ZONE_TILT_PHONE = 1.6
/**
 * The barrio is watched from one fixed vantage point. The camera never follows
 * anybody; the only control a person has is how close they stand, which is why
 * the view is described as a direction and a distance rather than a position.
 */
const BARRIO_VIEW = {
    look: new THREE.Vector3(0, 1, -9),
    dir: new THREE.Vector3(0, 0.62, 1).normalize(),
    dist: 56,
    zoom: { min: 0.42, max: 1.5 },
    /** Distance at which the whole barrio fits in view; the zoom-out limit for close views. */
    wholeBarrio: 74,
}
/**
 * Standing at the counter, which is where a collection point works from.
 * The angle is taken from the stand itself so the view is always of its front,
 * whichever way the barrio has it turned.
 */
/** Close-up used while the stand's panel is open: the counter and what is left on it. */
const COUNTER_VIEW = { dist: 15.5, lift: 1.0, rise: 0.46, offsets: [0, 0.18, -0.18, 0.45, -0.45] }
/** After a donation: how far back toward the barrio view the camera goes (0 counter, 1 barrio), and how slowly. */
const PULL_BACK = { reach: 0.6, seconds: 4.5 }
/**
 * A tall screen sees less of the barrio's width, so barrio views back off a little to make up for it;
 * only a little, or on a phone the guide and the families become specks.
 */
const PORTRAIT_PULL_BACK = 1.15

/**
 * Ink outlines per view: [strength, distance where they have faded out].
 * None while descending through the clouds (lines would show through them).
 */
const INK = { city: [0.45, 950], barrio: [0.78, 130] }

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000))

export class App {
    constructor() {
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        this.ui = document.getElementById('ui')
        this.$ = (sel) => this.ui.querySelector(sel)
        this.theme = session.theme
        this.audio = new Audio({ reducedMotion: this.reducedMotion })
        this.audio.setTheme(this.theme)
        hydrateIcons(document)

        this.stage = new Stage(document.querySelector('canvas.webgl'))
        this.stage.applyMood(this.theme.mood)
        this.rig = new CameraRig(this.stage.camera, { reducedMotion: this.reducedMotion })
        this.items = new ItemStage(document.querySelector('canvas.items'), { reducedMotion: this.reducedMotion })
        this.stage.afterRender = (dt, t) => this.items.render(dt, t)
        this.loader = new AssetLoader()
        this.labels = new Labels(this.$('.labels'), this.stage.camera)
        this.dockBubble = new Bubble(this.$('.bubble-dock'))
        this.worldBubble = new Bubble(this.$('.bubble-world'))
        this.progress = new Progress(this.$('.progress'))

        const opts = { reducedMotion: this.reducedMotion, audio: this.audio }
        const panelEl = this.$('.supply-panel')
        this.zoneCard = new ZoneCard(this.$('.zone-card'), opts, {
            onEnter: (zone) => this.enterBarrio(zone),
            onClose: () => this.deselectZone(),
        })
        this.donorPanel = new DonorPanel(panelEl, opts, {
            items: this.items,
            loader: this.loader,
            onClose: () => this.closePoint(),
            onStep: (step) => this.#onDonorStep(step),
            onConfirm: (barrio, basket, record) => this.registerSupport(barrio, basket, record),
            onExitMap: () => this.returnToMap(),
            // whatever goes into the basket appears on the stand's counter
            onBasket: (basket) => this.hood?.setDisplay(basket),
        })
        // the collection point's board; its store is created at login, when the point is known
        this.inventory = null
        this.inventoryPanel = new InventoryPanel(panelEl, opts, {
            items: this.items,
            loader: this.loader,
            onClose: () => this.closeInventory(),
            onShortages: (ids) => this.#onShortages(ids),
        })

        // What donors see of every collection point, read from the same sheet the points keep:
        // the map, the zone card and the stand's panel all follow it.
        this.board = new StockBoard()
        useStock(this.board)
        session.stock = this.board
        this.board.on(() => this.#onStock())
        this.board.start()

        this.state = 'boot'
        this.intro = { p: 0, target: 0, auto: false }
        this.zone = null
        this.barrio = null
        this.atPoint = false
        this.currentNode = null
        this.barrioCam = null
        this.zoom = { value: 1, target: 1 }
        this.cloudPresence = 1
        this.worldReady = false

        // Clouds and sky first: they are the "loading screen"
        this.clouds = new CloudLayer({ reducedMotion: this.reducedMotion })
        this.stage.scene.add(this.clouds.group)
        this.rig.set(INTRO_CURVE.getPoint(0), INTRO_TARGET_FROM)
        this.#setupOrbit()
        this.rainOn = !!this.theme.mood.rain
        if (this.rainOn) this.#setupRain()
        // Cali's real time and weather: the clock in the top bar, and the light, rain and lamps of the world
        this.sky = new CaliSky()
        this.sky.on((s) => this.#onSky(s))
        this.sky.start()
        // the time and weather test panel: click the clock, or Shift + D (dev server or ?debug only)
        if (skyDebugEnabled()) {
            this.skyDebug = new SkyDebug(this.ui, this.sky)
            const clock = this.$('.clock')
            clock.classList.add('is-debug')
            clock.title = 'Probar otra hora o clima'
            clock.addEventListener('click', () => this.skyDebug.toggle())
            window.addEventListener('keydown', (e) => {
                if (e.shiftKey && e.key.toLowerCase() === 'd' && !e.target.closest?.('input, textarea, select')) this.skyDebug.toggle()
            })
        }
        this.stage.onTick((dt, t) => this.#tick(dt, t))
        this.#bindInput()
        this.#fillRoleCard()

        setTimeout(() => {
            this.setState('role')
            this.$('.role-donor').focus({ preventScroll: true })
        }, 80)
        this.world = this.#loadWorld().catch((err) => {
            console.error(err)
            this.#caption('No pudimos cargar el mapa. Recarga la página para intentarlo de nuevo.')
        })
    }

    setState(s) {
        this.state = s
        this.audio.setScene(['barrio', 'walking', 'leaving', 'entering'].includes(s) ? 'barrio' : s === 'point' ? 'house' : ['role', 'login', 'boot', 'intro', 'exiting'].includes(s) ? 'intro' : 'city')
        this.ui.dataset.state = s
        this.ui.dataset.role = session.role ?? ''
        this.#syncProgress()
        this.#syncChrome()
    }

    get panel() {
        return session.role === 'collector' ? this.inventoryPanel : this.donorPanel
    }

    /* ================================================================
       Background loading — the world assembles while the person reads
       ================================================================ */

    async #loadWorld() {
        const supplyAssets = Object.values(ASSETS).filter((a) => a.category === 'supplies').map((a) => a.id)
        const assets = this.loader.preload([...HOUSE_MODELS, 'lamp-post', 'guide', ...supplyAssets])

        this.city = new CityOverview(this.theme)
        this.stage.scene.add(this.city.group)
        await this.city.build()
        this.#cityLighting()

        await assets
        this.hood = new NeighborhoodScene(this.loader, this.theme)
        await this.hood.build()
        this.hood.group.visible = false
        this.stage.scene.add(this.hood.group)
        // the collection point's own stand, seen from the front while its inventory is open
        this.depot = new Depot({ supplies: this.inventoryPanel.supplies, reducedMotion: this.reducedMotion })
        this.stage.scene.add(this.depot.group)

        const guideT = await this.loader.load('guide')
        this.guide = new GuideCharacter(this.loader.instanceSync(guideT), guideT.animations, { reducedMotion: this.reducedMotion })
        this.hood.group.add(this.guide.root)
        this.families = new Families({ parent: this.hood.group, reducedMotion: this.reducedMotion })
        this.portrait = new GuideCharacter(this.loader.instanceSync(guideT), guideT.animations, { reducedMotion: this.reducedMotion })
        this.portrait.place(new THREE.Vector3(), 0.32)
        this.portrait.blob.visible = false

        // Compile shaders now (not on first view) to avoid hitches later
        await this.stage.renderer.compileAsync?.(this.stage.scene, this.stage.camera).catch(() => {})
        this.worldReady = true
        this.#nightLights()

        // Quietly prepare the most likely first barrio
        const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 400))
        idle(() => this.hood.prepare(buildBarrio(ZONES.find((z) => z.id === 'centro'), this.theme)))
    }

    #cityLighting() {
        this.stage.setShadowFrame(new THREE.Vector3(20, 0, 0), 175, { mapSize: 2048, normalBias: 0.8 })
        this.stage.setFog(380, 1500)
    }

    #barrioLighting() {
        this.stage.setShadowFrame(new THREE.Vector3(0, 0, -10), 38, { mapSize: 2048, normalBias: 0.05 })
        this.stage.setFog(70, 260)
        this.stage.setInk(INK.barrio[0], INK.barrio[1])
    }

    /* ================================================================
       Frame loop
       ================================================================ */

    #tick(dt, t) {
        if (this.state === 'intro') this.#introStep(dt)
        if (this.orbit.enabled) this.#orbitStep()
        else this.rig.update(dt)

        if (this.city?.group.visible) this.city.update(dt, t)
        const focus = this.city?.focusMask
        this.stage.setFocus(this.city?.group.visible ? this.city.focusAmount : 0, focus?.texture, focus?.bounds)
        if (this.clouds.group.visible) this.clouds.update(dt, this.stage.camera, this.cloudPresence)
        if (this.hood?.group.visible) {
            this.hood.update(dt, t)
            if (this.guide.root.visible) {
                this.guide.update(dt, t)
                const p = this.guide.position
                p.y = this.hood.heightAt(p.x, p.z)
            }
            this.families.update(dt, t, (x, z) => this.hood.heightAt(x, z))
            this.#zoomStep(dt)
        }
        if (this.portraitShown) this.portrait.update(dt, t)
        if (this.lightning) {
            this.nextFlash ??= t + 2 + Math.random() * 5
            if (t > this.nextFlash) {
                this.stage.flash(0.55 + Math.random() * 0.45)
                this.nextFlash = t + 4 + Math.random() * 9
            }
        }
        if (this.rain) {
            const inBarrio = this.hood?.group.visible
            const r = inBarrio ? this.rain.near : this.rain.far
            const other = inBarrio ? this.rain.far : this.rain.near
            other.mesh.visible = false
            r.mesh.visible = this.rainOn && ['city', 'zone', 'barrio', 'walking', 'point', 'entering', 'leaving'].includes(this.state)
            r.update(dt, inBarrio ? (this.guide.root.visible ? this.guide.position : this.rig.target) : this.rig.target)
        }

        const { w, h } = this.stage.size
        this.labels.project(w, h, this.#chromeRects())
        this.#placeWorldBubble(w, h)
    }

    /* ================================================================
       Role selection, login, descent
       ================================================================ */

    #fillRoleCard() {
        const t = this.theme
        const chip = this.$('.theme-chip')
        chip.querySelector('[data-icon]').dataset.icon = t.icon
        chip.querySelector('[data-icon]').innerHTML = ''
        chip.querySelector('.theme-chip-text').textContent = t.title
        this.$('.intro-lead').textContent = t.lead
        hydrateIcons(chip)
    }

    chooseRole(role) {
        if (this.state !== 'role') return
        this.audio.unlock()
        this.audio.play('tap')
        session.role = role
        if (role === 'collector') return this.showLogin()
        this.startDescent()
    }

    showLogin() {
        this.setState('login')
        const form = this.$('.login-card')
        form.reset()
        form.querySelector('.form-error').hidden = true
        this.$('.login').hidden = false
        gsap.fromTo(form, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: this.reducedMotion ? 0.01 : 0.55, ease: 'power3.out' })
        form.querySelector('[name="code"]').focus({ preventScroll: true })
    }

    #submitLogin(e) {
        e?.preventDefault()
        const form = this.$('.login-card')
        const f = new FormData(form)
        const point = validateCredentials(f.get('code'), f.get('pin'))
        const err = form.querySelector('.form-error')
        if (!point) {
            err.textContent = 'El código o la clave no coinciden. Revisa e intenta de nuevo.'
            err.hidden = false
            form.querySelectorAll('input').forEach((i) => i.setAttribute('aria-invalid', 'true'))
            form.querySelector('[name="code"]').focus()
            return
        }
        session.point = point
        // the board is live from this moment: the sheet is read while the camera descends
        this.inventory?.stop()
        this.inventory = new InventoryStore({ pointId: point.id })
        this.inventory.start()
        form.querySelectorAll('input').forEach((i) => i.removeAttribute('aria-invalid'))
        gsap.to(form, {
            opacity: 0,
            y: -8,
            duration: 0.35,
            ease: 'power2.in',
            onComplete: () => {
                this.$('.login').hidden = true
                this.startDescent()
            },
        })
    }

    #loginBack() {
        this.$('.login').hidden = true
        session.role = null
        this.setState('role')
        this.$('.role-donor').focus({ preventScroll: true })
    }

    startDescent() {
        this.intro.target = 1
        this.intro.auto = true
        this.setState('intro')
        // a collection point's focus is in place while the clouds still cover the
        // city, so the first look at it is already the focused one
        this.#syncZoneFocus()
    }

    #introStep(dt) {
        const it = this.intro
        // Hold softly inside the clouds until the city is ready — never a frozen frame
        const limit = this.worldReady ? 1 : 0.3
        const target = Math.min(it.target, limit)
        const rate = this.reducedMotion ? 10 : it.auto ? 1.7 : 2.6
        it.p += (target - it.p) * (1 - Math.exp(-dt * rate))
        const e = it.p * it.p * (3 - 2 * it.p)
        INTRO_CURVE.points[3].copy(this.#cityFrame().pos)
        this.rig.pos.copy(INTRO_CURVE.getPoint(e))
        this.rig.target.lerpVectors(INTRO_TARGET_FROM, CITY_VIEW.target, e)
        this.rig.apply()
        this.$('.descent-caption').classList.toggle('is-waiting', !this.worldReady && it.p > 0.25)
        this.$('.skip-intro').hidden = false
        this.$('.skip-intro').classList.toggle('is-ready', this.worldReady && it.p > 0.12)
        if (it.target >= 1 && this.worldReady && it.p > 0.992) this.enterCity()
    }

    advanceIntro(delta) {
        if (this.state !== 'intro') return
        this.intro.target = THREE.MathUtils.clamp(this.intro.target + delta, 0, 1)
    }

    /* ================================================================
       City
       ================================================================ */

    enterCity() {
        const skip = this.$('.skip-intro')
        skip.classList.remove('is-ready')
        skip.hidden = true
        this.setState('city')
        this.rig.set(this.#cityFrame().pos, CITY_VIEW.target)
        this.stage.setInk(INK.city[0], INK.city[1], this.reducedMotion ? 0 : 1.2)
        this.#setContext('map', 'Mapa de ayuda', 'Cali, Valle del Cauca')
        this.#syncZoneFocus()
        this.#showZoneLabels()
        if (session.role === 'collector') {
            const zone = ZONES.find((z) => z.id === session.point.zone)
            this.#showGuideDock(`Hola, equipo de ${session.point.name.replace('Punto de acopio ', '')}.`, `Toca ${zone?.name ?? 'tu zona'} para actualizar el inventario.`)
        } else this.#showGuideDock('Hola, te ayudo a encontrar dónde apoyar.', 'Selecciona una zona de la ciudad.')
        // once the city is reached the descent clouds clear completely: nothing hazes the map
        gsap.to(this, { cloudPresence: 0, duration: 2 })
        // a collection point is then carried, slowly, in to its own zone
        if (session.role === 'collector') {
            const home = this.#homeFrame()
            this.#flyCity(home.pos, home.target, HOME_ZONE_FLIGHT, 'sine.inOut')
        } else this.#enableOrbit()
    }

    /**
     * Zones are marked by their icon alone; the words live in aria-label.
     * Beside each one, a bubble shows what is missing there: one icon per
     * supply category, each with an alert mark.
     */
    #zoneLabelHtml(zone) {
        const level = zoneLevel(zone, this.theme)
        const urgent = session.zoneHasUrgent(zone.id)
        const high = level === 'alta' || urgent
        // the shortage bubble is for donors: it answers "where is my help needed?".
        // A collection point is looking at its own shelves, not shopping the city.
        const missing = session.role === 'collector' ? [] : this.#zoneMissing(zone)
        const bubble = missing.length
            ? `<span class="need-bubble" aria-hidden="true">${missing
                  .map(
                      ([cat, lvl]) => `
                <span class="need-chip" style="background:${CATEGORIES[cat].color}">
                    ${icon(CATEGORIES[cat].icon)}
                    <span class="need-alert ${lvl === 'alta' ? 'is-high' : ''}">!</span>
                </span>`
                  )
                  .join('')}</span>`
            : ''
        // the house is drawn in the zone's own colour; urgency is carried by the dot
        return `
            <span class="wlabel-icon" style="background:${zone.color}">
                ${icon('home')}
                <span class="wlabel-dot ${urgent ? 'is-urgent' : high ? 'is-high' : ''}"></span>
            </span>
            ${bubble}`
    }

    /** The categories a zone is short of, most pressing first (at most three). */
    #zoneMissing(zone) {
        return zoneNeeds(zone, this.theme).filter(([, lvl]) => lvl !== 'baja')
    }

    #zoneAria(zone) {
        const missing = this.#zoneMissing(zone).map(([cat]) => CATEGORIES[cat].label.toLowerCase())
        return `${zone.name}. ${NEED_WORD[zoneLevel(zone, this.theme)]}${missing.length ? `. Faltan: ${missing.join(', ')}` : ''}. Ver detalles`
    }

    #showZoneLabels() {
        this.labels.clear()
        const own = session.role === 'collector' ? session.point?.zone : null
        ZONES.forEach((zone, i) => {
            const el = this.labels.add(`zone:${zone.id}`, {
                className: 'is-compact has-needs',
                html: this.#zoneLabelHtml(zone),
                ariaLabel: this.#zoneAria(zone),
                anchor: () => this.city.labelAnchor(zone.id, this._anchor ?? (this._anchor = new THREE.Vector3())),
                onClick: () => this.selectZone(zone.id),
            })
            el.style.setProperty('--delay', `${i * 70}ms`)
            if (own) this.labels.setClass(`zone:${zone.id}`, 'is-dim', zone.id !== own)
        })
    }

    #showGuideDock(lead, action) {
        const dock = this.$('.guide-dock')
        const first = dock.hidden
        dock.hidden = false
        this.dockBubble.say(lead, action)
        if (!this.portraitShown && this.portrait) {
            this.portraitShown = true
            this.items.add('guide-portrait', this.$('.guide-portrait'), this.portrait.root, { kind: 'guide' })
        }
        if (first) this.portrait?.appear()
    }

    #hideGuideDock() {
        this.$('.guide-dock').hidden = true
        this.items.remove('guide-portrait')
        this.portraitShown = false
    }

    selectZone(id) {
        if (session.role === 'collector') return this.openInventory(id)
        if (!['city', 'zone'].includes(this.state)) return
        const zone = ZONES.find((z) => z.id === id)
        this.zone = zone
        this.setState('zone')
        this.city.setSelected(id)
        for (const z of ZONES) {
            this.labels.setClass(`zone:${z.id}`, 'is-active', z.id === id)
            this.labels.setClass(`zone:${z.id}`, 'is-dim', z.id !== id)
        }
        this.audio.play('tap')
        this.zoneCard.render(zone)
        this.zoneCard.show()

        const view = this.#zoneView(id)
        this.#flyCity(view.pos, view.target, 1.4)
        this.#frameForPanel(this.zoneCard, 420)

        this.dockBubble.say('Esta zona necesita apoyo.', 'Puedes entrar al barrio para ver las casas.')
        if (isNarrow()) this.$('.guide-dock').hidden = true
        requestAnimationFrame(() => this.zoneCard.focusPrimary())

        // Build this barrio ahead of time so entering is instant
        this.pendingBarrio = buildBarrio(zone, this.theme)
        this.hood.prepare(this.pendingBarrio)
    }

    /** Shade every zone but the one this collection point answers for. */
    #syncZoneFocus() {
        this.city?.setFocusZone(session.role === 'collector' ? session.point?.zone ?? null : null)
    }

    /* ================================================================
       The collection point's board — it never enters a barrio
       ================================================================ */

    /**
     * A collection point taps its own zone and the board is simply there. There
     * is no barrio to walk and nothing to hand over: the work is keeping the
     * count on the shelves honest.
     */
    async openInventory(id) {
        if (!['city', 'inventory'].includes(this.state)) return
        const own = session.point?.zone
        if (id && id !== own) {
            // another zone belongs to another point; say so instead of ignoring the tap
            this.audio.play('error')
            const zone = ZONES.find((z) => z.id === own)
            this.dockBubble.say('Ese barrio lo atiende otro punto de acopio.', `Tu punto responde por ${zone?.name ?? 'tu zona'}.`)
            return
        }
        if (this.state === 'inventory') return
        this.audio.play('open')
        this.setState('inventory')
        this.zone = ZONES.find((z) => z.id === own) ?? null
        this.#disableOrbit()
        this.city.setSelected(own)
        this.labels.setAll('is-hidden', true)
        this.$('.guide-dock').hidden = true
        this.#showBack('Volver al mapa')
        // the board comes with the stand itself above it, its shelves showing the same stock
        await this.#veil(true)
        this.#showDepot()
        await this.inventoryPanel.openFor(session.point, this.inventory)
        this.#frameDepot()
        this.#veil(false)
        this.#syncProgress()
    }

    async closeInventory() {
        if (this.state !== 'inventory') return
        this.setState('city')
        this.city.setSelected(null)
        this.#hideBack()
        await this.#veil(true)
        await this.inventoryPanel.close()
        this.#showCity()
        const home = this.#homeFrame()
        this.rig.set(home.pos, home.target)
        this.labels.setAll('is-hidden', false)
        this.#veil(false)
        const zone = ZONES.find((z) => z.id === session.point?.zone)
        this.#showGuideDock('Tu inventario quedó guardado.', `Toca ${zone?.name ?? 'tu zona'} cuando quieras actualizarlo.`)
        this.#enableOrbit()
    }

    /** Swap the map for the stand. Its shelves follow the store live, wherever the change came from. */
    #showDepot() {
        this.city.group.visible = false
        this.clouds.group.visible = false
        this.depot.setPoint(session.point)
        this.depot.reset()
        this.depot.sync(this.inventory, { instant: true })
        this.depotSync?.()
        const store = this.inventory
        this.depotSync = store.on(() => this.depot.sync(store))
        this.depot.group.visible = true
        this.stage.setShadowFrame(new THREE.Vector3(0, 1.5, -0.6), 11, { mapSize: 2048, normalBias: 0.05 })
        this.stage.setFog(40, 160)
        this.stage.setInk(INK.barrio[0], INK.barrio[1])
    }

    #hideDepot() {
        this.depotSync?.()
        this.depotSync = null
        if (this.depot) this.depot.group.visible = false
    }

    /**
     * Frame the stand straight from the front, in the band the board leaves
     * free between the top bar and itself: as close as it can be while the
     * whole stand still fits, and centred in that band.
     */
    #frameDepot() {
        const cam = this.stage.camera
        const { w, h } = this.stage.size
        // phones also have the floating sound button up there
        const top = (isNarrow() ? this.#chromeBottom() : this.$('.topbar')?.getBoundingClientRect().bottom ?? 96) + 8
        // offsetTop ignores the board's rise-in transform: frame where it comes to rest
        const panelTop = this.inventoryPanel.el.offsetTop || h * 0.6
        const free = Math.max(140, panelTop - top - 8)
        const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)
        const height = DEPOT_BOUNDS.top - DEPOT_BOUNDS.bottom
        const byHeight = (height * h) / (2 * tan * free)
        const byWidth = (DEPOT_BOUNDS.width * h) / (2 * tan * w * 0.96)
        const dist = Math.max(byHeight, byWidth) * 1.04
        const look = this.depot.center
        this.rig.set(new THREE.Vector3(look.x, look.y, look.z + dist), look)
        this.stage.viewOffset.x = 0
        this.stage.viewOffset.y = h / 2 - (top + free / 2)
        this.stage.applyViewOffset()
    }

    /** Lowest edge of what sits at the top of the screen: top bar, back button, progress, the floating sound button. */
    #chromeBottom() {
        const bottoms = ['.topbar', '.back-btn', '.progress', '.js-sound']
            .map((sel) => this.$(sel))
            .filter((el) => el && !el.hidden && el.getClientRects().length && getComputedStyle(el).opacity !== '0')
            .map((el) => el.getBoundingClientRect().bottom)
        return Math.max(96, ...bottoms)
    }

    /**
     * Where the camera goes for a chosen zone. On a phone the card covers the
     * lower part of the screen, so the zone is brought in until it spans the
     * width, and it is centred in the band between the top bar and the card.
     */
    #zoneView(id) {
        const focus = this.city.focusPoint(id)
        let dist = 200 * this.#cityFrame().zoneK
        if (isNarrow()) {
            const { center, radius } = this.city.zoneFrame(id)
            const cam = this.stage.camera
            const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * (this.stage.size.w / this.stage.size.h)
            dist = Math.min(dist, (radius * ZONE_FIT_PHONE) / tanH)
            focus.copy(center).setY(focus.y)
        }
        const dir = this.#cityDir()
        if (isNarrow()) dir.y *= ZONE_TILT_PHONE
        return { pos: focus.clone().addScaledVector(dir.normalize(), dist), target: focus }
    }

    deselectZone() {
        if (this.state !== 'zone') return
        this.setState('city')
        this.zone = null
        this.city.setSelected(null)
        this.labels.setAll('is-active', false)
        this.labels.setAll('is-dim', false)
        this.zoneCard.hide()
        this.#frameForPanel(null)
        this.#flyCity(this.#cityFrame().pos, CITY_VIEW.target, 1.3)
        this.#showGuideDock('Puedes elegir cualquier zona.', 'Selecciona una zona de la ciudad.')
    }

    #cityDir() {
        return CITY_VIEW.pos.clone().sub(CITY_VIEW.target).normalize()
    }

    /**
     * Where the city view rests. A collection point only works its own zone, so
     * its view comes in close on that zone; everyone else sees the whole city.
     */
    #homeFrame() {
        const zoneId = session.role === 'collector' ? session.point?.zone : null
        if (!zoneId || !this.city) return { pos: this.#cityFrame().pos, target: CITY_VIEW.target.clone() }
        const { center, radius } = this.city.zoneFrame(zoneId)
        const a = this.stage.size.w / this.stage.size.h
        const dist = radius * HOME_ZONE_FIT * Math.min(1.8, Math.max(1, 1.15 / a))
        const dir = this.#cityDir()
        dir.y *= HOME_ZONE_TILT
        return { pos: center.clone().addScaledVector(dir.normalize(), dist), target: center.clone() }
    }

    /** Fly within the city view; the limited orbit is paused during the move. */
    async #flyCity(pos, target, duration, ease) {
        this.#disableOrbit()
        const flight = (this._flight = this.rig.flyTo(pos, target, { duration, ease }))
        await flight
        if (this._flight === flight && ['city', 'zone'].includes(this.state)) this.#enableOrbit()
    }

    /* ================================================================
       The barrio camera: one fixed vantage point, zoom only
       ================================================================ */

    /**
     * Point the barrio camera at something and stay there.
     * `dist` is the distance at zoom 1; the person can only move along that
     * same line, so the framing they were given is always recoverable.
     */
    #lookAt(look, { dir = BARRIO_VIEW.dir, dist = BARRIO_VIEW.dist } = {}) {
        const a = this.stage.size.w / this.stage.size.h
        this.barrioCam = { look: look.clone(), dir: dir.clone(), dist: dist * Math.min(PORTRAIT_PULL_BACK, Math.max(1, 0.9 / a)) }
        this.zoom.value = this.zoom.target = 1
        return this.#camPos()
    }

    #camPos() {
        const c = this.barrioCam
        return c.look.clone().addScaledVector(c.dir, c.dist * this.zoom.value)
    }

    /** Wheel and pinch only change how close the view is, never its angle. */
    zoomBy(delta) {
        if (!this.barrioCam) return
        const z = this.zoom
        // close views (the stand, the counter) can always back off far enough to take in the whole barrio
        const max = Math.max(BARRIO_VIEW.zoom.max, BARRIO_VIEW.wholeBarrio / this.barrioCam.dist)
        z.target = THREE.MathUtils.clamp(z.target * (1 + delta), BARRIO_VIEW.zoom.min, max)
    }

    #zoomStep(dt) {
        const z = this.zoom
        if (!this.barrioCam || Math.abs(z.target - z.value) < 0.0005) return
        z.value += (z.target - z.value) * (1 - Math.exp(-dt * 7))
        this.rig.kill()
        this.rig.stopFollow()
        this.rig.pos.copy(this.#camPos())
        this.rig.target.copy(this.barrioCam.look)
        this.rig.apply()
    }

    #cityFrame() {
        const a = this.stage.size.w / this.stage.size.h
        const k = Math.min(1.3, Math.max(1, 0.85 / a))
        const dir = CITY_VIEW.pos.clone().sub(CITY_VIEW.target)
        return { pos: CITY_VIEW.target.clone().addScaledVector(dir, k), zoneK: Math.min(1.8, Math.max(1, 1.15 / a)) }
    }

    #frameForPanel(panel, fallbackW = 640) {
        const vo = this.stage.viewOffset
        let x = 0, y = 0
        if (panel) {
            if (isNarrow()) {
                // centre the scene in the band left between the top of the screen and the sheet
                const H = window.innerHeight
                const sheetTop = H - (panel.footprint().h || H * 0.5) - 12
                y = Math.max(0, H / 2 - (this.#chromeBottom() + sheetTop) / 2)
            } else {
                // the supply panel sits on the left, so the scene moves right; the zone card is on the right
                const shift = ((panel.footprint().w || fallbackW) + 24) * 0.5
                x = panel === this.zoneCard ? shift : -shift
            }
        }
        gsap.to(vo, { x, y, duration: this.reducedMotion ? 0.01 : 1.0, ease: 'sine.inOut', onUpdate: () => this.stage.applyViewOffset() })
    }

    /* ================================================================
       Limited orbit over the map (city view only)
       ================================================================ */

    #setupOrbit() {
        const o = (this.orbit = new OrbitControls(this.stage.camera, this.stage.canvas))
        o.enabled = false
        o.enableDamping = true
        o.dampingFactor = 0.07
        o.rotateSpeed = 0.42
        o.zoomSpeed = 0.6
        o.panSpeed = 0.55
        o.screenSpacePanning = false
        o.addEventListener('start', () => (this.orbitTouched = true))
    }

    #enableOrbit() {
        const o = this.orbit
        const cam = this.stage.camera
        o.target.copy(this.rig.target)
        const offset = cam.position.clone().sub(o.target)
        const sph = new THREE.Spherical().setFromVector3(offset)
        this.orbitBase = { target: o.target.clone(), radius: sph.radius, theta: sph.theta, phi: sph.phi }
        // Restricted, but with room to tilt toward the horizon and turn west, so the
        // hills with Cristo Rey and the Tres Cruces can be brought into view
        // (the hills are to the west, which the camera faces by swinging toward +theta)
        o.minAzimuthAngle = sph.theta - 0.6
        o.maxAzimuthAngle = sph.theta + 0.9
        o.minPolarAngle = Math.max(0.3, sph.phi - 0.2)
        o.maxPolarAngle = Math.min(1.36, sph.phi + 0.5)
        o.minDistance = sph.radius * 0.6
        o.maxDistance = sph.radius * 1.2
        o.enabled = true
        o.update()
    }

    #disableOrbit() {
        if (!this.orbit.enabled) return
        this.orbit.enabled = false
        this.rig.pos.copy(this.stage.camera.position)
        this.rig.target.copy(this.orbit.target)
        this.$('.recenter').hidden = true
    }

    #orbitStep() {
        const o = this.orbit
        const b = this.orbitBase
        // keep panning close to the curated view
        const d = new THREE.Vector3().subVectors(o.target, b.target)
        d.y = 0
        const max = b.radius * 0.24
        if (d.length() > max) {
            d.setLength(max)
            const fix = b.target.clone().add(d).setY(b.target.y)
            this.stage.camera.position.add(fix.clone().sub(o.target))
            o.target.copy(fix)
        }
        o.target.y = b.target.y
        o.update()
        const off = new THREE.Spherical().setFromVector3(this.stage.camera.position.clone().sub(o.target))
        const moved = Math.abs(off.theta - b.theta) > 0.08 || Math.abs(off.radius - b.radius) > b.radius * 0.06 || d.length() > 4
        this.$('.recenter').hidden = !moved || !['city', 'zone'].includes(this.state)
    }

    recenter() {
        if (!this.orbitBase) return
        const b = this.orbitBase
        this.#flyCity(b.target.clone().add(new THREE.Vector3().setFromSphericalCoords(b.radius, b.phi, b.theta)), b.target.clone(), 1.4)
    }

    /* ================================================================
       City → neighborhood
       ================================================================ */

    async enterBarrio(zone) {
        if (this.state !== 'zone') return
        this.setState('entering')
        this.#disableOrbit()
        this.zoneCard.hide()
        this.labels.clear()
        this.#hideGuideDock()
        this.#frameForPanel(null)

        const barrio = this.pendingBarrio?.id === zone.id ? this.pendingBarrio : buildBarrio(zone, this.theme)
        const ready = this.hood.prepare(barrio)

        const focus = this.city.focusPoint(zone.id)
        const dive = this.rig.flyTo(focus.clone().addScaledVector(this.#cityDir(), 55), focus, { duration: 1.4, ease: 'power2.in' })
        await wait(this.reducedMotion ? 0.1 : 0.5)
        await this.#veil(true)
        await Promise.all([dive, ready])

        // Swap worlds behind the veil
        this.barrio = barrio
        this.city.group.visible = false
        this.clouds.group.visible = false
        this.hood.group.visible = true
        await this.hood.setBarrio(barrio)
        this.#nightLights()
        this.#barrioLighting()
        this.stage.viewOffset.x = this.stage.viewOffset.y = 0
        this.stage.applyViewOffset()

        this.families.clear()
        // a barrio kept in the cache may still hold supplies from an earlier visit
        this.hood.resetDisplay()
        const acopio = this.hood.acopio
        this.#setContext('home', barrio.name, 'Cali, Valle del Cauca')

        // the collection point sits in the middle of the view in every barrio
        const c = acopio.center
        const arrive = this.#lookAt(new THREE.Vector3(c.x, c.y + 1, c.z - 2))
        this.barrioHome = { ...this.barrioCam }
        this.rig.set(arrive.clone().add(new THREE.Vector3(0, 26, 16)), this.barrioCam.look.clone())

        this.currentNode = this.hood.startNode
        this.guide.place(this.hood.start, Math.PI)
        this.guide.hide()

        this.#veil(false)
        await this.rig.flyTo(arrive, this.barrioCam.look.clone(), { duration: 1.9, ease: 'power3.out' })

        await this.guide.appear()
        this.setState('barrio')
        this.#showBack('Volver al mapa')
        this.#showBarrioLabels()
        this.say('Hola. Aquí se recibe la ayuda del barrio.', 'Entra al punto de acopio para dejar tus suministros.')
        this.labels.get('acopio')?.focus({ preventScroll: true })
        this.guide.point(1.4)
    }

    #veil(on) {
        const el = this.$('.veil')
        return new Promise((resolve) => {
            gsap.to(el, {
                autoAlpha: on ? 1 : 0,
                duration: this.reducedMotion ? 0.15 : on ? 0.6 : 0.95,
                ease: on ? 'sine.in' : 'sine.out',
                onComplete: resolve,
            })
        })
    }

    /**
     * One marker: the collection point, the only thing a person opens in a
     * barrio. The houses carry no markers; what they need is shown at the stand.
     */
    #showBarrioLabels() {
        this.labels.clear()
        const acopioEl = this.labels.add('acopio', {
            className: 'is-compact is-point',
            html: `<span class="wlabel-icon" style="background:#011E41">${icon('box')}</span>`,
            ariaLabel: `Punto de acopio del ${this.barrio.name}. Abrir`,
            anchor: () => this.hood.acopioAnchor(this._aAnchor ?? (this._aAnchor = new THREE.Vector3())),
            onClick: () => this.openPoint(),
        })
        acopioEl.style.setProperty('--delay', '0ms')
    }

    /**
     * Move in on the counter (panel open) or back to the barrio view (panel closed).
     * `duration` lets the move last as long as something else, like the guide's walk.
     */
    #frameCounter(on, duration = 1.3) {
        if (on) {
            const v = this.hood.acopioViewpoint(COUNTER_VIEW)
            this.#lookAt(v.look, { dir: v.dir, dist: v.dist })
        } else if (this.barrioHome) {
            this.barrioCam = { ...this.barrioHome, look: this.barrioHome.look.clone(), dir: this.barrioHome.dir.clone() }
            this.zoom.value = this.zoom.target = 1
        }
        return this.rig.flyTo(this.#camPos(), this.barrioCam.look.clone(), {
            duration: this.reducedMotion ? 0.3 : duration,
            ease: duration > 2 ? 'sine.inOut' : 'power2.inOut',
        })
    }

    /**
     * After a donation the camera backs away from the counter, slowly, until the
     * streets around the stand are in view and the families can be seen coming
     * for their supplies. It stays on the stand: what changes is how much of the
     * barrio around it fits.
     */
    #pullBackForFamilies() {
        if (!this.barrioHome || !this.barrioCam) return
        const home = this.barrioHome
        const dist = THREE.MathUtils.lerp(this.barrioCam.dist, home.dist, PULL_BACK.reach)
        const look = this.barrioCam.look.clone().lerp(home.look, PULL_BACK.reach)
        const dir = this.barrioCam.dir.clone().lerp(home.dir, PULL_BACK.reach).normalize()
        this.barrioCam = { look, dir, dist }
        this.zoom.value = this.zoom.target = 1
        this.rig.flyTo(this.#camPos(), look.clone(), { duration: this.reducedMotion ? 0.3 : PULL_BACK.seconds, ease: 'sine.inOut' })
    }

    /** About how long the guide takes to walk a route, ramps included. */
    #walkSeconds(points, speed = 6.2) {
        let length = 0
        for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1])
        return length / speed + 0.9
    }

    /* ================================================================
       The collection point — the only place to act inside a barrio
       ================================================================ */

    /**
     * Donors walk over first; collection points are already standing there.
     * Either way the camera does not move: what changes is who is at the counter.
     */
    async openPoint() {
        if (!['barrio', 'walking'].includes(this.state) || this.atPoint) return
        if (this.state === 'walking') return
        this.setState('walking')
        this.hood.setSelected(true)
        this.labels.setClass('acopio', 'is-active', true)
        this.say('', 'Vamos al punto de acopio.')
        const { points } = this.hood.route(this.currentNode, 'acopio')
        points[0] = this.guide.position.clone().setY(0)
        // the camera closes in on the stand as the guide walks to it, arriving together,
        // so the barrio and the counter read as one continuous place
        this.#frameCounter(true, Math.max(1.6, this.#walkSeconds(points)))
        const arrived = await this.guide.walk(points)
        if (!arrived || this.state !== 'walking') return
        this.currentNode = 'acopio'
        // step aside so the counter stays in view while supplies are left on it
        const stand = this.hood.acopio
        this.guide.walk([this.guide.position.clone(), stand.aside.clone()], { speed: 3.2 }).then((done) => {
            if (done) this.guide.faceTowards(stand.counter)
        })
        this.guide.nod()

        this.audio.play('open')
        this.atPoint = true
        this.setState('point')
        this.hood.setSelected(true)
        this.hood.setFocusMode(true)
        this.labels.setAll('is-hidden', true)
        this.#showBack('Volver al barrio')

        this.say(session.urgentCount(this.barrio.id) ? 'Hay insumos marcados como urgentes.' : '', 'Elige qué dejar en el punto de acopio.')

        // the panel opens on the left (on phones, below) and the stand is framed in the space it leaves
        // the needs on offer are the point's stock right now, whatever happened since the barrio was built
        refreshBarrioNeeds(this.barrio)
        await this.panel.openFor(this.barrio)
        this.#syncProgress()
        this.#frameForPanel(this.panel)
        this.panel.el.querySelector('.tile-toggle:not(.is-static), .alert-btn')?.focus({ preventScroll: true })
    }

    async closePoint() {
        if (this.state !== 'point') return
        this.atPoint = false
        this.setState('barrio')
        this.hood.setSelected(false)
        this.hood.setFocusMode(false)
        this.hood.clearDisplay()
        this.labels.setAll('is-hidden', false)
        this.labels.setAll('is-active', false)
        this.#showBack('Volver al mapa')
        this.#frameForPanel(null)
        this.#frameCounter(false, 2.4)
        this.panel.close()
        if (barrioCovered(this.barrio)) this.say('El barrio quedó cubierto.', 'Gracias por tu apoyo.')
        else this.say('', 'Puedes dejar más suministros cuando quieras.')
    }

    #onDonorStep(step) {
        this.#syncProgress()
        const lines = {
            supplies: ['', 'Elige qué dejar en el punto de acopio.'],
            method: ['', 'Elige cómo quieres aportar.'],
            details: ['', 'Necesitamos pocos datos para coordinar.'],
            summary: ['Revisa el resumen.', 'Si todo está bien, confirma.'],
            payment: ['', 'Elige un medio de pago.'],
            done: ['Las familias salieron a recoger.', 'Puedes seguir apoyando cuando quieras.'],
        }
        if (lines[step]) this.say(...lines[step])
        requestAnimationFrame(() => this.#frameForPanel(this.panel))
    }

    /**
     * What arrives at the stand is shared out among the families waiting for it,
     * and the ones who were served come out to collect.
     */
    registerSupport(barrio, basket, record) {
        // the panel plays the completion sound as it moves to its last step
        const served = applyDonation(barrio, basket)
        // the donation goes onto the point's shelves and into the sheet, so the point's board,
        // the sheet and the next donor all count it
        this.board.donate(pointForZone(barrio.zone.id).id, basket)
        session.donations.push(record)
        // what was left stays on the counter, and the families come in line to take their share of it
        this.hood.commitDisplay()
        this.families.run(this.hood, served)
        if (served.length) this.#pullBackForFamilies()
        console.info(
            `[NEXOS] Aporte ${record.code} (${record.mode === 'physical' ? 'entrega física' : 'dinero, demostración'}) · ${barrio.name} · ${money(record.value)} · ${served.length} ${served.length === 1 ? 'familia' : 'familias'}`,
            Object.fromEntries([...basket].map(([k, v]) => [SUPPLIES[k].label, v]))
        )
    }

    /**
     * Shortages are no longer flagged by hand: whatever the board shows below its
     * critical line is what donors see first in this zone. The point's own board
     * is mirrored at once; the sheet carries it to every other device.
     */
    #onShortages() {
        if (session.point && this.inventory) this.board.mirror(session.point.id, this.inventory.stock)
    }

    /** The stock of some point moved (the sheet, a point's board, a donation): what donors read follows. */
    #onStock() {
        if (['city', 'zone'].includes(this.state)) {
            for (const z of ZONES) this.labels.update(`zone:${z.id}`, this.#zoneLabelHtml(z), this.#zoneAria(z))
        }
        if (this.state === 'zone' && this.zone && this.zoneCard.open) this.zoneCard.render(this.zone)
        if (this.barrio) refreshBarrioNeeds(this.barrio)
        if (this.state === 'point' && session.role === 'donor') this.donorPanel.refreshNeeds()
    }

    /* ================================================================
       Neighborhood → city, and leaving the session
       ================================================================ */

    async returnToMap() {
        if (!['barrio', 'walking', 'point'].includes(this.state)) return
        this.setState('leaving')
        this.guide.stop()
        this.families.clear()
        this.panel.close()
        this.hood.resetDisplay()
        this.hood.setFocusMode(false)
        this.hood.setSelected(false)
        this.labels.clear()
        this.worldBubble.hide()
        this.#hideBack()
        this.#frameForPanel(null)

        await this.#veil(true)
        this.#showCity()
        const focus = this.city.focusPoint(this.zone?.id ?? 'centro')
        this.rig.set(focus.clone().addScaledVector(this.#cityDir(), 70), focus)
        this.zone = null
        this.atPoint = false
        this.barrioCam = null

        this.#veil(false)
        await this.rig.flyTo(this.#cityFrame().pos, CITY_VIEW.target, { duration: 1.8, ease: 'power3.out' })
        this.setState('city')
        this.#showZoneLabels()
        this.#showGuideDock('Puedes apoyar en otra zona.', 'Selecciona una zona de la ciudad.')
        this.#enableOrbit()
    }

    #showCity() {
        this.rig.stopFollow()
        this.#hideDepot()
        this.hood.group.visible = false
        this.guide.hide()
        this.city.group.visible = true
        this.clouds.group.visible = true
        this.city.setSelected(null)
        this.#cityLighting()
        this.stage.setInk(INK.city[0], INK.city[1])
        this.stage.viewOffset.x = this.stage.viewOffset.y = 0
        this.stage.applyViewOffset()
        this.#setContext('map', 'Mapa de ayuda', 'Cali, Valle del Cauca')
    }

    /** "Salir": rise back above the clouds to the role choice. */
    async exitSession() {
        if (['role', 'boot', 'exiting'].includes(this.state)) return
        const from = this.state
        this.setState('exiting')
        this.#disableOrbit()
        this.guide?.stop()
        this.families?.clear()
        if (this.panel.open) this.panel.close()
        this.zoneCard.open && this.zoneCard.hide()
        this.labels.clear()
        this.worldBubble.hide()
        this.#hideGuideDock()
        this.#hideBack()
        this.#frameForPanel(null)
        this.$('.login').hidden = true

        if (['barrio', 'walking', 'point', 'leaving', 'entering', 'inventory'].includes(from)) {
            await this.#veil(true)
            this.#showCity()
            const home = this.#homeFrame()
            this.rig.set(home.pos, home.target)
            this.#veil(false)
        }
        if (this.city) {
            this.rig.kill()
            const look = this.rig.target.clone()
            INTRO_CURVE.points[3].copy(this.rig.pos)
            gsap.to(this, { cloudPresence: 1, duration: 1.5 })
            this.stage.setInk(0, undefined, this.reducedMotion ? 0 : 0.8)
            const s = { p: 1 }
            await new Promise((resolve) =>
                gsap.to(s, {
                    p: 0,
                    duration: this.reducedMotion ? 0.3 : 2.6,
                    ease: 'sine.inOut',
                    onUpdate: () => {
                        const e = s.p * s.p * (3 - 2 * s.p)
                        this.rig.pos.copy(INTRO_CURVE.getPoint(e))
                        this.rig.target.lerpVectors(INTRO_TARGET_FROM, look, e)
                        this.rig.apply()
                    },
                    onComplete: resolve,
                })
            )
        }
        this.intro = { p: 0, target: 0, auto: false }
        this.inventory?.stop()
        this.inventory = null
        this.city?.setFocusZone(null)
        session.role = null
        session.point = null
        this.zone = this.barrio = null
        this.setState('role')
        this.$('.role-donor').focus({ preventScroll: true })
    }

    /* ================================================================
       Shared UI
       ================================================================ */

    say(lead, action) {
        this.worldBubble.say(lead, action)
    }

    #caption(text) {
        const c = this.$('.descent-caption')
        c.textContent = text
        c.classList.add('is-waiting')
    }

    #syncProgress() {
        const role = session.role
        const show = role && !['boot', 'role', 'exiting'].includes(this.state)
        this.progress.show(!!show)
        if (!show) return
        this.progress.setSteps(STEPS[role])
        const s = this.state
        let i = 0
        if (role === 'collector') {
            i = s === 'login' ? 0 : s === 'inventory' ? 2 : 1
        } else {
            if (['entering', 'barrio', 'walking', 'leaving'].includes(s)) i = 1
            if (s === 'point') {
                const step = this.donorPanel.step
                i = step === 'supplies' ? 2 : ['method', 'details', 'payment'].includes(step) ? 3 : 4
            }
        }
        this.progress.set(i)
    }

    #syncChrome() {
        const chip = this.$('.role-chip')
        if (session.role === 'collector') chip.innerHTML = `${icon('box')}<span>Punto de acopio</span>`
        else if (session.role === 'donor') chip.innerHTML = `${icon('heart')}<span>Donante</span>`
        else chip.innerHTML = ''
        const exit = this.$('.js-exit')
        const label = session.role === 'collector' ? 'Cerrar sesión' : 'Salir'
        exit.setAttribute('aria-label', label)
        exit.title = label
    }

    #placeWorldBubble(w, h) {
        const el = this.$('.bubble-world')
        if (el.hidden) return
        const panelOpen = this.panel.open
        // the supply panel sits on the left; nothing is placed underneath it
        const panelRight = panelOpen && !isNarrow() ? this.panel.el.getBoundingClientRect().right + 16 : 24
        if (!this.guide?.root.visible) {
            // collection points have no character on screen, so the line is simply docked
            el.classList.remove('is-left')
            el.style.maxWidth = `${Math.min(420, w - panelRight - 24)}px`
            el.style.transform = `translate3d(${panelRight}px, ${h - el.offsetHeight - 24}px, 0)`
            return
        }
        if (isNarrow()) {
            const top = panelOpen ? (this.$('.progress').getBoundingClientRect().bottom || this.$('.topbar').getBoundingClientRect().bottom || 80) + 10 : h - el.offsetHeight - 16
            el.classList.remove('is-left')
            el.style.transform = `translate3d(12px, ${top}px, 0)`
            el.style.maxWidth = `${w - 24}px`
            return
        }
        el.style.maxWidth = ''
        const p = this._bub ?? (this._bub = new THREE.Vector3())
        p.copy(this.guide.position).setY(this.guide.position.y + 2.2).project(this.stage.camera)
        const x = (p.x * 0.5 + 0.5) * w
        const y = (-p.y * 0.5 + 0.5) * h
        const bw = el.offsetWidth
        const bh = el.offsetHeight
        let left = x + 46
        let isLeft = false
        if (left + bw > w - 24 && x - 46 - bw >= panelRight) {
            left = x - 46 - bw
            isLeft = true
        }
        left = Math.max(panelRight, Math.min(left, w - bw - 24))
        const minTop = (this.$('.progress').getBoundingClientRect().bottom || 120) + 12
        const top = Math.min(Math.max(minTop, y - bh + 24), h - bh - 24)
        el.classList.toggle('is-left', isLeft)
        el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`
    }

    #chromeRects() {
        const rects = [this.$('.topbar').getBoundingClientRect()]
        for (const sel of ['.back-btn', '.progress']) {
            const el = this.$(sel)
            if (!el.hidden) rects.push(el.getBoundingClientRect())
        }
        return rects
    }

    #setContext(iconName, title, sub) {
        const ic = this.$('.context-icon')
        ic.dataset.icon = iconName
        ic.innerHTML = ''
        hydrateIcons(this.$('.context'))
        this.$('.context-title').textContent = title
        this.$('.context-sub').textContent = sub
    }

    #showBack(label) {
        const b = this.$('.back-btn')
        b.querySelector('.back-label').textContent = label
        b.setAttribute('aria-label', label)
        b.hidden = false
    }

    #hideBack() {
        this.$('.back-btn').hidden = true
    }

    back() {
        if (this.state === 'point') {
            // inside the donor flow, step back before leaving the stand
            const order = { method: 'supplies', details: 'method', summary: 'details', payment: 'method' }
            const prev = session.role === 'donor' && order[this.donorPanel.step]
            if (prev) return this.donorPanel.go(prev)
            return this.closePoint()
        }
        if (this.state === 'inventory') return this.closeInventory()
        if (this.state === 'barrio' || this.state === 'walking') return this.returnToMap()
        if (this.state === 'zone') return this.deselectZone()
        if (this.state === 'login') return this.#loginBack()
    }

    /**
     * Cali's time and weather, every few seconds: the clock always, and the
     * world only when the light has really moved (a change of weather, or the
     * sun a little lower), so the scene eases from one to the next.
     */
    #onSky(s) {
        this.#renderClock(s)
        const key = `${s.kind}:${Math.round(s.daylight * 48)}`
        if (key === this.skyKey) return
        const first = !this.skyKey
        this.skyKey = key
        // the real day changes slowly; a time set by hand answers at once
        this.stage.applyMood(skyMood(this.theme.mood, s), first || this.reducedMotion ? 0 : s.manual ? 0.35 : 4)
        // it rains in the world when it rains in Cali (as hard as it does), and always in a flood emergency
        const level = Math.max(this.theme.mood.rain ? 0.55 : 0, s.weather.rain ?? 0)
        this.rainOn = level > 0
        if (this.rainOn) {
            this.#setupRain()
            this.rain.near.setLevel(level)
            this.rain.far.setLevel(level)
        }
        // a storm flashes now and then (not for people who asked for less motion)
        this.lightning = !!s.weather.lightning && !this.reducedMotion
        this.nextFlash = null
        this.nightness = 1 - s.daylight
        this.#nightLights()
    }

    #renderClock(s) {
        const el = this.$('.clock')
        if (!el) return
        el.querySelector('.clock-time').textContent = s.time
        el.querySelector('.clock-sub').textContent = [s.temp !== null ? `${s.temp} °C` : null, s.loaded ? s.label : 'Cali'].filter(Boolean).join(' · ')
        const ic = el.querySelector('.clock-icon')
        if (ic.dataset.icon !== s.icon) {
            ic.dataset.icon = s.icon
            ic.innerHTML = ''
            hydrateIcons(el)
        }
        el.setAttribute('aria-label', `En Cali son las ${s.time}. ${s.label}${s.temp !== null ? `, ${s.temp} grados` : ''}.`)
    }

    /**
     * After dark the street lamps come on and the windows glow warm. Lamps and
     * glass share their materials across every copy, so setting them once
     * reaches every house; it runs again whenever a new barrio is built.
     */
    #nightLights() {
        const n = this.nightness ?? 0
        this.hood?.setNight(n)
        setWindowGlow(n)
        this.stage.scene.traverse((o) => {
            if (!o.isMesh) return
            for (const m of [o.material].flat()) {
                if (!m?.emissive) continue
                const name = m.name ?? ''
                if (name.startsWith('house:lamp')) m.emissiveIntensity = 0.6 + 2.6 * n
                // only the glass glows, through what is painted on it (see three/nightWindows.js)
                else if (WINDOW_MATERIAL.test(name)) makeNightWindow(m)
            }
        })
    }

    #setupRain() {
        if (this.rain) return
        this.rain = {
            near: new Rain({ count: 2600, area: 70, height: 36, length: 0.9, opacity: 0.17 }),
            far: new Rain({ count: 3200, area: 520, height: 260, length: 7, opacity: 0.11 }),
        }
        this.stage.scene.add(this.rain.near.mesh, this.rain.far.mesh)
    }

    /* ================================================================
       Input — clicks; limited orbit on the map only
       ================================================================ */

    #bindInput() {
        const canvas = this.stage.canvas
        const ray = new THREE.Raycaster()
        const ndc = new THREE.Vector2()
        let down = null

        const toRay = (e) => {
            ndc.set((e.clientX / this.stage.size.w) * 2 - 1, -(e.clientY / this.stage.size.h) * 2 + 1)
            ray.setFromCamera(ndc, this.stage.camera)
            return ray
        }

        const hoverAt = (e) => {
            let hit = null
            if (['city', 'zone'].includes(this.state)) {
                hit = this.city.pick(toRay(e))
                // a collection point can only act on its own zone, so only that one reacts
                if (session.role === 'collector' && hit !== session.point?.zone) hit = null
                this.city.setHover(hit)
                for (const z of ZONES) this.labels.setClass(`zone:${z.id}`, 'is-hover', z.id === hit)
            } else if (['barrio', 'walking'].includes(this.state)) {
                hit = this.hood.pick(toRay(e)) === 'acopio' ? 'acopio' : null
                this.hood.setHover(!!hit)
                this.labels.setClass('acopio', 'is-hover', !!hit)
            }
            canvas.style.cursor = hit ? 'pointer' : ['city', 'zone'].includes(this.state) ? 'grab' : ''
        }

        canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }))
        canvas.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'mouse' && !e.buttons) hoverAt(e)
        })
        canvas.addEventListener('pointerleave', () => {
            this.city?.setHover(null)
            this.hood?.setHover(false)
        })
        canvas.addEventListener('pointerup', (e) => {
            if (!down) return
            const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
            down = null
            if (moved > 10) return
            if (['city', 'zone'].includes(this.state)) {
                const id = this.city.pick(toRay(e))
                if (id) this.selectZone(id)
                else if (this.state === 'zone') this.deselectZone()
            } else if (['barrio', 'walking'].includes(this.state)) {
                if (this.hood.pick(toRay(e)) === 'acopio') this.openPoint()
            }
        })

        // Wheel: speeds up the descent above the clouds, zooms inside a barrio
        window.addEventListener(
            'wheel',
            (e) => {
                if (this.state === 'intro') return this.advanceIntro(Math.max(-0.2, Math.min(0.2, e.deltaY * 0.001)))
                if (['barrio', 'walking', 'point'].includes(this.state)) this.zoomBy(Math.max(-0.12, Math.min(0.12, e.deltaY * 0.0012)))
            },
            { passive: true }
        )

        // Pinch to zoom, with the same limits as the wheel
        let pinch = null
        const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
        canvas.addEventListener(
            'touchstart',
            (e) => {
                if (e.touches.length === 2) pinch = spread(e.touches)
            },
            { passive: true }
        )
        canvas.addEventListener(
            'touchmove',
            (e) => {
                if (e.touches.length !== 2 || pinch === null) return
                const d = spread(e.touches)
                if (d > 0) this.zoomBy(Math.max(-0.1, Math.min(0.1, (pinch - d) / 420)))
                pinch = d
            },
            { passive: true }
        )
        canvas.addEventListener('touchend', () => (pinch = null), { passive: true })
        let ty = null
        window.addEventListener('touchstart', (e) => (ty = e.touches[0]?.clientY ?? null), { passive: true })
        window.addEventListener(
            'touchmove',
            (e) => {
                if (this.state !== 'intro' || ty === null) return
                const y = e.touches[0].clientY
                this.advanceIntro((ty - y) * 0.003)
                ty = y
            },
            { passive: true }
        )

        this.ui.querySelectorAll('.role-btn').forEach((b) => b.addEventListener('click', () => this.chooseRole(b.dataset.role)))
        this.$('.login-card').addEventListener('submit', (e) => this.#submitLogin(e))
        this.$('.js-login-back').addEventListener('click', () => this.#loginBack())
        this.$('.back-btn').addEventListener('click', () => this.back())
        this.$('.js-exit').addEventListener('click', () => this.exitSession())
        this.$('.recenter').addEventListener('click', () => this.recenter())
        this.$('.skip-intro').addEventListener('click', () => {
            if (this.state !== 'intro' || !this.worldReady) return
            this.audio.play('tap')
            this.intro.p = 1
            this.enterCity()
        })

        const soundBtn = this.$('.js-sound')
        // a phone's top bar has no room for it: there it floats just under the exit button
        const soundHome = soundBtn.parentElement
        const soundNext = soundBtn.nextElementSibling
        const narrowQuery = window.matchMedia('(max-width: 760px), (max-height: 560px) and (max-width: 1000px)')
        const placeSound = () => {
            if (narrowQuery.matches) this.$('.topbar').after(soundBtn)
            else soundHome.insertBefore(soundBtn, soundNext)
            soundBtn.classList.toggle('is-floating', narrowQuery.matches)
        }
        narrowQuery.addEventListener('change', placeSound)
        placeSound()
        soundBtn.addEventListener('click', () => {
            const on = this.audio.toggle()
            if (on) this.audio.play('tap')
        })
        this.audio.onChange((on) => {
            soundBtn.setAttribute('aria-pressed', String(on))
            soundBtn.setAttribute('aria-label', on ? 'Silenciar sonido' : 'Activar sonido')
            const ic = soundBtn.querySelector('[data-icon]')
            ic.dataset.icon = on ? 'sound' : 'muted'
            ic.innerHTML = ''
            hydrateIcons(soundBtn)
        })

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !e.target.closest?.('input, textarea')) this.back()
        })
        window.addEventListener('resize', () => {
            if (this.state === 'zone') this.#frameForPanel(this.zoneCard)
            if (this.state === 'point') this.#frameForPanel(this.panel)
            if (this.state === 'inventory') requestAnimationFrame(() => this.#frameDepot())
        })

        // Alerts made by a collection point show up live on the map
        session.on((type) => {
            if (type !== 'alerts' || !['city', 'zone'].includes(this.state)) return
            for (const z of ZONES) this.labels.update(`zone:${z.id}`, this.#zoneLabelHtml(z), this.#zoneAria(z))
        })
    }
}
