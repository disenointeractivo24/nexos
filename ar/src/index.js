import { SessionMode, VisibilityState, World } from '@iwsdk/core'
import { ShiftSystem } from './shift.js'

const start = document.getElementById('start')
const enterAr = document.getElementById('enter-ar')
const enterDesktop = document.getElementById('enter-desktop')
const note = document.getElementById('note')
const hud = document.getElementById('hud')

const world = await World.create(document.getElementById('scene-container'), {
    xr: {
        sessionMode: SessionMode.ImmersiveAR,
        offer: 'none',
        // none of these is required: the shift adapts to what the device grants
        features: { handTracking: true, anchors: true, hitTest: true, planeDetection: true, meshDetection: true },
    },
    input: { canvasPointerEvents: true },
    render: { fov: 60, near: 0.01, far: 60 },
    features: { locomotion: false, grabbing: true, sceneUnderstanding: true, physics: false, spatialUI: false },
})
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
if (modes.ar) note.textContent = 'Ponte el visor y busca unos 3 metros libres a tu alrededor.'
else if (modes.vr) {
    enterAr.textContent = 'Entrar con el visor (sin ver tu espacio)'
    note.textContent = 'Este navegador no ofrece ver tu espacio real, así que la carpa se verá sobre un fondo virtual. Busca unos 3 metros libres.'
} else if (isQuest) {
    note.textContent = `Este navegador de las gafas no ofrece el modo inmersivo: actualízalo en Ajustes › Sistema › Actualización de software. ${modes.xr ? 'WebXR sí, modos no.' : 'WebXR no está disponible.'} ${navigator.userAgent}`
} else {
    note.textContent = 'Aquí no hay gafas: esto es un computador o un celular. Abre este enlace en el navegador de las Meta Quest, o pruébalo aquí con el mouse.'
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
    note.textContent = shift.placed ? 'Saliste de las gafas. Tu turno quedó en pausa, tal como lo dejaste.' : 'Saliste de las gafas antes de levantar la carpa.'
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
