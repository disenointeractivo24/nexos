/**
 * Neighborhood layouts — each barrio is a distinct place with the same art
 * direction and the same interaction rules.
 *
 * Coordinates: x west→east, z north→south (the guide starts at the south and the
 * camera looks north). Units ≈ meters; houses are ~6 wide.
 *
 *  start        guide start [x, z]
 *  nodes/edges  walkable street graph (the guide only walks on it)
 *  slots        A–E labelled houses: centre, yaw (façade direction), node it links to,
 *               optional door distance. F* are context houses (no label, not walkable).
 *  paths        painted ground: [from, to, width, style]
 *  circles      painted round areas: [x, z, r, style]
 *  feature      the place's landmark (built in NeighborhoodScene)
 *  open         a clear spot for temporary relief tents (theme cues)
 *  look         per-layout vegetation and street furniture
 */

const deg = (d) => (d * Math.PI) / 180

/* 1 · San Fernando — small plaza ringed by houses */
const plaza = {
    id: 'plaza',
    start: [0, 10],
    nodes: { N0: [0, 10], N1: [0, 3.8], PW: [-3.6, -3.2], PE: [3.6, -3.2], N3: [0, -8.9] },
    edges: [['N0', 'N1'], ['N1', 'PW'], ['N1', 'PE'], ['PW', 'N3'], ['PE', 'N3']],
    slots: {
        A: { x: -9.8, z: 3.6, yaw: 0.78, link: 'N1' },
        B: { x: -11.6, z: -8.6, yaw: 0.46, link: 'PW' },
        C: { x: 0, z: -15.4, yaw: 0, link: 'N3', door: 4.6 },
        D: { x: 11.6, z: -8.6, yaw: -0.46, link: 'PE' },
        E: { x: 9.8, z: 3.6, yaw: -0.78, link: 'N1' },
        F1: { x: -21.5, z: 1, yaw: 0.6 },
        F2: { x: -23.5, z: -14, yaw: 0.4 },
        F3: { x: -12.5, z: -26, yaw: 0.18 },
        F4: { x: 12.5, z: -26.5, yaw: -0.18 },
        F5: { x: 23.5, z: -14.5, yaw: -0.4 },
        F6: { x: 21.5, z: 0.5, yaw: -0.6 },
    },
    paths: [
        [[0, 38], [0, 3.8], 4.4, 'cobble'],
        [[0, 3.8], [-3.6, -3.2], 3.4, 'cobble'],
        [[0, 3.8], [3.6, -3.2], 3.4, 'cobble'],
        [[-3.6, -3.2], [0, -8.9], 3.4, 'cobble'],
        [[3.6, -3.2], [0, -8.9], 3.4, 'cobble'],
        [[-50, -21.2], [50, -21.2], 3.2, 'cobble'],
        [[-2, 12], [-18, 9], 2.6, 'cobble'],
        [[2, 12], [18, 9], 2.6, 'cobble'],
        [[-18, 9], [-28, -21.2], 2.6, 'cobble'],
        [[18, 9], [28, -21.2], 2.6, 'cobble'],
    ],
    circles: [[0, -3, 4.7, 'cobble']],
    feature: { type: 'planter', x: 0, z: -3, r: 4.7 },
    open: [-17, -5],
    lamps: [[-5.6, -7.6, 1], [5.6, -7.6, -1], [-6.4, -13, 1], [6.4, -13, -1], [-20, -19, 1], [20, -19, -1]],
    look: { grass: '#A9BC8A', trees: 18, bushes: 70, palms: 0, flowers: ['#D0575C', '#F1EEE6', '#E3A3A0', '#E7C76E'] },
}

