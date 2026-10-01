/**
 * Emergency contexts ("skins"). One is chosen per session.
 *
 * A theme is never decoration only: it shifts the light and sky slightly, adds
 * small, respectful cues in the world, and changes which needs come first.
 * No damage, no destruction, no fear.
 *
 * To add a theme: add an entry here. Cues are implemented by id in
 * three/ThemeCues.js (city + neighborhood).
 */
export const THEMES = {
    sismo: {
        id: 'sismo',
        label: 'Sismo',
        title: 'Emergencia por sismo',
        icon: 'quake',
        lead: 'Después del sismo, varias familias de Cali necesitan apoyo.',
        mood: {
            skyTop: '#93BEDF', skyHorizon: '#F5E7D3', fog: '#EEE4D6',
            sun: '#FFDDB2', sunIntensity: 3.0, hemiSky: '#E6EFF7', hemiGround: '#D9B98F', hemiIntensity: 1.2,
            wet: 0, haze: 0, rain: 0,
        },
        boost: { refugio: 2, medicinas: 1, agua: 1 },
        cues: { city: ['tents'], barrio: ['inspection', 'reliefTent'] },
    },
    incendio: {
        id: 'incendio',
        label: 'Incendio forestal',
        title: 'Emergencia por incendio forestal',
        icon: 'flame',
        lead: 'Un incendio en los cerros afectó a familias del occidente de Cali.',
        mood: {
            skyTop: '#A6BCCD', skyHorizon: '#F4DEC4', fog: '#EDDCC8',
            sun: '#FFCF9C', sunIntensity: 2.7, hemiSky: '#EFE7DD', hemiGround: '#D5AF85', hemiIntensity: 1.2,
            wet: 0, haze: 0.35, rain: 0,
        },
        boost: { medicinas: 2, agua: 2, higiene: 1 },
        cues: { city: ['smoke'], barrio: ['distantSmoke', 'reliefTent'] },
    },
    tsunami: {
        id: 'tsunami',
        label: 'Tsunami en el Pacífico',
        title: 'Apoyo a familias del Pacífico',
        icon: 'wave',
        lead: 'Familias del Pacífico llegaron a Cali después del tsunami y necesitan apoyo.',
        mood: {
            skyTop: '#8DBADB', skyHorizon: '#EDEEE8', fog: '#E5EBEA',
            sun: '#FFE6C4', sunIntensity: 2.8, hemiSky: '#E5F0F7', hemiGround: '#CDB898', hemiIntensity: 1.28,
            wet: 0.15, haze: 0, rain: 0,
        },
        boost: { refugio: 2, agua: 2, alimentos: 1 },
        cues: { city: ['tents', 'highRiver'], barrio: ['reliefTent', 'waterTanks'] },
    },
    lluvias: {
        id: 'lluvias',
        label: 'Lluvias e inundaciones',
        title: 'Emergencia por lluvias',
        icon: 'rain',
        lead: 'Las lluvias inundaron algunas calles. Estas familias necesitan apoyo.',
        mood: {
            skyTop: '#9DB0C1', skyHorizon: '#DFE4E6', fog: '#D9E0E3',
            sun: '#F6EFE4', sunIntensity: 1.9, hemiSky: '#E0E8EE', hemiGround: '#B8B19C', hemiIntensity: 1.45,
            wet: 1, haze: 0.2, rain: 1,
        },
        boost: { refugio: 1, higiene: 2, agua: 1 },
        cues: { city: ['rain', 'highRiver'], barrio: ['rain', 'puddles', 'sandbags'] },
    },
}

/** Random per session; `?tema=lluvias` (or any theme id) forces one for demos. */
export function pickTheme() {
    const forced = new URLSearchParams(location.search).get('tema')
    if (forced && THEMES[forced]) return THEMES[forced]
    const ids = Object.keys(THEMES)
    return THEMES[ids[Math.floor(Math.random() * ids.length)]]
}
