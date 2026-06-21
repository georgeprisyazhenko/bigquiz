// Прогон старых вопросов (public/questions.json) через наш флоу. Берём НЕ rejected
// (approved + pending). Группируем по 1-й категории для батчей. Сохраняем explanation.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'old-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

const d = JSON.parse(readFileSync(join(ROOT, 'public', 'questions.json'), 'utf8')).questions
const groups = new Map()
let n = 0
for (const q of d) {
  if (q.reviewStatus === 'rejected') continue // забракованные не трогаем
  n++
  const cat = (q.categories && q.categories[0]) || 'прочее'
  if (!groups.has(cat)) groups.set(cat, [])
  groups.get(cat).push({ id: q.id, question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex, explanation: q.explanation || '' })
}
let i = 0
for (const [cat, questions] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + String(cat).replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
console.log(`old-in: ${n} не-rejected вопросов, ${groups.size} групп → scripts/old-in/`)
