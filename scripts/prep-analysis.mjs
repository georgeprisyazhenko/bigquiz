// Готовит вход для анализатора ревью: берёт из журнала data/review-log.jsonl
// записи ПОСЛЕ водяного знака (lastAnalyzed) и кладёт их в scripts/analysis-in/batch.json.
// Анализ — пачкой (а не после каждого точечного действия), чтобы тренды были видны.
//
// Дальше: Workflow({ scriptPath: "scripts/analyze-reviews.workflow.js" }) → merge-analysis.mjs
//
//   node scripts/prep-analysis.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWatermark } from './lib/review-store.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG = path.join(ROOT, 'data', 'review-log.jsonl')
const OUTDIR = path.join(ROOT, 'scripts', 'analysis-in')

// Значимые для обучения действия: было/стало/причина. nochange/revert пропускаем.
const SIGNAL = new Set(['edit', 'discard', 'rework', 'rework-drop'])

if (!fs.existsSync(LOG)) { console.error('Нет журнала data/review-log.jsonl — нечего анализировать.'); process.exit(1) }

const since = readWatermark().lastAnalyzed
const entries = []
let maxTs = since
for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let e
  try { e = JSON.parse(line) } catch { continue }
  if (since && e.ts <= since) continue
  if (!SIGNAL.has(e.action)) continue
  if (!maxTs || e.ts > maxTs) maxTs = e.ts
  entries.push({
    id: e.id,
    action: e.action,
    reason: e.reason || '',
    before: e.before ? { question: e.before.question, answers: e.before.answers, correctAnswerIndex: e.before.correctAnswerIndex, reviewProblem: e.before.reviewProblem || '', reviewTags: e.before.reviewTags || [] } : null,
    after: e.after ? { question: e.after.question, answers: e.after.answers, correctAnswerIndex: e.after.correctAnswerIndex } : null
  })
}

if (!entries.length) {
  console.log('Новых записей в журнале нет (после водяного знака). Анализировать нечего.')
  process.exit(0)
}

fs.rmSync(OUTDIR, { recursive: true, force: true })
fs.mkdirSync(OUTDIR, { recursive: true })
fs.writeFileSync(path.join(OUTDIR, 'batch.json'), JSON.stringify({ since: since || null, until: maxTs, count: entries.length, entries }, null, 2) + '\n')

const byAction = {}
for (const e of entries) byAction[e.action] = (byAction[e.action] || 0) + 1
console.log(`analysis-in: ${entries.length} записей (${Object.entries(byAction).map(([k, v]) => `${k} ${v}`).join(', ')}) → scripts/analysis-in/batch.json`)
console.log(`Окно: ${since || 'начало'} → ${maxTs}`)
console.log('Дальше: Workflow analyze-reviews.workflow.js, затем node scripts/merge-analysis.mjs')
