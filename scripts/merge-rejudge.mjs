// Применяет результат пере-судейства к пулу. Вход: scripts/rejudge-out.json (массив вердиктов,
// возврат воркфлоу re-judge — сохрани его туда). Пишет llmVerdict/llmReason на pending-вопросы
// и комбинирует с детерминированными гейтами (жёсткий код перебивает keep→revise). Статусы
// НЕ меняет — раскладку по drop/revise решает человек. Выдаёт триаж-отчёт.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAnswerText, validateOptionsHomogeneous, validateNumericRanges, validateNumericTell, validateEnumeration } from '../src/content-rules.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const POOL = path.join(ROOT, 'data', 'review-pool.json')
const OUT = path.join(ROOT, 'scripts', 'rejudge-out.json')

if (!fs.existsSync(OUT)) { console.error('нет scripts/rejudge-out.json — сохрани туда возврат воркфлоу re-judge'); process.exit(1) }
const verdicts = JSON.parse(fs.readFileSync(OUT, 'utf8'))
const vById = new Map(verdicts.map((v) => [v.id, v]))

const pool = JSON.parse(fs.readFileSync(POOL, 'utf8'))

function hardGates(q) {
  const h = []
  if ((q.answers || []).some((a) => !validateAnswerText(a).ok)) h.push('длина')
  if (!validateOptionsHomogeneous(q.answers || []).ok) h.push('около-спам')
  if (!validateNumericRanges(q.answers || []).ok) h.push('диапазоны')
  return h
}
function softGates(q) {
  const s = []
  if (!validateNumericTell(q.answers || [], q.correctAnswerIndex).ok) s.push('numeric-tell')
  if ((q.answers || []).some((a) => !validateEnumeration(a).ok)) s.push('запятая→и')
  return s
}

const stat = { keep: 0, revise: 0, drop: 0, forced: 0 }
for (const q of pool.questions) {
  if (q.reviewStatus !== 'pending') continue
  const v = vById.get(q.id)
  if (!v) continue
  let verdict = v.verdict
  let reason = v.reason || ''
  const hard = hardGates(q), soft = softGates(q)
  if (hard.length && verdict === 'keep') { verdict = 'revise'; stat.forced++ }
  if (hard.length) reason += ` [код: ${hard.join(', ')}]`
  if (soft.length) reason += ` [мягко: ${soft.join(', ')}]`
  q.llmVerdict = verdict
  q.llmReason = reason.trim()
  stat[verdict]++
}

fs.writeFileSync(POOL, JSON.stringify(pool, null, 2) + '\n')
console.log(`merge-rejudge: keep=${stat.keep} revise=${stat.revise} drop=${stat.drop} (код добавил ${stat.forced} keep→revise). Статусы не тронуты — раскладывай в admin по llmVerdict.`)
