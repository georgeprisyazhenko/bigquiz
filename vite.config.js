import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUESTIONS_FILE = path.join(__dirname, 'public', 'questions.json')
const GUESTION_FILE = path.join(__dirname, 'public', 'guestion.json')
const GUESTION_REVIEW_FILE = path.join(__dirname, 'public', 'guestion-review.json')
const GUESTION_SEEDS_FILE = path.join(__dirname, 'scripts', 'guestion-seeds.json')
const CLEAN_REVIEW_FILE = path.join(__dirname, 'public', 'guestion-clean-review.json')
const SCORE_LEVELS = ['compactness', 'language', 'distractors', 'factuality', 'angle']
const VALID_STATUS = ['pending', 'approved', 'rejected']

// Прочитать тело POST-запроса как JSON (с защитой от слишком большого тела).
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1e6) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch (e) {
        reject(e)
      }
    })
  })
}

function sendJson(res, code, obj) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}

// Dev-only плагин: эндпоинт записи отметок ревью из локальной админки
// (admin.html). apply: 'serve' → активен ТОЛЬКО в dev-сервере, в прод-сборку
// не попадает. Принимает PATCH одного вопроса по id и переписывает
// public/questions.json. Админка и этот эндпоинт намеренно не уезжают в zip
// Яндекс Игр (admin.html не указан в rollupOptions.input).
function adminReviewPlugin() {
  return {
    name: 'bigquiz-admin-review',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__admin/save-question', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        let body = ''
        req.on('data', (chunk) => {
          body += chunk
          if (body.length > 1e6) req.destroy() // защита от слишком большого тела
        })

        req.on('end', () => {
          try {
            const { id, reviewStatus, reviewNote } = JSON.parse(body || '{}')

            if (!id) throw new Error('id required')
            if (reviewStatus !== undefined && !VALID_STATUS.includes(reviewStatus)) {
              throw new Error(`invalid reviewStatus: ${reviewStatus}`)
            }

            const data = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'))
            const question = data.questions.find((q) => q.id === id)
            if (!question) throw new Error(`question not found: ${id}`)

            if (reviewStatus !== undefined) question.reviewStatus = reviewStatus

            // Заметка: пустая строка/undefined → удаляем поле, чтобы не копить мусор.
            if (reviewNote === undefined || reviewNote === null || reviewNote === '') {
              delete question.reviewNote
            } else {
              question.reviewNote = String(reviewNote)
            }

            fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8')

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, id, reviewStatus: question.reviewStatus }))
          } catch (err) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: String(err.message || err) }))
          }
        })
      })
    }
  }
}

