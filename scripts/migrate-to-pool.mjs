#!/usr/bin/env node
/**
 * Разовая миграция к модели «прод / пул ревью».
 *
 * ДО:  public/questions.json — всё вперемешку (pending/approved/rejected), игра берёт всё.
 * ПОСЛЕ:
 *   public/questions.json   — ПРОД: только reviewStatus='approved' (едет в игру).
 *   data/review-pool.json   — ПУЛ: всё остальное на ревью (вне public/, в zip игры не попадает).
 *   data/review-log.jsonl   — журнал действий ревью (создаётся пустым).
 *   data/.analyzer-watermark.json — водяной знак анализатора (lastAnalyzed).
 *
 * Правила миграции:
 *   - approved → остаётся в проде.
 *   - pending  → в пул как есть.
 *   - rejected → в пул, статус сбрасывается в 'pending' (старый коммент-контекст был стёрт,
 *                перетриажишь под новой моделью На доработку/На выброс).
 *   - llmVerdict='keep' проставляется всем (исторически все попали через merge-gen как keep).
 *
 * Идемпотентность: если пул уже существует — не перетираем, выходим с предупреждением.
 *
 * Запуск: node scripts/migrate-to-pool.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROD = path.join(ROOT, 'public', 'questions.json')
const DATA = path.join(ROOT, 'data')
const POOL = path.join(DATA, 'review-pool.json')
const LOG = path.join(DATA, 'review-log.jsonl')
const WATERMARK = path.join(DATA, '.analyzer-watermark.json')

if (fs.existsSync(POOL)) {
  console.error(`✋ ${path.relative(ROOT, POOL)} уже существует — миграция, похоже, уже выполнена.`)
  console.error('   Удали файл вручную, если точно хочешь перезапустить.')
  process.exit(1)
}

const data = JSON.parse(fs.readFileSync(PROD, 'utf8'))
const all = data.questions || []

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
fs.writeFileSync(path.join(ROOT, 'public', `questions.backup-${stamp}.json`), JSON.stringify(data, null, 2) + '\n')

const prod = []
const pool = []
for (const q of all) {
  const status = q.reviewStatus || 'pending'
  // Историческая правда: все нынешние вопросы прошли судью как keep при наполнении.
  if (q.llmVerdict === undefined) q.llmVerdict = 'keep'

  if (status === 'approved') {
    prod.push(q)
  } else {
    if (status === 'rejected') q.reviewStatus = 'pending'
    pool.push(q)
  }
}

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true })

fs.writeFileSync(PROD, JSON.stringify({ questions: prod }, null, 2) + '\n')
fs.writeFileSync(POOL, JSON.stringify({ questions: pool }, null, 2) + '\n')
if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, '')
if (!fs.existsSync(WATERMARK)) fs.writeFileSync(WATERMARK, JSON.stringify({ lastAnalyzed: null }, null, 2) + '\n')

console.log(`Прод (public/questions.json): ${prod.length} approved`)
console.log(`Пул  (data/review-pool.json): ${pool.length} на ревью`)
console.log(`Журнал: data/review-log.jsonl · водяной знак: data/.analyzer-watermark.json`)
console.log('Прогони npm test (гейт длины теперь только по проду).')
