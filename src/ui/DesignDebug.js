/**
 * The design panel: every design decision of the page, changeable live. Debug only — it loads
 * on the dev server or with ?debug in the address (see script.js), and opens with its button
 * or Shift + E.
 *
 *   Tokens    every custom property the stylesheet defines on :root (colours, type sizes, radii,
 *             shadows, spacing, timing), found by itself and grouped, each with its control.
 *   Elemento  pick anything on the page and change its type, colours, box, spacing, size and
 *             layout — or any CSS property at all. The change goes to a selector (the element's
 *             classes, editable) so every element like it follows.
 *   Cambios   everything changed: remove one by one, copy or download the CSS, undo all.
 *
 * Changes live in a stylesheet of their own, last in the page and with !important, so they win
 * over whatever they change; they are kept in this browser (localStorage) and apply only while
 * debugging. The panel itself sits in a shadow root: the page's tokens never change it.
 */
const KEY = 'nexos.design'

/* ---------------- what is changed ---------------- */

let data = { tokens: {}, rules: {} }
try {
    data = { tokens: {}, rules: {}, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
} catch {
    /* storage unavailable or unreadable: start clean */
}

const sheet = document.createElement('style')
sheet.id = 'design-debug'

function css() {
    const out = []
    const tokens = Object.entries(data.tokens)
    if (tokens.length) out.push(`html:root {\n${tokens.map(([k, v]) => `    ${k}: ${v} !important;`).join('\n')}\n}`)
    for (const [sel, props] of Object.entries(data.rules)) {
        const list = Object.entries(props)
        if (list.length) out.push(`${sel} {\n${list.map(([k, v]) => `    ${k}: ${v} !important;`).join('\n')}\n}`)
    }
    return out.join('\n\n')
}

function apply() {
    sheet.textContent = css()
    // last in the page, so it wins
    if (sheet.parentNode !== document.head || document.head.lastElementChild !== sheet) document.head.appendChild(sheet)
    try {
        localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
        /* not kept: still applied for now */
    }
}

function setToken(name, value) {
    if (value === null) delete data.tokens[name]
    else data.tokens[name] = value
    apply()
}

function setRule(sel, prop, value) {
    const r = (data.rules[sel] ??= {})
    if (value === null || value === '') delete r[prop]
    else r[prop] = value
    if (!Object.keys(r).length) delete data.rules[sel]
    apply()
}

/* ---------------- the stylesheet's tokens ---------------- */

function findTokens() {
    const names = new Set()
    const walk = (rules) => {
        for (const r of rules) {
            if (r.cssRules && !r.selectorText) walk(r.cssRules)
            else if (r.selectorText?.split(',').some((s) => s.trim() === ':root')) for (const p of r.style) p.startsWith('--') && names.add(p)
        }
    }
    for (const s of document.styleSheets) {
        if (s.ownerNode === sheet) continue
        try {
            walk(s.cssRules)
        } catch {
            /* a stylesheet from another origin (fonts): nothing of ours */
        }
    }
    return [...names]
}

const isColor = (v) => /^(#|rgb|hsl|oklch|color\()/i.test(v) && CSS.supports('color', v)
const LEN = /^(-?\d*\.?\d+)(px|rem|em|vh|vw|%|ms|s)?$/

function groupOf(name, value) {
    if (/radius/.test(name)) return 'Bordes redondeados'
    if (/shadow/.test(name)) return 'Sombras'
    if (/^--(fs|font|text|logo)/.test(name)) return 'Tipografía'
    if (/ease|dur/.test(name)) return 'Movimiento'
    if (/gutter|tap|gap|space|pad/.test(name)) return 'Espaciado y tamaños'
    if (isColor(value)) return 'Colores'
    return 'Otros'
}

/* ---------------- an element's selector ---------------- */

const STATE = /^(is-|has-|show-)/
function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`
    const own = [...el.classList].filter((c) => !STATE.test(c)).slice(0, 2)
    if (own.length) return own.map((c) => `.${CSS.escape(c)}`).join('')
    const parent = el.parentElement && el.parentElement !== document.body ? selectorFor(el.parentElement) : 'body'
    return `${parent} > ${el.tagName.toLowerCase()}`
}

const PROPS = [
    ['Texto', [
        ['font-size', 'len'], ['font-weight', 'select', ['400', '500', '600', '700', '800']], ['line-height', 'text'],
        ['letter-spacing', 'len'], ['color', 'color'], ['text-align', 'select', ['left', 'center', 'right', 'justify']],
        ['text-transform', 'select', ['none', 'uppercase', 'lowercase', 'capitalize']], ['font-family', 'text'],
    ]],
    ['Caja', [
        ['background-color', 'color'], ['border-radius', 'len'], ['border-width', 'len'],
        ['border-style', 'select', ['none', 'solid', 'dashed', 'dotted']], ['border-color', 'color'], ['box-shadow', 'text'],
        ['opacity', 'text'], ['backdrop-filter', 'text'],
    ]],
    ['Espacio', [
        ['padding-top', 'len'], ['padding-right', 'len'], ['padding-bottom', 'len'], ['padding-left', 'len'],
        ['margin-top', 'len'], ['margin-right', 'len'], ['margin-bottom', 'len'], ['margin-left', 'len'], ['gap', 'len'],
    ]],
    ['Tamaño', [
        ['width', 'len'], ['height', 'len'], ['min-width', 'len'], ['max-width', 'len'], ['min-height', 'len'], ['max-height', 'len'],
    ]],
    ['Disposición', [
        ['display', 'select', ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'none']],
        ['flex-direction', 'select', ['row', 'column', 'row-reverse', 'column-reverse']],
        ['justify-content', 'select', ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']],
        ['align-items', 'select', ['stretch', 'flex-start', 'center', 'flex-end', 'baseline']],
        ['flex-wrap', 'select', ['nowrap', 'wrap']], ['grid-template-columns', 'text'],
        ['position', 'select', ['static', 'relative', 'absolute', 'fixed', 'sticky']],
        ['top', 'len'], ['right', 'len'], ['bottom', 'len'], ['left', 'len'], ['z-index', 'text'], ['transform', 'text'],
    ]],
]

/* ---------------- controls ---------------- */

const toHex = (v) => {
    const c = document.createElement('canvas').getContext('2d')
    c.fillStyle = '#000'
    c.fillStyle = v
    const s = c.fillStyle
    if (s.startsWith('#')) return s
    const m = s.match(/[\d.]+/g)
    return m ? '#' + m.slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('') : '#000000'
}

/** A field for a CSS value: text, plus a colour picker for colours and a slider for lengths. */
function control(kind, value, onChange, options) {
    const wrap = document.createElement('div')
    wrap.className = 'ctl'
    if (kind === 'select') {
        const sel = document.createElement('select')
        const list = options.includes(value) ? options : [value, ...options]
        sel.innerHTML = list.map((o) => `<option${o === value ? ' selected' : ''}>${o}</option>`).join('')
        sel.addEventListener('change', () => onChange(sel.value))
        wrap.append(sel)
        return wrap
    }
    const text = document.createElement('input')
    text.type = 'text'
    text.value = value
    text.spellcheck = false
    wrap.append(text)
    let picker = null, range = null
    if (kind === 'color' || isColor(value)) {
        picker = document.createElement('input')
        picker.type = 'color'
        picker.value = toHex(value)
        picker.addEventListener('input', () => {
            // a colour with transparency keeps it
            const a = text.value.match(/rgba?\([^)]*,\s*([\d.]+)\)/)?.[1]
            const hex = picker.value
            const v = a && +a < 1 ? `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})` : hex.toUpperCase()
            text.value = v
            onChange(v)
        })
        wrap.prepend(picker)
    }
    const m = value.match(LEN)
    if (kind === 'len' || m) {
        const n = m ? +m[1] : 0
        const unit = m?.[2] ?? 'px'
        range = document.createElement('input')
        range.type = 'range'
        const max = unit === 'px' ? Math.max(64, Math.ceil(Math.abs(n) * 3)) : unit === 'ms' ? 2000 : Math.max(4, Math.ceil(Math.abs(n) * 3))
        range.min = n < 0 ? -max : 0
        range.max = max
        range.step = unit === 'px' || unit === 'ms' ? 1 : 0.05
        range.value = n
        range.addEventListener('input', () => {
            const u = text.value.match(LEN)?.[2] ?? unit
            text.value = `${range.value}${u}`
            onChange(text.value)
        })
        wrap.append(range)
    }
    text.addEventListener('input', () => {
        onChange(text.value)
        if (picker && isColor(text.value)) picker.value = toHex(text.value)
        const mm = text.value.match(LEN)
        if (range && mm) range.value = mm[1]
    })
    // arrows nudge a number by 1 (Shift: 10, Alt: 0.1)
    text.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        const mm = text.value.match(/(-?\d*\.?\d+)/)
        if (!mm) return
        e.preventDefault()
        const step = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
        const next = Math.round((+mm[1] + step) * 100) / 100
        text.value = text.value.replace(mm[1], String(next))
        text.dispatchEvent(new Event('input'))
    })
    return wrap
}

/* ---------------- the panel ---------------- */

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel {
    position: fixed; top: 12px; bottom: 12px; right: 12px; z-index: 2147483646;
    width: 360px; display: flex; flex-direction: column;
    background: #FFFFFF; color: #1B2230; border: 1px solid #D5DAE1; border-radius: 12px;
    box-shadow: 0 16px 40px rgba(10, 20, 40, 0.22), 0 2px 6px rgba(10, 20, 40, 0.08);
    font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.panel.left { right: auto; left: 12px; }
.panel[hidden] { display: none; }
.head { display: flex; align-items: center; gap: 6px; padding: 10px 10px 8px 14px; border-bottom: 1px solid #E6E9EE; }
.head b { flex: 1; font-size: 14px; }
.tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid #E6E9EE; }
.tab { flex: 1; padding: 8px 4px; border: 0; border-bottom: 2px solid transparent; background: none; font: inherit; font-weight: 600; color: #5B6577; cursor: pointer; }
.tab[aria-selected="true"] { color: #011E41; border-bottom-color: #011E41; }
.body { flex: 1; overflow: auto; padding: 8px 12px 16px; }
.group { margin-top: 10px; }
.group > summary { cursor: pointer; font-weight: 700; padding: 6px 0; color: #011E41; list-style-position: inside; }
.row { display: grid; grid-template-columns: 118px 1fr auto; align-items: center; gap: 6px; padding: 3px 0; }
.row label { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; color: #3A4456; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row.changed label { color: #C2410C; font-weight: 700; }
.ctl { display: flex; gap: 4px; align-items: center; min-width: 0; }
.ctl input[type="text"], .ctl select, .free input, .sel input {
    min-width: 0; flex: 1; height: 28px; padding: 0 6px; border: 1px solid #CDD3DB; border-radius: 6px;
    font: 12px ui-monospace, Consolas, monospace; color: #1B2230; background: #FFF;
}
.ctl input[type="color"] { width: 28px; height: 28px; padding: 0; border: 1px solid #CDD3DB; border-radius: 6px; background: none; flex: none; }
.ctl input[type="range"] { width: 70px; flex: none; }
button.mini { height: 26px; min-width: 26px; padding: 0 8px; border: 1px solid #CDD3DB; border-radius: 6px; background: #F6F7F9; font: inherit; font-size: 12px; cursor: pointer; color: #1B2230; }
button.mini:hover { background: #ECEFF3; }
button.main { height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: #011E41; color: #FFF; font: inherit; font-weight: 600; cursor: pointer; }
button.main.on { background: #C2410C; }
.reset { visibility: hidden; }
.row.changed .reset { visibility: visible; }
.hint { color: #5B6577; margin: 8px 0; }
.sel { display: flex; gap: 6px; align-items: center; margin: 10px 0 4px; }
.count { color: #5B6577; font-size: 12px; white-space: nowrap; }
.free { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; margin-top: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 12px; }
pre { margin: 0; padding: 10px; border-radius: 8px; background: #F4F6F9; font: 11.5px/1.45 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.change { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid #EEF0F3; font: 11.5px ui-monospace, Consolas, monospace; }
.change span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fab {
    position: fixed; left: 12px; bottom: 12px; z-index: 2147483646; height: 34px; padding: 0 12px;
    border: 1px solid #D5DAE1; border-radius: 999px; background: #FFFFFF; color: #011E41;
    font: 600 12px system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer;
    box-shadow: 0 6px 16px rgba(10, 20, 40, 0.18);
}
.box { position: fixed; z-index: 2147483645; pointer-events: none; border: 2px solid #C2410C; background: rgba(194, 65, 12, 0.08); border-radius: 2px; }
.box.picked { border-color: #011E41; background: rgba(1, 30, 65, 0.06); }
.box b { position: absolute; left: -2px; bottom: 100%; padding: 1px 6px; background: #C2410C; color: #FFF; font: 11px ui-monospace, Consolas, monospace; white-space: nowrap; border-radius: 3px 3px 0 0; }
.box.picked b { background: #011E41; }
`

