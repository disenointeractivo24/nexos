// Receives the opening act's frames from the dev page (see apertura.js) and writes them to a
// folder. It also serves apertura.js itself, so the page can fetch and run it.
//   node tools/apertura/recibir.mjs <frames folder>
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const here = path.dirname(fileURLToPath(import.meta.url))

http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    if (req.method === 'OPTIONS') return res.end()
    if (req.method === 'GET' && req.url === '/apertura.js') {
        res.setHeader('Content-Type', 'text/javascript')
        return res.end(fs.readFileSync(path.join(here, 'apertura.js')))
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
        const m = req.url.match(/^\/frame\/([\w.-]+\.png)$/)
        if (m) {
            // the page sends a data URL (base64 PNG)
            const body = Buffer.concat(chunks).toString()
            fs.writeFileSync(path.join(out, m[1]), Buffer.from(body.slice(body.indexOf(',') + 1), 'base64'))
        }
        res.end('ok')
        if (req.url === '/done') {
            console.log('listo:', fs.readdirSync(out).length, 'cuadros')
            setTimeout(() => process.exit(0), 100)
        }
    })
}).listen(5199, '127.0.0.1', () => console.log('esperando cuadros en http://127.0.0.1:5199'))
