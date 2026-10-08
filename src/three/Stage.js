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
        this.#post()

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
        // #frame advances GSAP too, so the interface animations ride the same clock.
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
        const n = { sun: mood.sunIntensity, hemi: mood.hemiIntensity, haze: mood.haze ?? 0, glow: mood.sunGlow ?? 1, stars: mood.stars ?? 0 }
        const glow = this.sunGlowBase.clone().multiplyScalar(n.glow)
        // the soft reflections and the exposure go down with the light too, or night only turns grey
        const env = mood.envIntensity ?? 0.32
        const exposure = mood.exposure ?? 1.04
        const fog = mood.fogAmount ?? 0
        if (!duration) {
            this.scene.environmentIntensity = env
            this.renderer.toneMappingExposure = exposure
            this.fogAmount = fog
        } else {
            gsap.to(this.scene, { environmentIntensity: env, duration, ease: 'sine.inOut' })
            gsap.to(this.renderer, { toneMappingExposure: exposure, duration, ease: 'sine.inOut' })
            gsap.to(this, { fogAmount: fog, duration, ease: 'sine.inOut' })
        }
        if (!duration) {
            this.sun.intensity = n.sun
            this.hemi.intensity = n.hemi
            this.skyUniforms.haze.value = n.haze
            this.skyUniforms.sunColor.value.copy(glow)
            this.stars.material.opacity = n.stars
        } else {
            gsap.to(this.sun, { intensity: n.sun, duration, ease: 'sine.inOut' })
            gsap.to(this.hemi, { intensity: n.hemi, duration, ease: 'sine.inOut' })
            gsap.to(this.skyUniforms.haze, { value: n.haze, duration, ease: 'sine.inOut' })
            gsap.to(this.skyUniforms.sunColor.value, { r: glow.r, g: glow.g, b: glow.b, duration, ease: 'sine.inOut' })
            gsap.to(this.stars.material, { opacity: n.stars, duration, ease: 'sine.inOut' })
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

    /** The fog of the current place (city or barrio); the weather brings it closer (see #frame). */
    setFog(near, far) {
        this.fogBase = { near, far }
        this.scene.fog.near = near
        this.scene.fog.far = far
    }

    /** A lightning flash: two quick bursts of cold light over the whole picture. */
    flash(strength = 1) {
        const u = this.postUniforms.uFlash
        gsap.killTweensOf(u)
        gsap.timeline()
            .to(u, { value: 0.85 * strength, duration: 0.05, ease: 'power2.out' })
            .to(u, { value: 0.12 * strength, duration: 0.12, ease: 'power1.in' })
            .to(u, { value: 0.6 * strength, duration: 0.05, ease: 'power2.out' })
            .to(u, { value: 0, duration: 0.6, ease: 'power2.in' })
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
        this.sunGlowBase = this.skyUniforms.sunColor.value.clone()

        // stars for a clear night: points on the upper half of a big sphere that travels with the camera
        const count = 900
        const pos = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
            const u = Math.random() * Math.PI * 2
            const v = 0.06 + Math.random() * 0.94 // above the horizon
            const r = Math.sqrt(1 - v * v)
            pos.set([Math.cos(u) * r * 1500, v * 1500, Math.sin(u) * r * 1500], i * 3)
        }
        const starGeo = new THREE.BufferGeometry()
        starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        this.stars = new THREE.Points(
            starGeo,
            new THREE.PointsMaterial({ color: '#F4F1FF', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false })
        )
        this.stars.frustumCulled = false
        this.stars.renderOrder = -9
        this.scene.add(this.stars)
    }

    /**
     * The stylized finish, as one screen pass over the rendered scene:
     *  - ink outlines from the depth buffer, drawn on the near side of every
     *    silhouette in a warm dark tone (never black), fading out with distance
     *    so faraway detail does not turn into noise
     *  - a gentle grade: a touch more colour, cool shadows and warm lights
     *  - a focus shade: when only one area is in play, the rest of the city is
     *    dimmed in its own colours (roofs, walls, streets), as if it stood in
     *    shade, so the eye (and the hand) stays where the work is
     * The scene renders into a multisampled target first, so edges stay smooth.
     */
    #post() {
        this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType })
        this.rt.depthTexture = new THREE.DepthTexture(1, 1)
        this.postUniforms = {
            tColor: { value: this.rt.texture },
            tDepth: { value: this.rt.depthTexture },
            tMask: { value: null },
            uMaskBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
            uFocus: { value: 0 },
            uShade: { value: new THREE.Color(0.5, 0.53, 0.62) },
            uProjInv: { value: new THREE.Matrix4() },
            uCamWorld: { value: new THREE.Matrix4() },
            uTexel: { value: new THREE.Vector2() },
            uNear: { value: this.camera.near },
            uFar: { value: this.camera.far },
            uLine: { value: 0 },
            uLineFar: { value: 140 },
            uInk: { value: new THREE.Color('#3B3346') },
            uSat: { value: 1.08 },
            uFlash: { value: 0 },
        }
        const mat = new THREE.ShaderMaterial({
            uniforms: this.postUniforms,
            depthTest: false,
            depthWrite: false,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: /* glsl */ `
                uniform sampler2D tColor;
                uniform sampler2D tDepth;
                uniform sampler2D tMask;
                uniform vec4 uMaskBounds;
                uniform float uFocus;
                uniform vec3 uShade;
                uniform mat4 uProjInv, uCamWorld;
                uniform vec2 uTexel;
                uniform float uNear, uFar, uLine, uLineFar, uSat, uFlash;
                uniform vec3 uInk;
                varying vec2 vUv;
                float lin(float d) {
                    float z = d * 2.0 - 1.0;
                    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
                }
                void main() {
                    vec3 col = texture2D(tColor, vUv).rgb;
                    float d = texture2D(tDepth, vUv).x;

                    // focus: where this pixel sits on the ground decides if it stays sharp
                    float shade = 0.0;
                    if (uFocus > 0.001) {
                        vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
                        vec3 w = (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
                        shade = uFocus * texture2D(tMask, (w.xz - uMaskBounds.xy) / uMaskBounds.zw).r;
                    }

                    // ink: how much farther the surroundings are than this pixel
                    float z = lin(d);
                    float jump = 0.0;
                    jump = max(jump, lin(texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).x) - z);
                    jump = max(jump, lin(texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).x) - z);
                    jump = max(jump, lin(texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).x) - z);
                    jump = max(jump, lin(texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).x) - z);
                    float edge = smoothstep(0.025, 0.07, jump / z);
                    edge *= uLine * (1.0 - smoothstep(uLineFar * 0.45, uLineFar, z));

                    // grade: a touch more colour, cool in the shade, warm in the light
                    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
                    col = mix(vec3(l), col, uSat);
                    col *= mix(vec3(0.94, 0.97, 1.05), vec3(1.03, 1.0, 0.96), smoothstep(0.04, 0.5, l));
                    col = mix(col, col * uInk * 1.6, edge);
                    // out of play: a little less colour, then a cool shade over its own materials
                    col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), shade * 0.3);
                    col *= mix(vec3(1.0), uShade, shade);
                    // lightning: a burst of cold light over everything
                    col = mix(col, col * 1.7 + vec3(0.22, 0.24, 0.3), uFlash);

                    gl_FragColor = vec4(col, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        })
        this.postScene = new THREE.Scene()
        this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
        quad.frustumCulled = false
        this.postScene.add(quad)
    }

    /**
     * Dim part of the ground. `mask` is a top-down texture of how much to dim
     * (1 = fully, 0 = untouched, with soft edges) covering `bounds` = (minX,
     * minZ, sizeX, sizeZ); anything outside it is left as is. `amount` (0..1)
     * eases the effect in and out.
     */
    setFocus(amount, mask = null, bounds = null) {
        const u = this.postUniforms
        u.uFocus.value = mask ? amount : 0
        if (mask) u.tMask.value = mask
        if (bounds) u.uMaskBounds.value.copy(bounds)
    }

    /**
     * How strong the ink lines are, and how far away they fade out. The barrio is
     * seen from tens of metres, the city from hundreds, so each sets its own.
     */
    setInk(strength, fadeDistance = this.postUniforms.uLineFar.value, duration = 0) {
        const u = this.postUniforms
        if (fadeDistance !== undefined) u.uLineFar.value = fadeDistance
        gsap.killTweensOf(u.uLine)
        if (!duration) u.uLine.value = strength
        else gsap.to(u.uLine, { value: strength, duration, ease: 'sine.inOut' })
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
        const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2())
        this.rt.setSize(buf.x, buf.y)
        // lines about one and a half CSS pixels wide whatever the screen density
        const px = 1.5 * Math.max(1, this.renderer.getPixelRatio())
        this.postUniforms.uTexel.value.set(px / buf.x, px / buf.y)
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
        this.stars.position.copy(this.camera.position)
        // mist and heavy rain bring the fog in from the place's own distances
        if (this.fogBase) {
            const a = this.fogAmount ?? 0
            this.scene.fog.near = this.fogBase.near * (1 - 0.85 * a)
            this.scene.fog.far = this.fogBase.far * (1 - 0.62 * a)
        }
        this.stars.visible = this.stars.material.opacity > 0.01
        this.renderer.setRenderTarget(this.rt)
        this.renderer.render(this.scene, this.camera)
        if (this.postUniforms.uFocus.value > 0.001) {
            this.postUniforms.uProjInv.value.copy(this.camera.projectionMatrixInverse)
            this.postUniforms.uCamWorld.value.copy(this.camera.matrixWorld)
        }
        this.renderer.setRenderTarget(null)
        this.renderer.render(this.postScene, this.postCamera)
        this.afterRender?.(dt, t)
    }
}
