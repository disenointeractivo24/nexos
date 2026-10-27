/**
 * Asset registry — the single place that maps an asset id to its source.
 *
 * Every asset can be backed by:
 *   - `model`      a GLB/GLTF path inside /static (served from the site root)
 *   - `procedural` a builder id from three/procedural (used when `model` is null
 *                  or when the GLB fails to load)
 *
 * To replace a procedural asset with a real model, drop the GLB into
 * static/assets/<category>/ and set `model` to its path. Nothing else changes.
 *
 * Optional per-asset settings:
 *   front    which local axis the model's façade faces ('-z' rotates it to +z)
 *   fit      { height } or { size } to normalise the model's scale
 *   scale    explicit uniform scale (applied after recentering)
 *   paint    for untextured GLBs: map mesh names → material roles. Painted
 *            models are merged per role so a house costs a handful of draw calls.
 *   drop     a RegExp: meshes whose name or material matches are removed before
 *            the model is measured (stray parts left in the file)
 */

/**
 * Every house is scaled so its front door is 2.1 m tall, the height of a real
 * door next to the 1.6 m guide. The models came at different scales (doors from
 * 1.8 to 2.6 m), which is what made some houses look huge and others like toys.
 * Each `scale` below is 2.1 ÷ the door height measured in that model.
 */
const DOOR = 2.1

/**
 * Every house is a GLB with its Substance textures embedded, made from the
 * model and textures kept in fuentes_3d/<casa>/ with tools/fbx_to_glb.py (see
 * fuentes_3d/LEEME.md). The app only ever loads these finished files.
 */
const stylized = { ao: 0.28, aoHeight: 3.2, rim: 0.1 } // keeps the textures; adds the world's shading

/** How the trees are shaded: the stylized look, and a little wind in the crowns. */
const TREE_LOOK = { ao: 0.35, aoHeight: 2.6, rim: 0.16, sway: 0.04 }

