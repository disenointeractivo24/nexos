import { liteWanted } from './lite/detect.js'

// NEXOS — red de ayuda en tiempo real.
// The light version (lists, no 3D) never downloads the 3D engine: each version is its own chunk.
if (liteWanted()) {
    document.documentElement.classList.add('is-lite')
    import('./lite/LiteApp.js').then(({ LiteApp }) => (window.nexos = new LiteApp()))
} else {
    import('./app/App.js').then(({ App }) => (window.nexos = new App()))
}
