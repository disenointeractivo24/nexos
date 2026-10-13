// Writes src/data/caliRoads.js from the OpenStreetMap render of Cali (Map_of_Cali.svg): the main
// roads, simplified, in the map's own coordinates. The drawing is laid over the MIO zoning map
// with an affine fit (found by overlapping the built-up area of one with the zones of the other).
//
// Usage, from starter/:
//   node tools/vias_cali.mjs fuentes_3d/mapa_cali/Map_of_Cali.svg src/data/caliRoads.js
import fs from 'fs'
const [src, out] = process.argv.slice(2)
const svg = fs.readFileSync(src, 'utf8')

// OSM drawing → MIO drawing (inverse of the fitted MIO → OSM affine), then MIO → map (CALI_FRAME)
const A = { a: 1.784986942345154, b: 0.003909876614872776, c: -146.4305362722648, d: 0.02551729629401282, e: 1.864694488096928, f: 796.0985293543307 }
const F = { X0: 370, Y0: 400, SCALE: 0.38, OX: 14, OZ: 4 }
const det = A.a * A.e - A.b * A.d
const toMap = (X, Y) => {
    const dx = X - A.c, dy = Y - A.f
    const mx = (A.e * dx - A.b * dy) / det, my = (-A.d * dx + A.a * dy) / det
    return [(mx - F.X0) * F.SCALE + F.OX, (my - F.Y0) * F.SCALE + F.OZ]
}

const KIND = (st) => {
    if (/stroke: none/.test(st)) return null
    const w = +(st.match(/stroke-width: ([\d.]+)/) || [])[1]
    const c = (st.match(/stroke: (rgb\([^)]*\))/) || [])[1] || ''
    if (c.includes('66.27451%,85.882353%,66.27451%') && w === 7) return 'avenue' // trunk
    if (c.includes('92.54902%,59.607843%,60.392157%') && w === 7) return 'avenue' // primary
    if (c.includes('99.607843%,84.313725%,64.705882%') && w >= 8) return 'street' // secondary
    if (c.includes('100%,100%,70.196078%') && w === 4.5) return 'street' // tertiary
    return null
}

// Douglas–Peucker: a road keeps its bends, not every little kink
function simplify(pts, eps) {
    if (pts.length < 3) return pts
    const [ax, az] = pts[0], [bx, bz] = pts[pts.length - 1]
    const L = Math.hypot(bx - ax, bz - az) || 1e-9
    let md = 0, mi = 0
    for (let i = 1; i < pts.length - 1; i++) {
        const [x, z] = pts[i]
        const d = Math.abs((bx - ax) * (az - z) - (ax - x) * (bz - az)) / L
        if (d > md) [md, mi] = [d, i]
    }
    if (md <= eps) return [pts[0], pts[pts.length - 1]]
    return [...simplify(pts.slice(0, mi + 1), eps).slice(0, -1), ...simplify(pts.slice(mi), eps)]
}

