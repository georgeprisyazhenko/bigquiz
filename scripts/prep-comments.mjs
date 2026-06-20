// Кандидаты для прохода по комментариям пользователя: вопросы из
// public/guestion-clean-review.json с непустым reviewNote, склеенные с текущим
// чистовиком (+ оригинал guestion для случаев «верни как было»). Per-category.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'comment-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

const review = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean-review.json'), 'utf8'))
const clean = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean.json'), 'utf8'))
const byId = new Map(clean.questions.map((q) => [q.id, q]))

const groups = new Map()
let n = 0
for (const [id, r] of Object.entries(review)) {
  const note = (r.reviewNote || '').trim()
  if (!note) continue
  const q = byId.get(id)
  if (!q) continue
  n++
  const cat = q.sourceCategory || 'прочее'
  if (!groups.has(cat)) groups.set(cat, [])
  groups.get(cat).push({
    id,
    question: q.question,
    answers: q.answers,
    correctAnswerIndex: q.correctAnswerIndex,
    currentAngle: q.angle ? q.angle.score : null,
    originalQuestion: q.original ? q.original.question : null,
    originalAnswers: q.original ? q.original.answers : null,
    userNote: note,
    userScores: r.scores || {}
  })
}
let i = 0
for (const [cat, questions] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
console.log(`comment-in: ${n} прокомментированных вопросов, ${groups.size} категорий → scripts/comment-in/`)