export const ASSETS = {
    /* ---------------- characters ---------------- */
    /*
     * The neighbours, textured in Substance on the guide's own body (tools/exportar_npcs_texturas.py):
     * every young one (adult, teenager, child) has the teenager's hairstyle; the child wears shorts.
     * Two sets of clothes for the young ones, alternated; the app sets each age's size.
     */
    'npc-joven-1': { id: 'npc-joven-1', category: 'characters', label: 'Vecino', model: '/assets/characters/npc-joven-1.glb', procedural: null, scale: 1.6 / 4 },
    'npc-joven-2': { id: 'npc-joven-2', category: 'characters', label: 'Vecino', model: '/assets/characters/npc-joven-2.glb', procedural: null, scale: 1.6 / 4 },
    'npc-nino-1': { id: 'npc-nino-1', category: 'characters', label: 'Niño', model: '/assets/characters/npc-nino-1.glb', procedural: null, scale: 1.6 / 4 },
    'npc-nino-2': { id: 'npc-nino-2', category: 'characters', label: 'Niño', model: '/assets/characters/npc-nino-2.glb', procedural: null, scale: 1.6 / 4 },
    'npc-mayor': { id: 'npc-mayor', category: 'characters', label: 'Vecino mayor', model: '/assets/characters/npc-mayor.glb', procedural: null, scale: 1.6 / 4 },
    guide: {
        id: 'guide',
        category: 'characters',
        label: 'Guía humanitario',
        // The muñequito, a puppet rig exported by tools/exportar_guia.py (fuentes_3d/guia/): rigid
        // pieces hanging from joints named body, head, armL/R and legL/R, which the app turns
        // itself. Clips named like "idle" / "walk", if a later version brings them, are picked up
        // automatically. The stand-in is the fallback.
        model: '/assets/characters/guia.glb',
        procedural: 'guide',
        // the body is 4 units tall in the model: 1.6 m here; the helmet goes on top of that
        scale: 1.6 / 4,
    },

    /* ---------------- houses ---------------- */
    'house-tile': {
        id: 'house-tile',
        category: 'houses',
        label: 'Casa de un piso con teja',
        model: '/assets/houses/casa-teja.glb',
        front: '-z',
        scale: DOOR / 2.36, // "Puerta"
        stylize: stylized,
    },
    'house-two-story': {
        id: 'house-two-story',
        category: 'houses',
        label: 'Casa de dos pisos',
        model: '/assets/houses/casa-dos-pisos.glb',
        front: '-z',
        scale: DOOR / 2.6, // "Puerta 2"
        stylize: stylized,
    },
    'house-zinc': {
        id: 'house-zinc',
        category: 'houses',
        label: 'Casa con techo ondulado',
        model: '/assets/houses/casa-techo-ondulado.glb',
        front: '-z',
        scale: DOOR / 2.16, // "Puerta.001"
        stylize: stylized,
    },
    'house-estrato2': {
        id: 'house-estrato2',
        category: 'houses',
        label: 'Casa de estrato 2',
        model: '/assets/houses/casa-estrato-2.glb',
        // door, porch and planter are on the model's +X side
        front: '+x',
        scale: DOOR / 1.72, // the door leaves in "Madera 3"
        stylize: stylized,
    },
    'house-estrato3': {
        id: 'house-estrato3',
        category: 'houses',
        label: 'Casa de estrato 3',
        model: '/assets/houses/casa-estrato-3.glb',
        // its door and windows are on the model's +X side, unlike the other houses
        front: '+x',
        scale: DOOR / 1.79, // "Madera 2"
        stylize: stylized,
    },
    'house-estrato4': {
        id: 'house-estrato4',
        category: 'houses',
        label: 'Casa de estrato 4 con balcón',
        model: '/assets/houses/casa-estrato-4.glb',
        // door, windows and balcony are on the model's +X side
        front: '+x',
        scale: DOOR / 1.51, // the door frame in "Madera 4"
        stylize: stylized,
    },
    'house-estrato5': {
        id: 'house-estrato5',
        category: 'houses',
        label: 'Casa de estrato 5 con garaje',
        model: '/assets/houses/casa-estrato-5.glb',
        front: '-z',
        scale: DOOR / 1.96, // "Madera 1"
        // the file carries a flat logo plane six metres to the side; without it the house is ~6.4 m wide
        drop: /^SVGMat/,
        stylize: stylized,
    },

    /* ---------------- props (provided GLB) ---------------- */
    obstacle: {
        id: 'obstacle',
        category: 'props',
        label: 'Barrera vial (obstáculo)',
        model: '/assets/props/obstaculo.glb',
        procedural: null,
        front: '+x', // the long side runs along X, like the procedural barrier it replaces
        fit: { size: 2.6 },
        stylize: { ao: 0.25, aoHeight: 0.6, rim: 0.1 },
    },
    'lamp-post': {
        id: 'lamp-post',
        category: 'props',
        label: 'Poste de luz',
        model: '/assets/props/poste-de-luz.glb',
        fit: { height: 3.7 },
        paint: {
            default: 'lampPole',
            rules: [[/^Cube054$/, 'lamp']],
        },
    },

    /*
     * Street props painted in Substance Painter (fuentes_3d/props/, exported with
     * tools/exportar_props.py): already in metres, so no scale. `front` is the side that
     * faces the street; the barrio turns each one toward the nearest path.
     */
    bin: { id: 'bin', category: 'props', label: 'Caneca de basura', model: '/assets/props/basurero.glb', procedural: null, stylize: { ao: 0.2, aoHeight: 0.8, rim: 0.1 } },
    cone: { id: 'cone', category: 'props', label: 'Cono de tránsito', model: '/assets/props/cono.glb', procedural: null, stylize: { ao: 0.15, aoHeight: 0.4, rim: 0.1 } },
    hydrant: { id: 'hydrant', category: 'props', label: 'Hidrante', model: '/assets/props/hidrante.glb', procedural: null, stylize: { ao: 0.2, aoHeight: 0.6, rim: 0.1 } },
    'electric-box': { id: 'electric-box', category: 'props', label: 'Caja eléctrica', model: '/assets/props/caja-electrica.glb', procedural: null, front: '+x', stylize: { ao: 0.2, aoHeight: 0.6, rim: 0.1 } },
    'phone-booth': { id: 'phone-booth', category: 'props', label: 'Teléfono público', model: '/assets/props/telefono.glb', procedural: null, front: '+x', stylize: { ao: 0.2, aoHeight: 0.8, rim: 0.1 } },
    'bus-stop': { id: 'bus-stop', category: 'props', label: 'Parada de bus', model: '/assets/props/parada-bus.glb', procedural: null, front: '+x', stylize: { ao: 0.2, aoHeight: 1.2, rim: 0.1 } },
    'utility-pole': { id: 'utility-pole', category: 'props', label: 'Poste de energía', model: '/assets/props/poste.glb', procedural: null, stylize: { ao: 0.15, aoHeight: 1.5, rim: 0.1 } },

    /*
     * Trees painted in Substance Painter (fuentes_3d/arboles/, exported with
     * tools/fbx_to_glb.py), made 1 m high: each place scales them to the tree it wants. The
     * `-lejos` copies (tools/decimar_glb.py) have half the triangles and small textures,
     * for the city's hillside forest, thousands of trees seen from far away.
     */
    'tree-1': { id: 'tree-1', category: 'trees', label: 'Árbol', model: '/assets/props/arbol-1.glb', procedural: null, fit: { height: 1 }, stylize: TREE_LOOK },
    'tree-1-lejos': { id: 'tree-1-lejos', category: 'trees', label: 'Árbol (lejos)', model: '/assets/props/arbol-1-lejos.glb', procedural: null, fit: { height: 1 }, stylize: TREE_LOOK },
    'tree-2': { id: 'tree-2', category: 'trees', label: 'Árbol', model: '/assets/props/arbol-2.glb', procedural: null, fit: { height: 1 }, stylize: TREE_LOOK },
    'tree-2-lejos': { id: 'tree-2-lejos', category: 'trees', label: 'Árbol (lejos)', model: '/assets/props/arbol-2-lejos.glb', procedural: null, fit: { height: 1 }, stylize: TREE_LOOK },
    'tree-3': { id: 'tree-3', category: 'trees', label: 'Árbol', model: '/assets/props/arbol-3.glb', procedural: null, fit: { height: 1 }, stylize: TREE_LOOK },
    'tree-3-lejos': { id: 'tree-3-lejos', category: 'trees', label: 'Árbol (lejos)', model: '/assets/props/arbol-3-lejos.glb', procedural: null, fit: { height: 1 }, stylize: TREE_LOOK },

    /*
     * Buildings painted in Substance Painter (fuentes_3d/edificios/, exported with
     * tools/exportar_props.py). The landmarks are sized to the city map; the collection
     * point is the stand donors walk to and the one a point works from.
     */
    ermita: { id: 'ermita', category: 'landmarks', label: 'La Ermita', model: '/assets/buildings/ermita.glb', procedural: null, front: '+x', fit: { height: 15.5 }, stylize: { ao: 0.15, aoHeight: 2, rim: 0.1 } },
    'torre-de-cali': { id: 'torre-de-cali', category: 'landmarks', label: 'Torre de Cali', model: '/assets/buildings/torre-de-cali.glb', procedural: null, fit: { height: 42 }, stylize: { ao: 0.15, aoHeight: 4, rim: 0.1 } },
    estadio: { id: 'estadio', category: 'landmarks', label: 'Estadio Pascual Guerrero', model: '/assets/buildings/estadio.glb', procedural: null, fit: { size: 36 }, stylize: { ao: 0.2, aoHeight: 1, rim: 0.1 } },
    // the city's apartment buildings (fuentes_3d/edificios/ciudad), placed where the map puts its towers
    'edificio-1': { id: 'edificio-1', category: 'buildings', label: 'Edificio', model: '/assets/buildings/edificio-1.glb', procedural: null, stylize: { ao: 0.2, aoHeight: 3, rim: 0.1 } },
    'edificio-2': { id: 'edificio-2', category: 'buildings', label: 'Edificio', model: '/assets/buildings/edificio-2.glb', procedural: null, stylize: { ao: 0.2, aoHeight: 3, rim: 0.1 } },
    'edificio-3': { id: 'edificio-3', category: 'buildings', label: 'Edificio', model: '/assets/buildings/edificio-3.glb', procedural: null, stylize: { ao: 0.2, aoHeight: 3, rim: 0.1 } },
    // San Antonio's church on the crest of its barrio (fuentes_3d/iglesia-san-antonio)
    // its entrance and stairs are on the model's +X side; its own grass hill stays out (the barrio
    // has its own crest)
    'iglesia-san-antonio': { id: 'iglesia-san-antonio', category: 'buildings', label: 'Iglesia de San Antonio', model: '/assets/buildings/iglesia-san-antonio.glb', procedural: null, front: '+x', drop: /^cesped/, stylize: { ao: 0.2, aoHeight: 2, rim: 0.1 } },
    'collection-point': { id: 'collection-point', category: 'buildings', label: 'Punto de acopio', model: '/assets/buildings/punto-de-acopio.glb', procedural: null, front: '+x', stylize: { ao: 0.25, aoHeight: 1.6, rim: 0.1 } },

    /* ---------------- supplies (procedural until GLBs arrive) ---------------- */
    rice: { id: 'rice', category: 'supplies', label: 'Arroz', model: null, procedural: 'rice', fit: { size: 1.7 } },
    water: { id: 'water', category: 'supplies', label: 'Agua', model: null, procedural: 'water', fit: { size: 1.75 } },
    cans: { id: 'cans', category: 'supplies', label: 'Alimentos enlatados', model: null, procedural: 'cans', fit: { size: 1.7 } },
    milk: { id: 'milk', category: 'supplies', label: 'Leche', model: null, procedural: 'milk', fit: { size: 1.7 } },
    medicine: { id: 'medicine', category: 'supplies', label: 'Medicinas', model: null, procedural: 'medicine', fit: { size: 1.7 } },
    soap: { id: 'soap', category: 'supplies', label: 'Jabón', model: null, procedural: 'soap', fit: { size: 1.55 } },
    blanket: { id: 'blanket', category: 'supplies', label: 'Cobija', model: null, procedural: 'blanket', fit: { size: 1.7 } },
    'hygiene-kit': { id: 'hygiene-kit', category: 'supplies', label: 'Kit de higiene', model: null, procedural: 'hygieneKit', fit: { size: 1.7 } },
}

/** The trees, in the barrio and on the city's streets (and their `-lejos` copies on the hills). */
export const TREE_MODELS = ['tree-1', 'tree-2', 'tree-3']

export const HOUSE_MODELS = ['house-tile', 'house-two-story', 'house-zinc', 'house-estrato2', 'house-estrato3', 'house-estrato4', 'house-estrato5']

/*
 * The same houses for the map of Cali: lighter copies (tools/casas_mapa.py) of each barrio
 * house, so the city and the barrios share one look. Same façade, same stray parts dropped.
 */
for (const id of HOUSE_MODELS) {
    const def = ASSETS[id]
    ASSETS[`map-${id}`] = { ...def, id: `map-${id}`, model: def.model.replace('/houses/', '/houses/mapa/') }
}

export function getAsset(id) {
    const def = ASSETS[id]
    if (!def) throw new Error(`[assets] Unknown asset id "${id}"`)
    return def
}
