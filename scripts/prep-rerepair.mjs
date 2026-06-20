// Полный-лайт ре-ремонт: все clean-вопросы guestion-clean.json + твои комментарии
// (guestion-clean-review.json) где есть, для прецизионного применения. Per-category.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'rerepair-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

const clean = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean.json'), 'utf8'))
const review = existsSync(join(ROOT, 'public', 'guestion-clean-review.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean-review.json'), 'utf8'))
  : {}

const groups = new Map()
let n = 0
for (const q of clean.questions) {
  if (q.disposition !== 'clean') continue
  n++
  const cat = q.sourceCategory || 'прочее'
  if (!groups.has(cat)) groups.set(cat, [])
  groups.get(cat).push({
    id: q.id,
    question: q.question,
    answers: q.answers,
    correctAnswerIndex: q.correctAnswerIndex,
    currentAngle: q.angle ? q.angle.score : null,
    originalQuestion: q.original ? q.original.question : null,
    originalAnswers: q.original ? q.original.answers : null,
    userNote: ((review[q.id] || {}).reviewNote || '').trim() || null
  })
}
let i = 0
for (const [cat, questions] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
const withNote = clean.questions.filter((q) => q.disposition === 'clean' && ((review[q.id] || {}).reviewNote || '').trim()).length
console.log(`rerepair-in: ${n} clean-вопросов (${withNote} с твоим комментом), ${groups.size} категорий → scripts/rerepair-in/`)
