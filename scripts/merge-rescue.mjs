// Применяет результат rescue-fix (scripts/rescue-out/*.json) к public/guestion-clean.json:
// новый угол; спасение weak-angle при newAngle>2; применение укороченных ответов +
// пере-проверка длины (снимаем formIssues, если починено). Код-гейт тире - на месте.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, validateAnswerText } from '../src/content-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'scripts', 'rescue-out')
const CLEAN = join(ROOT, 'public', 'guestion-clean.json')
if (!existsSync(DIR)) { console.error('Нет scripts/rescue-out - сначала прогони воркфлоу.'); process.exit(1) }

const byId = new Map()
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  for (const it of JSON.parse(readFileSync(join(DIR, f), 'utf8')).items || []) byId.set(it.id, it)
}

const d = JSON.parse(readFileSync(CLEAN, 'utf8'))
const stat = { rescued: 0, stillWeak: 0, formFixed: 0, formStill: 0 }
for (const q of d.questions) {
  const r = byId.get(q.id)
  if (!r) continue
  const wasWeak = q.disposition === 'drop-weak-angle'
  // угол
  q.angle = { ...(q.angle || {}), score: r.newAngle, note: r.angleNote || (q.angle && q.angle.note) || '' }
  // текст/ответы (минимальный диф; код-гейт тире)
  if (Array.isArray(r.answers) && r.answers.length === 4) {
    q.answers = r.answers.map(stripDashes)
    q.correctAnswerIndex = r.correctAnswerIndex
    q.correctAnswer = q.answers[q.correctAnswerIndex]
  }
  if (r.question) q.question = stripDashes(r.question)
  // пере-проверка длины
  const issues = q.answers.map((a, i) => (validateAnswerText(a).ok ? null : `answer[${i}] "${a}": ${validateAnswerText(a).reasons.join(', ')}`)).filter(Boolean)
  if (issues.length) { q.formIssues = issues; if (q.disposition === 'clean') stat.formStill++ }
  else { if (q.formIssues) stat.formFixed++; delete q.formIssues }
  // судьба weak-angle
  if (wasWeak) {
    if (r.newAngle > 2) { q.disposition = 'clean'; stat.rescued++ } else stat.stillWeak++
  }
}

d.clean = d.questions.filter((q) => q.disposition === 'clean').length
d.dropped = d.questions.filter((q) => q.disposition !== 'clean').length
d.generatedAt = new Date().toISOString()
writeFileSync(CLEAN, JSON.stringify(d, null, 2) + '\n', 'utf8')
console.log(`Слой 2 применён. Спасено weak-angle: ${stat.rescued} (осталось слабых ${stat.stillWeak}). Длина починена: ${stat.formFixed} (осталось ${stat.formStill}).`)
console.log(`Итог: clean ${d.clean} / dropped ${d.dropped}`)
