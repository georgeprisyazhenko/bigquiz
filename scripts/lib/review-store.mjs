// Общий слой работы с прод-базой и пулом ревью.
// Используется и dev-плагином Vite (кнопки админки), и CLI-скриптами (Фаза 4),
// чтобы логика промоушна/дропов/выгрузки на доработку жила в одном месте.
//
//   ПРОД  public/questions.json   — только approved, едет в игру.
//   ПУЛ   data/review-pool.json   — всё на ревью (вне public/).
//
// Поля ревью на вопросе: reviewStatus (pending|approved|rework|discard),
// reviewProblem (что не так — пишет человек), reviewSuggestion (как чинить — человек),
// reviewTags (причины-чипы), llmVerdict/llmReason (вердикт судьи, read-only).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, validateAnswerText, validateNoDashes, validateNoProhibited, validateOptionsHomogeneous, validateNumericRanges } from '../../src/content-rules.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PROD = path.join(ROOT, 'public', 'questions.json')
const POOL = path.join(ROOT, 'data', 'review-pool.json')
const CATEGORIES = path.join(ROOT, 'public', 'categories.json')
const POLISH_IN = path.join(ROOT, 'scripts', 'polish-in')
const LOG = path.join(ROOT, 'data', 'review-log.jsonl')
const WATERMARK = path.join(ROOT, 'data', '.analyzer-watermark.json')

export const VALID_STATUS = ['pending', 'approved', 'rework', 'discard']
// Поля «процесса ревью» + легаси-денормализация correctAnswer — не нужны в проде,
// снимаются при промоушне (correctAnswer избыточен и устаревает, источник — answers[correctAnswerIndex]).
const REVIEW_FIELDS = ['reviewProblem', 'reviewSuggestion', 'reviewTags', 'reviewNote', 'llmReason', 'preReworkVersion', 'reworkedAt', 'reworkNote', 'correctAnswer']

