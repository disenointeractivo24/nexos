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

export const ASSETS = {
    /* ---------------- characters ---------------- */
    guide: {
        id: 'guide',
        category: 'characters',
        label: 'Guía humanitario',
        // The muñequito, rigged by tools/rig_guia.py (fuentes_3d/guia/): bones named body, head,
        // armL/R and legL/R, which the app moves itself. Clips named like "idle" / "walk", if a
        // later version brings them, are picked up automatically. The stand-in is the fallback.
        model: '/assets/characters/guia.glb',
        procedural: 'guide',
        fit: { height: 1.6 },
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

export const HOUSE_MODELS = ['house-tile', 'house-two-story', 'house-zinc', 'house-estrato2', 'house-estrato3', 'house-estrato4', 'house-estrato5']

export function getAsset(id) {
    const def = ASSETS[id]
    if (!def) throw new Error(`[assets] Unknown asset id "${id}"`)
    return def
}
