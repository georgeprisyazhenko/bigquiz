// Кандидаты для совмещённого прохода (судейский дроп по классам + присвоение нашей
// категории): все clean-вопросы guestion-clean.json, по категории сайта для батчей.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'judgecat-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

const d = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean.json'), 'utf8'))
const groups = new Map()
let n = 0
for (const q of d.questions) {
  if (q.disposition !== 'clean') continue
  n++
  const cat = q.sourceCategory || 'прочее'
  if (!groups.has(cat)) groups.set(cat, [])
  groups.get(cat).push({ id: q.id, question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex })
}
let i = 0
for (const [cat, questions] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
console.log(`judgecat-in: ${n} clean-вопросов, ${groups.size} категорий → scripts/judgecat-in/`)
