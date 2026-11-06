/**
 * How someone feels about the wait, from what is left of it (1 full, 0 gone): the same reading
 * as the colour of their bar. Green is fine, amber is losing patience, red is angry.
 */
export function moodFor(left) {
    if (left >= 0.82) return 'happy'
    if (left >= 0.65) return 'smile'
    if (left >= 0.5) return 'flat'
    if (left >= 0.35) return 'worried'
    return 'angry'
}

/** From 0, while the wait is bearable, to 1 when it runs out: it keeps growing all through the red. */
export const angerFor = (left) => Math.min(1, Math.max(0, (0.5 - left) / 0.5))

/** Below this they say so: the bar has just turned red. */
export const COMPLAINS_BELOW = 0.35

const IN_LINE = ['¿Cuánto más hay que esperar?', '¡Llevamos mucho rato aquí!', '¡Esta fila no avanza!', '¡Nos atienden o qué!']
const AT_COUNTER = ['¿Y nuestro pedido?', '¡Apúrese, por favor!', '¡Llevamos mucho rato aquí!']
const URGENT = ['¡Hay pacientes esperando!', '¡Esto es urgente!', '¡No podemos esperar más!']
const LAST_STRAW = ['¡Si no nos atienden, nos vamos!', '¡Ya no aguantamos más!']

/** What they say: the nearer to leaving, the plainer. `turn` makes it a different thing each time. */
export function complaintFor(order, left, turn) {
    const lines = order.urgent ? URGENT : left < 0.15 ? LAST_STRAW : order.state === 'packing' ? AT_COUNTER : IN_LINE
    return lines[turn % lines.length]
}
