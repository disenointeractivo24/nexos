import { icon } from './icons.js'

/**
 * The collection point's three jobs. The board opens on them, one big button each, so a
 * volunteer sees at once what can be done here instead of hunting through tabs.
 */
export const POINT_OPTIONS = [
    { id: 'stock', icon: 'basket', title: 'Gestionar inventario', text: 'Cuenta lo que hay en el punto' },
    { id: 'receive', icon: 'qr', title: 'Recibir donaciones', text: 'Escanea el QR del donante o recibe un traslado' },
    { id: 'send', icon: 'truck', title: 'Enviar a otros puntos', text: 'Manda lo que te sobra a quien le falta' },
]

/** The three options as stacked buttons; each carries `data-tab` with the view it opens. */
export function pointMenu() {
    return `
        <nav class="point-menu" aria-label="¿Qué quieres hacer en el punto?">
            ${POINT_OPTIONS.map(
                (o) => `
            <button class="point-option js-option" type="button" data-tab="${o.id}">
                <span class="point-option-icon" aria-hidden="true">${icon(o.icon)}</span>
                <span class="point-option-text"><b>${o.title}</b><small>${o.text}</small></span>
                ${o.id === 'receive' ? '<span class="tab-badge js-receive-badge" hidden></span>' : ''}
                <span class="point-option-go" aria-hidden="true">${icon('chevron-right')}</span>
            </button>`
            ).join('')}
        </nav>`
}

/** What each view is called in the header: [short, rest], the rest dropped on phones. */
export const POINT_TITLES = {
    home: ['Punto de acopio', ''],
    stock: ['Inventario', ' del punto'],
    receive: ['Recibir', ' donaciones'],
    send: ['Enviar', ' a otros puntos'],
}
