import * as THREE from 'three'

/**
 * Windows that light up from inside at night.
 *
 * The house textures paint the window frame and the glass on the same image,
 * so lighting the whole material would turn it into a flat glowing panel and
 * wash out what is painted on the glass (the curtains). Instead only the glass
 * glows: the texels that read as glass (bluish and reasonably bright) give off
 * a warm light in proportion to their own brightness, so the curtains and the
 * reflections painted on them stay visible, and the frames stay dark.
 * Materials without a texture (the painted houses' panes) glow evenly.
 *
 * One shared uniform drives every window, so night falls on all of them at once.
 */

/** Which materials are windows, by the name they carry in each house model. */
export const WINDOW_MATERIAL = /vidrio|glass|^ventana|^negro [1-4]$/i

const glow = { value: new THREE.Color(0, 0, 0) }
const WARM = new THREE.Color('#FFB866')

/** 0 by day, 1 at full night. */
export function setWindowGlow(n) {
    glow.value.copy(WARM).multiplyScalar(1.5 * n)
}

export function makeNightWindow(m) {
    if (!m || m.userData.nightWindow) return
    m.userData.nightWindow = true
    const prev = m.onBeforeCompile
    const prevKey = m.customProgramCacheKey?.bind(m)
    m.onBeforeCompile = (shader, renderer) => {
        prev?.call(m, shader, renderer)
        shader.uniforms.uNightGlow = glow
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 uNightGlow;')
            .replace(
                '#include <emissivemap_fragment>',
                /* glsl */ `#include <emissivemap_fragment>
                #ifdef USE_MAP
                    // the texture arrives in linear light; judge it the way it is seen (≈ sRGB)
                    vec3 nxTex = sqrt( texture2D( map, vMapUv ).rgb );
                    // glass: bluer than it is red, and not a dark frame
                    float nxGlass = smoothstep( 0.05, 0.18, nxTex.b - nxTex.r ) * smoothstep( 0.22, 0.42, nxTex.b );
                    float nxLum = dot( nxTex, vec3( 0.2126, 0.7152, 0.0722 ) );
                    totalEmissiveRadiance += uNightGlow * nxGlass * ( 0.35 + 1.4 * nxLum );
                #else
                    totalEmissiveRadiance += uNightGlow * 0.55;
                #endif`
            )
    }
    m.customProgramCacheKey = () => `${prevKey?.() ?? ''}|nx-night-window`
    m.needsUpdate = true
}
