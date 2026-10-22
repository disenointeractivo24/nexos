import { setLite } from './lite/detect.js'

/**
 * The loading screen: the guide, the logo and a bar, drawn by index.html itself so it shows
 * before any script arrives. The app reports how far its loading has gone (set) and closes it
 * when everything is in (done).
 *
 * The bar never stands still: between two reports it keeps creeping a little towards the next,
 * and it eases to each new report rather than jumping. If loading takes long, it offers the
 * light version.
 */
const el = document.querySelector('.boot')
const bar = el?.querySelector('.boot-bar')
const fill = el?.querySelector('.boot-fill')
const text = el?.querySelector('.boot-text')
const slow = el?.querySelector('.boot-slow')

let target = 0.06
let shown = 0
let creep = 0
let raf = 0
let closed = false

function frame() {
    // a little further each frame towards the next report, never past it
    creep = Math.min(0.08, creep + 0.0004)
    const goal = Math.min(0.99, target + creep)
    shown += (goal - shown) * 0.08
    fill?.style.setProperty('--p', shown.toFixed(4))
    bar?.setAttribute('aria-valuenow', String(Math.round(shown * 100)))
    if (!closed) raf = requestAnimationFrame(frame)
}
if (el) raf = requestAnimationFrame(frame)

// on a slow connection or computer, the way out to the light version
const slowTimer = setTimeout(() => {
    if (slow && !closed) slow.hidden = false
}, 12000)
slow?.querySelector('button')?.addEventListener('click', () => setLite(true))

export const boot = {
    /** How far loading has gone (0 to 1), and what is being done now. */
    set(p, label) {
        if (closed || !el) return
        if (p > target) {
            target = p
            creep = 0
        }
        if (label && text && text.textContent !== label) text.textContent = label
    },

    /** Fill the bar and fade the screen out; resolves once it is gone. */
    done() {
        if (closed || !el) return Promise.resolve()
        closed = true
        clearTimeout(slowTimer)
        cancelAnimationFrame(raf)
        fill?.style.setProperty('--p', '1')
        el.classList.add('is-done')
        return new Promise((resolve) => {
            let gone = false
            const finish = () => {
                if (gone) return
                gone = true
                el.remove()
                resolve()
            }
            // the bar completes, then the screen fades (see .boot.is-done)
            el.addEventListener('transitionend', (e) => e.target === el && finish())
            setTimeout(finish, 1200)
        })
    },

    /** Loading failed: say so on the loading screen, with the way to try again. */
    fail(message) {
        if (!el) return
        closed = true
        clearTimeout(slowTimer)
        cancelAnimationFrame(raf)
        el.classList.add('is-failed')
        if (text) text.textContent = message
        if (slow) {
            slow.hidden = false
            const again = document.createElement('button')
            again.type = 'button'
            again.className = 'boot-link'
            again.textContent = 'Recargar'
            again.addEventListener('click', () => location.reload())
            slow.prepend(again)
        }
    },
}
