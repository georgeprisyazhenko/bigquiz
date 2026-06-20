// Готовит кандидатов догон-фактчека: clean-вопросы без факт-вердикта из
// public/guestion-clean.json, сгруппированные по категории → scripts/factcheck-in/<slug>.json.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'factcheck-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

const d = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean.json'), 'utf8'))
const cand = d.questions.filter((q) => q.disposition === 'clean' && !q.fact)
const groups = new Map()
for (const q of cand) {
  const cat = q.sourceCategory || 'прочее'
  if (!groups.has(cat)) groups.set(cat, [])
  groups.get(cat).push({ id: q.id, question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex, correctAnswer: q.correctAnswer })
}
let i = 0
for (const [cat, questions] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
console.log(`factcheck-in: ${cand.length} кандидатов, ${groups.size} категорий → scripts/factcheck-in/`)
