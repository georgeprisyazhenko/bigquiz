// Слой 2 (часть 1+2): кандидаты на спасение/починку из public/guestion-clean.json -
// drop-weak-angle (пере-оценка угла новой калибровкой) + clean с formIssues (фикс длины).
// Группирует по категории → scripts/rescue-in/<slug>.json.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'rescue-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

const d = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean.json'), 'utf8'))
const cand = d.questions.filter((q) => q.disposition === 'drop-weak-angle' || (q.disposition === 'clean' && q.formIssues))
const groups = new Map()
for (const q of cand) {
  const cat = q.sourceCategory || 'прочее'
  if (!groups.has(cat)) groups.set(cat, [])
  groups.get(cat).push({
    id: q.id,
    question: q.question,
    answers: q.answers,
    correctAnswerIndex: q.correctAnswerIndex,
    task: q.disposition === 'drop-weak-angle' ? 'rescore-angle' : 'fix-length',
    currentAngle: q.angle ? q.angle.score : null,
    formIssues: q.formIssues || null
  })
}
let i = 0
for (const [cat, questions] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
const weak = cand.filter((q) => q.disposition === 'drop-weak-angle').length
console.log(`rescue-in: ${cand.length} кандидатов (${weak} weak-angle + ${cand.length - weak} formIssues), ${groups.size} категорий → scripts/rescue-in/`)
