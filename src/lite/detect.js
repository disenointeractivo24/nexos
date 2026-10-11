/**
 * Which NEXOS to open: the full 3D map, or the light version (lists, no 3D) for phones
 * that would struggle with it or for people saving data.
 *
 * The person's own choice wins (the switch in either version, kept in this browser), then
 * `?ligero` / `?ligero=0` in the address; otherwise the light version opens by itself when the
 * browser says data saving is on, the connection is very slow, the phone has little memory
 * or it cannot draw 3D at all.
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

/** Why the device itself asks for the light version, if it does. */
export function liteSuggested() {
    const c = navigator.connection
    if (c?.saveData) return 'ahorro de datos'
    if (['slow-2g', '2g'].includes(c?.effectiveType)) return 'conexión lenta'
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return 'poca memoria'
    if (!canDraw3D()) return 'sin 3D'
    return ''
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

function canDraw3D() {
    try {
        const c = document.createElement('canvas')
        return !!(c.getContext('webgl2') || c.getContext('webgl'))
    } catch {
        return false
    }
}
