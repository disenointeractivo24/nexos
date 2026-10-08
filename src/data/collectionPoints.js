/**
 * Collection points (puntos de acopio).
 *
 * PROTOTYPE ONLY: these demo credentials live in the client so the flow can be
 * shown end to end. A real deployment must validate credentials on a server.
 *
 * Every point is a real place in its barrio. `lat`/`lon` and the street come
 * from OpenStreetMap (checked by reverse geocoding), so the map shown to donors
 * lands on the actual spot. No street numbers are given where the map has none.
 */
export const COLLECTION_POINTS = [
    {
        id: 'acopio-centro',
        code: 'ACOPIO-CENTRO',
        pin: '2024',
        name: 'Punto de acopio Parque de San Fernando',
        address: 'Calle 4C, Viejo San Fernando, Comuna 19',
        lat: 3.433045,
        lon: -76.544152,
        zone: 'centro',
        hours: 'de 8:00 a. m. a 5:00 p. m.',
    },
    {
        id: 'acopio-norte',
        code: 'ACOPIO-NORTE',
        pin: '2024',
        name: 'Punto de acopio Parque La Flora',
        address: 'Calle 47A Norte, La Flora, Comuna 2',
        lat: 3.484822,
        lon: -76.522905,
        zone: 'norte',
        hours: 'de 8:00 a. m. a 4:00 p. m.',
    },
    {
        id: 'acopio-oeste',
        code: 'ACOPIO-OESTE',
        pin: '2024',
        name: 'Punto de acopio Capilla de San Antonio',
        address: 'Calle 1 Oeste, San Antonio, Comuna 3',
        lat: 3.447505,
        lon: -76.541927,
        zone: 'oeste',
        hours: 'de 9:00 a. m. a 5:00 p. m.',
    },
    {
        id: 'acopio-oriente',
        code: 'ACOPIO-ORIENTE',
        pin: '2024',
        name: 'Punto de acopio Parque Longitudinal El Poblado',
        address: 'Calle 72W, El Poblado II, Comuna 13',
        lat: 3.42016,
        lon: -76.491119,
        zone: 'oriente',
        hours: 'de 7:00 a. m. a 4:00 p. m.',
    },
    {
        id: 'acopio-sur',
        code: 'ACOPIO-SUR',
        pin: '2024',
        name: 'Punto de acopio Parroquia la Virgen Peregrina',
        address: 'Calle 14, El Ingenio, Comuna 17',
        lat: 3.3833118,
        lon: -76.5329216,
        zone: 'sur',
        hours: 'de 8:00 a. m. a 5:00 p. m.',
    },
]

/** Google Maps for a point: an embeddable view (no API key needed) and a directions link. */
export const mapEmbedUrl = (p) => `https://maps.google.com/maps?q=${p.lat},${p.lon}&z=17&hl=es&output=embed`
export const directionsUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`

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
