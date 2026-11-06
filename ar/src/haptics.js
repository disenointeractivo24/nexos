/** What each answer feels like: strength from 0 to 1 and milliseconds, one entry per pulse. */
const PATTERNS = {
    tap: [[0.3, 20]],
    grab: [[0.45, 30]],
    right: [[0.75, 60]],
    wrong: [[0.9, 80], [0.9, 80]],
}
const GAP_MS = 130

function pulse(gamepad, strength, ms) {
    const actuator = gamepad.hapticActuators?.[0]
    const done = actuator?.pulse
        ? actuator.pulse(strength, ms)
        : gamepad.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength })
    done?.catch?.(() => {})
}

/**
 * The controllers answer in the hand. It goes to the hand that acted last. Bare hands and
 * computers have nothing to vibrate, and simply feel nothing.
 */
export class Haptics {
    constructor() {
        this.session = null
        this.hand = null
        this.remember = (event) => (this.hand = event.inputSource.handedness)
    }

    /** Follows the headset's session, whichever is current. */
    watch(session) {
        if (session === this.session) return
        for (const name of ['selectstart', 'squeezestart']) {
            this.session?.removeEventListener(name, this.remember)
            session?.addEventListener(name, this.remember)
        }
        this.session = session
    }

    play(name) {
        const sources = [...(this.session?.inputSources ?? [])].filter((s) => s.gamepad)
        const source = sources.find((s) => s.handedness === this.hand) ?? sources[0]
        if (!source) return
        PATTERNS[name].forEach(([strength, ms], i) => {
            const send = () => {
                try {
                    pulse(source.gamepad, strength, ms)
                } catch {
                    // a controller gone mid-pattern is no reason to stop the shift
                }
            }
            if (i === 0) send()
            else setTimeout(send, i * GAP_MS)
        })
    }
}
