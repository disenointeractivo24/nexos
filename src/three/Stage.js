import * as THREE from 'three'
import gsap from 'gsap'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { WORLD } from './materials.js'
import { shaderTime } from './stylize.js'

/**
 * Renderer, scene, camera, lights, sky and the frame loop.
 * One renderer; the city and the neighborhood are groups toggled in/out.
 */
export class Stage {
    constructor(canvas) {
        this.canvas = canvas
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        this.renderer.toneMapping = THREE.NeutralToneMapping
        this.renderer.toneMappingExposure = 1.04
        this.renderer.shadowMap.enabled = true
        // PCF with a blur radius gives soft, friendly shadow edges
        this.renderer.shadowMap.type = THREE.PCFShadowMap

        this.scene = new THREE.Scene()
        this.scene.fog = new THREE.Fog(WORLD.fog, 300, 1400)

        this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 3000)
        this.scene.add(this.camera)

        // Soft reflections for glossy materials (very low intensity)
        const pmrem = new THREE.PMREMGenerator(this.renderer)
        this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
        this.scene.environment = this.envMap
        this.scene.environmentIntensity = 0.32
        pmrem.dispose()

        this.#lights()
        this.#sky()

        this.viewOffset = { x: 0, y: 0 }
        this.size = { w: 1, h: 1 }
        this.tickers = new Set()
        this.clock = new THREE.Clock()

        this.resize = this.resize.bind(this)
        window.addEventListener('resize', this.resize)
        new ResizeObserver(this.resize).observe(document.documentElement)
        this.resize()

        // GSAP runs on the same clock as the renderer, so camera tweens and 3D stay in sync.
        gsap.ticker.remove(gsap.updateRoot)
        this.gsapOffset = gsap.ticker.time
        // `?timer` (dev only) drives frames with a timer for environments that pause rAF.
        if (new URLSearchParams(location.search).has('timer')) setInterval(() => this.#frame(), 1000 / 60)
        else this.renderer.setAnimationLoop(() => this.#frame())
    }

    #lights() {
        // Cool sky fill from above, warm bounce from the ground → shadows read soft and blue-ish
        this.hemi = new THREE.HemisphereLight('#E6EFF7', '#D9BC94', 1.25)
        this.scene.add(this.hemi)

        // Warm late-morning sun
        this.sun = new THREE.DirectionalLight('#FFE2BC', 3.0)
        this.sun.castShadow = true
        this.sun.shadow.mapSize.set(2048, 2048)
        this.sun.shadow.bias = -0.0005
        this.sun.shadow.normalBias = 0.6
        this.sun.shadow.radius = 4
        this.scene.add(this.sun, this.sun.target)
        this.sunDir = new THREE.Vector3(-0.5, 0.74, 0.45).normalize()

        // Gentle bounce from the opposite side so nothing goes flat or black
        this.fill = new THREE.DirectionalLight('#FFEFDC', 0.45)
        this.fill.position.set(0.6, 0.35, -0.7)
        this.scene.add(this.fill)
    }

    /** Ease light, sky and fog toward an emergency theme's mood. */
    applyMood(mood, duration = 0) {
        const targets = [
            [this.skyUniforms.top.value, mood.skyTop],
            [this.skyUniforms.horizon.value, mood.skyHorizon],
            [this.scene.fog.color, mood.fog],
            [this.sun.color, mood.sun],
            [this.hemi.color, mood.hemiSky],
            [this.hemi.groundColor, mood.hemiGround],
        ]
        for (const [color, hex] of targets) {
            const to = new THREE.Color(hex)
            if (!duration) color.copy(to)
            else gsap.to(color, { r: to.r, g: to.g, b: to.b, duration, ease: 'sine.inOut' })
        }
        const n = { sun: mood.sunIntensity, hemi: mood.hemiIntensity, haze: mood.haze ?? 0 }
        if (!duration) {
            this.sun.intensity = n.sun
            this.hemi.intensity = n.hemi
            this.skyUniforms.haze.value = n.haze
        } else {
            gsap.to(this.sun, { intensity: n.sun, duration, ease: 'sine.inOut' })
            gsap.to(this.hemi, { intensity: n.hemi, duration, ease: 'sine.inOut' })
            gsap.to(this.skyUniforms.haze, { value: n.haze, duration, ease: 'sine.inOut' })
        }
    }

