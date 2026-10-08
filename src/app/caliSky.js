/**
 * The time and the weather in Cali, right now.
 *
 * The clock always runs on Colombian time (America/Bogota), whatever time zone
 * the device is in. The weather comes from Open-Meteo (open data, no key, no
 * personal data sent: only Cali's coordinates), refreshed every ten minutes,
 * along with today's sunrise and sunset, which set how light it is.
 *
 * For demos: `?hora=21:30` fixes the time and `?clima=lluvia` (despejado,
 * parcial, nublado, niebla, lluvia, tormenta) fixes the weather.
 */

import * as THREE from 'three'

const CALI = { lat: 3.4516, lon: -76.532, tz: 'America/Bogota' }
const WEATHER_MS = 10 * 60 * 1000
const TICK_MS = 15 * 1000
/** Cali sits almost on the equator: the sun rises near 5:50 and sets near 18:05 all year. */
const FALLBACK_SUN = { rise: 5 * 60 + 50, set: 18 * 60 + 5 }

const timeFmt = new Intl.DateTimeFormat('es-CO', { timeZone: CALI.tz, hour: 'numeric', minute: '2-digit', hour12: true })
const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: CALI.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/**
 * Each kind of weather, in the world:
 *   cloud      how overcast the sky is (0 clear … 1 storm)
 *   rain       how hard it rains (0 none, 0.15 a drizzle, 0.55 rain, 1 a downpour)
 *   fog        how close the fog comes in (0 none … 1 thick mist)
 *   lightning  flashes now and then
 */
export const WEATHER = {
    despejado: { label: 'Despejado', cloud: 0, rain: 0, fog: 0, icon: 'sun' },
    parcial: { label: 'Parcialmente nublado', cloud: 0.35, rain: 0, fog: 0, icon: 'cloud-sun' },
    nublado: { label: 'Nublado', cloud: 0.7, rain: 0, fog: 0.15, icon: 'cloud' },
    niebla: { label: 'Neblina', cloud: 0.8, rain: 0, fog: 1, icon: 'cloud' },
    llovizna: { label: 'Llovizna', cloud: 0.75, rain: 0.15, fog: 0.2, icon: 'rain' },
    lluvia: { label: 'Lluvia', cloud: 0.85, rain: 0.55, fog: 0.3, icon: 'rain' },
    aguacero: { label: 'Aguacero', cloud: 0.95, rain: 1, fog: 0.42, icon: 'rain' },
    tormenta: { label: 'Tormenta', cloud: 1, rain: 1, fog: 0.45, lightning: true, icon: 'storm' },
}

/** WMO weather code (what Open-Meteo returns) → one of the kinds above. */
function kindOf(code) {
    if ([95, 96, 99].includes(code)) return 'tormenta'
    if ([65, 67, 81, 82].includes(code)) return 'aguacero'
    if ((code >= 51 && code <= 57)) return 'llovizna'
    if ((code >= 61 && code <= 66) || code === 80) return 'lluvia'
    if (code === 45 || code === 48) return 'niebla'
    if (code === 3) return 'nublado'
    if (code === 1 || code === 2) return 'parcial'
    return 'despejado'
}

const toMinutes = (hhmm) => {
    const m = /(\d{1,2}):(\d{2})/.exec(hhmm ?? '')
    return m ? +m[1] * 60 + +m[2] : null
}

const smooth = (e0, e1, x) => {
    const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
    return k * k * (3 - 2 * k)
}

export class CaliSky {
    constructor() {
        const q = new URLSearchParams(location.search)
        this.fixedTime = toMinutes(q.get('hora'))
        this.fixedKind = WEATHER[q.get('clima')] ? q.get('clima') : null
        this.kind = this.fixedKind ?? 'despejado'
        this.temp = null
        this.sun = { ...FALLBACK_SUN }
        this.listeners = new Set()
        this.loaded = !!this.fixedKind
    }

    on(fn) {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    }