const BOX = { x0: -140, x1: 240, z0: -300, z1: 300 }
const inBox = ([x, z]) => x >= BOX.x0 && x <= BOX.x1 && z >= BOX.z0 && z <= BOX.z1
const res = { avenue: [], street: [] }
for (const m of svg.matchAll(/<path style="([^"]*)" d="([^"]*)"/g)) {
    const kind = KIND(m[1])
    if (!kind) continue
    const t = m[2].trim().split(/\s+/)
    let line = null
    const lines = []
    for (let i = 0; i < t.length; ) {
        if (t[i] === 'M' || t[i] === 'L') {
            const p = toMap(+t[i + 1], +t[i + 2])
            if (t[i] === 'M' || !inBox(p)) {
                line = inBox(p) ? [p] : null
                if (line) lines.push(line)
            } else if (line) line.push(p)
            else lines.push((line = [p]))
            i += 3
        } else i++
    }
    for (const l of lines) {
        const s = simplify(l, 0.8)
        if (s.length >= 2) res[kind].push(s.flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]))
    }
}
// Abstracting: OSM draws each carriageway of an avenue apart, and Cali has far more roads than
// a map this size can hold. Longest roads first, a stretch is kept only where it runs clear of
// the roads already kept (a corridor is one line, and streets keep half a block apart), and
// short leftovers go. Only a road running alongside counts: one that crosses is let through.
const CLEAR = { avenue: 9, street: 14 }
const MIN_LEN = { avenue: 10, street: 20 }
const CELL = 4
const kept = new Map()
const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`
const remember = (x, z, dx, dz) => {
    const k = cellKey(x, z)
    if (!kept.has(k)) kept.set(k, [])
    kept.get(k).push([x, z, dx, dz])
}
const clearOf = (x, z, r, dx, dz) => {
    const n = Math.ceil(r / CELL)
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL)
    for (let i = -n; i <= n; i++)
        for (let j = -n; j <= n; j++)
            for (const [px, pz, qx, qz] of kept.get(`${cx + i},${cz + j}`) ?? []) if ((px - x) ** 2 + (pz - z) ** 2 < r * r && Math.abs(dx * qx + dz * qz) > 0.7) return false
    return true
}
const lengthOf = (l) => { let L = 0; for (let i = 2; i < l.length; i += 2) L += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]); return L }
// a point a metre, each with the direction the road runs there
function densify(l) {
    const out = []
    for (let i = 2; i < l.length; i += 2) {
        const [ax, az] = [l[i - 2], l[i - 1]], [bx, bz] = [l[i], l[i + 1]]
        const L = Math.hypot(bx - ax, bz - az) || 1
        const n = Math.max(1, Math.ceil(L))
        for (let k = i === 2 ? 0 : 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, (bx - ax) / L, (bz - az) / L])
    }
    return out
}
// OSM cuts a road into many short ways: those that meet end to end and carry on in the same
// direction become one line again first
function chain(list) {
    const lines = list.map((l) => { const p = []; for (let i = 0; i < l.length; i += 2) p.push([l[i], l[i + 1]]); return p })
    const key = ([x, z]) => `${Math.round(x * 2)},${Math.round(z * 2)}`
    const dir = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L] }
    const used = new Set()
    const ends = new Map()
    lines.forEach((l, i) => { for (const e of [key(l[0]), key(l[l.length - 1])]) { if (!ends.has(e)) ends.set(e, []); ends.get(e).push(i) } })
    const out = []
    lines.forEach((l, i) => {
        if (used.has(i)) return
        used.add(i)
        let line = l.slice()
        for (const atEnd of [true, false]) {
            for (;;) {
                const tip = atEnd ? line[line.length - 1] : line[0]
                const prev = atEnd ? line[line.length - 2] : line[1]
                const d0 = dir(prev, tip)
                let best = -1, bestDot = 0.7, bestLine = null
                for (const j of ends.get(key(tip)) ?? []) {
                    if (used.has(j)) continue
                    let m = lines[j]
                    if (key(m[0]) !== key(tip)) m = m.slice().reverse()
                    const dot = (([x, z]) => x * d0[0] + z * d0[1])(dir(m[0], m[1]))
                    if (dot > bestDot) [best, bestDot, bestLine] = [j, dot, m]
                }
                if (best < 0) break
                used.add(best)
                line = atEnd ? [...line, ...bestLine.slice(1)] : [...bestLine.slice(1).reverse(), ...line]
            }
        }
        out.push(line.flat())
    })
    return out
}

for (const kind of ['avenue', 'street']) {
    res[kind] = chain(res[kind])
    const pieces = res[kind].sort((p, q) => lengthOf(q) - lengthOf(p))
    const out = []
    for (const piece of pieces) {
        const pts = densify(piece)
        let run = []
        const flush = () => {
            let L = 0
            for (let i = 1; i < run.length; i++) L += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1])
            if (L >= MIN_LEN[kind]) {
                out.push(simplify(run.map(([x, z]) => [x, z]), 0.6).flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]))
                for (const [x, z, dx, dz] of run) remember(x, z, dx, dz)
            }
            run = []
        }
        for (const p of pts) {
            if (clearOf(p[0], p[1], CLEAR[kind], p[2], p[3])) run.push(p)
            else flush()
        }
        flush()
    }
    res[kind] = out
}

const fmt = (list) => list.map((l) => `    [${l.join(',')}],`).join('\n')
fs.writeFileSync(
    out,
    `/**
 * Cali's main roads, from OpenStreetMap (fuentes_3d/mapa_cali/Map_of_Cali.svg), laid over the
 * MIO zoning map and simplified: each road is a flat list x0, z0, x1, z1… in map units.
 * AVENUES are the trunk and primary roads (the wide ones, with palms); STREETS the secondary
 * and tertiary ones. The blocks between them follow each zone's own street grid.
 * Written by tools/vias_cali.mjs.
 */
export const AVENUES = [
${fmt(res.avenue)}
]

export const STREETS = [
${fmt(res.street)}
]
`
)
console.log('avenues', res.avenue.length, 'streets', res.street.length, fs.statSync(out).size, 'bytes')
