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
import { HOUSE_MODELS, ASSETS } from '../data/assets.js'
import { ZONES, NEED_WORD, buildBarrio, zoneLevel } from '../data/zones.js'
import { CATEGORIES, SUPPLIES, money } from '../data/catalog.js'
import { validateCredentials, pointForZone } from '../data/collectionPoints.js'
import { Labels, Bubble } from '../ui/Labels.js'
import { ZoneCard, DonorPanel, CollectorPanel, isNarrow } from '../ui/panels.js'
import { Progress, STEPS } from '../ui/Progress.js'
import { icon, hydrateIcons } from '../ui/icons.js'
import { session } from './session.js'

/**
 * Flow
 *   role ─┬─ donor ─────────── intro (descent) → city → zone → entering → barrio ⇄ walking → house (panel steps)
 *         └─ collector → login ┘
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
const FOLLOW_OFFSET = new THREE.Vector3(0, 15, 18.5)
const FOLLOW_LOOK = new THREE.Vector3(0, 0.8, -9.5)

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000))

export class App {
    constructor() {
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        this.ui = document.getElementById('ui')
        this.$ = (sel) => this.ui.querySelector(sel)
        this.theme = session.theme
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

        const opts = { reducedMotion: this.reducedMotion }
        const panelEl = this.$('.supply-panel')
        this.zoneCard = new ZoneCard(this.$('.zone-card'), opts, {
            onEnter: (zone) => this.enterBarrio(zone),
            onClose: () => this.deselectZone(),
        })
        this.donorPanel = new DonorPanel(panelEl, opts, {
            items: this.items,
            loader: this.loader,
            onClose: () => this.closeHouse(),
            onStep: (step) => this.#onDonorStep(step),
            onConfirm: (house, basket, record) => this.registerSupport(house, basket, record),
            onExitMap: () => this.returnToMap(),
        })
        this.collectorPanel = new CollectorPanel(panelEl, opts, {
            items: this.items,
            loader: this.loader,
            onClose: () => this.closeHouse(),
            onAlert: (house, item, on) => this.#onAlert(house, item, on),
        })

        this.state = 'boot'
        this.intro = { p: 0, target: 0, auto: false }
        this.zone = null
        this.barrio = null
        this.houseId = null
        this.currentNode = null
        this.cloudPresence = 1
        this.worldReady = false

        // Clouds and sky first: they are the "loading screen"
        this.clouds = new CloudLayer({ reducedMotion: this.reducedMotion })
        this.stage.scene.add(this.clouds.group)
        this.rig.set(INTRO_CURVE.getPoint(0), INTRO_TARGET_FROM)
        this.#setupOrbit()
        this.#setupRain()
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
        this.ui.dataset.state = s
        this.ui.dataset.role = session.role ?? ''
        this.#syncProgress()
        this.#syncChrome()
    }

    get panel() {
        return session.role === 'collector' ? this.collectorPanel : this.donorPanel
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

        const guideT = await this.loader.load('guide')
        this.guide = new GuideCharacter(this.loader.instanceSync(guideT), guideT.animations, { reducedMotion: this.reducedMotion })
        this.hood.group.add(this.guide.root)
        this.portrait = new GuideCharacter(this.loader.instanceSync(guideT), guideT.animations, { reducedMotion: this.reducedMotion })
        this.portrait.place(new THREE.Vector3(), 0.32)
        this.portrait.blob.visible = false

        // Compile shaders now (not on first view) to avoid hitches later
        await this.stage.renderer.compileAsync?.(this.stage.scene, this.stage.camera).catch(() => {})
        this.worldReady = true

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
    }

    /* ================================================================
       Frame loop
       ================================================================ */

    #tick(dt, t) {
        if (this.state === 'intro') this.#introStep(dt)
        if (this.orbit.enabled) this.#orbitStep()
        else this.rig.update(dt)

        if (this.city?.group.visible) this.city.update(dt, t)
        if (this.clouds.group.visible) this.clouds.update(dt, this.stage.camera, this.cloudPresence)
        if (this.hood?.group.visible) {
            this.hood.update(dt, t)
            this.guide.update(dt, t)
            const p = this.guide.position
            p.y = this.hood.heightAt(p.x, p.z)
        }
        if (this.portraitShown) this.portrait.update(dt, t)
        if (this.rain) {
            const inBarrio = this.hood?.group.visible
            const r = inBarrio ? this.rain.near : this.rain.far
            const other = inBarrio ? this.rain.far : this.rain.near
            other.mesh.visible = false
            r.mesh.visible = ['city', 'zone', 'barrio', 'walking', 'house', 'entering', 'leaving'].includes(this.state)
            r.update(dt, inBarrio ? this.guide.position : this.rig.target)
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
    }

    #introStep(dt) {
        const it = this.intro
        // Hold softly inside the clouds until the city is ready — never a frozen frame
        const limit = this.worldReady ? 1 : 0.3
        const target = Math.min(it.target, limit)
        const rate = this.reducedMotion ? 10 : it.auto ? 0.95 : 2.0
        it.p += (target - it.p) * (1 - Math.exp(-dt * rate))
        const e = it.p * it.p * (3 - 2 * it.p)
        INTRO_CURVE.points[3].copy(this.#cityFrame().pos)
        this.rig.pos.copy(INTRO_CURVE.getPoint(e))
        this.rig.target.lerpVectors(INTRO_TARGET_FROM, CITY_VIEW.target, e)
        this.rig.apply()
        this.$('.descent-caption').classList.toggle('is-waiting', !this.worldReady && it.p > 0.25)
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
        this.setState('city')
        this.rig.set(this.#cityFrame().pos, CITY_VIEW.target)
        this.#setContext('map', 'Mapa de ayuda', 'Cali, Valle del Cauca')
        this.#showZoneLabels()
        if (session.role === 'collector') this.#showGuideDock(`Hola, equipo de ${session.point.name.replace('Punto de acopio ', '')}.`, 'Elige una zona para revisar sus casas.')
        else this.#showGuideDock('Hola, te ayudo a encontrar dónde apoyar.', 'Selecciona una zona de la ciudad.')
        gsap.to(this, { cloudPresence: 0.85, duration: 2 })
        this.#enableOrbit()
    }

    #zoneLabelHtml(zone) {
        const level = zoneLevel(zone, this.theme)
        const urgent = session.zoneHasUrgent(zone.id)
        const high = level === 'alta' || urgent
        const status = urgent ? 'Faltantes urgentes' : NEED_WORD[level]
        return `
            <span class="wlabel-icon" style="background:${high ? '#F5333F' : '#011E41'}">${icon('home')}</span>
            <span class="wlabel-text">${zone.name}<span class="wlabel-status ${high ? 'is-high' : ''}">${status}</span></span>
            <span class="wlabel-chevron" data-icon="chevron-right"></span>`
    }

    #showZoneLabels() {
        this.labels.clear()
        ZONES.forEach((zone, i) => {
            const el = this.labels.add(`zone:${zone.id}`, {
                html: this.#zoneLabelHtml(zone),
                ariaLabel: `${zone.name}. ${NEED_WORD[zoneLevel(zone, this.theme)]}. Ver detalles`,
                anchor: () => this.city.labelAnchor(zone.id, this._anchor ?? (this._anchor = new THREE.Vector3())),
                onClick: () => this.selectZone(zone.id),
            })
            el.style.setProperty('--delay', `${i * 70}ms`)
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
        if (!['city', 'zone'].includes(this.state)) return
        const zone = ZONES.find((z) => z.id === id)
        this.zone = zone
        this.setState('zone')
        this.city.setSelected(id)
        for (const z of ZONES) {
            this.labels.setClass(`zone:${z.id}`, 'is-active', z.id === id)
            this.labels.setClass(`zone:${z.id}`, 'is-dim', z.id !== id)
        }
        this.zoneCard.render(zone)
        this.zoneCard.show()

        const focus = this.city.focusPoint(id)
        this.#flyCity(focus.clone().addScaledVector(this.#cityDir(), 200 * this.#cityFrame().zoneK), focus, 2.0)
        this.#frameForPanel(this.zoneCard, 420)

        if (session.role === 'collector') this.dockBubble.say('Revisa las casas de este barrio.', 'Puedes marcar lo que falta con urgencia.')
        else this.dockBubble.say('Esta zona necesita apoyo.', 'Puedes entrar al barrio para ver las casas.')
        if (isNarrow()) this.$('.guide-dock').hidden = true
        requestAnimationFrame(() => this.zoneCard.focusPrimary())

        // Build this barrio ahead of time so entering is instant
        this.pendingBarrio = buildBarrio(zone, this.theme)
        this.hood.prepare(this.pendingBarrio)
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
        this.#flyCity(this.#cityFrame().pos, CITY_VIEW.target, 1.8)
        this.#showGuideDock('Puedes elegir cualquier zona.', session.role === 'collector' ? 'Elige una zona para revisar.' : 'Selecciona una zona de la ciudad.')
    }

    #cityDir() {
        return CITY_VIEW.pos.clone().sub(CITY_VIEW.target).normalize()
    }

    /** Fly within the city view; the limited orbit is paused during the move. */
    async #flyCity(pos, target, duration) {
        this.#disableOrbit()
        const flight = (this._flight = this.rig.flyTo(pos, target, { duration }))
        await flight
        if (this._flight === flight && ['city', 'zone'].includes(this.state)) this.#enableOrbit()
    }

    #followOffset() {
        const a = this.stage.size.w / this.stage.size.h
        const base = this.hood?.cameraOffset ? new THREE.Vector3(...this.hood.cameraOffset) : FOLLOW_OFFSET.clone()
        return base.multiplyScalar(Math.min(1.45, Math.max(1, 0.85 / a)))
    }

    #followLook() {
        return this.hood?.cameraLook ? new THREE.Vector3(...this.hood.cameraLook) : FOLLOW_LOOK.clone()
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
                const h = panel.footprint().h || window.innerHeight * 0.6
                y = Math.min(h * 0.5, window.innerHeight * 0.32)
            } else {
                x = ((panel.footprint().w || fallbackW) + 24) * 0.5
            }
        }
        gsap.to(vo, { x, y, duration: this.reducedMotion ? 0.01 : 1.6, ease: 'sine.inOut', onUpdate: () => this.stage.applyViewOffset() })
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
        // Restricted: a little rotation, a little tilt, modest zoom, short pan
        o.minAzimuthAngle = sph.theta - 0.42
        o.maxAzimuthAngle = sph.theta + 0.42
        o.minPolarAngle = Math.max(0.35, sph.phi - 0.16)
        o.maxPolarAngle = Math.min(1.05, sph.phi + 0.12)
        o.minDistance = sph.radius * 0.72
        o.maxDistance = sph.radius * 1.12
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
        const max = b.radius * 0.14
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
        const dive = this.rig.flyTo(focus.clone().addScaledVector(this.#cityDir(), 55), focus, { duration: 1.9, ease: 'power2.in' })
        await wait(this.reducedMotion ? 0.1 : 1.0)
        await this.#veil(true)
        await Promise.all([dive, ready])

        // Swap worlds behind the veil
        this.barrio = barrio
        this.city.group.visible = false
        this.clouds.group.visible = false
        this.hood.group.visible = true
        await this.hood.setBarrio(barrio)
        this.#barrioLighting()
        this.stage.viewOffset.x = this.stage.viewOffset.y = 0
        this.stage.applyViewOffset()

        const start = this.hood.start
        this.currentNode = this.hood.startNode
        this.guide.place(start, Math.PI)
        this.guide.hide()
        this.rig.set(start.clone().add(new THREE.Vector3(0, 34, 38)), start.clone().add(new THREE.Vector3(0, 0, -16)))
        this.#setContext('home', barrio.name, session.role === 'collector' ? session.point.name : 'Cali, Valle del Cauca')

        this.#veil(false)
        await this.rig.flyTo(start.clone().add(this.#followOffset()), start.clone().add(this.#followLook()), { duration: 2.8, ease: 'power3.out' })

        await this.guide.appear()
        this.setState('barrio')
        this.rig.follow(this.guide.root, this.#followOffset(), this.#followLook())
        this.#showBack('Volver al mapa')
        this.#showHouseLabels()
        if (session.role === 'collector') this.say('Estas son las casas del barrio.', 'Elige una para revisar sus suministros.')
        else this.say('Hola. Estas casas necesitan apoyo.', 'Selecciona una casa para ver qué se necesita.')
        this.labels.get(`house:${barrio.houses[0].id}`)?.focus({ preventScroll: true })
        this.guide.point(1.4)
    }

    #veil(on) {
        const el = this.$('.veil')
        return new Promise((resolve) => {
            gsap.to(el, {
                autoAlpha: on ? 1 : 0,
                duration: this.reducedMotion ? 0.15 : on ? 0.9 : 1.4,
                ease: on ? 'sine.in' : 'sine.out',
                onComplete: resolve,
            })
        })
    }

    #showHouseLabels() {
        this.labels.clear()
        this.barrio.houses.forEach((h, i) => {
            const el = this.labels.add(`house:${h.id}`, {
                html: this.#houseLabelHtml(h),
                ariaLabel: this.#houseLabelAria(h),
                anchor: () => this.hood.labelAnchor(h.id, this._hAnchor ?? (this._hAnchor = new THREE.Vector3())),
                onClick: () => this.goToHouse(h.id),
            })
            el.style.setProperty('--delay', `${i * 80}ms`)
        })
    }

    #houseStatus(h) {
        if (session.urgentCount(h.id)) return ['Faltante urgente', 'is-high is-urgent']
        if (h.supported) return ['Apoyo en camino', 'is-ok']
        return h.priority === 'alta' ? ['Prioridad alta', 'is-high'] : ['Necesita apoyo', '']
    }

    #houseLabelHtml(h) {
        const c = CATEGORIES[h.category]
        const [text, cls] = this.#houseStatus(h)
        return `<span class="wlabel-icon" style="background:${c.color}">${icon(c.icon)}</span><span class="wlabel-text">${c.label}<span class="wlabel-status ${cls}">${text}</span></span>`
    }

    #houseLabelAria(h) {
        return `Casa ${h.number}, ${CATEGORIES[h.category].label}. ${this.#houseStatus(h)[0]}. Ir a esta casa`
    }

    /* ================================================================
       Neighborhood — click-and-go
       ================================================================ */

    async goToHouse(id) {
        if (!['barrio', 'walking'].includes(this.state)) return
        const house = this.hood.house(id)
        if (!house) return
        this.houseId = id
        this.setState('walking')
        this.hood.setSelected(id)
        for (const h of this.barrio.houses) this.labels.setClass(`house:${h.id}`, 'is-active', h.id === id)
        this.say('', `Vamos a la casa de ${CATEGORIES[house.data.category].label.toLowerCase()}.`)

        this.rig.follow(this.guide.root, this.#followOffset(), this.#followLook())
        const { points } = this.hood.route(this.currentNode, id)
        points[0] = this.guide.position.clone().setY(0)
        const arrived = await this.guide.walk(points)
        if (!arrived || this.houseId !== id) return

        this.currentNode = `door:${id}`
        this.guide.faceTowards(house.center)
        this.guide.nod()
        this.openHouse(id)
    }

    async openHouse(id) {
        const house = this.hood.house(id)
        this.setState('house')
        this.hood.setFocusMode(true)
        for (const h of this.barrio.houses) this.labels.setClass(`house:${h.id}`, 'is-hidden', h.id !== id)
        this.#showBack('Volver al barrio')
        const { pos, look } = this.hood.viewpointFor(id)
        this.rig.flyTo(pos, look, { duration: 2.0 })

        if (session.role === 'collector') this.say('', 'Marca lo que falta con urgencia.')
        else {
            const urgent = session.urgentCount(id)
            this.say(urgent ? 'Hay insumos marcados como urgentes.' : '', 'Elige qué y cuánto quieres aportar.')
        }
        await this.panel.openFor(house.data, this.barrio)
        this.#syncProgress()
        this.#frameForPanel(this.panel)
        this.panel.el.querySelector('.tile-toggle:not([disabled]), .alert-btn')?.focus({ preventScroll: true })
    }

    async closeHouse() {
        if (this.state !== 'house') return
        this.setState('barrio')
        this.hood.setSelected(null)
        this.hood.setFocusMode(false)
        this.labels.setAll('is-active', false)
        for (const h of this.barrio.houses) this.labels.setClass(`house:${h.id}`, 'is-hidden', false)
        this.#showBack('Volver al mapa')
        this.#frameForPanel(null)
        this.panel.close()
        this.rig.follow(this.guide.root, this.#followOffset(), this.#followLook(), { stiffness: 1.6 })
        const h = this.hood.house(this.houseId)
        this.houseId = null
        if (session.role === 'collector') this.say('', 'Puedes revisar otra casa.')
        else this.say(h?.data.supported ? 'Gracias. Tu aporte quedó registrado.' : '', 'Puedes elegir otra casa.')
    }

    #onDonorStep(step) {
        this.#syncProgress()
        const lines = {
            supplies: ['', 'Elige qué y cuánto quieres aportar.'],
            basket: ['Esta es tu cesta de apoyo.', 'Puedes ajustar las cantidades.'],
            method: ['', 'Elige cómo quieres aportar.'],
            details: ['', 'Necesitamos pocos datos para coordinar.'],
            summary: ['Revisa el resumen.', 'Si todo está bien, confirma.'],
            payment: ['', 'Revisa el valor antes de pagar.'],
            gateway: ['', 'Elige un medio de pago.'],
            done: ['Gracias por ayudar.', 'Puedes apoyar otra casa cuando quieras.'],
        }
        if (lines[step]) this.say(...lines[step])
        // the panel can grow or shrink between steps; keep the house framed
        requestAnimationFrame(() => this.#frameForPanel(this.panel))
    }

    registerSupport(house, basket, record) {
        for (const n of house.needs) if (basket.has(n.item)) n.qty = Math.max(0, n.qty - basket.get(n.item))
        house.supported = true
        session.donations.push(record)
        this.labels.update(`house:${house.id}`, this.#houseLabelHtml(house), this.#houseLabelAria(house))
        console.info(`[NEXOS] Aporte ${record.code} (${record.mode === 'physical' ? 'entrega física' : 'dinero, demostración'}) · casa ${house.number} · ${money(record.value)}`, Object.fromEntries([...basket].map(([k, v]) => [SUPPLIES[k].label, v])))
    }

    #onAlert(house, item, on) {
        this.labels.update(`house:${house.id}`, this.#houseLabelHtml(house), this.#houseLabelAria(house))
        this.say(on ? 'Alerta registrada.' : 'Alerta retirada.', on ? `Los donantes verán “${SUPPLIES[item].label}” como urgente.` : 'Puedes marcar otro insumo si lo necesitas.')
    }

    /* ================================================================
       Neighborhood → city, and leaving the session
       ================================================================ */

    async returnToMap() {
        if (!['barrio', 'walking', 'house'].includes(this.state)) return
        this.setState('leaving')
        this.guide.stop()
        this.panel.close()
        this.hood.setFocusMode(false)
        this.hood.setSelected(null)
        this.labels.clear()
        this.worldBubble.hide()
        this.#hideBack()
        this.#frameForPanel(null)

        await this.#veil(true)
        this.#showCity()
        const focus = this.city.focusPoint(this.zone?.id ?? 'centro')
        this.rig.set(focus.clone().addScaledVector(this.#cityDir(), 70), focus)
        this.zone = null
        this.houseId = null

        this.#veil(false)
        await this.rig.flyTo(this.#cityFrame().pos, CITY_VIEW.target, { duration: 2.6, ease: 'power3.out' })
        this.setState('city')
        this.#showZoneLabels()
        this.#showGuideDock(session.role === 'collector' ? 'Puedes revisar otra zona.' : 'Puedes apoyar en otra zona.', session.role === 'collector' ? 'Elige una zona.' : 'Selecciona una zona de la ciudad.')
        this.#enableOrbit()
    }

    #showCity() {
        this.rig.stopFollow()
        this.hood.group.visible = false
        this.guide.hide()
        this.city.group.visible = true
        this.clouds.group.visible = true
        this.city.setSelected(null)
        this.#cityLighting()
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
        if (this.panel.open) this.panel.close()
        this.zoneCard.open && this.zoneCard.hide()
        this.labels.clear()
        this.worldBubble.hide()
        this.#hideGuideDock()
        this.#hideBack()
        this.#frameForPanel(null)
        this.$('.login').hidden = true

        if (['barrio', 'walking', 'house', 'leaving', 'entering'].includes(from)) {
            await this.#veil(true)
            this.#showCity()
            this.rig.set(this.#cityFrame().pos, CITY_VIEW.target)
            this.#veil(false)
        }
        if (this.city) {
            gsap.to(this, { cloudPresence: 1, duration: 1.5 })
            const s = { p: 1 }
            await new Promise((resolve) =>
                gsap.to(s, {
                    p: 0,
                    duration: this.reducedMotion ? 0.3 : 2.6,
                    ease: 'sine.inOut',
                    onUpdate: () => {
                        const e = s.p * s.p * (3 - 2 * s.p)
                        this.rig.pos.copy(INTRO_CURVE.getPoint(e))
                        this.rig.target.lerpVectors(INTRO_TARGET_FROM, CITY_VIEW.target, e)
                        this.rig.apply()
                    },
                    onComplete: resolve,
                })
            )
        }
        this.intro = { p: 0, target: 0, auto: false }
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
            i = s === 'login' ? 0 : ['intro', 'city', 'zone'].includes(s) ? 1 : s === 'house' ? 3 : 2
        } else {
            if (['entering', 'barrio', 'walking', 'leaving'].includes(s)) i = 1
            if (s === 'house') {
                const step = this.donorPanel.step
                i = step === 'supplies' ? 2 : step === 'basket' ? 3 : step === 'done' ? 5 : 4
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
        exit.textContent = session.role === 'collector' ? 'Cerrar sesión' : 'Salir'
    }

    #placeWorldBubble(w, h) {
        const el = this.$('.bubble-world')
        if (el.hidden || !this.guide?.root.visible) return
        const panelOpen = this.panel.open
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
        const panelLeft = panelOpen ? this.panel.el.getBoundingClientRect().left - 16 : w - 24
        let left = x + 46
        let isLeft = false
        if (left + bw > panelLeft) {
            left = x - 46 - bw
            isLeft = true
        }
        left = Math.max(24, left)
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
        if (this.state === 'house') {
            // inside the donor flow, step back before leaving the house
            const order = { basket: 'supplies', method: 'basket', details: 'method', summary: 'details', payment: 'method', gateway: 'payment' }
            const prev = session.role === 'donor' && order[this.donorPanel.step]
            if (prev) return this.donorPanel.go(prev)
            return this.closeHouse()
        }
        if (this.state === 'barrio' || this.state === 'walking') return this.returnToMap()
        if (this.state === 'zone') return this.deselectZone()
        if (this.state === 'login') return this.#loginBack()
    }

    #setupRain() {
        if (!this.theme.mood.rain) return
        this.rain = {
            near: new Rain({ count: 2600, area: 70, height: 36, length: 0.9, opacity: 0.28 }),
            far: new Rain({ count: 3200, area: 520, height: 260, length: 7, opacity: 0.18 }),
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
                this.city.setHover(hit)
                for (const z of ZONES) this.labels.setClass(`zone:${z.id}`, 'is-hover', z.id === hit)
            } else if (['barrio', 'walking'].includes(this.state)) {
                hit = this.hood.pick(toRay(e))
                this.hood.setHover(hit)
                for (const h of this.barrio.houses) this.labels.setClass(`house:${h.id}`, 'is-hover', h.id === hit)
            }
            canvas.style.cursor = hit ? 'pointer' : ['city', 'zone'].includes(this.state) ? 'grab' : ''
        }

        canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }))
        canvas.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'mouse' && !e.buttons) hoverAt(e)
        })
        canvas.addEventListener('pointerleave', () => {
            this.city?.setHover(null)
            this.hood?.setHover(null)
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
                const id = this.hood.pick(toRay(e))
                if (id) this.goToHouse(id)
            }
        })

        // Descent: wheel / touch speed it up (it also runs on its own)
        window.addEventListener('wheel', (e) => this.state === 'intro' && this.advanceIntro(Math.max(-0.2, Math.min(0.2, e.deltaY * 0.001))), { passive: true })
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

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !e.target.closest?.('input, textarea')) this.back()
        })
        window.addEventListener('resize', () => {
            if (this.state === 'zone') this.#frameForPanel(this.zoneCard)
            if (this.state === 'house') this.#frameForPanel(this.panel)
        })

        // Alerts made by a collection point show up live in every view
        session.on((type, d) => {
            if (type !== 'alerts') return
            if (this.barrio && this.labels.get(`house:${d.houseId}`)) {
                const h = this.barrio.houses.find((x) => x.id === d.houseId)
                if (h) this.labels.update(`house:${h.id}`, this.#houseLabelHtml(h), this.#houseLabelAria(h))
            }
        })
    }
}