    #emit() {
        const s = this.state
        for (const fn of this.listeners) fn(s)
    }

    start() {
        this.#emit()
        this.#fetch()
        this.tick = setInterval(() => this.#emit(), TICK_MS)
        this.refetch = setInterval(() => this.#fetch(), WEATHER_MS)
    }

    stop() {
        clearInterval(this.tick)
        clearInterval(this.refetch)
    }

    async #fetch() {
        const url =
            `https://api.open-meteo.com/v1/forecast?latitude=${CALI.lat}&longitude=${CALI.lon}` +
            `&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=${encodeURIComponent(CALI.tz)}&forecast_days=1`
        try {
            const res = await fetch(url)
            const data = await res.json()
            const code = data?.current?.weather_code
            if (Number.isFinite(code)) this.realKind = kindOf(code)
            this.kind = this.fixedKind ?? this.realKind ?? this.kind
            const t = data?.current?.temperature_2m
            if (Number.isFinite(t)) this.temp = Math.round(t)
            const rise = toMinutes(data?.daily?.sunrise?.[0]?.slice(11))
            const set = toMinutes(data?.daily?.sunset?.[0]?.slice(11))
            if (rise !== null && set !== null) this.sun = { rise, set }
            this.loaded = true
        } catch {
            // offline: keep the clock, the usual sunrise and sunset, and the last known weather
        }
        this.#emit()
    }

    /**
     * Testing: fix the time (minutes since midnight) and/or the weather.
     * `null` goes back to the real one; leaving a field out keeps it as it is.
     */
    setOverride({ minutes, kind } = {}) {
        if (minutes !== undefined) this.fixedTime = minutes
        if (kind !== undefined) this.fixedKind = kind && WEATHER[kind] ? kind : null
        this.kind = this.fixedKind ?? this.realKind ?? 'despejado'
        this.#emit()
    }

    /** Minutes since midnight in Cali. */
    get minutes() {
        if (this.fixedTime !== null) return this.fixedTime
        const [h, m] = partsFmt.format(new Date()).split(':').map(Number)
        return h * 60 + m
    }

    get timeText() {
        if (this.fixedTime !== null) {
            const d = new Date(Date.UTC(2026, 0, 1, Math.floor(this.fixedTime / 60) + 5, this.fixedTime % 60))
            return timeFmt.format(d)
        }
        return timeFmt.format(new Date())
    }

    /**
     * 1 in full daylight, 0 at night, easing through dawn and dusk (about
     * forty minutes each side of sunrise and sunset).
     */
    get daylight() {
        const t = this.minutes
        const { rise, set } = this.sun
        return smooth(rise - 25, rise + 20, t) * (1 - smooth(set - 20, set + 25, t))
    }

    get state() {
        const w = WEATHER[this.kind]
        const day = this.daylight
        // a clear night still shows a moon, not a sun
        const icon = day < 0.5 && (this.kind === 'despejado' || this.kind === 'parcial') ? 'moon' : w.icon
        return {
            time: this.timeText,
            minutes: this.minutes,
            daylight: day,
            kind: this.kind,
            weather: w,
            label: w.label,
            temp: this.temp,
            icon,
            loaded: this.loaded,
            // a time or weather set by hand (the test panel or the address), not the real one
            manual: this.fixedTime !== null || !!this.fixedKind,
        }
    }
}

/* ------------------------------------------------------------------
   The light of the moment, laid over the emergency's own
   ------------------------------------------------------------------ */

/** A heavy grey sky: where the colours go as the clouds close in. */
const OVERCAST = { skyTop: '#8F9DAB', skyHorizon: '#D3D8DC', fog: '#C9CFD4', sun: '#EEEDE8', hemiSky: '#D6DDE3', hemiGround: '#A9A595' }
/** Night over Cali: deep blue sky, a cool moon, the ground in shadow. */
const NIGHT = { skyTop: '#081530', skyHorizon: '#22335A', fog: '#1A2540', sun: '#9FB4F0', hemiSky: '#425783', hemiGround: '#24242E' }

const mix = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()

/**
 * The emergency's mood (data/themes.js), turned toward Cali's real sky: greyer
 * and dimmer the more overcast it is, and toward night as the sun goes down.
 */
export function skyMood(base, s) {
    const c = s.weather.cloud
    const n = 1 - s.daylight
    const out = { ...base }
    for (const k of Object.keys(OVERCAST)) out[k] = mix(base[k], OVERCAST[k], c * 0.75)
    out.sunIntensity = base.sunIntensity * (1 - 0.6 * c)
    out.hemiIntensity = base.hemiIntensity * (1 - 0.1 * c)
    out.haze = Math.max(base.haze ?? 0, s.kind === 'niebla' ? 0.7 : c * 0.35)
    for (const k of Object.keys(NIGHT)) out[k] = mix(out[k], NIGHT[k], n)
    out.sunIntensity = out.sunIntensity * (1 - n) + 0.3 * n
    out.hemiIntensity = out.hemiIntensity * (1 - n) + 0.42 * n
    out.envIntensity = 0.32 * (1 - n) + 0.05 * n
    out.exposure = 1.04 * (1 - 0.06 * c) * (1 - n) + 0.82 * n
    out.haze *= 1 - n * 0.5
    // the warm glow around the sun fades with it, and behind clouds
    out.sunGlow = (1 - n) * (1 - 0.7 * c)
    // stars only on a night that is not covered
    out.stars = n * (1 - c)
    // the fog closes in with mist and with heavy rain
    out.fogAmount = s.weather.fog ?? 0
    return out
}
