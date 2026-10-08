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
 *               Houses stand in rows facing their street (see below).
 *  paths        painted ground: [from, to, width, style]
 *  circles      painted round areas: [x, z, r, style]
 *  feature      the place's landmark (built in NeighborhoodScene)
 *  terrain      optional relief. The ground stops being a plane and becomes a
 *               ridge rising toward `crest`, flattened into a terrace around
 *               every house so the barrio still reads as a place to walk:
 *                 height            metres at the crest
 *                 south/crest/north z where it starts, peaks and returns to flat
 *                 sideFade/sideEnd  |x| where the slope fades out sideways
 *                 pad/featurePad    terrace radius for houses and the landmark
 *  acopio       the collection point: where aid is handed over. `yaw` faces it
 *               toward the street and `link` names the street node a visitor
 *               walks in from, exactly like a house door.
 *  open         a clear spot for temporary relief tents (theme cues)
 *  look         per-layout vegetation and street furniture. `trees`/`bushes`
 *               are what grows inside the barrio and stay deliberately sparse,
 *               so the place reads as somewhere to walk; `outer` is the belt of
 *               trees planted around it, which does the work of filling the view.
 */

const deg = (d) => (d * Math.PI) / 180

/*
 * Every barrio has its collection point in the middle of the view, facing the
 * camera (yaw 0), with the streets passing around it rather than through it.
 *
 * Houses stand in rows along the streets, like real blocks: every house faces
 * the street in front of it (yaw 0, or ±90° on side streets), its door about
 * four metres from its centre, at the edge of that street, and neighbours are
 * 8.5–9.5 m apart. Nothing is placed out in the grass on its own.
 */

/* 1 · San Fernando — the collection point stands in the middle of the plaza,
   with a street on each side lined with houses, and a row along the back street */
const plaza = {
    id: 'plaza',
    start: [0, 10],
    nodes: {
        N0: [0, 10], N1: [0, 3.8], PW: [-6, -2.6], PE: [6, -2.6], N3: [0, -9.8], N4: [0, -21.2],
        W1: [-10, 6], W2: [-10, -2.6], W3: [-10, -11], E1: [10, 6], E2: [10, -2.6], E3: [10, -11],
    },
    edges: [
        ['N0', 'N1'], ['N1', 'PW'], ['N1', 'PE'], ['PW', 'N3'], ['PE', 'N3'], ['N3', 'N4'],
        ['PW', 'W2'], ['W2', 'W1'], ['W2', 'W3'], ['PE', 'E2'], ['E2', 'E1'], ['E2', 'E3'],
    ],
    slots: {
        A: { x: -15, z: 6, yaw: deg(90), link: 'W1' },
        B: { x: -15, z: -11, yaw: deg(90), link: 'W3' },
        C: { x: 0, z: -26.5, yaw: 0, link: 'N4' },
        D: { x: 15, z: -11, yaw: deg(-90), link: 'E3' },
        E: { x: 15, z: 6, yaw: deg(-90), link: 'E1' },
        // the rest of the two side streets
        F1: { x: -15, z: -2.5, yaw: deg(90) },
        F2: { x: 15, z: -2.5, yaw: deg(-90) },
        // the row along the back street
        F3: { x: -25.5, z: -26.5, yaw: 0 },
        F4: { x: -17, z: -26.5, yaw: 0 },
        F5: { x: -8.5, z: -26.5, yaw: 0 },
        F6: { x: 8.5, z: -26.5, yaw: 0 },
        F7: { x: 17, z: -26.5, yaw: 0 },
        F8: { x: 25.5, z: -26.5, yaw: 0 },
    },
    paths: [
        [[0, 38], [0, 3.8], 4.4, 'cobble'],
        [[0, 3.8], [-6, -2.6], 3.4, 'cobble'],
        [[0, 3.8], [6, -2.6], 3.4, 'cobble'],
        [[-6, -2.6], [0, -9.8], 3.4, 'cobble'],
        [[6, -2.6], [0, -9.8], 3.4, 'cobble'],
        [[0, -9.8], [0, -21.2], 3, 'cobble'],
        [[-40, -21.2], [40, -21.2], 3.2, 'cobble'],
        [[-10, 12], [-10, -21.2], 3, 'cobble'],
        [[10, 12], [10, -21.2], 3, 'cobble'],
        [[-6, -2.6], [-10, -2.6], 2.6, 'cobble'],
        [[6, -2.6], [10, -2.6], 2.6, 'cobble'],
    ],
    circles: [[0, -3, 6.6, 'cobble']],
    acopio: { x: 0, z: -3, yaw: 0, link: 'N1' },
    terrain: { height: 2.6, south: 24, crest: -26, north: -56, sideFade: 26, sideEnd: 46, pad: 7.6, featurePad: 8.5 },
    // the plaza's centre now holds the collection point, so there is no separate landmark
    feature: { type: 'none', x: 0, z: -3 },
    open: [-24, 4],
    lamps: [[-5.6, -7.6, 1], [5.6, -7.6, -1], [-6.4, -13, 1], [6.4, -13, -1], [-20, -19, 1], [20, -19, -1]],
    look: { grass: '#A9BC8A', trees: 7, bushes: 30, outer: 74, palms: 0, flowers: ['#D0575C', '#F1EEE6', '#E3A3A0', '#E7C76E'] },
}

