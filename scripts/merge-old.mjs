// Впечатывает результат process-old (scripts/old-out/*.json) в public/questions.json.
// Сохраняет image/imageRole/requiresImage/imageSearchQuery/categories. Дроп-классы и
// миф/неверно/непроверено → reviewStatus='rejected'. Исправленные → 'pending'.
// БЕЗОПАСНО: если отремонтированный вопрос нарушает жёсткий гейт (длина/тире/запрет 3.4),
// откатываем его к оригиналу - чтобы npm test остался зелёным.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, validateAnswerText, validateNoDashes, validateNoProhibited } from '../src/content-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'scripts', 'old-out')
const P = join(ROOT, 'public', 'questions.json')
if (!existsSync(DIR)) { console.error('Нет old-out - сначала прогони воркфлоу.'); process.exit(1) }

const byId = new Map()
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  for (const it of JSON.parse(readFileSync(join(DIR, f), 'utf8')).items || []) byId.set(it.id, it)
}

const norm = (s) => (s || '').trim().toLowerCase()
const passesGates = (question, answers) =>
  question.length <= 240 && validateNoDashes(question).ok && validateNoProhibited(question).ok &&
  answers.every((a) => validateAnswerText(a).ok && validateNoDashes(a).ok && validateNoProhibited(a).ok)

const data = JSON.parse(readFileSync(P, 'utf8'))
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
writeFileSync(join(ROOT, 'public', `questions.backup-old-${ts}.json`), JSON.stringify(data, null, 2) + '\n')

const stat = { dropClass: 0, factReject: 0, fixed: 0, changed: 0, reverted: 0, untouched: 0 }
for (const q of data.questions) {
  const r = byId.get(q.id)
  if (!r) continue // rejected/не обрабатывались
  // 1. дроп по классам
  if (r.drop) { q.reviewStatus = 'rejected'; q.reviewNote = 'flow-drop: ' + (r.dropReason || 'other'); stat.dropClass++; continue }
  // 2. факт
  const v = r.fact ? r.fact.factVerdict : null
  if (v === 'myth' || v === 'unverifiable') { q.reviewStatus = 'rejected'; q.reviewNote = 'факт: ' + v + ' - ' + (r.fact.explanation || '').slice(0, 160); stat.factReject++; continue }
  // подготовить отремонтированный вариант
  let nq = stripDashes(r.question)
  let na = r.answers.map(stripDashes)
  let ni = r.correctAnswerIndex
  if (v === 'wrong') {
    const ca = norm(r.fact.correctedAnswer)
    const idx = ca ? na.findIndex((a) => norm(a) === ca || norm(a).includes(ca.split(/[\s(]/)[0])) : -1
    if (idx >= 0) { ni = idx; stat.fixed++ } else { q.reviewStatus = 'rejected'; q.reviewNote = 'факт: wrong - ' + (r.fact.explanation || '').slice(0, 160); stat.factReject++; continue }
  }
  // 3. безопасность: если ремонт нарушает жёсткий гейт - откат к оригиналу
  if (!passesGates(nq, na)) { stat.reverted++; q.reviewStatus = 'pending'; q.reviewNote = 'ремонт нарушил гейт длины/тире - оставлен оригинал, проверить'; continue }
  // 4. применить
  const changed = (r.changed || '') !== 'без изменений' || nq !== q.question || JSON.stringify(na) !== JSON.stringify(q.answers)
  q.question = nq; q.answers = na; q.correctAnswerIndex = ni; q.correctAnswer = na[ni]
  if (r.explanation) q.explanation = stripDashes(r.explanation)
  // image/imageRole/requiresImage/imageSearchQuery/categories - НЕ трогаем (остаются)
  if (changed) { q.reviewStatus = 'pending'; q.reviewNote = (r.changed || '').slice(0, 160); stat.changed++ } else stat.untouched++
}

const cnt = (s) => data.questions.filter((q) => q.reviewStatus === s).length
writeFileSync(P, JSON.stringify(data, null, 2) + '\n')
console.log(`process-old применён: дроп-классы ${stat.dropClass} · факт-реджект ${stat.factReject} · ответ исправлен ${stat.fixed} · изменено→pending ${stat.changed} · откат-к-оригиналу ${stat.reverted} · без изменений ${stat.untouched}`)
console.log(`reviewStatus: approved ${cnt('approved')} · pending ${cnt('pending')} · rejected ${cnt('rejected')} · всего ${data.questions.length}`)
