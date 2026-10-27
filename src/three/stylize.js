import * as THREE from 'three'

/**
 * Stylized shading on top of MeshStandardMaterial (shadows and the rest of the lighting stay intact):
 *  - soft cel bands: sunlight falls on a surface in two or three soft steps
 *    instead of a continuous gradient, the way a painted miniature is lit
 *  - soft height-based occlusion: objects darken gently toward their base → grounded,
 *    "miniature" contact shading without screen-space AO
 *  - warm rim light: a soft halo on silhouettes for a crafted, friendly look
 *  - wind sway for foliage (instanced or not)
 *  - animated water shimmer (stylizeWater)
 * The ink outlines and colour grade are a screen pass in Stage.
 */

/** Shared clock for all stylized shaders (advanced by the Stage). */
export const shaderTime = { value: 0 }

/** How strongly sunlight is banded: 0 = smooth PBR, 1 = full cel. Shared by every stylized material. */
export const toonAmount = { value: 0.8 }

/** The physical lighting chunk with the sun's falloff passed through the band function. */
const BANDED_LIGHTS = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
    'vec3 irradiance = dotNL * directLight.color;',
    'vec3 irradiance = nxBand( dotNL ) * directLight.color;'
)
if (!BANDED_LIGHTS.includes('nxBand')) console.warn('[stylize] three.js lighting chunk changed: cel bands are off')

const COMMON_VERT = /* glsl */ `
uniform float uTime;
uniform float uSway;
varying vec3 vNxWorld;
varying float vNxBaseY;
`
const COMMON_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAo;
uniform float uAoHeight;
uniform float uRim;
uniform vec3 uRimColor;
uniform float uToon;
varying vec3 vNxWorld;
varying float vNxBaseY;
// lit side, mid tone and shade, with soft edges between them (never hard, aliased steps)
float nxBand(float x) {
    float cel = smoothstep(0.0, 0.1, x) * 0.58 + smoothstep(0.38, 0.52, x) * 0.42;
    return mix(x, cel, uToon);
}
`

function patchVertex(src) {
    return src
        .replace('#include <common>', `#include <common>\n${COMMON_VERT}`)
        .replace(
            '#include <begin_vertex>',
            /* glsl */ `#include <begin_vertex>
            vec4 nxBase = vec4(0.0, 0.0, 0.0, 1.0);
            #ifdef USE_INSTANCING
                nxBase = instanceMatrix * nxBase;
            #endif
            nxBase = modelMatrix * nxBase;
            vNxBaseY = nxBase.y;
            if (uSway > 0.0) {
                float h = max(position.y, 0.0);
                float ph = uTime * 1.15 + nxBase.x * 0.37 + nxBase.z * 0.29;
                transformed.x += sin(ph) * uSway * h * h * 0.12;
                transformed.z += cos(ph * 0.83) * uSway * h * h * 0.08;
            }`
        )
        .replace(
            '#include <project_vertex>',
            /* glsl */ `#include <project_vertex>
            vec4 nxW = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                nxW = instanceMatrix * nxW;
            #endif
            vNxWorld = (modelMatrix * nxW).xyz;`
        )
}

/**
 * @param {THREE.MeshStandardMaterial} material
 * @param {{ao?:number, aoHeight?:number, rim?:number, rimColor?:string, sway?:number, roughness?:number}} o
 */
export function stylize(material, { ao = 0.32, aoHeight = 2.4, rim = 0.14, rimColor = '#FFEBD2', sway = 0, roughness } = {}) {
    if (material.userData.nx) return material
    // some exported models arrive glossy; a matte override keeps the sun from glinting off them
    if (roughness !== undefined) material.roughness = roughness
    const u = {
        uTime: shaderTime,
        uAo: { value: ao },
        uAoHeight: { value: aoHeight },
        uRim: { value: rim },
        uRimColor: { value: new THREE.Color(rimColor) },
        uSway: { value: sway },
        uToon: toonAmount,
    }
    material.userData.nx = u
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, u)
        shader.vertexShader = patchVertex(shader.vertexShader)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${COMMON_FRAG}`)
            .replace('#include <lights_physical_pars_fragment>', BANDED_LIGHTS)
            .replace(
                '#include <opaque_fragment>',
                /* glsl */ `
                float nxRel = vNxWorld.y - vNxBaseY;
                float nxAo = mix(1.0 - uAo, 1.0, smoothstep(-0.15, uAoHeight, nxRel));
                outgoingLight *= nxAo;
                float nxFres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
                outgoingLight += uRimColor * nxFres * uRim * (0.55 + 0.45 * saturate(normal.y + 0.5));
                #include <opaque_fragment>`
            )
    }
    material.customProgramCacheKey = () => `nx-stylize-toon-${sway > 0 ? 'sway' : 'still'}`
    material.needsUpdate = true
    return material
}

