// Готовит вход для воркфлоу пере-судейства: pending-вопросы пула → scripts/rejudge-in/<subId>.json
// (по одному файлу на подкатегорию). Дальше: Workflow({scriptPath:"scripts/re-judge.workflow.js"})
// → сохранить возврат в scripts/rejudge-out.json → node scripts/merge-rejudge.mjs.
//
// Зачем пере-судейство: судья эволюционирует (см. docs/rules-map.md). Старые pending судились
// прежним промптом и могли пропустить вау-не-в-ответе / слабые дистракторы / миф. Прогон
// обновлённым judgePrompt раскладывает их на keep/revise/drop — человек смотрит только флаги.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const POOL = path.join(ROOT, 'data', 'review-pool.json')
const CATS = path.join(ROOT, 'public', 'categories.json')
const IN = path.join(ROOT, 'scripts', 'rejudge-in')

const pool = JSON.parse(fs.readFileSync(POOL, 'utf8')).questions || []
const cats = JSON.parse(fs.readFileSync(CATS, 'utf8'))
const subName = new Map(), topName = new Map()
for (const top of cats.categories || []) {
  subName.set(top.id, top.name); topName.set(top.id, top.name)
  for (const sub of top.subcategories || []) { subName.set(sub.id, sub.name); topName.set(sub.id, top.name) }
}

const pending = pool.filter((q) => q.reviewStatus === 'pending')
const groups = new Map()
for (const q of pending) {
  const sid = (q.categories && q.categories[0]) || 'unknown'
  if (!groups.has(sid)) groups.set(sid, [])
  groups.get(sid).push({ id: q.id, question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex, explanation: q.explanation || '' })
}

if (fs.existsSync(IN)) fs.rmSync(IN, { recursive: true })
fs.mkdirSync(IN, { recursive: true })
let files = 0
for (const [sid, questions] of groups) {
  fs.writeFileSync(path.join(IN, `${sid}.json`), JSON.stringify({ subId: sid, subName: subName.get(sid) || sid, cat: topName.get(sid) || sid, questions }, null, 2))
  files++
}
console.log(`prep-rejudge: ${pending.length} pending → ${files} файлов в scripts/rejudge-in/`)
