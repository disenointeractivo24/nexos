import { DepthOccludable, DepthSensingSystem, SessionMode, VisibilityState, World } from '@iwsdk/core'
import { ShiftSystem } from './shift.js'

const start = document.getElementById('start')
const enterAr = document.getElementById('enter-ar')
const enterDesktop = document.getElementById('enter-desktop')
const note = document.getElementById('note')
const hud = document.getElementById('hud')

/**
 * Everything the headset can tell about the room, asked for and none of it required: the
 * shift adapts to what the device grants (no planes: a hit on the surface; no hit test: a
 * table of its own at the person's height).
 */
const world = await World.create(document.getElementById('scene-container'), {
    xr: {
        sessionMode: SessionMode.ImmersiveAR,
        offer: 'none',
        features: {
            handTracking: true,
            anchors: true,
            hitTest: true,
            planeDetection: true,
            meshDetection: true,
            // real hands in front of what is virtual: occlusion from the headset's depth
            depthSensing: { usage: 'gpu-optimized', format: 'float32' },
        },
    },
    input: { canvasPointerEvents: true },
    render: { fov: 60, near: 0.01, far: 60 },
    features: {
        locomotion: false,
        // only hands: a pinch near something takes it, a pinch along the ray too
        grabbing: { useHandPinchForGrab: true },
        sceneUnderstanding: { showWireFrame: false },
        environmentRaycast: true,
        physics: { useWorker: true, updateFrequency: 72, interpolation: true },
        camera: true,
        spatialUI: { kit: 'horizon', preferredColorScheme: 'light' },
    },
})
// occlusion is not part of World.create: it is a system of its own, with its component
world.registerComponent(DepthOccludable).registerSystem(DepthSensingSystem, { configData: { enableOcclusion: true, enableDepthTexture: true } })
world.registerSystem(ShiftSystem)
const shift = world.getSystem(ShiftSystem)
window.nexosAR = { world, shift }

// capability detection, in words that say what to do about it. Asked again now that all is
// loaded: the page's first question (see index.html) only serves to report early.
const ask = (mode) => navigator.xr?.isSessionSupported?.(mode).catch(() => false) ?? false
const [ar, vr] = await Promise.all([ask('immersive-ar'), ask('immersive-vr')])
const modes = { xr: !!navigator.xr, ar, vr }
const isQuest = /OculusBrowser|Quest/i.test(navigator.userAgent)
enterDesktop.disabled = false
enterAr.disabled = !modes.ar && !modes.vr
if (modes.ar) note.textContent = 'Ponte el visor de pie, frente a una mesa. Usarás solo tus manos.'
else if (modes.vr) {
    enterAr.textContent = 'Entrar con el visor (sin ver tu espacio)'
    note.textContent = 'Este navegador no muestra tu espacio real: verás una mesa virtual.'
} else if (isQuest) {
    note.textContent = `Este navegador de las gafas no ofrece el modo inmersivo: actualízalo en Ajustes › Sistema › Actualización de software. ${modes.xr ? 'WebXR sí, modos no.' : 'WebXR no está disponible.'}`
} else {
    note.textContent = 'Aquí no hay gafas. Abre este enlace en las Meta Quest, o pruébalo aquí con el mouse.'
}

// the SDK only logs why a session did not open; the person in the headset needs to read it
const logError = console.error.bind(console)
console.error = (...args) => {
    logError(...args)
    if (String(args[0]).startsWith('[XR] Failed')) {
        start.hidden = false
        note.textContent = `No se pudo abrir el modo inmersivo: ${args[1]?.message ?? args[1]}`
    }
}

// out of the headset there is nothing else on the page: a way back has to be there
let wasInside = false
world.visibilityState.subscribe((state) => {
    if (state !== VisibilityState.NonImmersive) {
        wasInside = true
        return
    }
    if (!wasInside) return
    wasInside = false
    start.hidden = false
    enterDesktop.hidden = true
    enterAr.textContent = shift.placed ? 'Volver al turno' : 'Entrar con el visor'
    note.textContent = shift.placed ? 'Tu turno quedó en pausa, tal como lo dejaste.' : 'Saliste antes de elegir tu mesa.'
})

enterAr.addEventListener('click', () => {
    start.hidden = true
    world.launchXR({ sessionMode: modes.ar ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR })
})
enterDesktop.addEventListener('click', () => {
    start.hidden = true
    hud.hidden = false
    shift.startOnDesktop()
    // the instructions make room for the table once they have been read, or once the person is at it
    const howTo = hud.querySelector('p')
    const hide = () => howTo && (howTo.hidden = true)
    setTimeout(hide, 16000)
    document.getElementById('scene-container').addEventListener('pointerdown', () => setTimeout(hide, 6000), { once: true })
})
document.getElementById('show-list').addEventListener('click', () => shift.toggleList())
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && !hud.hidden) shift.toggleList()
})
for (const button of hud.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => {
        shift.showView(button.dataset.view)
        for (const b of hud.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b === button))
    })
}
