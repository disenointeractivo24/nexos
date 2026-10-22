import { setLite } from './lite/detect.js'

/**
 * The loading screen and the opening act. index.html draws it, so it shows before any script.
 *
 * The 3D version plays the act (play): a film of the guide, made with tools/apertura — a
 * close-up of the face, a glance that turns to camera, the camera pulling out on an arc, a
 * wave as the logo comes in. A film rather than live 3D: it plays smoothly on any computer,
 * with or without a graphics card, while the page loads behind it. If loading takes longer than
 * the act, the guide stays, breathing, in a second film that starts on the act's last frame
 * and loops. The app reports how far loading has gone (set) and asks to close (done): the
 * act is always seen to its end (it can be skipped once everything is in), then the screen
 * opens onto the app. With reduced motion, or if the film cannot play, the guide's picture
 * stands in.
 *
 * The bar never stands still: between two reports it creeps a little towards the next, and
 * eases to each new report rather than jumping. If loading takes long, it offers the light
 * version.
 */
const el = document.querySelector('.boot')
const $ = (s) => el?.querySelector(s)
const act = $('.boot-act')
const loop = $('.boot-loop')
const bar = $('.boot-bar')
const fill = $('.boot-fill')
const text = $('.boot-text')
const slow = $('.boot-slow')
const skip = $('.boot-skip')
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

// when, in the act, the guide waves and the logo comes in (seconds)
const LOGO_AT = 3.1

let target = 0.06
let shown = 0
let creep = 0
let raf = 0
let closed = false
let actOver = true
let ready = false
let closing = null
let opening = null

function frame() {
    // a little further each frame towards the next report, never past it
    creep = Math.min(0.08, creep + 0.0004)
    const goal = ready ? 1 : Math.min(0.99, target + creep)
    shown += (goal - shown) * 0.08
    fill?.style.setProperty('--p', shown.toFixed(4))
    bar?.setAttribute('aria-valuenow', String(Math.round(shown * 100)))
    if (act && !el.classList.contains('show-logo') && act.currentTime >= LOGO_AT) el.classList.add('show-logo')
    if (!closed) raf = requestAnimationFrame(frame)
}
if (el) raf = requestAnimationFrame(frame)

// on a slow connection or computer, the way out to the light version
const slowTimer = setTimeout(() => {
    if (slow && !closed && !ready) slow.hidden = false
}, 14000)
slow?.querySelector('.boot-link')?.addEventListener('click', () => setLite(true))

/** No film: the guide's picture, and the logo at once. */
function still() {
    actOver = true
    el?.classList.add('is-still', 'show-logo')
    act?.pause()
    loop?.pause()
    if (ready) finish()
}

/** The act is over: the guide stays, breathing, until everything is in. */
function onActEnd() {
    actOver = true
    if (ready) return finish()
    if (!loop) return
    loop.currentTime = 0
    loop.play().then(
        // both films show the same frame here: the swap does not show
        () => el.classList.add('is-looping'),
        () => {}
    )
}

function finish() {
    if (closed || !el) return
    closed = true
    clearTimeout(slowTimer)
    cancelAnimationFrame(raf)
    fill?.style.setProperty('--p', '1')
    opening?.()
    el.classList.add('is-done')
    let gone = false
    const end = () => {
        if (gone) return
        gone = true
        act?.pause()
        loop?.pause()
        el.remove()
        closing?.resolve()
    }
    el.addEventListener('transitionend', (e) => e.target === el && e.propertyName === 'opacity' && end())
    setTimeout(end, 1400)
}

export const boot = {
    /** Play the opening act (the 3D version; the light one opens without it). */
    play() {
        if (!el || closed) return
        if (reducedMotion || !act?.canPlayType('video/mp4')) return still()
        actOver = false
        el.classList.add('has-act')
        act.addEventListener('playing', () => el.classList.add('is-playing'), { once: true })
        act.addEventListener('ended', onActEnd, { once: true })
        // the frame loop shows the logo on time; this, where frames are held back (a hidden tab)
        act.addEventListener('timeupdate', () => act.currentTime >= LOGO_AT && el.classList.add('show-logo'))
        act.addEventListener('error', still, { once: true })
        // the loop is fetched once the act has what it needs, so it never slows the act down
        act.addEventListener('canplaythrough', () => {
            if (loop && loop.preload !== 'auto') {
                loop.preload = 'auto'
                loop.load()
            }
        }, { once: true })
        act.play().catch(still)
        skip?.addEventListener('click', () => {
            actOver = true
            finish()
        })
    },

    /** How far loading has gone (0 to 1), and what is being done now. */
    set(p, label) {
        if (closed || !el) return
        if (p > target) {
            target = p
            creep = 0
        }
        if (label && text && text.textContent !== label) text.textContent = label
    },

    /**
     * Everything is in: the screen opens onto the app once the act is over (straight away if
     * there is none). `onOpen` is called as it starts to open; resolves once it is gone.
     */
    done(onOpen) {
        if (!el) {
            onOpen?.()
            return Promise.resolve()
        }
        opening = onOpen
        if (closing) return closing.promise
        let resolve
        closing = { promise: new Promise((r) => (resolve = r)) }
        closing.resolve = resolve
        ready = true
        if (text) text.textContent = '¡Listo!'
        if (slow) slow.hidden = true
        el.classList.add('is-ready')
        if (actOver) finish()
        return closing.promise
    },

    /** Loading failed: say so on the loading screen, with the way to try again. */
    fail(message) {
        if (!el) return
        closed = true
        clearTimeout(slowTimer)
        cancelAnimationFrame(raf)
        still()
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
