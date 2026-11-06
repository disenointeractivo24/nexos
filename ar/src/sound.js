/**
 * Work sounds, generated as they play like the rest of NEXOS's audio, and placed in the
 * room: a box lands where the box is. The web experience's Audio class brings its calm
 * music with it, which is not what a shift sounds like, so only the idea is shared.
 */
export class Sound {
    constructor() {
        this.ctx = null
    }

    /** Browsers only allow audio after a real gesture. */
    unlock() {
        if (this.ctx) return void this.ctx.resume?.()
        const AC = window.AudioContext ?? window.webkitAudioContext
        if (!AC) return
        this.ctx = new AC()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.8
        this.master.connect(this.ctx.destination)
        const seconds = 4 // long enough for the crowd not to sound like a loop
        this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate)
        const data = this.noise.getChannelData(0)
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }

    /** Follows the head, called every frame. */
    listen(pos, forward, up) {
        const l = this.ctx?.listener
        if (!l?.positionX) return
        l.positionX.value = pos.x
        l.positionY.value = pos.y
        l.positionZ.value = pos.z
        l.forwardX.value = forward.x
        l.forwardY.value = forward.y
        l.forwardZ.value = forward.z
        l.upX.value = up.x
        l.upY.value = up.y
        l.upZ.value = up.z
    }

    #out(at) {
        if (!at) return this.master
        const p = this.ctx.createPanner()
        p.panningModel = 'HRTF'
        p.refDistance = 0.8
        p.positionX.value = at.x
        p.positionY.value = at.y
        p.positionZ.value = at.z
        p.connect(this.master)
        return p
    }

    #tone({ freq, decay = 0.2, level = 0.1, type = 'sine', delay = 0, slide = 0, at }) {
        const t = this.ctx.currentTime + delay
        const o = this.ctx.createOscillator()
        const g = this.ctx.createGain()
        o.type = type
        o.frequency.setValueAtTime(freq, t)
        if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + decay)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(level, t + 0.012)
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
        o.connect(g).connect(this.#out(at))
        o.start(t)
        o.stop(t + decay + 0.02)
    }

    #burst({ decay = 0.2, level = 0.2, filter = 900, q = 0.8, kind = 'lowpass', delay = 0, at }) {
        const t = this.ctx.currentTime + delay
        const s = this.ctx.createBufferSource()
        s.buffer = this.noise
        const f = this.ctx.createBiquadFilter()
        f.type = kind
        f.frequency.value = filter
        f.Q.value = q
        const g = this.ctx.createGain()
        g.gain.setValueAtTime(level, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
        s.connect(f).connect(g).connect(this.#out(at))
        s.start(t, Math.random() * 3)
        s.stop(t + decay + 0.02)
    }

    /**
     * The noise of the place, called every frame with the pressure from 0 to 1: people waiting
     * and moving beyond the counter, a low murmur of filtered noise with no words in it,
     * and at the worst moments the person's own pulse.
     */
    ambient(level, dt) {
        if (!this.ctx) return
        if (!this.crowd) {
            const s = this.ctx.createBufferSource()
            s.buffer = this.noise
            s.loop = true
            const f = this.ctx.createBiquadFilter()
            f.type = 'bandpass'
            f.frequency.value = 420
            f.Q.value = 0.7
            const lfo = this.ctx.createOscillator()
            const depth = this.ctx.createGain()
            lfo.frequency.value = 0.13
            depth.gain.value = 130
            lfo.connect(depth).connect(f.frequency)
            this.crowd = this.ctx.createGain()
            this.crowd.gain.value = 0
            const from = this.#out({ x: 0, y: 1.2, z: -3.5 })
            s.connect(f).connect(this.crowd).connect(from)
            s.start()
            lfo.start()
            this.pulse = 0
        }
        this.crowd.gain.setTargetAtTime(0.012 + 0.11 * level, this.ctx.currentTime, 1.5)
        if (level > 0.55) {
            this.pulse -= dt
            if (this.pulse <= 0) {
                this.pulse = 1.25 - 0.3 * level
                this.play('heart')
            }
        }
    }

    play(name, at) {
        if (!this.ctx) return
        switch (name) {
            case 'box': // cardboard set down
                this.#burst({ decay: 0.16, level: 0.5, filter: 320, at })
                this.#tone({ freq: 92, decay: 0.14, level: 0.3, at })
                break
            case 'tape': // packing tape pulled off
                this.#burst({ decay: 0.42, level: 0.2, filter: 2600, q: 4, kind: 'bandpass', at })
                this.#burst({ decay: 0.22, level: 0.14, filter: 3600, q: 6, kind: 'bandpass', delay: 0.26, at })
                break
            case 'item': // something put away in a crate
                this.#burst({ decay: 0.09, level: 0.26, filter: 1100, at })
                this.#tone({ freq: 659, decay: 0.12, level: 0.05, at })
                break
            case 'wrong': // it does not go there
                this.#tone({ freq: 196, decay: 0.2, level: 0.09, type: 'triangle', at })
                this.#tone({ freq: 165, decay: 0.26, level: 0.09, type: 'triangle', delay: 0.11, at })
                break
            case 'radio': // the radio opens: a short squelch, then two beeps
                this.#burst({ decay: 0.14, level: 0.1, filter: 2200, q: 1.2, kind: 'bandpass' })
                this.#tone({ freq: 1320, decay: 0.09, level: 0.05, type: 'square', delay: 0.13 })
                this.#tone({ freq: 990, decay: 0.11, level: 0.05, type: 'square', delay: 0.25 })
                break
            case 'done': // a task ticked off
                this.#tone({ freq: 587, decay: 0.2, level: 0.08 })
                this.#tone({ freq: 880, decay: 0.32, level: 0.06, delay: 0.09 })
                break
            case 'tap':
                this.#tone({ freq: 587, decay: 0.1, level: 0.05 })
                break
            case 'alert': // something that cannot wait: the only sound here that insists
                for (const delay of [0, 0.24, 0.48]) this.#tone({ freq: 880, decay: 0.16, level: 0.08, type: 'square', delay })
                this.#burst({ decay: 0.14, level: 0.1, filter: 2200, q: 1.2, kind: 'bandpass' })
                break
            case 'truck': // an engine that comes and stops, off to one side
                this.#burst({ decay: 1.6, level: 0.3, filter: 180, at })
                this.#tone({ freq: 62, decay: 1.5, level: 0.16, type: 'sawtooth', slide: -22, at })
                break
            case 'grumble': { // someone complaining, too far to make out: not words, only the tone of it
                let delay = 0
                for (let i = 0; i < 5; i++) {
                    const decay = 0.1 + Math.random() * 0.11
                    this.#tone({ freq: 135 + Math.random() * 75, decay, level: 0.09, type: 'sawtooth', slide: -25, delay, at })
                    delay += decay + 0.02
                }
                break
            }
            case 'heart': // felt more than heard
                this.#tone({ freq: 58, decay: 0.16, level: 0.1 })
                this.#tone({ freq: 50, decay: 0.2, level: 0.07, delay: 0.2 })
                break
        }
    }
}
