// Применяет полный-лайт ре-ремонт (scripts/rerepair-out/*.json) к guestion-clean.json.
// Переносит существующие фактовые вердикты (веб не гоняли). Правило #5: factSuspect ИЛИ
// существующий вердикт 'unverifiable' → drop-fact (непроверенное отклоняем). Код-гейты.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, validateAnswerText } from '../src/content-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'scripts', 'rerepair-out')
const CLEAN = join(ROOT, 'public', 'guestion-clean.json')
if (!existsSync(DIR)) { console.error('Нет scripts/rerepair-out - сначала прогони воркфлоу.'); process.exit(1) }

const byId = new Map()
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  for (const it of JSON.parse(readFileSync(join(DIR, f), 'utf8')).items || []) byId.set(it.id, it)
}

const d = JSON.parse(readFileSync(CLEAN, 'utf8'))
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
writeFileSync(join(ROOT, 'public', `guestion-clean.backup-${ts}.json`), JSON.stringify(d, null, 2) + '\n')

const stat = { changed: 0, suspect: 0, unverif: 0, weak: 0, form: 0 }
for (const q of d.questions) {
  if (q.disposition !== 'clean') continue // ре-ремонт шёл только по clean
  const r = byId.get(q.id)
  if (!r) continue
  if ((r.changed || '') !== 'без изменений') stat.changed++
  q.question = stripDashes(r.question)
  q.answers = r.answers.map(stripDashes)
  q.correctAnswerIndex = r.correctAnswerIndex
  q.correctAnswer = q.answers[q.correctAnswerIndex]
  q.angle = { ...(q.angle || {}), score: r.newAngle }
  q.changed = r.changed
  if (r.proofNote) q.proofNote = r.proofNote
  // форма
  const issues = q.answers.map((a, i) => (validateAnswerText(a).ok ? null : `answer[${i}] "${a}"`)).filter(Boolean)
  if (issues.length) { q.formIssues = issues; stat.form++ } else delete q.formIssues
  // судьба: непроверенное/апокриф → дроп; слабый угол → дроп
  const v = q.fact ? q.fact.factVerdict : null
  if (r.factSuspect) { q.disposition = 'drop-fact'; if (!q.fact) q.fact = { factVerdict: 'myth', explanation: 'Помечен ре-ремонтом как апокриф/мисатрибуция (без веб-проверки).' }; stat.suspect++ }
  else if (v === 'unverifiable') { q.disposition = 'drop-fact'; stat.unverif++ }
  else if (r.newAngle <= 2) { q.disposition = 'drop-weak-angle'; stat.weak++ }
}

d.clean = d.questions.filter((q) => q.disposition === 'clean').length
d.dropped = d.questions.filter((q) => q.disposition !== 'clean').length
d.generatedAt = new Date().toISOString()
writeFileSync(CLEAN, JSON.stringify(d, null, 2) + '\n', 'utf8')
console.log(`Ре-ремонт применён. Изменено: ${stat.changed} · factSuspect→дроп ${stat.suspect} · unverifiable→дроп ${stat.unverif} · угол≤2→дроп ${stat.weak} · с formIssues ${stat.form}`)
console.log(`Итог: clean ${d.clean} / dropped ${d.dropped}  (бэкап guestion-clean.backup-${ts}.json)`)
