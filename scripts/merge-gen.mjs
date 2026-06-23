#!/usr/bin/env node
/**
 * Слияние результатов воркфлоу наполнения (scripts/fill-questions.workflow.js) в ПУЛ ревью.
 *
 * Вход:  scripts/gen-out/<subId>.json — по файлу на подкатегорию:
 *        { subId, subName, questions:[...], verdicts:[{index,verdict,reason,...}], summary }
 * Выход: data/review-pool.json — дописаны вопросы с verdict ∈ {keep, revise} как
 *        reviewStatus:'pending' + llmVerdict/llmReason (судить будет человек в админке).
 *        drop НЕ добавляем (только считаем). Дальше — ревью в admin.html.
 *
 * Почему пул, а не прод: в прод (public/questions.json) едет только одобренное мной
 * (см. docs/review-runbook.md). Генерации проходят моё ревью в пуле.
 * revise НЕ выбрасываем — это «годная идея с правимым изъяном», материал для доработки.
 *
 * Семантика — ДОПИСЫВАНИЕ: существующее в пуле не трогается. id выдаются сквозные
 * (max по проду И пулу), чтобы не было коллизий.
 *
 * Запуск: node scripts/merge-gen.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, validateAnswerText, validateOptionsHomogeneous, validateNumericRanges } from '../src/content-rules.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GENDIR = path.join(ROOT, 'scripts', 'gen-out')
const PROD = path.join(ROOT, 'public', 'questions.json')
const POOL = path.join(ROOT, 'data', 'review-pool.json')
const CATEGORIES = path.join(ROOT, 'public', 'categories.json')

if (!fs.existsSync(GENDIR)) {
  console.error(`Нет папки ${path.relative(ROOT, GENDIR)} — сначала прогони воркфлоу наполнения.`)
  process.exit(1)
}
const files = fs.readdirSync(GENDIR).filter((f) => f.endsWith('.json')).sort()
if (!files.length) { console.error(`В ${path.relative(ROOT, GENDIR)} нет .json файлов.`); process.exit(1) }

const results = []
for (const f of files) {
  try { results.push(JSON.parse(fs.readFileSync(path.join(GENDIR, f), 'utf8'))) }
  catch (e) { console.warn(`⚠ Пропускаю битый файл ${f}: ${e.message}`) }
}

const catData = JSON.parse(fs.readFileSync(CATEGORIES, 'utf8'))
const prod = JSON.parse(fs.readFileSync(PROD, 'utf8'))
const pool = fs.existsSync(POOL) ? JSON.parse(fs.readFileSync(POOL, 'utf8')) : { questions: [] }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
if (fs.existsSync(POOL)) fs.copyFileSync(POOL, POOL.replace(/\.json$/, `.backup-${stamp}.json`))

const validIds = new Set()
for (const c of catData.categories) {
  validIds.add(c.id)
  for (const s of c.subcategories || []) validIds.add(s.id)
}

// Сквозной счётчик id по проду И пулу.
let maxNum = 0
for (const q of [...prod.questions, ...pool.questions]) {
  const m = /^q_(\d+)$/.exec(q.id || '')
  if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
}
const nextId = () => 'q_' + String(++maxNum).padStart(3, '0')

const added = []
let kept = 0, revise = 0, dropped = 0, downgraded = 0

for (const r of results) {
  const verdictByIndex = new Map((r.verdicts || []).map((v) => [v.index, v]))
  ;(r.questions || []).forEach((q, i) => {
    const v = verdictByIndex.get(i) || { verdict: 'drop', reason: 'нет вердикта судьи' }
    if (v.verdict === 'drop') { dropped++; return }

    let cats = (q.categories || []).filter((c) => validIds.has(c))
    if (!cats.includes(r.subId)) cats.unshift(r.subId)
    cats = cats.slice(0, 3)

    const id = nextId()
    const answers = (q.answers || []).map(stripDashes)

    // Код-гейты, которые судья считает ненадёжно: длина + «около»-спам + вложенные
    // диапазоны. Нарушение — НЕ чистый keep: детерминированно понижаем до revise (всё
    // равно попадёт в пул как pending, но помечен как требующий доработки). См. docs/rules-map.md.
    const overLimit = answers.some((a) => !validateAnswerText(a).ok) ||
      !validateOptionsHomogeneous(answers).ok || !validateNumericRanges(answers).ok
    let verdict = v.verdict
    if (overLimit && verdict === 'keep') { verdict = 'revise'; downgraded++ }
    if (verdict === 'keep') kept++; else revise++

    added.push({
      id,
      question: stripDashes(q.question),
      answers,
      correctAnswerIndex: q.correctAnswerIndex,
      categories: cats,
      image: `assets/images/${id}.jpg`,
      imageRole: 'illustrative',
      requiresImage: false,
      explanation: stripDashes(q.explanation || ''),
      imageSearchQuery: q.imageSearchQuery || '',
      reviewStatus: 'pending',
      llmVerdict: verdict,
      llmReason: v.reason || (overLimit ? 'код-гейт: ответ длиннее лимита' : '')
    })
  })
}

pool.questions.push(...added)
fs.writeFileSync(POOL, JSON.stringify(pool, null, 2) + '\n', 'utf8')

console.log(`Прочитано подкатегорий: ${results.length}`)
console.log(`Вердикты: keep ${kept} / revise ${revise} / drop ${dropped} (drop не добавлены)`)
if (downgraded) console.log(`Код-гейт длины: ${downgraded} keep → revise (ответ длиннее лимита)`)
console.log(`Добавлено в ПУЛ (data/review-pool.json): ${added.length} как pending`)
console.log(`Новые id: ${added.length ? added[0].id + ' … ' + added[added.length - 1].id : '—'}`)
console.log('Ревьюй в admin.html. Очисти scripts/gen-out перед следующей партией.')
