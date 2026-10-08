import * as THREE from 'three'
import { stylize } from './stylize.js'

/** Brand colours (interface) */
export const BRAND = {
    charcoal: '#323232',
    light: '#EDEDED',
    white: '#FFFFFF',
    red: '#F5333F',
    navy: '#011E41',
}

/**
 * Environment colours: slightly muted so the humanitarian interface
 * colours keep visual priority.
 */
export const WORLD = {
    skyTop: '#A9C6DA',
    skyHorizon: '#E9EFF2',
    fog: '#E4EBEE',
    grass: '#A7B98C',
    grassDark: '#8EA676',
    field: '#B7C39A',
    urban: '#E4DDD0',
    mountain: '#6F8E64',
    mountainHigh: '#8AA283',
    river: '#8EB2C0',
    road: '#D9D3C8',
    stone: '#DCCFBC',
    trunk: '#7B6250',
    leaf: ['#7F9E6A', '#8DAA74', '#728F60', '#97B07C', '#6E8B5F'],
}

/** Façade colour schemes for houses — warm, familiar, never saturated. */
export const HOUSE_SCHEMES = {
    cream: { wall: '#EFE5D3', wallAlt: '#D8CBB4', trim: '#FBF8F2', door: '#8A5D3F', roof: '#C27052' },
    white: { wall: '#F3F1EC', wallAlt: '#C9D4D9', trim: '#E6E0D5', door: '#56687A', roof: '#B9664B' },
    ochre: { wall: '#E9CF9B', wallAlt: '#D9B77B', trim: '#F7F2E8', door: '#7A4E33', roof: '#BF6A4B' },
    sage: { wall: '#CFDACB', wallAlt: '#B2C4AE', trim: '#F5F2EB', door: '#6B4A35', roof: '#B86A4F' },
    blush: { wall: '#ECD3C6', wallAlt: '#D9B6A6', trim: '#FAF6F0', door: '#5D6B78', roof: '#C0715A' },
}

const COMMON = {
    base: '#D2C9BA',
    glass: '#566B7D',
    metal: '#3B4552',
    planter: '#B06A4E',
    roofFlat: '#E2DBD0',
    lamp: '#FFF4DA',
    lampPole: '#5D6A72',
}

const THIN_ROLES = new Set(['glass', 'metal', 'door', 'trim', 'planter', 'roofSheet'])

const cache = new Map()

/** Shared, cached standard material — never create duplicates per mesh. */
export function sharedMaterial(key, params) {
    let m = cache.get(key)
    if (!m) {
        m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...params })
        m.name = key // readable in exports and in the inspector
        cache.set(key, m)
    }
    return m
}

export function houseMaterial(role, schemeName = 'cream') {
    const s = HOUSE_SCHEMES[schemeName] ?? HOUSE_SCHEMES.cream
    let color = s[role] ?? COMMON[role]
    if (role === 'roofTile' || role === 'roofSheet') color = s.roof
    if (role === 'roofBase') color = new THREE.Color(s.roof).multiplyScalar(0.78).getStyle()
    color = color ?? s.wall

    const extra = {}
    // Thin parts (panes, grilles, doors, frames) may be single planes: render both sides.
    if (THIN_ROLES.has(role)) extra.side = THREE.DoubleSide
    if (role === 'glass') Object.assign(extra, { roughness: 0.32, metalness: 0.15 })
    if (role === 'metal') Object.assign(extra, { roughness: 0.55, metalness: 0.35 })
    if (role === 'lamp') Object.assign(extra, { emissive: '#FFE3AE', emissiveIntensity: 0.6, roughness: 0.4 })
    if (role === 'roofTile' || role === 'roofSheet') Object.assign(extra, { roughness: 0.78 })
    const m = sharedMaterial(`house:${role}:${color}`, { color, ...extra })
    // Houses get soft base occlusion + a warm rim (see stylize.js)
    const roof = role.startsWith('roof')
    return stylize(m, { ao: roof || role === 'base' ? 0 : 0.28, aoHeight: 3.2, rim: roof ? 0.16 : 0.1 })
}
