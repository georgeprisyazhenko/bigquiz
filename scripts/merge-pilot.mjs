#!/usr/bin/env node
/**
 * Слияние результатов пилотной генерации в questions.json + отчёт судьи.
 *
 * Вход:  scripts/pilot-output.json — массив результатов Workflow:
 *        [{ subId, subName, questions:[...], verdicts:[{index,verdict,reason,...}], summary }]
 * Выход: public/questions.json   — дописаны вопросы с verdict keep|revise (reviewStatus: "pending")
 *        docs/judge-report.md     — полный разбор судьи по всем вопросам (включая drop)
 *
 * Запуск: node scripts/merge-pilot.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INPUT = path.join(ROOT, 'scripts', 'pilot-output.json')
const QUESTIONS = path.join(ROOT, 'public', 'questions.json')
const CATEGORIES = path.join(ROOT, 'public', 'categories.json')
const REPORT = path.join(ROOT, 'docs', 'judge-report.md')

const results = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
const catData = JSON.parse(fs.readFileSync(CATEGORIES, 'utf8'))
const qData = JSON.parse(fs.readFileSync(QUESTIONS, 'utf8'))

// Валидные id категорий/подкатегорий
const validIds = new Set()
for (const c of catData.categories) {
  validIds.add(c.id)
  for (const s of c.subcategories || []) validIds.add(s.id)
}

// Следующий свободный q_NNN
let maxNum = 0
for (const q of qData.questions) {
  const m = /^q_(\d+)$/.exec(q.id || '')
  if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
}
const nextId = () => 'q_' + String(++maxNum).padStart(3, '0')

const VERDICT_BADGE = { keep: '✅ keep', revise: '🟡 revise', drop: '⛔ drop' }
const added = []
const report = ['# Отчёт судьи — пилотная генерация', '', `Подкатегорий: ${results.length}.`, '']

let totalKeep = 0, totalRevise = 0, totalDrop = 0

for (const r of results) {
  const verdictByIndex = new Map((r.verdicts || []).map((v) => [v.index, v]))
  report.push(`## ${r.subName} \`${r.subId}\``, '')
  if (r.summary) report.push(`> ${r.summary}`, '')

  r.questions.forEach((q, i) => {
    const v = verdictByIndex.get(i) || { verdict: 'drop', reason: 'нет вердикта судьи', factuallyCorrect: false, inSweetSpot: false }
    if (v.verdict === 'keep') totalKeep++
    else if (v.verdict === 'revise') totalRevise++
    else totalDrop++

    let assignedId = '—'
    if (v.verdict === 'keep') {
      // нормализуем категории: только валидные id, гарантируем subId, максимум 3
      let cats = (q.categories || []).filter((c) => validIds.has(c))
      if (!cats.includes(r.subId)) cats.unshift(r.subId)
      cats = cats.slice(0, 3)

      assignedId = nextId()
      added.push({
        id: assignedId,
        question: q.question,
        answers: q.answers,
        correctAnswerIndex: q.correctAnswerIndex,
        categories: cats,
        image: `assets/images/${assignedId}.jpg`,
        imageRole: 'illustrative',
        requiresImage: false,
        explanation: q.explanation,
        imageSearchQuery: q.imageSearchQuery,
        reviewStatus: 'pending'
      })
    }

    const flags = `факт:${v.factuallyCorrect ? '✓' : '✗'} коридор:${v.inSweetSpot ? '✓' : '✗'}`
    report.push(`- **${VERDICT_BADGE[v.verdict] || v.verdict}** ${assignedId !== '—' ? '`' + assignedId + '`' : ''} — ${q.question}`)
    report.push(`  - _${flags}_ · ${v.reason}`)
  })
  report.push('')
}

report.unshift('') // пустая строка после заголовка-итога
report.splice(1, 0, `Итого вердиктов: ✅ keep ${totalKeep} · 🟡 revise ${totalRevise} · ⛔ drop ${totalDrop}. В questions.json добавлено: ${added.length}.`)

qData.questions.push(...added)
fs.writeFileSync(QUESTIONS, JSON.stringify(qData, null, 2) + '\n', 'utf8')
fs.writeFileSync(REPORT, report.join('\n') + '\n', 'utf8')

console.log(`Добавлено в questions.json: ${added.length} (только keep)`)
console.log(`Вердикты: keep ${totalKeep} / revise ${totalRevise} / drop ${totalDrop}`)
console.log(`Отчёт: docs/judge-report.md`)
console.log(`Новые id: ${added.length ? added[0].id + ' … ' + added[added.length - 1].id : '—'}`)
