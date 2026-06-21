// Применяет результаты polish.workflow.js (scripts/polish-out/*.json) к public/questions.json.
//   - Починенные: применяет новый текст + очищает reviewNote (обработано) +
//     если был rejected → возвращает в pending для повторного ревью.
//   - Дропнутые: reviewStatus='rejected', reviewNote='polish-drop: <причина>'.
//   - Код-гейты (длина/тире/запрет): если нарушены → откат к оригинальному тексту,
//     reviewNote='polish-revert: gate failed' (будет повторно обработан при следующем прогоне).
// node scripts/merge-polish.mjs && npm test

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, validateAnswerText, validateNoDashes, validateNoProhibited } from '../src/content-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'scripts', 'polish-out')
if (!existsSync(DIR)) { console.error('Нет polish-out — сначала прогони воркфлоу.'); process.exit(1) }

const gatesOk = (q, a) =>
  q.length <= 240 &&
  validateNoDashes(q).ok && validateNoProhibited(q).ok &&
  a.every(x => validateAnswerText(x).ok && validateNoDashes(x).ok && validateNoProhibited(x).ok)

// Собрать все результаты по id
const byId = new Map()
for (const f of readdirSync(DIR).filter(x => x.endsWith('.json'))) {
  for (const it of JSON.parse(readFileSync(join(DIR, f), 'utf8')).items || []) byId.set(it.id, it)
}

const P = join(ROOT, 'public', 'questions.json')
const data = JSON.parse(readFileSync(P, 'utf8'))
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
writeFileSync(P.replace(/\.json$/, `.backup-polish-${ts}.json`), JSON.stringify(data, null, 2) + '\n')

const stat = { fixed: 0, unchanged: 0, dropped: 0, reverted: 0, factDropped: 0 }

for (const q of data.questions) {
  const r = byId.get(q.id)
  if (!r) continue

  // Дроп по классам или по факту
  if (r.drop || (r.fact && (r.fact.factVerdict === 'myth' || r.fact.factVerdict === 'wrong'))) {
    const reason = r.drop ? r.dropReason || 'other' : 'fact-' + r.fact.factVerdict
    const issue = r.verifyIssue || (r.fact && r.fact.explanation) || ''
    q.reviewStatus = 'rejected'
    q.reviewNote = 'polish-drop: ' + reason + (issue ? ' | ' + issue.slice(0, 120) : '')
    if (r.drop) stat.dropped++; else stat.factDropped++
    continue
  }

  // Без изменений
  if (!r.changed || /^без изменений/i.test(r.changed)) {
    delete q.reviewNote
    stat.unchanged++
    continue
  }

  // Применить исправленный текст
  const newQ = stripDashes(r.question || q.question)
  const newA = (r.answers || q.answers).map(stripDashes)
  const newCI = r.correctAnswerIndex ?? q.correctAnswerIndex

  if (!gatesOk(newQ, newA)) {
    // Гейт провален — откат к оригиналу, оставить заметку для следующего прогона
    q.reviewNote = 'polish-revert: gate failed — ' + (r.changed || '').slice(0, 80)
    stat.reverted++
    continue
  }

  q.question = newQ
  q.answers = newA
  q.correctAnswerIndex = newCI
  if (r.explanation) q.explanation = stripDashes(r.explanation)
  delete q.reviewNote
  if (q.reviewStatus === 'rejected') q.reviewStatus = 'pending'
  stat.fixed++
}

writeFileSync(P, JSON.stringify(data, null, 2) + '\n')
console.log(`polish merge: починено ${stat.fixed} · без изм. ${stat.unchanged} · дроп ${stat.dropped} · факт-дроп ${stat.factDropped} · откат ${stat.reverted}`)
console.log('Прогони npm test.')
