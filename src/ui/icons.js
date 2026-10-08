/** Simple line icons (24px grid, currentColor). Always paired with a text label. */

const stroke = (d, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`
const fill = (d) => `<svg viewBox="0 0 24 24" fill="currentColor">${d}</svg>`

export const ICONS = {
    apple: fill('<path d="M15.6 3.2c.2 1.5-.5 2.9-1.6 3.7-1 .8-2.2.9-2.6.8-.2-1.3.5-2.7 1.4-3.5 1-.8 2.3-1.1 2.8-1zM12 8.4c1-.6 2-.9 3.2-.9 2.5 0 4.6 2.1 4.6 5.6 0 4.1-2.7 8.1-5.1 8.1-1.1 0-1.6-.6-2.7-.6s-1.6.6-2.7.6c-2.4 0-5.1-4-5.1-8.1 0-3.5 2.1-5.6 4.6-5.6 1.2 0 2.2.3 3.2.9z"/>'),
    drop: fill('<path d="M12 2.8c.3 0 .6.2.8.4 2 2.7 6.2 8.3 6.2 11.6A7 7 0 0 1 5 14.8c0-3.3 4.2-8.9 6.2-11.6.2-.2.5-.4.8-.4z"/>'),
    cross: fill('<path d="M9.3 3.5h5.4v5.8h5.8v5.4h-5.8v5.8H9.3v-5.8H3.5V9.3h5.8z"/>'),
    soap: stroke('<path d="M7 10h10a2 2 0 0 1 2 2v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-6a2 2 0 0 1 2-2z"/><path d="M10 10V7h4v3"/><path d="M12 7V4h4"/><circle cx="18.5" cy="5" r="1" fill="currentColor"/>'),
    home: stroke('<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.8 9.6V20h12.4V9.6"/><path d="M10 20v-5.2h4V20"/>'),
    map: stroke('<path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
    'chevron-left': stroke('<path d="M15 5l-7 7 7 7"/>'),
    'chevron-right': stroke('<path d="M9 5l7 7-7 7"/>'),
    'chevron-down': stroke('<path d="M5 9l7 7 7-7"/>'),
    x: stroke('<path d="M6 6l12 12M18 6 6 18"/>'),
    check: stroke('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="2.8"'),
    plus: stroke('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.6"'),
    minus: stroke('<path d="M5 12h14"/>', 'stroke-width="2.6"'),
    pin: stroke('<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
    heart: fill('<path d="M12 20.5s-8-4.8-8-11a4.6 4.6 0 0 1 8-3.1 4.6 4.6 0 0 1 8 3.1c0 6.2-8 11-8 11z"/>'),
    shield: stroke('<path d="M12 3 5 6v5.5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>'),
    box: stroke('<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"/>'),
    alert: stroke('<path d="M12 3.5 21 19.5H3z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="16.9" r="0.6" fill="currentColor"/>'),
    urgent: stroke('<path d="M12 6v8"/><circle cx="12" cy="18" r="0.9" fill="currentColor"/>', 'stroke-width="3"'),
    info: stroke('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="0.6" fill="currentColor"/>'),
    target: stroke('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>'),
    basket: stroke('<path d="M4 10h16l-1.6 8.2a2 2 0 0 1-2 1.6H7.6a2 2 0 0 1-2-1.6z"/><path d="M8.5 10 11 4.5M15.5 10 13 4.5"/><path d="M9.5 13.5v3M14.5 13.5v3"/>'),
    lock: stroke('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    card: stroke('<rect x="3" y="6" width="18" height="12.5" rx="2"/><path d="M3 10.5h18M7 15h4"/>'),
    bank: stroke('<path d="M3.5 9.5 12 4.5l8.5 5"/><path d="M5.5 10v7M10 10v7M14 10v7M18.5 10v7M3.5 19.5h17"/>'),
    phone: stroke('<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 17.5h2"/>'),
    calendar: stroke('<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
    sun: stroke('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>'),
    moon: stroke('<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>'),
    cloud: stroke('<path d="M7 18.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 18.5z"/>'),
    'cloud-sun': stroke('<path d="M8.5 7.2A3.5 3.5 0 0 1 14.6 6"/><path d="M8 3v1.3M3.8 7.6h1.3M4.9 4.4l.9.9"/><path d="M8 20h9.5a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.3A3 3 0 0 0 8 20z"/>'),
    storm: stroke('<path d="M7 14.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 14.5z"/><path d="M12.5 15.5 10.5 19h3l-2 3.5"/>'),
    clock: stroke('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    hands: stroke('<path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20z"/><path d="M8.5 12.5h7"/>'),
    quake: stroke('<path d="M2.5 12h4l2-5 3.5 11 2.8-8 1.7 2h5"/>'),
    flame: stroke('<path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 2.6-5 3.6-8.4 2 1.4 2.6 3.2 2.6 4.6 1-1 1.6-2.2 1.6-3.6 2.4 2 4.2 4.6 4.2 7.4 0 3.2-2.4 5.6-6 5.6z"/>'),
    wave: stroke('<path d="M2.5 15.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 3-1.6"/><path d="M2.5 19.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 3-1.6"/><path d="M6 11c0-3.6 3-6.5 7-6.5 2 0 3.6.8 4.5 2-2.6 0-4.5 1.8-4.5 4.5"/>'),
    rain: stroke('<path d="M7 15.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 15.5z"/><path d="M8.5 18.5l-1 2M12.5 18.5l-1 2M16.5 18.5l-1 2"/>'),
    sound: stroke('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.8a7.5 7.5 0 0 1 0 10.4"/>'),
    muted: stroke('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 10l4 4M20 10l-4 4"/>'),
    logout: stroke('<path d="M14 4.5h4.5v15H14"/><path d="M10 8l-4 4 4 4M6 12h9"/>'),
}

export function icon(name) {
    return `<span data-icon="${name}" aria-hidden="true">${ICONS[name] ?? ''}</span>`
}

/** Fill every empty [data-icon] in a subtree. */
export function hydrateIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
        if (!el.firstElementChild) el.innerHTML = ICONS[el.dataset.icon] ?? ''
    })
}
