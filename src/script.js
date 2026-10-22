import { liteWanted } from './lite/detect.js'
import { boot } from './boot.js'

// NEXOS — red de ayuda en tiempo real.
// The light version (lists, no 3D) never downloads the 3D engine: each version is its own chunk.
// The loading screen stays until the version that opens is ready (the 3D one closes it itself,
// once its world is in).
const failed = (err) => {
    console.error(err)
    boot.fail('No pudimos cargar NEXOS. Revisa tu conexión y recarga la página.')
}
if (liteWanted()) {
    document.documentElement.classList.add('is-lite')
    import('./lite/LiteApp.js').then(({ LiteApp }) => {
        window.nexos = new LiteApp()
        boot.done()
    }, failed)
} else {
    boot.set(0.08, 'Preparando el mapa…')
    import('./app/App.js').then(({ App }) => (window.nexos = new App()), failed)
}

// the design panel: debug only (the dev server, or ?debug in the address), in either version
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) import('./ui/DesignDebug.js').then((m) => m.start())
