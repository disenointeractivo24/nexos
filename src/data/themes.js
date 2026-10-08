/**
 * Emergency contexts ("skins"). One is chosen per session.
 *
 * A theme is never decoration only: it shifts the light and sky slightly, adds
 * small, respectful cues in the world, and changes which needs come first.
 * No damage, no destruction, no fear.
 *
 * `skin` carries the context down into the neighborhood itself, so a barrio
 * does not look the same in every emergency:
 *   grass / grassMix   how far the barrio's own grass shifts toward the context
 *   leaf               canopy colours for that context (null keeps the default)
 *   paint              an extra ground pass, drawn by id in NeighborhoodScene
 *   damp               extra wetness on the ground material (0–1)
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
        skin: {
            grass: '#B5AF84', grassMix: 0.55, leaf: ['#8DA074', '#9AAB7E', '#84976C', '#A3B188', '#7E9268'], paint: 'dust', damp: 0,
        },
        cues: { city: ['tents'], barrio: ['inspection', 'reliefTent', 'cones', 'meetingPoint'] },
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
        skin: {
            grass: '#BCAE79', grassMix: 0.68, leaf: ['#9A9A62', '#A8A06A', '#8E8F5C', '#B3A571', '#8A8A5A'], paint: 'ash', damp: 0,
        },
        cues: { city: ['smoke'], barrio: ['distantSmoke', 'reliefTent', 'waterPoint', 'ashFall'] },
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
        skin: {
            grass: '#88A371', grassMix: 0.55, leaf: ['#6F8E5C', '#7B9866', '#657F54', '#86A06E', '#5F7A50'], paint: 'wet', damp: 0.55,
        },
        cues: { city: ['rain', 'highRiver'], barrio: ['rain', 'puddles', 'sandbags', 'clothesLine', 'reliefTent'] },
    },
}

/** How often each theme comes up: an earthquake is the most likely emergency for Cali. */
const WEIGHTS = { sismo: 2, incendio: 1, lluvias: 1 }

/** Weighted random per session; `?tema=lluvias` (or any theme id) forces one for demos. */
export function pickTheme() {
    const forced = new URLSearchParams(location.search).get('tema')
    if (forced && THEMES[forced]) return THEMES[forced]
    const ids = Object.keys(THEMES)
    const total = ids.reduce((s, id) => s + (WEIGHTS[id] ?? 1), 0)
    let r = Math.random() * total
    for (const id of ids) {
        r -= WEIGHTS[id] ?? 1
        if (r < 0) return THEMES[id]
    }
    return THEMES.sismo
}
