// Узкий догон-фактчек: только рисковая полоса (миф-паттерны) среди clean без вердикта
// + «умершие» на лимите факты первого прогона. Пишет per-category scripts/factcheck-in/<slug>.json.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'factcheck-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

// id фактчеков, упавших на лимите в полном прогоне (из <failures>).
const DEAD = new Set(['g_1974', 'g_1996', 'g_4881', 'g_2001', 'g_611', 'g_1142', 'g_1292', 'g_1932', 'g_5038', 'g_1965', 'g_5280', 'g_1950', 'g_1961', 'g_1947', 'g_671', 'g_3736', 'g_1291'])
const RISK = /перв(ый|ая|ое|ым)|изобр[её]|придума|самы[йяе]|назван[ия]? в честь|получил имя|изначально|сказал|фраз[аы]|цитат|приписыва|в честь|рекорд|единственн|по словам|по мнению|по теории|согласно|утвержда|гласит|по [А-ЯЁ][а-яё]+у/i

const d = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean.json'), 'utf8'))
const cand = d.questions.filter((q) => q.disposition === 'clean' && !q.fact && (RISK.test(q.question) || DEAD.has(q.id)))

const groups = new Map()
for (const q of cand) {
  const cat = q.sourceCategory || 'прочее'
  if (!groups.has(cat)) groups.set(cat, [])
  groups.get(cat).push({ id: q.id, question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex, correctAnswer: q.correctAnswer })
}
let i = 0
for (const [cat, questions] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, questions }, null, 2) + '\n')
  i++
}
console.log(`factcheck-in (узкий): ${cand.length} кандидатов (рисковые + умершие), ${groups.size} категорий → scripts/factcheck-in/`)