/* 2 · La Flora — palm avenue with a central promenade, a row of houses on each
   side and one along the street that closes it at the back */
const avenida = {
    id: 'avenida',
    start: [0, 11],
    // the promenade opens into a small square around the collection point; walkers go round it on the pavements
    nodes: {
        S0: [0, 11], S1: [0, 3], S2: [0, -1.5], L1: [-5.5, -3.5], L2: [-5.5, -11], R1: [5.5, -3.5], R2: [5.5, -11],
        S3: [0, -12.6], S4: [0, -16], S5: [0, -21.5],
    },
    edges: [['S0', 'S1'], ['S1', 'S2'], ['S2', 'L1'], ['L1', 'L2'], ['L2', 'S3'], ['S2', 'R1'], ['R1', 'R2'], ['R2', 'S3'], ['S3', 'S4'], ['S4', 'S5']],
    slots: {
        A: { x: -10.5, z: 2.5, yaw: deg(90), link: 'S1' },
        B: { x: 10.5, z: -6, yaw: deg(-90), link: 'R1' },
        C: { x: -10.5, z: -14.5, yaw: deg(90), link: 'L2' },
        D: { x: 10.5, z: -14.5, yaw: deg(-90), link: 'R2' },
        E: { x: 0, z: -29.5, yaw: 0, link: 'S5' },
        F1: { x: -10.5, z: 11, yaw: deg(90) },
        F2: { x: -10.5, z: -6, yaw: deg(90) },
        F3: { x: 10.5, z: 11, yaw: deg(-90) },
        F4: { x: 10.5, z: 2.5, yaw: deg(-90) },
        F5: { x: -17, z: -29.5, yaw: 0 },
        F6: { x: -8.5, z: -29.5, yaw: 0 },
        F7: { x: 8.5, z: -29.5, yaw: 0 },
        F8: { x: 17, z: -29.5, yaw: 0 },
    },
    paths: [
        [[0, 40], [0, -22], 2.8, 'pavers'],
        [[-3.4, 40], [-3.4, -0.6], 2.4, 'road'],
        [[3.4, 40], [3.4, -0.6], 2.4, 'road'],
        [[-3.4, -12.4], [-3.4, -21], 2.4, 'road'],
        [[3.4, -12.4], [3.4, -21], 2.4, 'road'],
        [[-5.5, 40], [-5.5, -24], 1.7, 'pavers'],
        [[5.5, 40], [5.5, -24], 1.7, 'pavers'],
        [[-21, -24], [21, -24], 2.8, 'pavers'],
    ],
    circles: [[0, -22, 3.6, 'pavers'], [0, -6.5, 5.9, 'pavers']],
    acopio: { x: 0, z: -6.5, yaw: 0, link: 'S2' },
    terrain: { height: 1.9, south: 26, crest: -30, north: -56, sideFade: 24, sideEnd: 46, pad: 8, featurePad: 7.5 },
    feature: { type: 'kiosk', x: -18.5, z: -17 },
    open: [19, -19],
    lamps: [[-4.8, 7, 1], [4.8, 1.5, -1], [-6.8, -7, 1], [4.8, -18.5, -1], [-4.8, -19, 1]],
    look: {
        grass: '#A6BB86',
        trees: 4,
        bushes: 18,
        outer: 66,
        // the promenade in front of the collection point is kept clear; palms line the pavements there instead
        palms: [[-6.9, 10.5], [6.9, 11.5], [1.85, -13.5], [-1.85, -18]],
        flowers: ['#E07A8A', '#F1EEE6', '#E7C76E'],
    },
}

/* 3 · San Antonio — hillside barrio. One stone lane, walled like a hill path,
   climbs in bends from the bottom of the slope, round the collection point and up
   to the chapel on the crest. The houses line it on both sides, each a little
   higher than the one below and each facing the lane, with its own short way in;
   their lots are kept small so the slope still shows between them. */
