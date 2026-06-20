// Код-фикс (без LLM): clean-вопросы с вердиктом wrong/myth, проскочившие из-за бага
// g_115 (wrong + correctedAnswer не среди вариантов → оставалось clean). Логика:
// myth → drop-fact; wrong → если correctedAnswer совпадает с вариантом, ставим верным
// (починка), иначе drop-fact.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const P = join(ROOT, 'public', 'guestion-clean.json')
const d = JSON.parse(readFileSync(P, 'utf8'))
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
writeFileSync(join(ROOT, 'public', `guestion-clean.backup-${ts}.json`), JSON.stringify(d, null, 2) + '\n')

const norm = (s) => (s || '').trim().toLowerCase()
const stat = { myth: 0, wrongDrop: 0, fixed: 0 }
for (const q of d.questions) {
  if (q.disposition !== 'clean' || !q.fact) continue
  const v = q.fact.factVerdict
  if (v === 'myth') { q.disposition = 'drop-fact'; stat.myth++ }
  else if (v === 'wrong') {
    const ca = norm(q.fact.correctedAnswer)
    const idx = ca ? q.answers.findIndex((a) => norm(a) === ca || norm(a).includes(ca.split(/[\s(]/)[0])) : -1
    if (idx >= 0) { q.correctAnswerIndex = idx; q.correctAnswer = q.answers[idx]; stat.fixed++ } // спасли: верный есть в вариантах
    else { q.disposition = 'drop-fact'; stat.wrongDrop++ }
  }
}
d.clean = d.questions.filter((q) => q.disposition === 'clean').length
d.dropped = d.questions.filter((q) => q.disposition !== 'clean').length
writeFileSync(P, JSON.stringify(d, null, 2) + '\n')
console.log(`Код-фикс фактов: myth→дроп ${stat.myth} · wrong→дроп ${stat.wrongDrop} · ответ исправлен ${stat.fixed}`)
console.log(`Итог: clean ${d.clean} / dropped ${d.dropped}`)