/* 2 · La Flora — palm avenue with a central promenade */
const avenida = {
    id: 'avenida',
    start: [0, 11],
    nodes: { S0: [0, 11], S1: [0, 3], S2: [0, -2], S3: [0, -11], S4: [0, -16], S5: [0, -21.5] },
    edges: [['S0', 'S1'], ['S1', 'S2'], ['S2', 'S3'], ['S3', 'S4'], ['S4', 'S5']],
    slots: {
        A: { x: -9.6, z: 3, yaw: deg(80), link: 'S1' },
        B: { x: 9.6, z: -2, yaw: deg(-80), link: 'S2' },
        C: { x: -9.6, z: -11, yaw: deg(85), link: 'S3' },
        D: { x: 9.6, z: -16, yaw: deg(-85), link: 'S4' },
        E: { x: 0, z: -29.5, yaw: 0, link: 'S5', door: 4.6 },
        F1: { x: -9.6, z: -4, yaw: deg(88) },
        F2: { x: -9.6, z: -18, yaw: deg(90) },
        F3: { x: 9.6, z: 5, yaw: deg(-80) },
        F4: { x: 9.6, z: -9, yaw: deg(-88) },
        F5: { x: -10, z: -28, yaw: deg(30) },
        F6: { x: 10.5, z: -27, yaw: deg(-30) },
    },
    paths: [
        [[0, 40], [0, -22], 2.8, 'pavers'],
        [[-3.4, 40], [-3.4, -21], 2.4, 'road'],
        [[3.4, 40], [3.4, -21], 2.4, 'road'],
        [[-5.5, 40], [-5.5, -23], 1.7, 'pavers'],
        [[5.5, 40], [5.5, -23], 1.7, 'pavers'],
    ],
    circles: [[0, -22, 3.6, 'pavers']],
    feature: { type: 'kiosk', x: 7.2, z: -23.4 },
    open: [-17, -12],
    lamps: [[-4.8, 7, 1], [4.8, 1.5, -1], [-4.8, -6.5, 1], [4.8, -12.5, -1], [-4.8, -19, 1]],
    look: {
        grass: '#A6BB86',
        trees: 12,
        bushes: 40,
        palms: [[-1.85, 9], [1.85, 6.5], [-1.85, 1.5], [1.85, -3.5], [-1.85, -8.5], [1.85, -13.5], [-1.85, -18]],
        flowers: ['#E07A8A', '#F1EEE6', '#E7C76E'],
    },
}

/* 3 · San Antonio — winding hillside lane up to the chapel */
const loma = {
    id: 'loma',
    start: [0, 10],
    nodes: { P0: [0, 10], P1: [-2.5, 4], P2: [-1.2, -3], P3: [2.4, -8.5], P4: [2.4, -14], P5: [0, -19.5] },
    edges: [['P0', 'P1'], ['P1', 'P2'], ['P2', 'P3'], ['P3', 'P4'], ['P4', 'P5']],
    slots: {
        A: { x: -10, z: 3.4, yaw: 1.3, link: 'P1' },
        B: { x: -8.6, z: -6.6, yaw: 1.36, link: 'P2' },
        C: { x: -6.2, z: -16.4, yaw: 1.32, link: 'P4' },
        D: { x: 10.4, z: -11.2, yaw: -1.42, link: 'P3' },
        E: { x: 8, z: 4.9, yaw: -1.3, link: 'P0' },
        F1: { x: -18.5, z: -2, yaw: 1.2 },
        F2: { x: 18, z: -4, yaw: -1.25 },
        F3: { x: -16, z: -22, yaw: 0.9 },
        F4: { x: 16, z: -22, yaw: -0.9 },
        F5: { x: 19.5, z: 9, yaw: -1.3 },
    },
    paths: [
        [[0, 38], [0, 10], 3.4, 'stone'],
        [[0, 10], [-2.5, 4], 3.4, 'stone'],
        [[-2.5, 4], [-1.2, -3], 3.4, 'stone'],
        [[-1.2, -3], [2.4, -8.5], 3.4, 'stone'],
        [[2.4, -8.5], [2.4, -14], 3.4, 'stone'],
        [[2.4, -14], [0, -19.5], 3.4, 'stone'],
        [[0, -19.5], [0, -22], 3.4, 'stone'],
    ],
    circles: [],
    feature: { type: 'chapel', x: 0, z: -30.5 },
    open: [12.5, -1],
    lamps: [[-4.2, 6.5, 1], [1.3, 0, -1], [-2.6, -9, 1], [4.6, -16.5, -1]],
    look: { grass: '#9FB683', trees: 26, bushes: 80, palms: 0, flowers: ['#C9488F', '#E07AB0', '#F1EEE6'], walls: true },
}

