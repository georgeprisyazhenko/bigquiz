// ФИНАЛЬНОЕ слияние: clean-вопросы guestion-clean.json → public/questions.json (единая база).
// Запускать ПОСЛЕ финальных прогонов обеих баз. node scripts/merge-guestion-into-main.mjs
// Маппинг: categories = ourCategories; добавляем image/imageRole/requiresImage=false/imageSearchQuery;
// id q_NNN от максимума; reviewStatus='pending' (новые, на ревью). Бэкап + код-гейты.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, validateAnswerText, validateNoDashes, validateNoProhibited } from '../src/content-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = join(ROOT, 'public', 'questions.json')
const G = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean.json'), 'utf8'))
const main = JSON.parse(readFileSync(MAIN, 'utf8'))

const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
writeFileSync(join(ROOT, 'public', `questions.backup-merge-${ts}.json`), JSON.stringify(main, null, 2) + '\n')

// продолжить нумерацию q_NNN
let maxN = 0
for (const q of main.questions) { const m = /^q_(\d+)$/.exec(q.id || ''); if (m) maxN = Math.max(maxN, parseInt(m[1], 10)) }

const gatesOk = (q, a) => q.length <= 240 && validateNoDashes(q).ok && validateNoProhibited(q).ok && a.every((x) => validateAnswerText(x).ok && validateNoDashes(x).ok && validateNoProhibited(x).ok)

let added = 0, skipped = 0
const skippedIds = []
for (const q of G.questions) {
  if (q.disposition !== 'clean') continue
  if (q.mergedToMain) { skipped++; continue } // уже влит ранее - не дублируем
  const question = stripDashes(q.question)
  const answers = (q.answers || []).map(stripDashes)
  const cats = (q.ourCategories && q.ourCategories.length) ? q.ourCategories : null
  // пропускаем, если нет нашей категории или не проходит гейты (чтобы npm test остался зелёным)
  if (!cats || !gatesOk(question, answers)) { skipped++; skippedIds.push(q.sourceId || q.id); continue }
  const id = 'q_' + String(++maxN).padStart(3, '0')
  main.questions.push({
    id,
    question,
    answers,
    correctAnswerIndex: q.correctAnswerIndex,
    categories: cats.slice(0, 3),
    image: `assets/images/${id}.jpg`,
    imageRole: 'illustrative',
    requiresImage: false,
    explanation: stripDashes(q.explanation || ''),
    imageSearchQuery: q.correctAnswer || question.slice(0, 60),
    reviewStatus: 'pending',
    reviewNote: 'из guestion-базы (финал), на ревью'
  })
  q.mergedToMain = true // пометка, чтобы повторный запуск не дублировал
  added++
}

writeFileSync(MAIN, JSON.stringify(main, null, 2) + '\n')
writeFileSync(join(ROOT, 'public', 'guestion-clean.json'), JSON.stringify(G, null, 2) + '\n') // сохраняем пометки mergedToMain
console.log(`Влито в questions.json: +${added} (id q_${String(maxN - added + 1).padStart(3, '0')}..q_${String(maxN).padStart(3, '0')}). Пропущено (нет категории/гейт): ${skipped}`)
console.log(`Всего в questions.json: ${main.questions.length}. Прогони npm test.`)
if (skipped) console.log('Пропущены:', skippedIds.slice(0, 30).join(', '))
