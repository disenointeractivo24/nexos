/**
 * Which NEXOS to open: the full 3D map, or the light version (lists, no 3D) for phones
 * that would struggle with it or for people saving data.
 *
 * The person's own choice wins (the switch in either version, kept in this browser), then
 * `?ligero` / `?ligero=0` in the address; otherwise the light version opens by itself when the
 * browser says data saving is on, the connection is very slow, the phone has little memory,
 * it cannot draw 3D at all, or it draws it without the graphics card (hardware acceleration
 * turned off in the browser), where the 3D map would crawl.
 */
const KEY = 'nexos.lite'

export function liteWanted() {
    const q = new URLSearchParams(location.search)
    if (q.has('ligero')) return q.get('ligero') !== '0'
    try {
        const saved = localStorage.getItem(KEY)
        if (saved !== null) return saved === '1'
    } catch {
        /* storage unavailable: decide from the device */
    }
    return liteSuggested()
}

/**
 * Why the device itself asks for the light version, if it does: the end of "Abrimos la versión
 * ligera porque …".
 */
export function liteSuggested() {
    const c = navigator.connection
    if (c?.saveData) return 'tienes activado el ahorro de datos'
    if (['slow-2g', '2g'].includes(c?.effectiveType)) return 'tu conexión está muy lenta'
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return 'tu dispositivo tiene poca memoria'
    const gl = graphics()
    if (gl === 'none') return 'tu navegador no puede mostrar el mapa en 3D'
    if (gl === 'software') return 'tu navegador tiene la aceleración gráfica apagada'
    return ''
}

/** True when 3D is drawn without the graphics card: the 3D map then draws less (see Stage). */
export function softwareGraphics() {
    return graphics() === 'software'
}

/** Switch versions: remembered here, and the page opens again in the chosen one. */
export function setLite(on) {
    try {
        localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
        /* storage unavailable: the address carries it instead */
    }
    const url = new URL(location.href)
    url.searchParams.set('ligero', on ? '1' : '0')
    location.assign(url)
}

let gpu = null

/**
 * How this browser draws 3D: 'gpu', 'software' (no graphics card: hardware acceleration off,
 * or a card the browser will not use) or 'none'. A browser refuses a context that asks to fail
 * on a major performance caveat when it would draw in software; the renderer's name tells the
 * rest (SwiftShader, llvmpipe, Microsoft Basic Render Driver…). Asked once.
 */
function graphics() {
    if (gpu) return gpu
    try {
        const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')
        if (!gl) return (gpu = 'none')
        const fast = document.createElement('canvas').getContext('webgl', { failIfMajorPerformanceCaveat: true })
        const info = gl.getExtension('WEBGL_debug_renderer_info')
        const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')
        // the test contexts are let go at once: a page only gets a few
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        fast?.getExtension('WEBGL_lose_context')?.loseContext()
        gpu = !fast || /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) ? 'software' : 'gpu'
    } catch {
        gpu = 'none'
    }
    return gpu
}
