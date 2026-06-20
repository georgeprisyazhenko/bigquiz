// Разрезает public/guestion.json на per-category файлы scripts/clean-in/<n>.json
// для пайплайна чистки (scripts/clean-questions.workflow.js). Резюмируемо.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'clean-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

const guest = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion.json'), 'utf8'))
const groups = new Map()
for (const q of guest.questions) {
  const cat = q.sourceCategory || 'прочее'
  if (!groups.has(cat)) groups.set(cat, [])
  groups.get(cat).push({ id: q.id, question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex, correctAnswer: q.correctAnswer })
}
let i = 0
for (const [cat, questions] of groups) {
  const name = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, name + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
console.log(`clean-in: ${groups.size} категорий, ${guest.questions.length} вопросов → scripts/clean-in/`)
