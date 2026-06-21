// Готовит вход для polish.workflow.js: читает public/questions.json, отбирает
// вопросы по фильтру, группирует по топ-категории → scripts/polish-in/*.json.
//
// Фильтры (можно комбинировать):
//   --pending          все pending-вопросы (дефолт если ничего не задано)
//   --rejected         rejected с живыми твоими комментами (не авто-ноты pipeline)
//   --approved         approved (повторный аудит)
//   --all              всё (все статусы)
//   --ids q_012 q_030  конкретные id
// По умолчанию (без флагов): pending + rejected с твоими комментами.
//
// Дальше: Workflow({ scriptPath: "scripts/polish.workflow.js" }) → merge-polish.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'polish-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

const data = JSON.parse(readFileSync(join(ROOT, 'public', 'questions.json'), 'utf8'))
const catsData = JSON.parse(readFileSync(join(ROOT, 'public', 'categories.json'), 'utf8'))

// Авто-ноты pipeline — не пользовательские комменты.
const AUTO = /^(polish-drop:|final-drop:|flow-drop:|факт:|ремонт нарушил|из guestion)/i
const hasUserNote = (q) => (q.reviewNote || '').trim() && !AUTO.test((q.reviewNote || '').trim())

const argv = process.argv.slice(2)
const wantAll = argv.includes('--all')
const wantPending = wantAll || argv.includes('--pending')
const wantRejected = wantAll || argv.includes('--rejected')
const wantApproved = wantAll || argv.includes('--approved')
const idxIds = argv.indexOf('--ids')
const wantIds = idxIds >= 0 ? new Set(argv.slice(idxIds + 1).filter(a => !a.startsWith('-'))) : null
const useDefault = !wantAll && !wantPending && !wantRejected && !wantApproved && !wantIds

// Карта subcatId → топ-категория name
const topNameById = new Map()
for (const top of catsData.categories || []) {
  topNameById.set(top.id, top.name)
  for (const sub of top.subcategories || []) topNameById.set(sub.id, top.name)
}

const groups = new Map()
let n = 0

for (const q of data.questions) {
  const status = q.reviewStatus || 'pending'
  let include = false
  if (wantIds) {
    include = wantIds.has(q.id)
  } else if (useDefault) {
    include = status === 'pending' || (status === 'rejected' && hasUserNote(q))
  } else {
    if (wantPending && status === 'pending') include = true
    if (wantRejected && status === 'rejected' && hasUserNote(q)) include = true
    if (wantApproved && status === 'approved') include = true
  }
  if (!include) continue
  n++
  const catId = (q.categories || [])[0] || 'прочее'
  const catName = topNameById.get(catId) || catId
  if (!groups.has(catName)) groups.set(catName, [])
  groups.get(catName).push({
    id: q.id,
    question: q.question,
    answers: q.answers,
    correctAnswerIndex: q.correctAnswerIndex,
    explanation: q.explanation || '',
    reviewNote: (q.reviewNote || '').trim()
  })
}

let i = 0
for (const [cat, questions] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
console.log(`polish-in: ${n} вопросов, ${groups.size} категорий → scripts/polish-in/`)
if (n === 0) console.log('(ничего не отобрано — проверь фильтры или запусти с --all)')
