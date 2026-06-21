import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPool, saveReview, promoteToProd, deleteDrops, exportRework } from './scripts/lib/review-store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POOL_FILE = path.join(__dirname, 'data', 'review-pool.json')

function sendJson(res, code, obj) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk; if (body.length > 2e6) req.destroy() })
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch (e) { reject(e) } })
  })
}

// Dev-only плагин ревью: эндпоинты локальной админки (admin.html). apply: 'serve' →
// активен ТОЛЬКО в dev-сервере, в прод-сборку не попадает. admin.html намеренно НЕ
// в rollupOptions.input. Источник истины операций — scripts/lib/review-store.mjs.
function adminReviewPlugin() {
  return {
    name: 'bigquiz-admin-review',
    apply: 'serve',
    configureServer(server) {
      // Пул ревью лежит вне public/, отдаём его админке отдельным эндпоинтом.
      server.middlewares.use('/__admin/pool', (req, res) => {
        try {
          const data = fs.existsSync(POOL_FILE) ? loadPool() : { questions: [] }
          sendJson(res, 200, data)
        } catch (err) { sendJson(res, 500, { ok: false, error: String(err.message || err) }) }
      })

      // Сохранение отметок ревью (статус/проблема/предложение/теги) — в прод ИЛИ пул.
      server.middlewares.use('/__admin/save-question', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
        try {
          const { id, reviewStatus, reviewProblem, reviewSuggestion, reviewTags } = await readBody(req)
          sendJson(res, 200, saveReview(id, { reviewStatus, reviewProblem, reviewSuggestion, reviewTags }))
        } catch (err) { sendJson(res, 400, { ok: false, error: String(err.message || err) }) }
      })

      // Батч: перенести все approved из пула в прод (с код-гейтами).
      server.middlewares.use('/__admin/promote', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
        try { sendJson(res, 200, { ok: true, ...promoteToProd() }) }
        catch (err) { sendJson(res, 500, { ok: false, error: String(err.message || err) }) }
      })

      // Батч: удалить все discard из пула.
      server.middlewares.use('/__admin/delete-drops', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
        try { const r = deleteDrops(); sendJson(res, 200, { ok: true, removed: r.removed }) }
        catch (err) { sendJson(res, 500, { ok: false, error: String(err.message || err) }) }
      })

      // Батч: выгрузить rework-вопросы в scripts/polish-in для прогона воркфлоу polish.
      server.middlewares.use('/__admin/export-rework', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
        try { sendJson(res, 200, { ok: true, ...exportRework() }) }
        catch (err) { sendJson(res, 500, { ok: false, error: String(err.message || err) }) }
      })
    }
  }
}

// base: './' — относительные пути к ассетам в сборке. Обязательно для Яндекс Игр:
// игра загружается из zip с index.html в корне (требования 1.7, 1.22).
export default defineConfig({
  base: './',
  plugins: [adminReviewPlugin()]
})
