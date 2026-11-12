import { createReadStream, cpSync, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { iwsdkDev } from '@iwsdk/vite-plugin-dev'
import { defineConfig } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const STATIC = resolve(here, '../static')

/** What this experience takes from NEXOS's own static folder: no copies in the repository. */
const SHARED = ['assets/characters', 'assets/buildings/punto-de-acopio.glb', 'draco']
const MIME = { '.glb': 'model/gltf-binary', '.js': 'text/javascript', '.wasm': 'application/wasm' }

function sharedAssets(command) {
    return {
        name: 'nexos-shared-assets',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const path = decodeURIComponent((req.url ?? '').split('?')[0])
                if (!/^\/(assets|draco)\//.test(path)) return next()
                const file = normalize(join(STATIC, path))
                if (!file.startsWith(STATIC) || !existsSync(file) || !statSync(file).isFile()) return next()
                res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
                createReadStream(file).pipe(res)
            })
        },
        closeBundle() {
            if (command !== 'build') return
            for (const rel of SHARED) cpSync(join(STATIC, rel), join(here, 'dist', rel), { recursive: true })
        },
    }
}

export default defineConfig(({ mode, command }) => ({
    // options here rather than in iwsdk.config.json: that file also turns on IWSDK's managed
    // editor, which we do not use and which fails to start on some Windows machines
    // `--mode http` is for trying it on this computer only: a headset needs the HTTPS default
    // a living room has nothing like the run of desks this is used on: the open office does
    plugins: [iwsdkDev({ https: mode !== 'http', emulator: { device: 'metaQuest3', environment: 'open_office' } }), sharedAssets(command)],
    envDir: '..', // the sheet's address lives in the web experience's .env
    server: { host: '0.0.0.0', port: 8081, open: false, fs: { allow: ['..'] } },
    build: {
        outDir: 'dist',
        sourcemap: false,
        target: 'esnext',
        rollupOptions: { input: './index.html' },
    },
    esbuild: { target: 'esnext' },
    // The modules shared with the web experience (../src) must use this project's three
    // (IWSDK needs super-three 0.185), or there would be two copies of it in the page.
    resolve: {
        dedupe: ['three', 'gsap', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'],
    },
    optimizeDeps: {
        exclude: ['@babylonjs/havok'],
        include: ['three', 'gsap', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide', '@drawcall/uikitml'],
        esbuildOptions: { target: 'esnext' },
    },
    publicDir: 'public',
    base: './',
}))
