/** When a donor can bring supplies to the point: the next few half-days, written out. */
export function deliveryWindows(now = new Date()) {
    const day = (offset) => {
        const d = new Date(now)
        d.setDate(d.getDate() + offset)
        return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
    }
    const list = []
    if (now.getHours() < 12) list.push({ id: 'hoy-tarde', label: 'Hoy en la tarde', detail: `${day(0)}, de 2:00 a 6:00 p. m.` })
    list.push({ id: 'manana-am', label: 'Mañana en la mañana', detail: `${day(1)}, de 8:00 a. m. a 12:00 m.` })
    list.push({ id: 'manana-pm', label: 'Mañana en la tarde', detail: `${day(1)}, de 2:00 a 6:00 p. m.` })
    list.push({ id: 'pasado-am', label: 'Pasado mañana', detail: `${day(2)}, de 8:00 a. m. a 12:00 m.` })
    return list
}