// Журнал действий ревью (обучающий корпус для анализатора Фазы 5).
// Пишем по факту каждого значимого действия; анализ — пачкой по водяному знаку.
export function appendLog(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry })
  fs.appendFileSync(LOG, line + '\n', 'utf8')
}
export function readWatermark() {
  try { return JSON.parse(fs.readFileSync(WATERMARK, 'utf8')) } catch { return { lastAnalyzed: null } }
}
export function writeWatermark(obj) { writeJson(WATERMARK, obj) }
// Снимок «было» для журнала/preReworkVersion.
export function snapshot(q) {
  return {
    question: q.question, answers: q.answers, correctAnswerIndex: q.correctAnswerIndex,
    explanation: q.explanation || '',
    reviewProblem: q.reviewProblem || '', reviewSuggestion: q.reviewSuggestion || '', reviewTags: q.reviewTags || []
  }
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const writeJson = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8')

function backup(p) {
  if (!fs.existsSync(p)) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  fs.copyFileSync(p, p.replace(/\.json$/, `.backup-${stamp}.json`))
}

export const loadProd = () => readJson(PROD)
export const loadPool = () => (fs.existsSync(POOL) ? readJson(POOL) : { questions: [] })

// Код-гейты прода (длина/тире/запрет + гейты уровня вопроса: «около»-спам, вложенные
// диапазоны) — то же, что в тестах и merge-скриптах.
export function gatesOk(q) {
  return (
    typeof q.question === 'string' && q.question.length <= 240 &&
    validateNoDashes(q.question).ok && validateNoProhibited(q.question).ok &&
    Array.isArray(q.answers) && q.answers.length === 4 &&
    q.answers.every((a) => validateAnswerText(a).ok && validateNoDashes(a).ok && validateNoProhibited(a).ok) &&
    validateOptionsHomogeneous(q.answers).ok && validateNumericRanges(q.answers).ok
  )
}

// Патч полей ревью у вопроса — ищем по id в проде и пуле, пишем тот файл, где нашли.
export function saveReview(id, patch) {
  if (!id) throw new Error('id required')
  if (patch.reviewStatus !== undefined && !VALID_STATUS.includes(patch.reviewStatus)) {
    throw new Error(`invalid reviewStatus: ${patch.reviewStatus}`)
  }
  for (const [file, label] of [[PROD, 'prod'], [POOL, 'pool']]) {
    if (!fs.existsSync(file)) continue
    const data = readJson(file)
    const q = (data.questions || []).find((x) => x.id === id)
    if (!q) continue
    const oldStatus = q.reviewStatus || 'pending'
    for (const key of ['reviewStatus', 'reviewProblem', 'reviewSuggestion', 'reviewTags']) {
      if (patch[key] === undefined) continue
      const v = patch[key]
      if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete q[key]
      else q[key] = v
    }
    writeJson(file, data)
    // Переход в «На выброс» — негативный пример для анализатора (было + причина).
    if (q.reviewStatus === 'discard' && oldStatus !== 'discard') {
      appendLog({ id, action: 'discard', reason: [q.reviewProblem, (q.reviewTags || []).join(',')].filter(Boolean).join(' '), before: snapshot(q) })
    }
    return { ok: true, id, source: label, reviewStatus: q.reviewStatus || 'pending' }
  }
  throw new Error(`question not found: ${id}`)
}

// Ручная правка текста вопроса (кнопка «Редактировать» в админке). Пишет в журнал
// действие 'edit' с было/стало — тоже сигнал для анализатора.
export function editQuestion(id, fields) {
  for (const [file, label] of [[PROD, 'prod'], [POOL, 'pool']]) {
    if (!fs.existsSync(file)) continue
    const data = readJson(file)
    const q = (data.questions || []).find((x) => x.id === id)
    if (!q) continue
    const before = snapshot(q)
    if (typeof fields.question === 'string') q.question = stripDashes(fields.question)
    if (Array.isArray(fields.answers) && fields.answers.length === 4) q.answers = fields.answers.map(stripDashes)
    if (Number.isInteger(fields.correctAnswerIndex) && fields.correctAnswerIndex >= 0 && fields.correctAnswerIndex <= 3) {
      q.correctAnswerIndex = fields.correctAnswerIndex
    }
    if (typeof fields.explanation === 'string') q.explanation = stripDashes(fields.explanation)
    writeJson(file, data)
    appendLog({ id, action: 'edit', before, after: snapshot(q) })
    return { ok: true, id, source: label, gatesOk: gatesOk(q) }
  }
  throw new Error(`question not found: ${id}`)
}

// Промоушн: approved из пула → прод. Гейты обязательны; не прошедшие остаются в пуле.
export function promoteToProd() {
  const pool = loadPool()
  const prod = loadProd()
  const approved = (pool.questions || []).filter((q) => q.reviewStatus === 'approved')
  if (!approved.length) return { moved: 0, blocked: [], remaining: (pool.questions || []).length }

  backup(PROD); backup(POOL)
  const moved = []
  const blocked = []
  for (const q of approved) {
    if (!gatesOk(q)) { blocked.push({ id: q.id, reason: 'code-gate' }); continue }
    const clean = { ...q }
    for (const f of REVIEW_FIELDS) delete clean[f]
    clean.reviewStatus = 'approved'
    prod.questions.push(clean)
    moved.push(q.id)
  }
  const movedSet = new Set(moved)
  pool.questions = (pool.questions || []).filter((q) => !movedSet.has(q.id))
  writeJson(PROD, prod)
  writeJson(POOL, pool)
  return { moved: moved.length, movedIds: moved, blocked, remaining: pool.questions.length }
}

// Удаление дропов: убирает discard из пула. Возвращает удалённые (для журнала Фазы 4).
export function deleteDrops() {
  const pool = loadPool()
  const dropped = (pool.questions || []).filter((q) => q.reviewStatus === 'discard')
  if (!dropped.length) return { removed: 0, items: [] }
  backup(POOL)
  const dropSet = new Set(dropped.map((q) => q.id))
  pool.questions = (pool.questions || []).filter((q) => !dropSet.has(q.id))
  writeJson(POOL, pool)
  return { removed: dropped.length, items: dropped }
}

// Выгрузка на доработку: пул-вопросы со статусом rework → scripts/polish-in/*.json.
// reviewNote собирается из проблемы+предложения+тегов как директива для polish.
export function exportRework() {
  const pool = loadPool()
  const rework = (pool.questions || []).filter((q) => q.reviewStatus === 'rework')
  if (!rework.length) return { count: 0, files: 0 }

  const cats = readJson(CATEGORIES)
  const topNameById = new Map()
  for (const top of cats.categories || []) {
    topNameById.set(top.id, top.name)
    for (const sub of top.subcategories || []) topNameById.set(sub.id, top.name)
  }

  if (fs.existsSync(POLISH_IN)) fs.rmSync(POLISH_IN, { recursive: true })
  fs.mkdirSync(POLISH_IN, { recursive: true })

  const groups = new Map()
  for (const q of rework) {
    const top = topNameById.get((q.categories || [])[0]) || 'прочее'
    if (!groups.has(top)) groups.set(top, [])
    const tags = (q.reviewTags || []).join(', ')
    const note = [q.reviewProblem, q.reviewSuggestion, tags ? `теги: ${tags}` : '']
      .map((s) => (s || '').trim()).filter(Boolean).join(' | ')
    groups.get(top).push({
      id: q.id,
      question: q.question,
      answers: q.answers,
      correctAnswerIndex: q.correctAnswerIndex,
      explanation: q.explanation || '',
      reviewNote: note
    })
  }

  let i = 0
  for (const [cat, questions] of groups) {
    const slug = String(i).padStart(2, '0') + '-' + cat.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
    writeJson(path.join(POLISH_IN, slug + '.json'), { category: cat, questions })
    i++
  }
  return { count: rework.length, files: groups.size }
}

export { stripDashes }