// Dev-only плагин для вкладки guestion в админке. Отметки ревью чужих вопросов
// (guestion.ru) пишутся в ОТДЕЛЬНЫЙ public/guestion-review.json (id -> {status,note}),
// чтобы наш набор public/questions.json и регенерируемый public/guestion.json
// оставались нетронутыми. Плюс эндпоинт экспорта одобренных в шорт-лист затравок.
function guestionReviewPlugin() {
  return {
    name: 'bigquiz-guestion-review',
    apply: 'serve',
    configureServer(server) {
      // Сохранение отметки ок/не ок + заметки по одному guestion-вопросу.
      server.middlewares.use('/__admin/save-guestion', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' })
        try {
          const { id, reviewStatus, reviewNote } = await readJsonBody(req)
          if (!id) throw new Error('id required')
          if (reviewStatus !== undefined && !VALID_STATUS.includes(reviewStatus)) {
            throw new Error(`invalid reviewStatus: ${reviewStatus}`)
          }
          const review = fs.existsSync(GUESTION_REVIEW_FILE) ? JSON.parse(fs.readFileSync(GUESTION_REVIEW_FILE, 'utf8')) : {}
          const entry = review[id] || {}
          if (reviewStatus !== undefined) entry.reviewStatus = reviewStatus
          if (reviewNote === undefined || reviewNote === null || reviewNote === '') delete entry.reviewNote
          else entry.reviewNote = String(reviewNote)
          // Пустую запись (pending без заметки) не храним - чистим мусор.
          if ((!entry.reviewStatus || entry.reviewStatus === 'pending') && !entry.reviewNote) delete review[id]
          else review[id] = entry
          fs.writeFileSync(GUESTION_REVIEW_FILE, JSON.stringify(review, null, 2) + '\n', 'utf8')
          sendJson(res, 200, { ok: true, id, reviewStatus: entry.reviewStatus || 'pending' })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: String(err.message || err) })
        }
      })

      // Экспорт одобренных guestion-вопросов в шорт-лист тем-затравок для нашего
      // пайплайна генерации (scripts/guestion-seeds.json). Тема/факт + категория -
      // дальше прогонять через fill-questions.workflow.js (форма по нашему своду).
      server.middlewares.use('/__admin/export-guestion-seeds', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' })
        try {
          if (!fs.existsSync(GUESTION_FILE)) throw new Error('public/guestion.json not found - run scripts/merge-guestion.mjs')
          const data = JSON.parse(fs.readFileSync(GUESTION_FILE, 'utf8'))
          const review = fs.existsSync(GUESTION_REVIEW_FILE) ? JSON.parse(fs.readFileSync(GUESTION_REVIEW_FILE, 'utf8')) : {}
          const seeds = data.questions
            .filter((q) => (review[q.id] || {}).reviewStatus === 'approved')
            .map((q) => ({
              sourceId: q.id,
              sourceCategory: q.sourceCategory,
              tags: q.tags,
              theme: q.question,
              answers: q.answers,
              correctAnswer: q.correctAnswer,
              angleType: q.angleType,
              seedValue: q.seedValue,
              judgeNote: q.note,
              reviewNote: (review[q.id] || {}).reviewNote || ''
            }))
          const out = { generatedAt: new Date().toISOString(), count: seeds.length, seeds }
          fs.writeFileSync(GUESTION_SEEDS_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8')
          sendJson(res, 200, { ok: true, count: seeds.length, file: 'scripts/guestion-seeds.json' })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: String(err.message || err) })
        }
      })

      // Баллы 1-5 по уровням + заметка для чистовиков (вкладка «Чистовик»).
      // Отдельный файл public/guestion-clean-review.json (id -> {scores, reviewNote}).
      server.middlewares.use('/__admin/save-clean-review', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' })
        try {
          const { id, scores, reviewNote } = await readJsonBody(req)
          if (!id) throw new Error('id required')
          const clean = {}
          if (scores && typeof scores === 'object') {
            for (const lvl of SCORE_LEVELS) {
              const v = scores[lvl]
              if (Number.isInteger(v) && v >= 1 && v <= 5) clean[lvl] = v
            }
          }
          const review = fs.existsSync(CLEAN_REVIEW_FILE) ? JSON.parse(fs.readFileSync(CLEAN_REVIEW_FILE, 'utf8')) : {}
          const entry = {}
          if (Object.keys(clean).length) entry.scores = clean
          if (reviewNote && String(reviewNote).trim()) entry.reviewNote = String(reviewNote)
          if (Object.keys(entry).length) review[id] = entry
          else delete review[id]
          fs.writeFileSync(CLEAN_REVIEW_FILE, JSON.stringify(review, null, 2) + '\n', 'utf8')
          sendJson(res, 200, { ok: true, id })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: String(err.message || err) })
        }
      })
    }
  }
}

// base: './' — относительные пути к ассетам в сборке. Обязательно для Яндекс Игр:
// игра загружается из zip с index.html в корне (требования 1.7, 1.22). Абсолютные
// пути (/assets/...) на их CDN не разрешаются.
//
// admin.html намеренно НЕ добавлен в rollupOptions.input → vite build его
// игнорирует, и админка не попадает в прод-zip.
export default defineConfig({
  base: './',
  plugins: [adminReviewPlugin(), guestionReviewPlugin()]
})
