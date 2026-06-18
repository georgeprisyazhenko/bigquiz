#!/usr/bin/env node
/**
 * Слияние результатов аудита (scripts/audit-questions.workflow.js) в questions.json.
 *
 * Вход:  scripts/audit-out/<id>.json — { id, audit:{ok,issues,...}, edited:{...}|null, verify:{ok,issues}|null }
 * Действие:
 *   - audit.ok=true (или edited=null)      → вопрос НЕ трогаем (прошёл аудит);
 *   - edited.removeSuggested=true          → удаляем вопрос;
 *   - иначе (исправлен)                    → патчим на месте (dash-strip), reviewStatus='pending'
 *                                            (изменён аудитом — на твоё повторное ревью).
 * Бэкап делается всегда. Длина/тире — авто-зачистка тире + предупреждение о длине.
 *
 * Запуск: node scripts/merge-audit.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAnswerText, stripDashes } from '../src/content-rules.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'scripts', 'audit-out')
const QUESTIONS = path.join(ROOT, 'public', 'questions.json')
const REPORT = path.join(ROOT, 'docs', 'audit-report.md')

if (!fs.existsSync(DIR)) { console.error('Нет scripts/audit-out — сначала прогони audit-questions.workflow.js'); process.exit(1) }
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
if (!files.length) { console.error('scripts/audit-out пуст'); process.exit(1) }

const qData = JSON.parse(fs.readFileSync(QUESTIONS, 'utf8'))
const byId = new Map(qData.questions.map((q) => [q.id, q]))
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
fs.writeFileSync(path.join(ROOT, 'public', `questions.backup-${stamp}.json`), JSON.stringify(qData, null, 2) + '\n', 'utf8')

const report = ['# Отчёт аудита под полный свод правил', '', `Файлов аудита: ${files.length}.`, '']
let passed = 0, fixed = 0, removed = 0, warned = 0, missing = 0
const removeIds = new Set()

for (const f of files) {
  let rec
  try { rec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) } catch (e) { console.warn(`⚠ битый ${f}: ${e.message}`); continue }
  const q = byId.get(rec.id)
  if (!q) { missing++; continue }
  const au = rec.audit || {}
  const ed = rec.edited

  if (au.ok || !ed) { passed++; continue }

  if (ed.removeSuggested) {
    removeIds.add(rec.id); removed++
    report.push(`## ⛔ удалён \`${rec.id}\``, `> аудит: ${au.issues}`, `> причина: ${ed.reason || '—'}`, '')
    continue
  }

  const oldQ = q.question
  q.question = stripDashes(ed.question ?? q.question)
  q.answers = (ed.answers ?? q.answers).map(stripDashes)
  if (typeof ed.correctAnswerIndex === 'number') q.correctAnswerIndex = ed.correctAnswerIndex
  q.explanation = stripDashes(ed.explanation ?? q.explanation)
  q.reviewStatus = 'pending' // изменён аудитом — на повторное ревью
  delete q.reviewNote

  const bad = (q.answers || []).some((a) => !validateAnswerText(a).ok)
  if (bad) warned++
  fixed++
  const vr = rec.verify || {}
  report.push(
    `## ✏️ \`${rec.id}\` → pending${bad ? ' ⚠ДЛИНА' : ''}`,
    `> аудит: ${au.issues}`,
    `- было: ${oldQ}`,
    `- стало: ${q.question}`,
    `- ответы: ${(q.answers || []).join(' | ')}`,
    `- проверка правки: ${vr.ok ? '✓' : '✗ ' + (vr.issues || '')}`,
    ''
  )
}

if (removeIds.size) qData.questions = qData.questions.filter((q) => !removeIds.has(q.id))
fs.writeFileSync(QUESTIONS, JSON.stringify(qData, null, 2) + '\n', 'utf8')
report.splice(3, 0, `Прошли аудит: ${passed} · исправлено → pending: ${fixed} · удалено: ${removed} · предупреждений о длине: ${warned} · не найдено: ${missing}.`, '')
fs.writeFileSync(REPORT, report.join('\n') + '\n', 'utf8')

console.log(`Бэкап: public/questions.backup-${stamp}.json`)
console.log(`Прошли аудит: ${passed} | исправлено→pending: ${fixed} | удалено: ${removed} | warn(длина): ${warned}`)
console.log(`Всего вопросов: ${qData.questions.length}`)
console.log(`Отчёт: docs/audit-report.md`)
console.log(`Затем: npm test, и проверь pending в /admin.html`)
