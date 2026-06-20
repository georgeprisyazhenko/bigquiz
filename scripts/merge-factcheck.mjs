// Впечатывает вердикты догон-фактчека (scripts/factcheck-out/*.json) в
// public/guestion-clean.json: ставит q.fact и пересчитывает disposition.
// myth → drop-fact; wrong без починки → drop-fact; wrong+correctedAnswer (если он среди
// вариантов) → переставляем верный; true/unverifiable → остаётся clean.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'scripts', 'factcheck-out')
const CLEAN = join(ROOT, 'public', 'guestion-clean.json')
if (!existsSync(DIR)) { console.error('Нет scripts/factcheck-out - сначала прогони воркфлоу.'); process.exit(1) }

const verdictById = new Map()
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  for (const v of data.verdicts || []) if (v && v.id) verdictById.set(v.id, v)
}

const d = JSON.parse(readFileSync(CLEAN, 'utf8'))
let applied = 0
const stat = { myth: 0, wrong: 0, fixed: 0, unverifiable: 0, tru: 0 }
for (const q of d.questions) {
  const v = verdictById.get(q.id)
  if (!v) continue
  applied++
  q.fact = { factVerdict: v.factVerdict, explanation: v.explanation || '', ...(v.correctedAnswer ? { correctedAnswer: v.correctedAnswer } : {}) }
  if (q.disposition === 'clean') {
    if (v.factVerdict === 'myth') { q.disposition = 'drop-fact'; stat.myth++ }
    else if (v.factVerdict === 'wrong') {
      const idx = (q.answers || []).findIndex((a) => v.correctedAnswer && a.trim().toLowerCase() === v.correctedAnswer.trim().toLowerCase())
      if (idx >= 0) { q.correctAnswerIndex = idx; q.correctAnswer = q.answers[idx]; stat.fixed++ } // верный переставлен
      else { q.disposition = 'drop-fact'; stat.wrong++ }
    } else if (v.factVerdict === 'unverifiable') stat.unverifiable++
    else stat.tru++
  }
}

d.clean = d.questions.filter((q) => q.disposition === 'clean').length
d.dropped = d.questions.filter((q) => q.disposition !== 'clean').length
d.generatedAt = new Date().toISOString()
writeFileSync(CLEAN, JSON.stringify(d, null, 2) + '\n', 'utf8')
console.log(`Вердиктов применено: ${applied}`)
console.log(`  миф→дроп ${stat.myth} · неверно→дроп ${stat.wrong} · ответ исправлен ${stat.fixed} · unverifiable ${stat.unverifiable} · подтверждено ${stat.tru}`)
console.log(`Итог: clean ${d.clean} / dropped ${d.dropped}`)