export function start() {
    apply()
    const host = document.createElement('div')
    host.id = 'design-debug-panel'
    document.body.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${STYLE}</style>
        <button class="fab" type="button" title="Panel de diseño (Shift + E)">Diseño</button>
        <div class="box hover" hidden><b></b></div>
        <div class="box picked" hidden><b></b></div>
        <section class="panel" hidden aria-label="Panel de diseño">
            <div class="head">
                <b>Diseño</b>
                <button class="mini js-side" type="button" title="Pasar el panel al otro lado">⇄</button>
                <button class="mini js-close" type="button" title="Cerrar (Shift + E)">✕</button>
            </div>
            <div class="tabs" role="tablist">
                <button class="tab" role="tab" data-tab="tokens" aria-selected="true">Tokens</button>
                <button class="tab" role="tab" data-tab="element" aria-selected="false">Elemento</button>
                <button class="tab" role="tab" data-tab="changes" aria-selected="false">Cambios</button>
            </div>
            <div class="body"></div>
        </section>`
    const $ = (s) => root.querySelector(s)
    const panel = $('.panel')
    const body = $('.body')
    const hoverBox = $('.box.hover')
    const pickedBox = $('.box.picked')
    let tab = 'tokens'
    let picked = null
    let selector = ''
    let picking = false

    const open = (on = panel.hidden) => {
        panel.hidden = !on
        $('.fab').hidden = on
        if (on) render()
        else stopPicking()
    }
    $('.fab').addEventListener('click', () => open(true))
    $('.js-close').addEventListener('click', () => open(false))
    $('.js-side').addEventListener('click', () => panel.classList.toggle('left'))
    window.addEventListener('keydown', (e) => {
        if (e.shiftKey && e.key.toLowerCase() === 'e' && !e.composedPath().some((n) => n.matches?.('input, textarea, select, [contenteditable]'))) open()
        if (e.key === 'Escape' && picking) stopPicking()
    })
    for (const t of root.querySelectorAll('.tab')) {
        t.addEventListener('click', () => {
            tab = t.dataset.tab
            root.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)))
            render()
        })
    }

    /* ---- tokens ---- */
    function renderTokens() {
        const cs = getComputedStyle(document.documentElement)
        const groups = new Map()
        for (const name of findTokens().sort()) {
            const value = data.tokens[name] ?? cs.getPropertyValue(name).trim()
            const g = groupOf(name, value)
            if (!groups.has(g)) groups.set(g, [])
            groups.get(g).push([name, value])
        }
        body.innerHTML = '<p class="hint">Los valores base de toda la página. Cambia uno y cambia en todas partes donde se usa.</p>'
        const order = ['Colores', 'Tipografía', 'Bordes redondeados', 'Espaciado y tamaños', 'Sombras', 'Movimiento', 'Otros']
        for (const g of order.filter((x) => groups.has(x))) {
            const det = document.createElement('details')
            det.className = 'group'
            det.open = g === 'Colores' || g === 'Tipografía'
            det.innerHTML = `<summary>${g}</summary>`
            for (const [name, value] of groups.get(g)) {
                const row = document.createElement('div')
                row.className = 'row' + (name in data.tokens ? ' changed' : '')
                row.innerHTML = `<label title="${name}">${name}</label>`
                row.append(control(isColor(value) ? 'color' : LEN.test(value) ? 'len' : 'text', value, (v) => {
                    setToken(name, v)
                    row.classList.add('changed')
                }))
                const reset = document.createElement('button')
                reset.className = 'mini reset'
                reset.title = 'Volver al original'
                reset.textContent = '↺'
                reset.addEventListener('click', () => {
                    setToken(name, null)
                    renderTokens()
                })
                row.append(reset)
                det.append(row)
            }
            body.append(det)
        }
    }

    /* ---- one element ---- */
    function renderElement() {
        body.innerHTML = ''
        const pick = document.createElement('button')
        pick.className = 'main' + (picking ? ' on' : '')
        pick.textContent = picking ? 'Toca un elemento de la página… (Esc cancela)' : picked ? 'Elegir otro elemento' : 'Elegir un elemento'
        pick.addEventListener('click', () => (picking ? stopPicking() : startPicking()))
        body.append(pick)
        if (!picked) {
            body.insertAdjacentHTML('beforeend', '<p class="hint">Elige cualquier cosa de la página: un botón, un texto, un panel. Sus cambios se aplican a todos los elementos que coinciden con el selector.</p>')
            return
        }
        const selRow = document.createElement('div')
        selRow.className = 'sel'
        const selInput = document.createElement('input')
        selInput.value = selector
        selInput.spellcheck = false
        selInput.title = 'A qué elementos se aplica (selector CSS)'
        const count = document.createElement('span')
        count.className = 'count'
        const recount = () => {
            try {
                count.textContent = `${document.querySelectorAll(selInput.value).length} elem.`
            } catch {
                count.textContent = 'selector no válido'
            }
        }
        recount()
        selInput.addEventListener('change', () => {
            selector = selInput.value.trim()
            renderElement()
        })
        selInput.addEventListener('input', recount)
        const parent = document.createElement('button')
        parent.className = 'mini'
        parent.textContent = '↑'
        parent.title = 'Elegir el contenedor'
        parent.addEventListener('click', () => {
            if (picked.parentElement && picked.parentElement !== document.body) select(picked.parentElement)
        })
        selRow.append(selInput, count, parent)
        body.append(selRow)

        const cs = getComputedStyle(picked)
        const mine = data.rules[selector] ?? {}
        for (const [title, props] of PROPS) {
            const det = document.createElement('details')
            det.className = 'group'
            det.open = title === 'Texto' || title === 'Caja'
            det.innerHTML = `<summary>${title}</summary>`
            for (const [prop, kind, options] of props) {
                const value = mine[prop] ?? cs.getPropertyValue(prop).trim()
                const row = document.createElement('div')
                row.className = 'row' + (prop in mine ? ' changed' : '')
                row.innerHTML = `<label title="${prop}">${prop}</label>`
                row.append(control(kind, value, (v) => {
                    setRule(selector, prop, v)
                    row.classList.add('changed')
                    place(pickedBox, picked, selector)
                }, options))
                const reset = document.createElement('button')
                reset.className = 'mini reset'
                reset.title = 'Volver al original'
                reset.textContent = '↺'
                reset.addEventListener('click', () => {
                    setRule(selector, prop, null)
                    renderElement()
                })
                row.append(reset)
                det.append(row)
            }
            body.append(det)
        }
        // anything else
        const free = document.createElement('div')
        free.className = 'free'
        free.innerHTML = '<input placeholder="propiedad (p. ej. outline)" spellcheck="false"><input placeholder="valor" spellcheck="false"><button class="mini" type="button">Añadir</button>'
        const [fp, fv] = free.querySelectorAll('input')
        free.querySelector('button').addEventListener('click', () => {
            if (!fp.value.trim()) return
            setRule(selector, fp.value.trim(), fv.value.trim())
            renderElement()
        })
        body.append(free)
        const extra = Object.keys(mine).filter((p) => !PROPS.some(([, list]) => list.some(([q]) => q === p)))
        for (const p of extra) {
            const row = document.createElement('div')
            row.className = 'row changed'
            row.innerHTML = `<label title="${p}">${p}</label>`
            row.append(control('text', mine[p], (v) => setRule(selector, p, v)))
            const reset = document.createElement('button')
            reset.className = 'mini reset'
            reset.textContent = '↺'
            reset.addEventListener('click', () => {
                setRule(selector, p, null)
                renderElement()
            })
            row.append(reset)
            body.append(row)
        }
    }

    /* ---- everything changed ---- */
    function renderChanges() {
        body.innerHTML = ''
        const actions = document.createElement('div')
        actions.className = 'actions'
        actions.innerHTML = '<button class="main js-copy" type="button">Copiar CSS</button><button class="mini js-dl" type="button">Descargar .css</button><button class="mini js-clear" type="button">Deshacer todo</button>'
        body.append(actions)
        actions.querySelector('.js-copy').addEventListener('click', async (e) => {
            await navigator.clipboard?.writeText(css()).catch(() => {})
            e.target.textContent = 'Copiado'
            setTimeout(() => (e.target.textContent = 'Copiar CSS'), 1400)
        })
        actions.querySelector('.js-dl').addEventListener('click', () => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([css()], { type: 'text/css' }))
            a.download = 'nexos-diseno.css'
            a.click()
            setTimeout(() => URL.revokeObjectURL(a.href), 1000)
        })
        actions.querySelector('.js-clear').addEventListener('click', () => {
            if (!confirm('¿Deshacer todos los cambios de diseño?')) return
            data = { tokens: {}, rules: {} }
            apply()
            renderChanges()
        })
        const items = [
            ...Object.entries(data.tokens).map(([k, v]) => [`${k}: ${v}`, () => setToken(k, null)]),
            ...Object.entries(data.rules).flatMap(([sel, props]) => Object.entries(props).map(([p, v]) => [`${sel} { ${p}: ${v} }`, () => setRule(sel, p, null)])),
        ]
        if (!items.length) {
            body.insertAdjacentHTML('beforeend', '<p class="hint">Todavía no hay cambios.</p>')
            return
        }
        for (const [label, remove] of items) {
            const row = document.createElement('div')
            row.className = 'change'
            row.innerHTML = `<span title="${label.replace(/"/g, '&quot;')}">${label.replace(/</g, '&lt;')}</span>`
            const x = document.createElement('button')
            x.className = 'mini'
            x.textContent = '✕'
            x.title = 'Quitar este cambio'
            x.addEventListener('click', () => {
                remove()
                renderChanges()
            })
            row.append(x)
            body.append(row)
        }
        const pre = document.createElement('pre')
        pre.textContent = css()
        body.append(pre)
    }

    function render() {
        if (tab === 'tokens') renderTokens()
        else if (tab === 'element') renderElement()
        else renderChanges()
    }

    /* ---- picking ---- */
    function place(box, el, label) {
        if (!el?.isConnected) return (box.hidden = true)
        const r = el.getBoundingClientRect()
        box.hidden = false
        Object.assign(box.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` })
        box.querySelector('b').textContent = label
    }
    const fromPage = (e) => e.composedPath().find((n) => n instanceof Element && n !== host && !root.contains(n))
    const onMove = (e) => {
        const el = fromPage(e)
        if (el) place(hoverBox, el, selectorFor(el))
    }
    const block = (e) => {
        if (e.composedPath().includes(host)) return
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
    }
    const onClick = (e) => {
        if (e.composedPath().includes(host)) return
        block(e)
        const el = fromPage(e)
        stopPicking()
        if (el) select(el)
    }
    function select(el) {
        picked = el
        selector = selectorFor(el)
        tab = 'element'
        root.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === 'element')))
        render()
    }
    function startPicking() {
        picking = true
        document.addEventListener('pointermove', onMove, true)
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart']) document.addEventListener(t, block, true)
        document.addEventListener('click', onClick, true)
        document.documentElement.style.cursor = 'crosshair'
        render()
    }
    function stopPicking() {
        if (!picking) return
        picking = false
        document.removeEventListener('pointermove', onMove, true)
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart']) document.removeEventListener(t, block, true)
        // the click that ends picking still has to be caught; let it go a moment later
        setTimeout(() => document.removeEventListener('click', onClick, true), 0)
        document.documentElement.style.cursor = ''
        hoverBox.hidden = true
        if (!panel.hidden) render()
    }
    // the picked element's outline follows it (scrolling, animations, layout changes)
    const follow = () => {
        if (!panel.hidden && picked) place(pickedBox, picked, selector)
        else pickedBox.hidden = true
        requestAnimationFrame(follow)
    }
    requestAnimationFrame(follow)
}
