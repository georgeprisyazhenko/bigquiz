import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUESTIONS_FILE = path.join(__dirname, 'public', 'questions.json')
const VALID_STATUS = ['pending', 'approved', 'rejected']

function sendJson(res, code, obj) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}

// Dev-only плагин: эндпоинт записи отметок ревью из локальной админки
// (admin.html). apply: 'serve' → активен ТОЛЬКО в dev-сервере, в прод-сборку
// не попадает. admin.html намеренно НЕ добавлен в rollupOptions.input.
function adminReviewPlugin() {
  return {
    name: 'bigquiz-admin-review',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__admin/save-question', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
        let body = ''
        req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy() })
        req.on('end', () => {
          try {
            const { id, reviewStatus, reviewNote } = JSON.parse(body || '{}')
            if (!id) throw new Error('id required')
            if (reviewStatus !== undefined && !VALID_STATUS.includes(reviewStatus)) throw new Error(`invalid reviewStatus: ${reviewStatus}`)
            const data = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'))
            const question = data.questions.find((q) => q.id === id)
            if (!question) throw new Error(`question not found: ${id}`)
            if (reviewStatus !== undefined) question.reviewStatus = reviewStatus
            if (reviewNote === undefined || reviewNote === null || reviewNote === '') delete question.reviewNote
            else question.reviewNote = String(reviewNote)
            fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8')
            sendJson(res, 200, { ok: true, id, reviewStatus: question.reviewStatus })
          } catch (err) {
            sendJson(res, 400, { ok: false, error: String(err.message || err) })
          }
        })
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
