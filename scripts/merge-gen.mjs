#!/usr/bin/env node
/**
 * Слияние результатов воркфлоу наполнения (scripts/fill-questions.workflow.js) в questions.json.
 *
 * Вход:  scripts/gen-out/<subId>.json — по файлу на подкатегорию:
 *        { subId, subName, questions:[...], verdicts:[{index,verdict,reason,...}], summary }
 * Выход: public/questions.json   — дописаны вопросы с verdict=keep (reviewStatus: "pending")
 *        docs/judge-report.md     — разбор судьи по всем вопросам партии
 *        public/questions.backup-<timestamp>.json — бэкап ПЕРЕД записью
 *
 * Семантика — ДОПИСЫВАНИЕ: существующие вопросы и твои отметки ревью не трогаются.
 * После успешного слияния папку scripts/gen-out можно очистить перед следующей партией.
 *
 * Запуск: node scripts/merge-gen.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes } from '../src/content-rules.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GENDIR = path.join(ROOT, 'scripts', 'gen-out')
const QUESTIONS = path.join(ROOT, 'public', 'questions.json')
const CATEGORIES = path.join(ROOT, 'public', 'categories.json')
const REPORT = path.join(ROOT, 'docs', 'judge-report.md')

if (!fs.existsSync(GENDIR)) {
  console.error(`Нет папки ${path.relative(ROOT, GENDIR)} — сначала прогони воркфлоу наполнения.`)
  process.exit(1)
}

const files = fs.readdirSync(GENDIR).filter((f) => f.endsWith('.json')).sort()
if (!files.length) {
  console.error(`В ${path.relative(ROOT, GENDIR)} нет .json файлов.`)
  process.exit(1)
}

const results = []
for (const f of files) {
  try {
    results.push(JSON.parse(fs.readFileSync(path.join(GENDIR, f), 'utf8')))
  } catch (e) {
    console.warn(`⚠ Пропускаю битый файл ${f}: ${e.message}`)
  }
}

const catData = JSON.parse(fs.readFileSync(CATEGORIES, 'utf8'))
const qData = JSON.parse(fs.readFileSync(QUESTIONS, 'utf8'))

// Бэкап перед любыми изменениями
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = path.join(ROOT, 'public', `questions.backup-${stamp}.json`)
fs.writeFileSync(backup, JSON.stringify(qData, null, 2) + '\n', 'utf8')

const validIds = new Set()
for (const c of catData.categories) {
  validIds.add(c.id)
  for (const s of c.subcategories || []) validIds.add(s.id)
}

let maxNum = 0
for (const q of qData.questions) {
  const m = /^q_(\d+)$/.exec(q.id || '')
  if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
}
const nextId = () => 'q_' + String(++maxNum).padStart(3, '0')

const VERDICT_BADGE = { keep: '✅ keep', revise: '🟡 revise', drop: '⛔ drop' }
const added = []
const report = ['# Отчёт судьи — наполнение', '', `Подкатегорий в партии: ${results.length}.`, '']
let totalKeep = 0, totalRevise = 0, totalDrop = 0

for (const r of results) {
  const verdictByIndex = new Map((r.verdicts || []).map((v) => [v.index, v]))
  report.push(`## ${r.subName || ''} \`${r.subId}\``, '')
  if (r.summary) report.push(`> ${r.summary}`, '')

  ;(r.questions || []).forEach((q, i) => {
    const v = verdictByIndex.get(i) || { verdict: 'drop', reason: 'нет вердикта судьи', factuallyCorrect: false, inSweetSpot: false }
    if (v.verdict === 'keep') totalKeep++
    else if (v.verdict === 'revise') totalRevise++
    else totalDrop++

    let assignedId = '—'
    if (v.verdict === 'keep') {
      let cats = (q.categories || []).filter((c) => validIds.has(c))
      if (!cats.includes(r.subId)) cats.unshift(r.subId)
      cats = cats.slice(0, 3)

      assignedId = nextId()
      added.push({
        id: assignedId,
        question: stripDashes(q.question),
        answers: (q.answers || []).map(stripDashes),
        correctAnswerIndex: q.correctAnswerIndex,
        categories: cats,
        image: `assets/images/${assignedId}.jpg`,
        imageRole: 'illustrative',
        requiresImage: false,
        explanation: stripDashes(q.explanation),
        imageSearchQuery: q.imageSearchQuery,
        reviewStatus: 'pending'
      })
    }

    const flags = `факт:${v.factuallyCorrect ? '✓' : '✗'} коридор:${v.inSweetSpot ? '✓' : '✗'} не-ярлык:${v.factOverLabel ? '✓' : '✗'}`
    report.push(`- **${VERDICT_BADGE[v.verdict] || v.verdict}** ${assignedId !== '—' ? '`' + assignedId + '`' : ''} — ${q.question}`)
    report.push(`  - _${flags}_ · ${v.reason}`)
  })
  report.push('')
}

report.unshift('')
report.splice(1, 0, `Итого вердиктов: ✅ keep ${totalKeep} · 🟡 revise ${totalRevise} · ⛔ drop ${totalDrop}. В questions.json добавлено: ${added.length}.`)

qData.questions.push(...added)
fs.writeFileSync(QUESTIONS, JSON.stringify(qData, null, 2) + '\n', 'utf8')
fs.writeFileSync(REPORT, report.join('\n') + '\n', 'utf8')

console.log(`Бэкап: ${path.relative(ROOT, backup)}`)
console.log(`Прочитано файлов подкатегорий: ${results.length}`)
console.log(`Вердикты: keep ${totalKeep} / revise ${totalRevise} / drop ${totalDrop}`)
console.log(`Добавлено в questions.json: ${added.length} (только keep)`)
console.log(`Новые id: ${added.length ? added[0].id + ' … ' + added[added.length - 1].id : '—'}`)
console.log(`Отчёт: docs/judge-report.md`)
console.log(`Всего вопросов теперь: ${qData.questions.length}`)
console.log(`\nПроверь в админке (/admin.html), затем очисти scripts/gen-out перед следующей партией.`)
