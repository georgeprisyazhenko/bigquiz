// Разлив: убирает преждевременно влитые guestion-вопросы из public/questions.json
// (reviewNote «из guestion-базы») и сбрасывает mergedToMain в guestion-clean.json,
// чтобы переобработать guestion целиком (с комментами + fix-first) и влить заново.
// Запускать ПЕРЕД guestion-recovery. node scripts/unmerge-guestion.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = join(ROOT, 'public', 'questions.json')
const GP = join(ROOT, 'public', 'guestion-clean.json')
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)

const main = JSON.parse(readFileSync(MAIN, 'utf8'))
writeFileSync(join(ROOT, 'public', `questions.backup-unmerge-${ts}.json`), JSON.stringify(main, null, 2) + '\n')
const before = main.questions.length
main.questions = main.questions.filter((q) => !/из guestion/i.test(q.reviewNote || ''))
writeFileSync(MAIN, JSON.stringify(main, null, 2) + '\n')

const g = JSON.parse(readFileSync(GP, 'utf8'))
let cleared = 0
for (const q of g.questions) if (q.mergedToMain) { delete q.mergedToMain; cleared++ }
writeFileSync(GP, JSON.stringify(g, null, 2) + '\n')

console.log(`Разлито: убрано из questions.json ${before - main.questions.length} guestion-вопросов (осталось ${main.questions.length}); сброшено mergedToMain: ${cleared}.`)
console.log('Теперь переобработай guestion (clean + --recover, с комментами) и влей заново через merge-guestion-into-main.')
