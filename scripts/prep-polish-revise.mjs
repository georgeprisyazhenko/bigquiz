// Готовит вход для polish.workflow.js из ПУЛА: берёт pending-вопросы с вердиктом судьи
// llmVerdict='revise', которые ещё НЕ полировались (без reworkedAt), и кладёт их в
// scripts/polish-in/*.json, сгруппировав по топ-категории. Директива полиша (reviewNote)
// = llmReason судьи (его диагноз: что чинить).
//
// Зачем: по договорённости ревью пользователя идёт ВСЕГДА ПОСЛЕ полиша. Судья только
// ставит диагноз revise+причину, не переписывает. Этот prep превращает диагнозы в задания
// для polish, чтобы человек ревьюил уже исправленные версии, а не сырьё.
// См. память feedback-review-after-polish, docs/review-runbook.md §4.
//
//   node scripts/prep-polish-revise.mjs   (после merge-gen)
//   → Workflow polish.workflow.js → node scripts/merge-polish.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'polish-in')
const POOL = join(ROOT, 'data', 'review-pool.json')
const CATS = join(ROOT, 'public', 'categories.json')

const pool = JSON.parse(readFileSync(POOL, 'utf8'))
const catsData = JSON.parse(readFileSync(CATS, 'utf8'))

const topNameById = new Map()
for (const top of catsData.categories || []) {
  topNameById.set(top.id, top.name)
  for (const sub of top.subcategories || []) topNameById.set(sub.id, top.name)
}

// Кандидаты на (повторный) полиш: вердикт судьи revise, ещё не полированные (нет reworkedAt),
// в статусе pending ИЛИ rework (откаты по гейту длины из merge-polish — на второй проход).
const revise = (pool.questions || []).filter(
  (q) => q.llmVerdict === 'revise' && !q.reworkedAt && ['pending', 'rework'].includes(q.reviewStatus || 'pending')
)

if (!revise.length) { console.log('Нет непрополированных revise в пуле — нечего готовить.'); process.exit(0) }

if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

const groups = new Map()
for (const q of revise) {
  const catName = topNameById.get((q.categories || [])[0]) || 'прочее'
  if (!groups.has(catName)) groups.set(catName, [])
  groups.get(catName).push({
    id: q.id,
    question: q.question,
    answers: q.answers,
    correctAnswerIndex: q.correctAnswerIndex,
    explanation: q.explanation || '',
    reviewNote: (q.llmReason || '').trim() // диагноз судьи как директива полиша
  })
}

let i = 0
for (const [cat, questions] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
console.log(`polish-in: ${revise.length} revise из пула, ${groups.size} категорий → scripts/polish-in/`)
