/**
 * Model export, receiver (run with `node tools/export-models/receive.mjs`).
 *
 * Listens on http://localhost:5199 for the models sent by /export-models.html
 * and writes them to tools/export-models/out/:
 *   out/<category>/<name>.json   node tree, quad meshes and materials
 *   out/textures/<file>.png      the textures those materials use
 * Only accepts connections from this machine.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_')

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (req.method === 'OPTIONS') return res.end()
    if (req.method !== 'POST' || req.url !== '/model') {
        res.statusCode = 404
        return res.end()
    }
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
        try {
            const model = JSON.parse(body)
            const dir = path.join(OUT, safe(model.category))
            fs.mkdirSync(dir, { recursive: true })
            fs.mkdirSync(path.join(OUT, 'textures'), { recursive: true })
            for (const [file, dataUrl] of Object.entries(model.textures ?? {})) {
                fs.writeFileSync(path.join(OUT, 'textures', safe(file)), Buffer.from(dataUrl.split(',')[1], 'base64'))
            }
            model.textures = Object.keys(model.textures ?? {}).map(safe)
            fs.writeFileSync(path.join(dir, `${safe(model.name)}.json`), JSON.stringify(model))
            console.log(`guardado ${model.category}/${model.name}`)
            res.end('ok')
        } catch (err) {
            console.error(err)
            res.statusCode = 500
            res.end(String(err))
        }
    })
})

server.listen(5199, '127.0.0.1', () => console.log(`Receptor de modelos en http://localhost:5199 → ${OUT}`))