    /** Fit the sun's shadow camera around an area (city or neighborhood). */
    setShadowFrame(center, radius, { mapSize = 2048, normalBias } = {}) {
        const s = this.sun
        s.target.position.copy(center)
        s.position.copy(center).addScaledVector(this.sunDir, radius * 3)
        const cam = s.shadow.camera
        cam.left = -radius
        cam.right = radius
        cam.top = radius
        cam.bottom = -radius
        cam.near = 0.5
        cam.far = radius * 7
        cam.updateProjectionMatrix()
        if (normalBias !== undefined) s.shadow.normalBias = normalBias
        if (s.shadow.mapSize.x !== mapSize) {
            s.shadow.mapSize.set(mapSize, mapSize)
            s.shadow.map?.dispose()
            s.shadow.map = null
        }
    }

    setFog(near, far) {
        this.scene.fog.near = near
        this.scene.fog.far = far
    }

    #sky() {
        const geo = new THREE.SphereGeometry(1, 32, 16)
        const mat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: (this.skyUniforms = {
                top: { value: new THREE.Color(WORLD.skyTop) },
                horizon: { value: new THREE.Color(WORLD.skyHorizon) },
                sunDir: { value: this.sunDir.clone() },
                sunColor: { value: new THREE.Color('#FFE4BE') },
                haze: { value: 0 },
            }),
            vertexShader: /* glsl */ `
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_Position = p.xyww;
                }`,
            fragmentShader: /* glsl */ `
                uniform vec3 top;
                uniform vec3 horizon;
                uniform vec3 sunDir;
                uniform vec3 sunColor;
                uniform float haze;
                varying vec3 vDir;
                void main() {
                    vec3 d = normalize(vDir);
                    float h = clamp(d.y, 0.0, 1.0);
                    vec3 c = mix(horizon, top, smoothstep(0.0, 0.6, pow(h, 0.85)));
                    // warm glow toward the sun, soft and wide (no visible disc)
                    float s = max(dot(d, sunDir), 0.0);
                    c += sunColor * (pow(s, 6.0) * 0.22 + pow(s, 48.0) * 0.18);
                    // a little haze sitting on the horizon
                    c = mix(c, horizon, haze * (1.0 - smoothstep(0.0, 0.35, h)));
                    gl_FragColor = vec4(c, 1.0);
                    #include <colorspace_fragment>
                }`,
        })
        this.skyDome = new THREE.Mesh(geo, mat)
        this.skyDome.scale.setScalar(2000)
        this.skyDome.frustumCulled = false
        this.skyDome.renderOrder = -10
        this.scene.add(this.skyDome)
    }

    onTick(fn) {
        this.tickers.add(fn)
        return () => this.tickers.delete(fn)
    }

    resize() {
        const w = Math.max(1, window.innerWidth)
        const h = Math.max(1, window.innerHeight)
        if (w === this.size.w && h === this.size.h) return
        this.size = { w, h }
        this.renderer.setSize(w, h, false)
        this.camera.aspect = w / h
        // Portrait screens get a wider lens instead of a tiny, far-away scene
        const a = w / h
        this.camera.fov = a < 1 ? 38 + (1 - a) * 34 : 38
        this.applyViewOffset()
        this.onResize?.(w, h)
    }

    /** Shift the framing (e.g. leave room for a side panel) without moving the camera. */
    applyViewOffset() {
        const { w, h } = this.size
        const { x, y } = this.viewOffset
        if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) this.camera.clearViewOffset()
        else this.camera.setViewOffset(w, h, x, y, w, h)
        this.camera.updateProjectionMatrix()
    }

    #frame() {
        const dt = Math.min(this.clock.getDelta(), 1 / 20)
        const t = this.clock.elapsedTime
        gsap.updateRoot(t + this.gsapOffset)
        shaderTime.value = t
        // keep sizes right even if the window was hidden at startup
        if (this.canvas.clientWidth && (this.canvas.clientWidth !== this.size.w || this.canvas.clientHeight !== this.size.h)) this.resize()
        for (const fn of this.tickers) fn(dt, t)
        this.skyDome.position.copy(this.camera.position)
        this.renderer.render(this.scene, this.camera)
        this.afterRender?.(dt, t)
    }
}
