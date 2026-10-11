/**
 * Sound for NEXOS — fully procedural (Web Audio), no audio files to download.
 *
 * Two layers, both gentle:
 *   · music    an ambient score, generated as it plays: a slow pad that breathes,
 *              a low drone, a soft keys melody that drifts through a long echo,
 *              a high shimmer and a hush of air; birds now and then in the barrio
 *   · cues     short sounds answering the buttons (tap, add, confirm…)
 *
 * The context is created on the first real gesture, because browsers block
 * audio before that. Everything is wired through one master gain, so muting is
 * instant and the choice is remembered between visits.
 *
 * Nothing here is essential to the experience: if Web Audio is missing or the
 * context refuses to start, every method is a no-op and the app runs silently.
 */

const KEY = 'nexos.sound.v1'

/**
 * The score's harmony, in D: open, warm chords that drift without ever resolving to
 * anything dramatic. Each is [low drone, voicing]. Re maj9 · Si m11 · Sol maj7(#11) · La add9
 */
const CHORDS = [
    [73.42, [146.83, 220.0, 277.18, 329.63, 369.99]],
    [61.74, [123.47, 185.0, 220.0, 293.66, 329.63]],
    [49.0, [98.0, 146.83, 185.0, 246.94, 277.18]],
    [55.0, [110.0, 164.81, 246.94, 277.18, 329.63]],
]
/** Seconds each chord lasts; the next one starts a little before, so they melt together. */
const CHORD_LEN = 20
const CHORD_EVERY = 13

/** The keys melody: D major pentatonic, which sits on every chord above. */
const KEYS = [440.0, 493.88, 587.33, 659.25, 739.99, 880.0, 987.77, 1174.66]

/** How present the music is in each view: a little lower while a panel is open. */
const MUSIC_LEVEL = { intro: 0.55, city: 0.5, barrio: 0.42, house: 0.3 }

export class Audio {
    constructor({ reducedMotion = false } = {}) {
        this.reducedMotion = reducedMotion
        this.ctx = null
        this.ready = false
        this.failed = false
        this.scene = 'intro'
        this.nodes = {}
        this.timers = []
        this.enabled = this.#readPreference()
        this.listeners = new Set()
    }