const loma = {
    id: 'loma',
    start: [0, 10],
    terrain: { height: 11, south: 20, crest: -31, north: -54, sideFade: 28, sideEnd: 46, pad: 5.5, featurePad: 9 },
    // the lane bends east around the collection point, which sits on a terrace in the middle of the slope
    nodes: { P0: [0, 10], P1: [-2.5, 4], P2: [-1.2, -2.6], P2b: [5.4, -4.2], P3: [6.4, -9.5], P4: [6, -14.5], P5: [0, -19.5] },
    edges: [['P0', 'P1'], ['P1', 'P2'], ['P2', 'P2b'], ['P2b', 'P3'], ['P3', 'P4'], ['P4', 'P5']],
    slots: {
        // west side of the lane, facing east, stepping up the hill
        A: { x: -10.5, z: 6, yaw: deg(90), link: 'P1' },
        F1: { x: -10.5, z: -2.5, yaw: deg(90) },
        B: { x: -10.5, z: -11, yaw: deg(90), link: 'P2' },
        C: { x: -10.5, z: -19.5, yaw: deg(90), link: 'P5' },
        // east side, facing west
        F2: { x: 12.5, z: 6, yaw: deg(-90) },
        E: { x: 12.5, z: -2.5, yaw: deg(-90), link: 'P2b' },
        D: { x: 12.5, z: -11, yaw: deg(-90), link: 'P3' },
        F3: { x: 12.5, z: -19.5, yaw: deg(-90) },
        // on the crest, either side of the chapel, looking down the hill
        F4: { x: -12, z: -28.5, yaw: 0 },
        F5: { x: 12, z: -28.5, yaw: 0 },
    },
    paths: [
        [[0, 38], [0, 10], 3.6, 'stone'],
        [[0, 10], [-2.5, 4], 3.6, 'stone'],
        [[-2.5, 4], [-1.2, -2.6], 3.6, 'stone'],
        [[-1.2, -2.6], [5.4, -4.2], 3.6, 'stone'],
        [[5.4, -4.2], [6.4, -9.5], 3.6, 'stone'],
        [[6.4, -9.5], [6, -14.5], 3.6, 'stone'],
        [[6, -14.5], [0, -19.5], 3.6, 'stone'],
        [[0, -19.5], [0, -24], 3.6, 'stone'],
    ],
    circles: [[0, -9, 5.2, 'stone']],
    acopio: { x: 0, z: -9, yaw: 0, link: 'P2' },
    feature: { type: 'chapel', x: 0, z: -30.5 },
    open: [21, 13],
    lamps: [[-4.2, 6.5, 1], [1.3, 0.4, -1], [-4.6, -9.5, 1], [8.4, -17, -1]],
    look: { grass: '#9FB683', trees: 10, bushes: 38, outer: 82, palms: 0, flowers: ['#C9488F', '#E07AB0', '#F1EEE6'], walls: true },
}

/* 4 · El Poblado — canal with a footbridge and a sports court: a row of houses
   along the street across the canal, and one on each side of the small square */
const canal = {
    id: 'canal',
    start: [0, 11],
    // the collection point stands on a small square before the bridge; the street splits around it
    nodes: {
        S0: [0, 11], S1: [0, 6.8], SW: [-5.4, 5.4], CW: [-5.4, -3.6], SE: [5.4, 5.4], CE: [5.4, -3.6],
        B0: [0, -3.6], B1: [0, -12.6], NW: [-10, -12.8], NE: [10, -12.8],
    },
    edges: [['S0', 'S1'], ['S1', 'SW'], ['SW', 'CW'], ['CW', 'B0'], ['S1', 'SE'], ['SE', 'CE'], ['CE', 'B0'], ['B0', 'B1'], ['B1', 'NW'], ['B1', 'NE']],
    slots: {
        A: { x: -11, z: 3.5, yaw: deg(90), link: 'SW' },
        B: { x: -8.5, z: -17.4, yaw: 0, link: 'NW' },
        C: { x: 0, z: -17.4, yaw: 0, link: 'B1' },
        D: { x: 8.5, z: -17.4, yaw: 0, link: 'NE' },
        E: { x: 11, z: 3.5, yaw: deg(-90), link: 'SE' },
        F1: { x: -25.5, z: -17.4, yaw: 0 },
        F2: { x: -17, z: -17.4, yaw: 0 },
        F3: { x: 17, z: -17.4, yaw: 0 },
        F4: { x: 25.5, z: -17.4, yaw: 0 },
    },
    paths: [
        [[0, 40], [0, 6.8], 3.6, 'pavers'],
        [[0, 6.8], [-5.4, 5.4], 3.2, 'pavers'],
        [[0, 6.8], [5.4, 5.4], 3.2, 'pavers'],
        [[-5.4, 5.4], [-5.4, -3.6], 3.2, 'pavers'],
        [[5.4, 5.4], [5.4, -3.6], 3.2, 'pavers'],
        [[-50, -3.6], [50, -3.6], 2.4, 'pavers'],
        [[-50, -12.8], [50, -12.8], 2.8, 'pavers'],
    ],
    circles: [[0, 1.2, 5.2, 'pavers']],
    acopio: { x: 0, z: 1.2, yaw: 0, link: 'S1' },
    feature: { type: 'canal', z: -8, width: 4.2, bridgeX: 0 },
    court: { x: 22, z: 2 },
    open: [-18.5, 0.2],
    lamps: [[-6, -11.2, 1], [6, -11.2, -1], [-16, -11.2, 1], [16, -11.2, -1], [-2.6, 10, 1]],
    look: { grass: '#A3B98A', trees: 4, bushes: 20, outer: 68, palms: 3, flowers: ['#E3A3A0', '#F1EEE6', '#E7C76E'] },
}

