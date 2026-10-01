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
 */

export const ASSETS = {
    /* ---------------- characters ---------------- */
    guide: {
        id: 'guide',
        category: 'characters',
        label: 'Guía humanitario',
        // Set to '/assets/characters/guide.glb' once the character model is available.
        // Clips named like "idle" / "walk" are picked up automatically.
        model: null,
        procedural: 'guide',
        fit: { height: 1.75 },
    },

    /* ---------------- houses (provided GLBs) ---------------- */
    'house-tile': {
        id: 'house-tile',
        category: 'houses',
        label: 'Casa de un piso con teja',
        model: '/assets/houses/Casa1.glb',
        front: '-z',
        paint: {
            default: 'wall',
            rules: [
                [/^Plane/, 'roofTile'],
                [/^Cube009$/, 'base'],
                [/^Cube011$/, 'roofBase'],
                [/^Cube003$/, 'door'],
                [/^Cube005$/, 'trim'],
                [/^Cube004$/, 'planter'],
                [/^Cube006$/, 'trim'],
                [/^Cube00[78]$/, 'glass'],
                [/^Cube(010)?$/, 'base'],
            ],
        },
    },
    'house-two-story': {
        id: 'house-two-story',
        category: 'houses',
        label: 'Casa de dos pisos',
        model: '/assets/houses/Casa2.glb',
        front: '-z',
        paint: {
            default: 'wall',
            rules: [
                [/^Cube01[27]$|^Cube046$/, 'base'],
                [/^Cube019$|^Cube02[135]$/, 'trim'],
                [/^Cube02[24]$|^Cube015$/, 'glass'],
                [/^Cube027$/, 'roofFlat'],
                [/^Cube013$/, 'wallAlt'],
                [/^Cube01[46]$/, 'metal'],
                [/^Cube018$/, 'door'],
            ],
        },
    },
    'house-zinc': {
        id: 'house-zinc',
        category: 'houses',
        label: 'Casa con techo ondulado',
        model: '/assets/houses/Casa3.glb',
        front: '-z',
        paint: {
            default: 'wall',
            rules: [
                [/zierCurve/, 'roofSheet'],
                [/^Cube029$|^Cube049$/, 'trim'],
                [/^Cube026$|^Cube03[23]$/, 'base'],
                [/^Cube030$/, 'planter'],
                [/^Cube037$/, 'door'],
                [/^Cube03[89]$/, 'metal'],
                [/^Cube04[07]$/, 'glass'],
            ],
        },
    },
    'house-flat': {
        id: 'house-flat',
        category: 'houses',
        label: 'Casa de techo plano',
        model: '/assets/houses/Casa4.glb',
        front: '-z',
        paint: {
            default: 'wall',
            rules: [
                [/^Cube034$/, 'base'],
                [/^Cube036$/, 'roofFlat'],
                [/^Cube041$/, 'metal'],
                [/^Cube04[28]$/, 'glass'],
                [/^Cube043$/, 'door'],
                [/^Cube04[45]$/, 'planter'],
            ],
        },
    },

    /* ---------------- props (provided GLB) ---------------- */
    'lamp-post': {
        id: 'lamp-post',
        category: 'props',
        label: 'Poste de luz',
        model: '/assets/props/PosteDeLuz.glb',
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

export const HOUSE_MODELS = ['house-tile', 'house-two-story', 'house-zinc', 'house-flat']

export function getAsset(id) {
    const def = ASSETS[id]
    if (!def) throw new Error(`[assets] Unknown asset id "${id}"`)
    return def
}
