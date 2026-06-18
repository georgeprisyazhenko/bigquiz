#!/usr/bin/env node
/**
 * Слияние правок прогон-редактора (scripts/edit-questions.workflow.js) в questions.json.
 *
 * Вход:  scripts/edit-out/<id>.json — { id, status, note, edited:{question,answers,correctAnswerIndex,explanation,removeSuggested,...}, verify }
 * Действие по каждому id:
 *   - removeSuggested=true  → вопрос удаляется из questions.json;
 *   - иначе                 → патчится на месте (question/answers/correctAnswerIndex/explanation),
 *                             reviewNote снимается (учтена); если был rejected → reviewStatus='pending'
 *                             (переделан, ждёт повторного ревью); approved остаётся approved.
 * Бэкап public/questions.backup-<ts>.json делается всегда. Нарушения лимита длины — предупреждением.
 *
 * Запуск: node scripts/merge-edits.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAnswerText, stripDashes } from '../src/content-rules.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDITDIR = path.join(ROOT, 'scripts', 'edit-out')
const QUESTIONS = path.join(ROOT, 'public', 'questions.json')
const REPORT = path.join(ROOT, 'docs', 'edit-report.md')

if (!fs.existsSync(EDITDIR)) { console.error('Нет scripts/edit-out — сначала прогони edit-questions.workflow.js'); process.exit(1) }
const files = fs.readdirSync(EDITDIR).filter((f) => f.endsWith('.json')).sort()
if (!files.length) { console.error('scripts/edit-out пуст'); process.exit(1) }

const qData = JSON.parse(fs.readFileSync(QUESTIONS, 'utf8'))
const byId = new Map(qData.questions.map((q) => [q.id, q]))

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
fs.writeFileSync(path.join(ROOT, 'public', `questions.backup-${stamp}.json`), JSON.stringify(qData, null, 2) + '\n', 'utf8')

const report = ['# Отчёт прогон-редактора', '', `Файлов правок: ${files.length}.`, '']
let patched = 0, removed = 0, reangled = 0, warned = 0, missing = 0
const removeIds = new Set()

for (const f of files) {
  let rec
  try { rec = JSON.parse(fs.readFileSync(path.join(EDITDIR, f), 'utf8')) } catch (e) { console.warn(`⚠ битый ${f}: ${e.message}`); continue }
  const q = byId.get(rec.id)
  if (!q) { missing++; report.push(`- ⚠ \`${rec.id}\` не найден в questions.json`); continue }
  const ed = rec.edited || {}

  if (ed.removeSuggested) {
    removeIds.add(rec.id); removed++
    report.push(`## ⛔ удалён \`${rec.id}\` [${rec.status}]`, `> заметка: ${rec.note}`, `> причина: ${ed.reason || '—'}`, '')
    continue
  }

  const oldQ = q.question
  q.question = stripDashes(ed.question ?? q.question)
  q.answers = (ed.answers ?? q.answers).map(stripDashes)
  if (typeof ed.correctAnswerIndex === 'number') q.correctAnswerIndex = ed.correctAnswerIndex
  q.explanation = stripDashes(ed.explanation ?? q.explanation)

  // проверка лимита длины
  const bad = (q.answers || []).map((a) => validateAnswerText(a)).filter((r) => !r.ok)
  const warnFlag = bad.length ? ' ⚠ВСЁ ЕЩЁ ДЛИННО' : ''
  if (bad.length) warned++

  // снять заметку (учтена); rejected → pending для повторного ревью
  delete q.reviewNote
  if (rec.status === 'rejected') { q.reviewStatus = 'pending'; reangled++ }

  patched++
  const vr = rec.verify || {}
  report.push(
    `## ✏️ \`${rec.id}\` [${rec.status}${rec.status === 'rejected' ? ' → pending' : ''}]${warnFlag}`,
    `> заметка: ${rec.note}`,
    `- было: ${oldQ}`,
    `- стало: ${q.question}`,
    `- ответы: ${(q.answers || []).join(' | ')}`,
    `- судья: факт ${vr.factuallyCorrect ? '✓' : '✗'} · правила ${vr.contentRulesOk ? '✓' : '✗'} · заметка учтена ${vr.noteAddressed ? '✓' : '✗'}${vr.issues ? ' · ' + vr.issues : ''}`,
    ''
  )
}

if (removeIds.size) qData.questions = qData.questions.filter((q) => !removeIds.has(q.id))

fs.writeFileSync(QUESTIONS, JSON.stringify(qData, null, 2) + '\n', 'utf8')
report.splice(3, 0, `Поправлено: ${patched} · удалено: ${removed} · возвращено в pending (re-angle): ${reangled} · с предупреждением о длине: ${warned} · не найдено: ${missing}.`, '')
fs.writeFileSync(REPORT, report.join('\n') + '\n', 'utf8')

console.log(`Бэкап: public/questions.backup-${stamp}.json`)
console.log(`Поправлено: ${patched} | удалено: ${removed} | re-angle→pending: ${reangled} | warn(длина): ${warned} | не найдено: ${missing}`)
console.log(`Всего вопросов: ${qData.questions.length}`)
console.log(`Отчёт: docs/edit-report.md`)
console.log(`Проверь правки и прогони: npm test`)
