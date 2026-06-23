// Готовит вход для воркфлоу angle-flip: берёт id из scripts/angleflip-ids.json (массив строк)
// и собирает их данные из пула → scripts/angleflip-in/questions.json.
// Обычно сюда кладут pending-вопросы с llmVerdict=revise по причине «вау не в ответе»
// (factOverLabel=false) — те, что требуют СМЕНЫ УГЛА, а не механической доводки.
// Дальше: Workflow({scriptPath:"scripts/angle-flip.workflow.js"}) → ревью кандидатов в чате.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const POOL = path.join(ROOT, 'data', 'review-pool.json')
const IDS = path.join(ROOT, 'scripts', 'angleflip-ids.json')
const IN = path.join(ROOT, 'scripts', 'angleflip-in')

if (!fs.existsSync(IDS)) { console.error('нет scripts/angleflip-ids.json — положи туда массив id для смены угла'); process.exit(1) }
const ids = JSON.parse(fs.readFileSync(IDS, 'utf8'))
const pool = JSON.parse(fs.readFileSync(POOL, 'utf8')).questions || []
const byId = new Map(pool.map((q) => [q.id, q]))

const data = ids.map((id) => {
  const q = byId.get(id)
  if (!q) { console.warn('пропущен (нет в пуле):', id); return null }
  return { id, question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex, explanation: q.explanation || '', judgeReason: q.llmReason || '' }
}).filter(Boolean)

fs.mkdirSync(IN, { recursive: true })
fs.writeFileSync(path.join(IN, 'questions.json'), JSON.stringify(data, null, 2))
console.log(`prep-angle-flip: ${data.length} вопросов → scripts/angleflip-in/questions.json`)
