// Восстановление результата clean-questions из журнала прогона (когда стадия save
// упала по лимиту сессии). Берёт закэшированные результаты агентов ремонта +
// корректора + фактчека, джойнит по id, считает disposition и пишет
// scripts/clean-out/<slug>.json по всем категориям. Дальше - scripts/merge-clean.mjs.
//
// Запуск: node scripts/reconstruct-clean-from-journal.mjs <путь к journal.jsonl>
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JOURNAL = process.argv[2]
if (!JOURNAL || !existsSync(JOURNAL)) { console.error('Укажи путь к journal.jsonl'); process.exit(1) }

const guest = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion.json'), 'utf8'))
const catById = new Map(guest.questions.map((q) => [q.id, q.sourceCategory || 'прочее']))

const repairById = new Map()
const proofById = new Map()
const factById = new Map()

for (const line of readFileSync(JOURNAL, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let o
  try { o = JSON.parse(line) } catch { continue }
  if (o.type !== 'result' || !o.result || typeof o.result !== 'object') continue
  const r = o.result
  if (Array.isArray(r.items)) {
    for (const it of r.items) {
      if (!it || !it.id) continue
      if ('angle' in it) { if (!repairById.has(it.id)) repairById.set(it.id, it) }
      else if ('proofNote' in it) { if (!proofById.has(it.id)) proofById.set(it.id, it) }
    }
  } else if (r.factVerdict && r.id) {
    if (!factById.has(r.id)) factById.set(r.id, r)
  }
}

function disposition(it, fact) {
  if (!it.fixable) return 'drop-unfixable'
  if (it.angle.score <= 2) return 'drop-weak-angle'
  if (fact && fact.factVerdict === 'myth') return 'drop-fact'
  if (fact && fact.factVerdict === 'wrong' && !fact.correctedAnswer) return 'drop-fact'
  return 'clean'
}

// Собрать финальные items, сгруппировать по категории.
const byCat = new Map()
let factsMerged = 0
for (const [id, rep] of repairById) {
  const p = proofById.get(id)
  const merged = p ? { ...rep, cleanedQuestion: p.cleanedQuestion, cleanedAnswers: p.cleanedAnswers, correctAnswerIndex: p.correctAnswerIndex, proofNote: p.proofNote } : rep
  const fact = factById.get(id) || null
  if (fact) factsMerged++
  merged.fact = fact
  merged.disposition = disposition(merged, fact)
  const cat = catById.get(id) || 'прочее'
  if (!byCat.has(cat)) byCat.set(cat, [])
  byCat.get(cat).push(merged)
}

const OUT = join(ROOT, 'scripts', 'clean-out')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })
let i = 0
for (const [cat, items] of byCat) {
  const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ slug, items }, null, 2) + '\n')
  i++
}
console.log(`Восстановлено: ${repairById.size} вопросов, ${byCat.size} категорий, фактов вмёржено ${factsMerged}/${repairById.size}`)
console.log(`Корректор применён к ${proofById.size}, → scripts/clean-out/`)