    #readPreference() {
        try {
            const v = localStorage.getItem(KEY)
            return v === null ? true : v === 'on'
        } catch {
            return true
        }
    }

    #savePreference() {
        try {
            localStorage.setItem(KEY, this.enabled ? 'on' : 'off')
        } catch {
            /* storage unavailable: the choice lasts for this session only */
        }
    }

    onChange(fn) {
        this.listeners.add(fn)
        fn(this.enabled)
        return () => this.listeners.delete(fn)
    }

    #emit() {
        for (const fn of this.listeners) fn(this.enabled)
    }

    /* ================================================================
       Start-up
       ================================================================ */

    /** Call from a real user gesture. Safe to call many times. */
    async unlock() {
        if (this.ready || this.failed) {
            if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {})
            return this.ready
        }
        const Ctor = window.AudioContext ?? window.webkitAudioContext
        if (!Ctor) {
            this.failed = true
            return false
        }
        try {
            this.ctx = new Ctor()
            await this.ctx.resume().catch(() => {})
            this.#build()
            this.ready = true
            this.#applyEnabled(0.9)
            this.#applyScene()
            this.#schedulePad()
            return true
        } catch {
            this.failed = true
            return false
        }
    }

    #build() {
        const ctx = this.ctx

        // master → a gentle top-end roll-off → light limiting, so nothing is ever harsh or spikes
        const master = ctx.createGain()
        master.gain.value = 0
        const soften = ctx.createBiquadFilter()
        soften.type = 'lowpass'
        soften.frequency.value = 5200
        soften.Q.value = 0.5
        const guard = ctx.createDynamicsCompressor()
        guard.threshold.value = -18
        guard.knee.value = 24
        guard.ratio.value = 4
        guard.attack.value = 0.02
        guard.release.value = 0.4
        master.connect(soften).connect(guard).connect(ctx.destination)

        // a small, short room shared by the music and the cues; kept low so cues stay clear
        const room = ctx.createConvolver()
        room.buffer = this.#impulse(1.6, 3)
        const roomSend = ctx.createGain()
        roomSend.gain.value = 0.16
        roomSend.connect(room).connect(master)

        const padBus = ctx.createGain()
        padBus.gain.value = 0.0001
        const cueBus = ctx.createGain()
        cueBus.gain.value = 0.7
        padBus.connect(master)
        padBus.connect(roomSend)
        cueBus.connect(master)
        cueBus.connect(roomSend)

        // the music's own space: a long, soft hall, so everything trails off slowly
        const hall = ctx.createConvolver()
        hall.buffer = this.#impulse(5.5, 2.4)
        const hallSend = ctx.createGain()
        hallSend.gain.value = 0.55
        hallSend.connect(hall).connect(padBus)

        // an echo for the keys: repeats that darken as they fade
        const echo = ctx.createDelay(2)
        echo.delayTime.value = 0.48
        const echoBack = ctx.createGain()
        echoBack.gain.value = 0.38
        const echoTone = ctx.createBiquadFilter()
        echoTone.type = 'lowpass'
        echoTone.frequency.value = 2200
        echo.connect(echoTone).connect(echoBack).connect(echo)
        const echoOut = ctx.createGain()
        echoOut.gain.value = 0.45
        echoTone.connect(echoOut)
        echoOut.connect(padBus)
        echoOut.connect(hallSend)

        this.nodes = { master, padBus, cueBus, roomSend, room, hallSend, echo }
    }

    /** Decaying noise impulse response — a soft room, not a cathedral. */
    #impulse(seconds, decay) {
        const ctx = this.ctx
        const len = Math.floor(ctx.sampleRate * seconds)
        const buf = ctx.createBuffer(2, len, ctx.sampleRate)
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch)
            for (let i = 0; i < len; i++) {
                const t = i / len
                d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.6
            }
        }
        return buf
    }

    /* ================================================================
       Mute
       ================================================================ */

    toggle() {
        this.enabled = !this.enabled
        this.#savePreference()
        this.#applyEnabled(0.35)
        this.#emit()
        if (this.enabled) this.unlock()
        return this.enabled
    }

    #applyEnabled(fade = 0.4) {
        if (!this.ready) return
        const { master } = this.nodes
        const t = this.ctx.currentTime
        const to = this.enabled ? 0.55 : 0.0001
        master.gain.cancelScheduledValues(t)
        master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t)
        master.gain.exponentialRampToValueAtTime(Math.max(to, 0.0001), t + fade)
    }

    /* ================================================================
       Music level per view
       ================================================================ */

    /** Kept for callers; the emergency theme no longer changes the sound. */
    setTheme() {}

    setScene(scene) {
        if (this.scene === scene) return
        this.scene = scene
        this.#applyScene()
    }

    #applyScene() {
        if (!this.ready) return
        const level = MUSIC_LEVEL[this.scene] ?? 0.4
        this.nodes.padBus.gain.setTargetAtTime(level, this.ctx.currentTime, 1.6)
    }

    /* ================================================================
       Music — an ambient score, generated as it plays
       ================================================================ */

    #schedulePad() {
        this.#air()
        let i = 0
        const step = () => {
            if (!this.ready) return
            this.chordIndex = i % CHORDS.length
            this.#chord(CHORDS[this.chordIndex])
            i++
        }
        step()
        this.timers.push(setInterval(step, CHORD_EVERY * 1000))
        // the keys wander on their own clock, never in step with the chords
        const keys = () => {
            if (!this.ready) return
            this.#phrase()
            this.timers.push(setTimeout(keys, 5000 + Math.random() * 7000))
        }
        this.timers.push(setTimeout(keys, 3500))
        // in the barrio, a bird now and then
        const birds = () => {
            if (!this.ready) return
            if (this.scene === 'barrio' || this.scene === 'house') this.#bird()
            this.timers.push(setTimeout(birds, 6000 + Math.random() * 10000))
        }
        this.timers.push(setTimeout(birds, 8000))
    }

    /** A swelling, slowly breathing pad over a low drone. */
    #chord([root, notes]) {
        const ctx = this.ctx
        const t = ctx.currentTime
        const end = t + CHORD_LEN
        const out = ctx.createGain()
        out.gain.value = 0.0001
        out.gain.setTargetAtTime(1, t, 3.2)
        out.gain.setTargetAtTime(0.0001, t + CHORD_LEN - 6, 2.2)
        out.connect(this.nodes.padBus)
        out.connect(this.nodes.hallSend)

        // the filter opens and closes slowly, so the pad seems to breathe
        const tone = ctx.createBiquadFilter()
        tone.type = 'lowpass'
        tone.Q.value = 0.7
        tone.frequency.value = 700
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.06 + Math.random() * 0.04
        const depth = ctx.createGain()
        depth.gain.value = 380
        lfo.connect(depth).connect(tone.frequency)
        tone.connect(out)
        lfo.start(t)
        lfo.stop(end)

        notes.forEach((f, n) => {
            // two slightly detuned voices, one to each side: wide and soft
            for (const side of [-1, 1]) {
                const o = ctx.createOscillator()
                o.type = n < 2 ? 'triangle' : 'sawtooth'
                o.frequency.value = f
                o.detune.value = side * (5 + Math.random() * 4)
                const g = ctx.createGain()
                g.gain.value = n < 2 ? 0.05 : 0.016
                const pan = ctx.createStereoPanner()
                pan.pan.value = side * (0.25 + n * 0.08)
                o.connect(g).connect(pan).connect(tone)
                o.start(t)
                o.stop(end)
            }
        })

        // the drone, felt more than heard
        const d = ctx.createOscillator()
        d.type = 'sine'
        d.frequency.value = root
        const dg = ctx.createGain()
        dg.gain.value = 0.07
        d.connect(dg).connect(out)
        d.start(t)
        d.stop(end)

        // a high shimmer: the chord's top note two octaves up, barely there
        const sh = ctx.createOscillator()
        sh.type = 'sine'
        sh.frequency.value = notes[notes.length - 1] * 4
        const shg = ctx.createGain()
        shg.gain.value = 0.0001
        shg.gain.setTargetAtTime(0.006, t + 4, 3)
        shg.gain.setTargetAtTime(0.0001, t + CHORD_LEN - 9, 2)
        const trem = ctx.createOscillator()
        trem.frequency.value = 0.3
        const tg = ctx.createGain()
        tg.gain.value = 0.004
        trem.connect(tg).connect(shg.gain)
        sh.connect(shg).connect(this.nodes.hallSend)
        sh.start(t)
        sh.stop(end)
        trem.start(t)
        trem.stop(end)
    }

    /** Three to five soft keys notes, unhurried, rising or falling, into the echo. */
    #phrase() {
        const ctx = this.ctx
        let t = ctx.currentTime + 0.1
        let k = Math.floor(Math.random() * KEYS.length)
        const n = 3 + Math.floor(Math.random() * 3)
        const dir = Math.random() < 0.5 ? -1 : 1
        for (let i = 0; i < n; i++) {
            const f = KEYS[k]
            this.#key(f, t, 0.035 + Math.random() * 0.02)
            t += 0.45 + Math.random() * 0.7
            k = Math.min(KEYS.length - 1, Math.max(0, k + dir * (1 + (Math.random() < 0.3 ? 1 : 0))))
        }
    }

    #key(f, t, level) {
        const ctx = this.ctx
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(level, t + 0.012)
        g.gain.exponentialRampToValueAtTime(level * 0.3, t + 0.5)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6)
        const pan = ctx.createStereoPanner()
        pan.pan.value = (Math.random() - 0.5) * 0.8
        g.connect(pan)
        pan.connect(this.nodes.padBus)
        pan.connect(this.nodes.echo)
        pan.connect(this.nodes.hallSend)
        // a soft electric-piano colour: the note, its octave and a faint bell partial
        for (const [mult, type, amt] of [[1, 'triangle', 1], [2, 'sine', 0.35], [3.01, 'sine', 0.08]]) {
            const o = ctx.createOscillator()
            o.type = type
            o.frequency.value = f * mult
            const og = ctx.createGain()
            og.gain.value = amt
            o.connect(og).connect(g)
            o.start(t)
            o.stop(t + 3.8)
        }
    }

    /** A hush of air under everything: noise through a slowly wandering band. */
    #air() {
        const ctx = this.ctx
        const len = ctx.sampleRate * 4
        const buf = ctx.createBuffer(2, len, ctx.sampleRate)
        for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c)
            let last = 0
            for (let i = 0; i < len; i++) {
                // brown-ish noise: soft, without hiss
                last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
                d[i] = last * 3.2
            }
        }
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.loop = true
        const band = ctx.createBiquadFilter()
        band.type = 'bandpass'
        band.Q.value = 0.5
        band.frequency.value = 520
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 0.045
        const depth = ctx.createGain()
        depth.gain.value = 260
        lfo.connect(depth).connect(band.frequency)
        const g = ctx.createGain()
        g.gain.value = 0.09
        src.connect(band).connect(g).connect(this.nodes.padBus)
        src.start()
        lfo.start()
    }

    /** Two or three quick chirps, high and far off. */
    #bird() {
        const ctx = this.ctx
        let t = ctx.currentTime + 0.05
        const base = 2600 + Math.random() * 1400
        const pan = ctx.createStereoPanner()
        pan.pan.value = (Math.random() - 0.5) * 1.4
        pan.connect(this.nodes.padBus)
        pan.connect(this.nodes.hallSend)
        const n = 2 + Math.floor(Math.random() * 2)
        for (let i = 0; i < n; i++) {
            const o = ctx.createOscillator()
            o.type = 'sine'
            o.frequency.setValueAtTime(base, t)
            o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.07)
            o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.13)
            const g = ctx.createGain()
            g.gain.setValueAtTime(0.0001, t)
            g.gain.exponentialRampToValueAtTime(0.012, t + 0.02)
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
            o.connect(g).connect(pan)
            o.start(t)
            o.stop(t + 0.16)
            t += 0.16 + Math.random() * 0.12
        }
    }

    /* ================================================================
       Button sounds
       ================================================================ */

    /** A soft attack (no click) and a rounded decay; every cue is built from these. */
    #tone({ freq, type = 'sine', attack = 0.018, decay = 0.22, level = 0.1, slide = 0, delay = 0 }) {
        if (!this.ready || !this.enabled) return
        const ctx = this.ctx
        const t = ctx.currentTime + delay
        const o = ctx.createOscillator()
        o.type = type
        o.frequency.setValueAtTime(freq, t)
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(freq + slide, 20), t + decay)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(level, t + attack)
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
        o.connect(g).connect(this.nodes.cueBus)
        o.start(t)
        o.stop(t + decay + 0.05)
    }

    /** Named button sounds. Unknown names are ignored on purpose. */
    play(name) {
        if (!this.ready || !this.enabled) return
        switch (name) {
            case 'tap':
                this.#tone({ freq: 587.33, decay: 0.12, level: 0.06 })
                break
            case 'add':
                // a light "pop", in step with the supply appearing on the counter
                this.#tone({ freq: 659.25, decay: 0.12, level: 0.07, attack: 0.01 })
                this.#tone({ freq: 880, decay: 0.18, level: 0.05, delay: 0.06 })
                break
            case 'remove':
                this.#tone({ freq: 523.25, decay: 0.14, level: 0.05, slide: -60 })
                break
            case 'step':
                this.#tone({ freq: 587.33, decay: 0.22, level: 0.06 })
                this.#tone({ freq: 880, decay: 0.3, level: 0.035, delay: 0.08 })
                break
            case 'back':
                this.#tone({ freq: 440, decay: 0.2, level: 0.05 })
                break
            case 'open':
                this.#tone({ freq: 392, decay: 0.35, level: 0.06, slide: 120, attack: 0.03 })
                break
            case 'confirm':
                // donation or payment completed: a bright, rising major arpeggio that rings out
                this.#tone({ freq: 523.25, decay: 0.7, level: 0.075 })
                this.#tone({ freq: 659.25, decay: 0.8, level: 0.065, delay: 0.11 })
                this.#tone({ freq: 783.99, decay: 0.9, level: 0.06, delay: 0.22 })
                this.#tone({ freq: 1046.5, decay: 1.5, level: 0.05, delay: 0.36 })
                break
            case 'alert':
                this.#tone({ freq: 698.46, decay: 0.18, level: 0.06 })
                this.#tone({ freq: 698.46, decay: 0.22, level: 0.045, delay: 0.17 })
                break
            case 'error':
                this.#tone({ freq: 246.94, decay: 0.26, level: 0.06, slide: -30 })
                break
            default:
                break
        }
    }

    dispose() {
        for (const id of this.timers) {
            clearInterval(id)
            clearTimeout(id)
        }
        this.timers = []
        this.ready = false
        this.ctx?.close().catch(() => {})
    }
}