/* 4 · El Poblado — canal with a footbridge and a sports court */
const canal = {
    id: 'canal',
    start: [0, 11],
    nodes: { S0: [0, 11], S1: [0, 3], B0: [0, -3.4], B1: [0, -12.6], NW: [-10, -12.8], NE: [10, -12.8] },
    edges: [['S0', 'S1'], ['S1', 'B0'], ['B0', 'B1'], ['B1', 'NW'], ['B1', 'NE']],
    slots: {
        A: { x: -10.5, z: 4.5, yaw: 0.9, link: 'S1' },
        B: { x: -10, z: -17.4, yaw: 0, link: 'NW' },
        C: { x: 0, z: -18.6, yaw: 0, link: 'B1', door: 4.6 },
        D: { x: 10, z: -17.4, yaw: 0, link: 'NE' },
        E: { x: 10.5, z: 4.5, yaw: -0.9, link: 'S1' },
        F1: { x: -20.5, z: -17.4, yaw: 0 },
        F2: { x: 20.5, z: -17.4, yaw: 0 },
        F3: { x: -6, z: -29, yaw: 0 },
        F4: { x: 7, z: -29.5, yaw: 0 },
        F5: { x: -23.5, z: 8.5, yaw: 0.9 },
    },
    paths: [
        [[0, 40], [0, 3], 3.6, 'pavers'],
        [[0, 3], [0, -3.4], 3.2, 'pavers'],
        [[-50, -3.6], [50, -3.6], 2.4, 'pavers'],
        [[-50, -12.8], [50, -12.8], 2.8, 'pavers'],
    ],
    circles: [],
    feature: { type: 'canal', z: -8, width: 4.2, bridgeX: 0 },
    court: { x: 22, z: 2 },
    open: [-18.5, 0.2],
    lamps: [[-6, -11.2, 1], [6, -11.2, -1], [-16, -11.2, 1], [16, -11.2, -1], [-2.4, 7, 1]],
    look: { grass: '#A3B98A', trees: 10, bushes: 46, palms: 6, flowers: ['#E3A3A0', '#F1EEE6', '#E7C76E'] },
}

/* 5 · El Ingenio — houses around a park with a pond */
const parque = {
    id: 'parque',
    start: [0, 11],
    nodes: {
        N0: [0, 11], RS: [0, 0.5], RSW: [-8.2, -4.25], RNW: [-8.2, -13.75], RN: [0, -18.5], RNE: [8.2, -13.75], RSE: [8.2, -4.25],
    },
    edges: [['N0', 'RS'], ['RS', 'RSW'], ['RSW', 'RNW'], ['RNW', 'RN'], ['RN', 'RNE'], ['RNE', 'RSE'], ['RSE', 'RS']],
    slots: {
        A: { x: -16, z: -2.4, yaw: 1.22, link: 'RSW' },
        B: { x: -16, z: -15.6, yaw: 1.82, link: 'RNW' },
        C: { x: 0, z: -27, yaw: 0, link: 'RN', door: 4.6 },
        D: { x: 16, z: -15.6, yaw: -1.82, link: 'RNE' },
        E: { x: 16, z: -2.4, yaw: -1.22, link: 'RSE' },
        F1: { x: -27, z: -9, yaw: deg(90) },
        F2: { x: 27, z: -9, yaw: deg(-90) },
        F3: { x: -12, z: -31, yaw: 0.3 },
        F4: { x: 12.5, z: -31.5, yaw: -0.3 },
    },
    paths: [[[0, 40], [0, 0.5], 3.2, 'gravel']],
    ring: { x: 0, z: -9, r: 9.5, w: 2.8, style: 'gravel' },
    circles: [],
    feature: { type: 'pond', x: 0, z: -9, r: 3.4, park: 8.1 },
    open: [-12, 8],
    lamps: [[-3.1, 4, 1], [6.6, 1.4, -1], [-13.8, -9, 1], [13.8, -9, -1], [3, -21, -1]],
    look: { grass: '#A0BA84', trees: 30, bushes: 60, palms: 0, flowers: ['#D0575C', '#F1EEE6', '#B9A3E3', '#E7C76E'], parkTrees: 9 },
    camera: { offset: [0, 17.5, 20], look: [0, 0.4, -11] },
}

export const LAYOUTS = { plaza, avenida, loma, canal, parque }

/** Which layout each zone's barrio uses */
export const LAYOUT_BY_ZONE = { centro: 'plaza', norte: 'avenida', oeste: 'loma', oriente: 'canal', sur: 'parque' }
