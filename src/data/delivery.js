/**
 * When a donor can bring supplies to a point: the next windows it is open, worked out from
 * the point's own hours and the time in Cali (America/Bogota, whatever the device's zone).
 *
 * Each day splits in two, the morning (opening to noon) and the afternoon (noon to closing).
 * Today's windows start from now plus the time it takes to get there, so someone looking in
 * the morning can still go this afternoon, or even before noon, and someone looking at 3 p. m.
 * gets "Hoy, antes del cierre". A window too short to make it in time is not offered.
 */

const TZ = 'America/Bogota'
const NOON = 12 * 60
/** Minutes to get to the point: today's windows never start sooner than this from now. */
const LEAD = 30
/** A window shorter than this is not worth offering. */
const MIN_STAY = 30
const SHOWN = 4

const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
// the dates are built at noon UTC from Cali's calendar day, so they are written in UTC
const dayFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })

function caliNow(now) {
    const p = Object.fromEntries(partsFmt.formatToParts(now).map((x) => [x.type, x.value]))
    return { y: +p.year, m: +p.month, d: +p.day, min: (+p.hour % 24) * 60 + +p.minute }
}

function caliDay(c, offset) {
    const t = new Date(Date.UTC(c.y, c.m - 1, c.d + offset, 12))
    return { key: t.toISOString().slice(0, 10), name: dayFmt.format(t) }
}

/** Minutes after midnight, the Colombian way: "8:00 a. m.", "12:00 m.", "4:30 p. m.". */
export function clock(min) {
    const h = Math.floor(min / 60)
    const m = String(min % 60).padStart(2, '0')
    if (h === 12 && m === '00') return '12:00 m.'
    return `${h % 12 || 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

const hoursOf = (point) => ({ open: point?.open ?? 8 * 60, close: point?.close ?? 17 * 60 })

/** Every window of today and the next two days, offered or not (a passed one is kept to read back a choice). */
function allWindows(point, now) {
    const { open, close } = hoursOf(point)
    const c = caliNow(now)
    const earliest = Math.ceil((c.min + LEAD) / 15) * 15
    const halves = [
        { part: 'am', from: open, to: Math.min(NOON, close) },
        { part: 'pm', from: Math.max(NOON, open), to: close },
    ].filter((b) => b.to - b.from >= MIN_STAY)
    const when = ['Hoy', 'Mañana', 'Pasado mañana']
    const out = []
    for (let off = 0; off < 3; off++) {
        const day = caliDay(c, off)
        for (const b of halves) {
            const late = off === 0 && earliest > b.from
            const from = late ? Math.min(earliest, b.to) : b.from
            const half = b.part === 'am' ? 'mañana' : 'tarde'
            // late in the afternoon it says what matters: there is still time before it closes
            const rush = late && b.part === 'pm' && from > NOON + 60
            const label = off === 0 && late ? (b.part === 'am' ? 'Hoy, esta mañana' : rush ? 'Hoy, antes del cierre' : 'Hoy en la tarde') : `${when[off]} en la ${half}`
            const closing = b.to === close ? ` · cierra a las ${clock(close)}` : ''
            out.push({
                id: `${day.key}-${b.part}`,
                label,
                detail: `${day.name}, de ${clock(from)} a ${clock(b.to)}${rush ? closing : ''}`,
                offered: b.to - from >= MIN_STAY,
            })
        }
    }
    return out
}

/** The next windows the donor can still make, soonest first. */
export function deliveryWindows(point, now = new Date()) {
    return allWindows(point, now)
        .filter((w) => w.offered)
        .slice(0, SHOWN)
}

/** A chosen window read back by its id (also when it has started or passed since it was picked). */
export function findWindow(point, id, now = new Date()) {
    return allWindows(point, now).find((w) => w.id === id)
}
