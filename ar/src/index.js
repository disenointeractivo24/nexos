import { SessionMode, World } from '@iwsdk/core'
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

// capability detection: the headset button only works where a browser really offers AR
const supported = (await navigator.xr?.isSessionSupported?.('immersive-ar').catch(() => false)) ?? false
enterAr.disabled = !supported
note.textContent = supported
    ? 'Ponte el visor y busca una mesa libre a tu alrededor.'
    : 'Este navegador no tiene realidad aumentada. Ábrelo en las Meta Quest o pruébalo aquí, con el mouse.'

enterAr.addEventListener('click', () => {
    start.hidden = true
    world.launchXR()
})
enterDesktop.addEventListener('click', () => {
    start.hidden = true
    hud.hidden = false
    shift.startOnDesktop()
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