/**
 * A cartoon river: murky green-brown water, its surface broken into lighter patches that
 * drift downstream, a lacework of faint ripples, and pale foam along both banks. Drawn on a
 * strip whose uv runs along the river in metres (x) and across it from 0 to 1 (y);
 * `width` is the strip's width in metres, so the pattern keeps its size on any river.
 */
export function stylizeRiver(material, { width = 10, speed = 1 } = {}) {
    const u = { uTime: shaderTime, uWidth: { value: width }, uSpeed: { value: speed } }
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, u)
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vRiverUv;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiverUv = uv;')
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                /* glsl */ `#include <common>
                uniform float uTime;
                uniform float uWidth;
                uniform float uSpeed;
                varying vec2 vRiverUv;
                float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float rNoise(vec2 p) {
                    vec2 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), f.x), mix(rHash(i + vec2(0.0, 1.0)), rHash(i + vec2(1.0, 1.0)), f.x), f.y);
                }
                float rFbm(vec2 p) {
                    float v = 0.0, a = 0.5;
                    for (int k = 0; k < 4; k++) { v += a * rNoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
                    return v;
                }
                // distance to the nearest cell centre and to the second nearest (a moving voronoi)
                vec2 rCells(vec2 p, float t) {
                    vec2 i = floor(p), f = fract(p);
                    float d1 = 8.0, d2 = 8.0;
                    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
                        vec2 g = vec2(float(x), float(y));
                        vec2 o = vec2(rHash(i + g), rHash(i + g + 19.3));
                        o = 0.5 + 0.42 * sin(t + 6.2831 * o);
                        float d = length(g + o - f);
                        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
                    }
                    return vec2(d1, d2);
                }`
            )
            .replace(
                '#include <color_fragment>',
                /* glsl */ `#include <color_fragment>
                float t = uTime * uSpeed;
                // metres: along the river, and across it from bank to bank
                vec2 m = vec2(vRiverUv.x, vRiverUv.y * uWidth);
                vec2 flow = m - vec2(t * 1.6, 0.0);
                float patches = rFbm(flow * 0.22);
                float bands = rFbm(flow * vec2(0.08, 0.5) + 3.0);
                vec2 c = rCells(flow * 0.3 + vec2(0.0, patches * 1.5), t * 1.3);
                float ripple = (1.0 - smoothstep(0.0, 0.16, c.y - c.x)) * smoothstep(0.35, 0.7, rFbm(flow * 0.15 + 11.0));
                // a river, not a pool: murky green-brown water, like the Cauca
                vec3 deep = vec3(0.12, 0.19, 0.13);
                vec3 mid = vec3(0.22, 0.29, 0.19);
                vec3 light = vec3(0.34, 0.38, 0.25);
                vec3 col = mix(deep, mid, smoothstep(0.3, 0.62, patches));
                col = mix(col, light, smoothstep(0.58, 0.8, patches) * 0.75);
                col += vec3(0.06, 0.06, 0.04) * (bands - 0.5);
                col = mix(col, vec3(0.55, 0.58, 0.48), ripple * 0.3);
                // white foam along both banks, frayed by the noise
                float edge = min(vRiverUv.y, 1.0 - vRiverUv.y) * uWidth;
                float fray = rFbm(m * vec2(0.5, 1.2) - vec2(t * 0.7, 0.0));
                float foam = 1.0 - smoothstep(0.25, 0.9, edge - fray * 0.9);
                col = mix(col, vec3(0.70, 0.69, 0.58), foam * 0.45);
                diffuseColor.rgb = col;`
            )
            .replace(
                '#include <emissivemap_fragment>',
                /* glsl */ `#include <emissivemap_fragment>
                // water stays bright under the cel shading: part of its colour is its own
                totalEmissiveRadiance += diffuseColor.rgb * 0.08;`
            )
    }
    material.customProgramCacheKey = () => 'nx-river'
    material.needsUpdate = true
    return material
}

/** Calm moving water: soft bands and occasional glints, no foam, no drama. */
export function stylizeWater(material, { scale = 1 } = {}) {
    const u = { uTime: shaderTime, uSway: { value: 0 }, uScale: { value: scale } }
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, u)
        shader.vertexShader = patchVertex(shader.vertexShader)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uScale;\nvarying vec3 vNxWorld;\nvarying float vNxBaseY;`)
            .replace(
                '#include <color_fragment>',
                /* glsl */ `#include <color_fragment>
                vec2 wp = vNxWorld.xz * uScale;
                float b1 = sin(wp.x * 0.9 + uTime * 0.55) * sin(wp.y * 1.25 - uTime * 0.42);
                float b2 = sin((wp.x + wp.y) * 2.3 + uTime * 1.1) * sin((wp.x - wp.y) * 1.7 - uTime * 0.8);
                diffuseColor.rgb *= 0.95 + 0.05 * b1;
                diffuseColor.rgb += vec3(0.11, 0.12, 0.12) * smoothstep(0.72, 0.98, b2);`
            )
    }
    material.customProgramCacheKey = () => 'nx-water'
    material.needsUpdate = true
    return material
}
