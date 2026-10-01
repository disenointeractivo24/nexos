/**
 * Collection points (puntos de acopio).
 *
 * PROTOTYPE ONLY: these demo credentials live in the client so the flow can be
 * shown end to end. A real deployment must validate credentials on a server.
 */
export const COLLECTION_POINTS = [
    {
        id: 'acopio-centro',
        code: 'ACOPIO-CENTRO',
        pin: '2024',
        name: 'Punto de acopio Parroquia San Fernando',
        address: 'Carrera 34 # 3-50, junto a la parroquia',
        zone: 'centro',
        hours: 'de 8:00 a. m. a 5:00 p. m.',
    },
    {
        id: 'acopio-norte',
        code: 'ACOPIO-NORTE',
        pin: '2024',
        name: 'Punto de acopio Coliseo La Flora',
        address: 'Calle 52 Norte # 5B-20, entrada principal',
        zone: 'norte',
        hours: 'de 8:00 a. m. a 4:00 p. m.',
    },
    {
        id: 'acopio-oeste',
        code: 'ACOPIO-OESTE',
        pin: '2024',
        name: 'Punto de acopio Salón comunal San Antonio',
        address: 'Carrera 10 # 1-30, frente a la capilla',
        zone: 'oeste',
        hours: 'de 9:00 a. m. a 5:00 p. m.',
    },
    {
        id: 'acopio-oriente',
        code: 'ACOPIO-ORIENTE',
        pin: '2024',
        name: 'Punto de acopio Polideportivo El Poblado',
        address: 'Carrera 28D # 72-10, cancha múltiple',
        zone: 'oriente',
        hours: 'de 7:00 a. m. a 4:00 p. m.',
    },
    {
        id: 'acopio-sur',
        code: 'ACOPIO-SUR',
        pin: '2024',
        name: 'Punto de acopio Parque El Ingenio',
        address: 'Carrera 85 # 15-40, kiosco del parque',
        zone: 'sur',
        hours: 'de 8:00 a. m. a 5:00 p. m.',
    },
]

export const DEMO_LOGIN = { code: 'ACOPIO-CENTRO', pin: '2024' }

export function pointForZone(zoneId) {
    return COLLECTION_POINTS.find((p) => p.zone === zoneId) ?? COLLECTION_POINTS[0]
}

/** Returns the point on success, null otherwise. */
export function validateCredentials(code, pin) {
    const c = String(code ?? '').trim().toUpperCase()
    const p = String(pin ?? '').trim()
    return COLLECTION_POINTS.find((pt) => pt.code === c && pt.pin === p) ?? null
}
