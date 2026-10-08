/**
 * Sound for NEXOS — fully procedural (Web Audio), no audio files to download.
 *
 * Two layers, both gentle:
 *   · music    a slow, warm chord bed with a rare bell note
 *   · cues     short sounds answering the buttons (tap, add, confirm…)
 *
 * There is deliberately no ambience (rain, wind, footsteps, transitions): only
 * the music and the sounds of what the person does.
 *
 * The context is created on the first real gesture, because browsers block
 * audio before that. Everything is wired through one master gain, so muting is
 * instant and the choice is remembered between visits.
 *
 * Nothing here is essential to the experience: if Web Audio is missing or the
 * context refuses to start, every method is a no-op and the app runs silently.
 */

const KEY = 'nexos.sound.v1'

/** Chord bed: warm, open voicings that never resolve to anything dramatic. */
const CHORDS = [
    [146.83, 220.0, 277.18, 329.63], // Re menor 9
    [130.81, 196.0, 261.63, 329.63], // Do mayor 9
    [174.61, 261.63, 329.63, 392.0], // Fa mayor 9
    [196.0, 293.66, 349.23, 440.0], // Sol sus
]

/** Sparse melody notes (same scale), used very rarely so it never nags. */
const MOTIF = [587.33, 659.25, 783.99, 880.0, 1046.5]

/** How present the music is in each view: a little lower while a panel is open. */
const MUSIC_LEVEL = { intro: 0.5, city: 0.45, barrio: 0.36, house: 0.26 }

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

        this.nodes = { master, padBus, cueBus, roomSend, room }
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
       Music — a slow chord bed with a rare motif
       ================================================================ */

    #schedulePad() {
        let i = 0
        const step = () => {
            if (!this.ready) return
            this.#chord(CHORDS[i % CHORDS.length])
            if (i % 3 === 1) this.#motif()
            i++
        }
        step()
        this.timers.push(setInterval(step, 13000))
    }

    #chord(freqs) {
        const ctx = this.ctx
        const t = ctx.currentTime
        const dur = 14
        for (const f of freqs) {
            // pure tones with only a slight detune: warm, without the beating that muddies a chord
            for (const [mult, level, detune] of [[1, 0.07, -2], [1, 0.07, 2], [2, 0.015, 0]]) {
                const o = ctx.createOscillator()
                o.type = 'sine'
                o.frequency.value = f * mult
                o.detune.value = detune
                const lp = ctx.createBiquadFilter()
                lp.type = 'lowpass'
                lp.frequency.value = 760
                lp.Q.value = 0.3
                const g = ctx.createGain()
                g.gain.value = 0.0001
                g.gain.setTargetAtTime(level, t + 0.2, 2.6)
                g.gain.setTargetAtTime(0.0001, t + dur * 0.55, 3.2)
                o.connect(lp).connect(g).connect(this.nodes.padBus)
                o.start(t)
                o.stop(t + dur)
            }
        }
    }

    /** One or two soft bell notes, far apart — presence without melody. */
    #motif() {
        const ctx = this.ctx
        const base = ctx.currentTime + 2 + Math.random() * 4
        const n = 1 + (Math.random() < 0.4 ? 1 : 0)
        for (let k = 0; k < n; k++) {
            const t = base + k * (1.1 + Math.random() * 0.9)
            const f = MOTIF[Math.floor(Math.random() * MOTIF.length)]
            const o = ctx.createOscillator()
            o.type = 'sine'
            o.frequency.value = f
            const g = ctx.createGain()
            g.gain.setValueAtTime(0.0001, t)
            g.gain.exponentialRampToValueAtTime(0.035, t + 0.08)
            g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8)
            o.connect(g).connect(this.nodes.padBus)
            o.start(t)
            o.stop(t + 3)
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
