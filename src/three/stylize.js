import * as THREE from 'three'

/**
 * Stylized shading on top of MeshStandardMaterial (lighting and shadows stay intact):
 *  - soft height-based occlusion: objects darken gently toward their base → grounded,
 *    "miniature" contact shading without screen-space AO
 *  - warm rim light: a soft halo on silhouettes for a crafted, friendly look
 *  - wind sway for foliage (instanced or not)
 *  - animated water shimmer (stylizeWater)
 */

/** Shared clock for all stylized shaders (advanced by the Stage). */
export const shaderTime = { value: 0 }

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
varying vec3 vNxWorld;
varying float vNxBaseY;
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
 * @param {{ao?:number, aoHeight?:number, rim?:number, rimColor?:string, sway?:number}} o
 */
export function stylize(material, { ao = 0.32, aoHeight = 2.4, rim = 0.14, rimColor = '#FFEBD2', sway = 0 } = {}) {
    if (material.userData.nx) return material
    const u = {
        uTime: shaderTime,
        uAo: { value: ao },
        uAoHeight: { value: aoHeight },
        uRim: { value: rim },
        uRimColor: { value: new THREE.Color(rimColor) },
        uSway: { value: sway },
    }
    material.userData.nx = u
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, u)
        shader.vertexShader = patchVertex(shader.vertexShader)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${COMMON_FRAG}`)
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
    material.customProgramCacheKey = () => `nx-stylize-${sway > 0 ? 'sway' : 'still'}`
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
