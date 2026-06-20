// Слияние собранных (scripts/scrape-out) и размеченных (scripts/annotate-out)
// вопросов guestion.ru в один файл public/guestion.json для вкладки админки.
// НЕ трогает public/questions.json и public/guestion-review.json (твои отметки).
//
// Запуск: node scripts/merge-guestion.mjs
//
// Джойн по sourceId внутри одноимённых файлов категории. Вопрос, встретившийся
// в нескольких категориях, дедуплицируется по id (объединяем теги). Дерево вкладки
// строится по тегам (это и есть категории сайта); совпадение узла - tags.includes(name).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAnswerText } from '../src/content-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Ось concise считаем ДЕТЕРМИНИРОВАННО (кодом), а не доверяем LLM-аннотатору:
// это единственная ось с объективным критерием. Источник правды по ответам -
// src/content-rules.js (тот же, что роняет npm test). Вопрос - длина ≤240 симв (A.8).
function isConcise(q) {
  if ((q.question || '').length > 240) return false
  return (q.answers || []).every((a) => validateAnswerText(a).ok)
}
const SCRAPE = join(ROOT, 'scripts', 'scrape-out')
const ANNOT = join(ROOT, 'scripts', 'annotate-out')
const OUT = join(ROOT, 'public', 'guestion.json')

if (!existsSync(SCRAPE)) { console.error('Нет scripts/scrape-out - сначала собери (scrape-guestion.mjs --all).'); process.exit(1) }

const AXIS_KEYS = ['factOverLabel', 'inSweetSpot', 'cleanDistractors', 'naturalLanguage', 'factuallyCorrect', 'concise']
const files = readdirSync(SCRAPE).filter((f) => f.endsWith('.json'))

const byId = new Map()      // g_<sourceId> -> merged question
const categories = []        // { name, count, summary }
let annotated = 0
let conciseFlips = 0         // сколько раз код разошёлся с LLM по concise

for (const file of files) {
  const scrape = JSON.parse(readFileSync(join(SCRAPE, file), 'utf8'))
  const annPath = join(ANNOT, file)
  const ann = existsSync(annPath) ? JSON.parse(readFileSync(annPath, 'utf8')) : { annotations: [], summary: '' }
  const annById = new Map((ann.annotations || []).map((a) => [String(a.sourceId), a]))

  categories.push({ name: scrape.category, count: scrape.questions.length, summary: ann.summary || '' })

  for (const q of scrape.questions) {
    const id = `g_${q.sourceId}`
    if (byId.has(id)) {
      // дубль из другой категории - объединяем теги
      const existing = byId.get(id)
      existing.tags = [...new Set([...(existing.tags || []), ...(q.tags || [])])]
      continue
    }
    const a = annById.get(String(q.sourceId))
    if (a) annotated++
    const axes = {}
    if (a) for (const k of AXIS_KEYS) axes[k] = a[k]
    // concise пересчитываем кодом (детерминированно) поверх LLM-оценки.
    if (a) {
      const codeConcise = isConcise(q)
      if (a.concise !== codeConcise) conciseFlips++
      axes.concise = codeConcise
    }
    byId.set(id, {
      id,
      sourceId: q.sourceId,
      sourceCategory: scrape.category,
      question: q.question,
      answers: q.answers,
      correctAnswerIndex: q.correctAnswerIndex,
      correctAnswer: q.correctAnswer,
      tags: q.tags || [],
      // разметка нашего судьи (может отсутствовать, если annotate-out не полон)
      axes: a ? axes : null,
      angleType: a ? a.angleType : null,
      ourVerdict: a ? a.ourVerdict : null,
      seedValue: a ? a.seedValue : null,
      note: a ? a.note : null
    })
  }
}

const questions = [...byId.values()]
const payload = {
  generatedAt: new Date().toISOString(),
  source: 'guestion.ru',
  count: questions.length,
  annotated,
  categories: categories.sort((x, y) => x.name.localeCompare(y.name, 'ru')),
  questions
}
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')

const verd = (v) => questions.filter((q) => q.ourVerdict === v).length
const conciseOk = questions.filter((q) => q.axes && q.axes.concise).length
console.log(`guestion.json: ${questions.length} вопросов (${annotated} с разметкой), ${categories.length} категорий`)
console.log(`вердикты: keep ${verd('keep')} · revise ${verd('revise')} · drop ${verd('drop')}`)
console.log(`concise (пересчитан кодом): ${conciseOk}/${questions.length} проходят; расхождений с LLM исправлено: ${conciseFlips}`)
console.log(`→ ${OUT}`)