/* 5 · El Ingenio — a park with a pond in the middle of a square block: streets
   on its four sides, and houses in rows facing it on three of them */
const parque = {
    id: 'parque',
    start: [0, 11],
    nodes: {
        N0: [0, 11], RS: [0, 0.5], RSW: [-8.2, -4.25], RNW: [-8.2, -13.75], RN: [0, -18.5], RNE: [8.2, -13.75], RSE: [8.2, -4.25],
        OW1: [-15, -4.25], OW2: [-15, -13.75], OE1: [15, -4.25], OE2: [15, -13.75], ON: [0, -24],
    },
    edges: [
        ['N0', 'RS'], ['RS', 'RSW'], ['RSW', 'RNW'], ['RNW', 'RN'], ['RN', 'RNE'], ['RNE', 'RSE'], ['RSE', 'RS'],
        ['RSW', 'OW1'], ['RNW', 'OW2'], ['RSE', 'OE1'], ['RNE', 'OE2'], ['RN', 'ON'],
    ],
    slots: {
        A: { x: -20.5, z: -4.25, yaw: deg(90), link: 'OW1' },
        B: { x: -20.5, z: -13.75, yaw: deg(90), link: 'OW2' },
        C: { x: 0, z: -29.5, yaw: 0, link: 'ON' },
        D: { x: 20.5, z: -13.75, yaw: deg(-90), link: 'OE2' },
        E: { x: 20.5, z: -4.25, yaw: deg(-90), link: 'OE1' },
        F1: { x: -20.5, z: 5.25, yaw: deg(90) },
        F2: { x: -20.5, z: -23.25, yaw: deg(90) },
        F3: { x: 20.5, z: 5.25, yaw: deg(-90) },
        F4: { x: 20.5, z: -23.25, yaw: deg(-90) },
        F5: { x: -9, z: -29.5, yaw: 0 },
        F6: { x: 9, z: -29.5, yaw: 0 },
    },
    paths: [
        [[0, 40], [0, 0.5], 3.2, 'gravel'],
        // the block around the park
        [[-15, 8], [15, 8], 2.8, 'gravel'],
        [[-15, 8], [-15, -24], 2.8, 'gravel'],
        [[15, 8], [15, -24], 2.8, 'gravel'],
        [[-15, -24], [15, -24], 2.8, 'gravel'],
        // from the ring out to the block's streets
        [[-8.2, -4.25], [-15, -4.25], 2.2, 'gravel'],
        [[-8.2, -13.75], [-15, -13.75], 2.2, 'gravel'],
        [[8.2, -4.25], [15, -4.25], 2.2, 'gravel'],
        [[8.2, -13.75], [15, -13.75], 2.2, 'gravel'],
        [[0, -18.5], [0, -24], 2.2, 'gravel'],
    ],
    ring: { x: 0, z: -9, r: 9.5, w: 2.8, style: 'gravel' },
    circles: [],
    // the collection point stands in the park, inside the ring; the pond moves behind it
    acopio: { x: 0, z: -7.4, yaw: 0, link: 'RS' },
    terrain: { height: 3.4, south: 26, crest: -32, north: -56, sideFade: 26, sideEnd: 46, pad: 8, featurePad: 12 },
    feature: { type: 'pond', x: 0, z: -14.2, r: 2.2, park: 8.1, parkX: 0, parkZ: -9 },
    open: [-24, 14],
    lamps: [[-3.1, 4, 1], [6.6, 1.4, -1], [-13.8, -9, 1], [13.8, -9, -1], [3, -21, -1]],
    look: { grass: '#A0BA84', trees: 10, bushes: 26, outer: 76, palms: 0, flowers: ['#D0575C', '#F1EEE6', '#B9A3E3', '#E7C76E'], parkTrees: 7 },
    camera: { offset: [0, 17.5, 20], look: [0, 0.4, -11] },
}

export const LAYOUTS = { plaza, avenida, loma, canal, parque }

/** Which layout each zone's barrio uses */
export const LAYOUT_BY_ZONE = { centro: 'plaza', norte: 'avenida', oeste: 'loma', oriente: 'canal', sur: 'parque' }
