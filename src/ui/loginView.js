import { COLLECTION_POINTS } from '../data/collectionPoints.js'
import { ZONES } from '../data/zones.js'

/**
 * The collection point sign-in, shared by both versions: the fields, a button to see the
 * key while typing it, and (this is a prototype) the five points as buttons in their
 * zone's colour that fill in the code, with the test key beside them.
 */
export function loginFields(codeAttrs = '') {
    return `
        <label class="field">
            <span class="field-label">Código del punto</span>
            <input name="code" type="text" placeholder="ACOPIO-…" autocomplete="username" autocapitalize="characters" spellcheck="false" required ${codeAttrs}>
        </label>
        <label class="field">
            <span class="field-label">Clave</span>
            <span class="lg-pin-row">
                <input name="pin" type="password" placeholder="4 números" autocomplete="current-password" inputmode="numeric" required>
                <button class="lg-pin-toggle js-pin-toggle" type="button" aria-pressed="false" aria-label="Mostrar la clave">Ver</button>
            </span>
        </label>`
}

export function pointPicker() {
    return `
        <div class="lg-pick">
            <span class="lg-pick-label">Prototipo: toca tu punto para llenar el código</span>
            <div class="lg-pick-list">
                ${COLLECTION_POINTS.map((p) => {
                    const z = ZONES.find((zz) => zz.id === p.zone)
                    return `<button class="lg-point js-pick" type="button" data-code="${p.code}" aria-pressed="false" style="--zone:${z?.color ?? '#011E41'}"><i aria-hidden="true"></i>${z?.name.replace('Zona ', '') ?? p.code}</button>`
                }).join('')}
            </div>
            <small>La clave de prueba es <b>2024</b>.</small>
        </div>`
}

export function bindLogin(form) {
    const pin = form.querySelector('[name="pin"]')
    form.querySelectorAll('.js-pick').forEach((b) =>
        b.addEventListener('click', () => {
            form.querySelector('[name="code"]').value = b.dataset.code
            form.querySelectorAll('.js-pick').forEach((o) => o.setAttribute('aria-pressed', String(o === b)))
            pin.focus()
        })
    )
    const toggle = form.querySelector('.js-pin-toggle')
    toggle?.addEventListener('click', () => {
        const show = pin.type === 'password'
        pin.type = show ? 'text' : 'password'
        toggle.textContent = show ? 'Ocultar' : 'Ver'
        toggle.setAttribute('aria-pressed', String(show))
        toggle.setAttribute('aria-label', show ? 'Ocultar la clave' : 'Mostrar la clave')
        pin.focus()
    })
}

/** Back to how it opens: key hidden, no point picked. */
export function resetLogin(form) {
    const pin = form.querySelector('[name="pin"]')
    pin.type = 'password'
    const toggle = form.querySelector('.js-pin-toggle')
    if (toggle) {
        toggle.textContent = 'Ver'
        toggle.setAttribute('aria-pressed', 'false')
        toggle.setAttribute('aria-label', 'Mostrar la clave')
    }
    form.querySelectorAll('.js-pick').forEach((o) => o.setAttribute('aria-pressed', 'false'))
}
