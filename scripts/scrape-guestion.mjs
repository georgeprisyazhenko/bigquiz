#!/usr/bin/env node
// Парсер вопросов с guestion.ru — для изучения «угла»/ремесла постановки чужих
// вопросов (НЕ для копирования в продакшн). Собирает: текст, 4 варианта, правильный
// индекс, теги-категории сайта. Размечать по нашим осям (factOverLabel, sweet spot,
// чистота дистракторов, тип угла) — отдельным LLM-проходом, см. docs/category-risks.md.
//
// Как это работает (разобрано по сайту):
//   - Категорийная страница рендерит ОДИН вопрос; прогресс хранится в куках.
//   - После ответа (POST /question/<id>/answer/<n>) и перезагрузки показывается СЛЕДУЮЩИЙ.
//   - Эндпоинт ответа возвращает JSON {answer, correct_answer, user_auth} — поле
//     correct_answer присутствует даже без логина, фронт просто прячет его в UI.
//   - Нумерация вариантов на сайте 1..4; correctAnswerIndex у нас 0..3.
//
// Запуск:
//   node scripts/scrape-guestion.mjs --category "Личности" --limit 30
//   node scripts/scrape-guestion.mjs --category "Наука" --limit 50 --out scripts/scrape-out/nauka.json
//   node scripts/scrape-guestion.mjs --list   # вывести список всех категорий с сайта
//   node scripts/scrape-guestion.mjs --all --limit 40   # все категории по 40 → per-category JSON
//
// Флаги: --category <имя>  --all  --limit <N=25>  --out <path>  --delay <ms=900>  --list
// --all: проходит ВСЕ категории сайта, пишет scripts/scrape-out/<slug>.json на каждую
//        (резюмируемо: уже существующие файлы пропускаются).

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://guestion.ru'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const COOKIE_JAR = `/tmp/guestion-cookies-${process.pid}.txt`

// ---- args ----
function parseArgs(argv) {
  const a = { limit: 25, delay: 900 }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--list') a.list = true
    else if (k === '--all') a.all = true
    else if (k === '--category') a.category = argv[++i]
    else if (k === '--limit') a.limit = parseInt(argv[++i], 10)
    else if (k === '--out') a.out = argv[++i]
    else if (k === '--delay') a.delay = parseInt(argv[++i], 10)
  }
  return a
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slugify = (name) => name.replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
const outPath = (name) => join(ROOT, 'scripts', 'scrape-out', `${slugify(name)}.json`)
const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim()
const slug = (name) => `${BASE}/category/${encodeURIComponent(name)}`

// ---- curl wrappers (curl надёжно ведёт cookie jar / gzip / редиректы) ----
function curlGet(url) {
  return execFileSync('curl', [
    '-sL', '--compressed', '-A', UA,
    '-b', COOKIE_JAR, '-c', COOKIE_JAR, url
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
}

function curlPostAnswer(id, answerN, csrf, referer) {
  const xsrf = readXsrf()
  const out = execFileSync('curl', [
    '-s', '--compressed', '-A', UA, '-b', COOKIE_JAR, '-c', COOKIE_JAR,
    '-H', `X-CSRF-TOKEN: ${csrf}`,
    '-H', `X-XSRF-TOKEN: ${xsrf}`,
    '-H', 'X-Requested-With: XMLHttpRequest',
    '-H', 'Accept: application/json',
    '-H', `Referer: ${referer}`,
    '-X', 'POST', `${BASE}/question/${id}/answer/${answerN}`
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  try { return JSON.parse(out) } catch { return null }
}

function readXsrf() {
  try {
    const jar = execFileSync('cat', [COOKIE_JAR], { encoding: 'utf8' })
    const line = jar.split('\n').find((l) => l.includes('XSRF-TOKEN'))
    if (!line) return ''
    const raw = line.split('\t').pop().trim()
    return decodeURIComponent(raw)
  } catch { return '' }
}

// ---- parsing ----
function extractCsrf(html) {
  const m = html.match(/name="csrf-token"\s+content="([^"]+)"/i)
  return m ? m[1] : ''
}

function parseQuestion(html) {
  const titleM = html.match(/class="quest-title-text"[^>]*>([\s\S]*?)<\/(?:div|h1|h2|span|p)>/i)
  const buttons = [...html.matchAll(/<button class="quest-answer" question="(\d+)" answer="(\d+)">([\s\S]*?)<\/button>/g)]
  if (!titleM || buttons.length < 4) return null
  const id = buttons[0][1]
  const answers = buttons
    .map((b) => ({ n: parseInt(b[2], 10), text: stripTags(b[3]) }))
    .sort((a, b) => a.n - b.n)
  const tags = [...new Set([...html.matchAll(/class="quest-category">\s*([^<]+?)\s*<\/a>/g)].map((m) => stripTags(m[1])))]
  return { id, question: stripTags(titleM[1]), answers, tags }
}

// ---- list categories ----
function listCategories() {
  const html = curlGet(`${BASE}/`)
  const cats = [...new Set([...html.matchAll(/href="https:\/\/guestion\.ru\/category\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1])))]
  return cats
}

// ---- main scrape loop ----
async function scrape(category, limit, delay) {
  const url = slug(category)
  const collected = []
  const seen = new Set()
  let repeats = 0
  // первый заход — установить сессию/куки
  curlGet(url)
  for (let i = 0; collected.length < limit && repeats < 5 && i < limit * 4; i++) {
    const html = curlGet(url)
    const csrf = extractCsrf(html)
    const q = parseQuestion(html)
    if (!q) { repeats++; await sleep(delay); continue }
    if (seen.has(q.id)) {
      // вопрос повторился — продвинем прогресс ответом и попробуем дальше
      repeats++
      if (csrf) curlPostAnswer(q.id, 1, csrf, url)
      await sleep(delay)
      continue
    }
    seen.add(q.id)
    repeats = 0
    // получить правильный ответ + продвинуть прогресс
    const res = csrf ? curlPostAnswer(q.id, 1, csrf, url) : null
    const correctN = res && Number.isInteger(res.correct_answer) ? res.correct_answer : null
    collected.push({
      sourceId: q.id,
      source: url,
      question: q.question,
      answers: q.answers.map((a) => a.text),
      correctAnswerIndex: correctN ? correctN - 1 : null,
      correctAnswer: correctN ? (q.answers.find((a) => a.n === correctN) || {}).text || null : null,
      tags: q.tags
    })
    process.stderr.write(`  [${collected.length}/${limit}] id=${q.id} ✓=${correctN ?? '?'}  ${q.question.slice(0, 60)}\n`)
    await sleep(delay)
  }
  return collected
}

// ---- entry ----
const args = parseArgs(process.argv.slice(2))

if (args.list) {
  const cats = listCategories()
  console.log(`Категорий: ${cats.length}\n`)
  for (const c of cats) console.log(`  ${c}`)
  process.exit(0)
}

// ---- --all: пул дочерних процессов, по процессу на категорию ----
if (args.all) {
  const CONCURRENCY = 5 // вежливо к сайту и при этом ×5 по скорости
  const cats = listCategories()
  const todo = cats.filter((c) => !existsSync(outPath(c)))
  console.error(`Категорий всего: ${cats.length}; к сбору: ${todo.length} (готовые пропускаю); пул ${CONCURRENCY}.`)
  let idx = 0
  let done = 0
  const runOne = (cat) => new Promise((resolve) => {
    const child = spawn('node', [
      fileURLToPath(import.meta.url),
      '--category', cat, '--limit', String(args.limit), '--delay', String(args.delay)
    ], { stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('exit', (code) => {
      done++
      console.error(`[${done}/${todo.length}] «${cat}» завершено (код ${code}).`)
      resolve()
    })
  })
  const worker = async () => { while (idx < todo.length) { await runOne(todo[idx++]) } }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))
  console.error(`\nВсё. Файлы в scripts/scrape-out/. Собрано категорий: ${todo.length}.`)
  process.exit(0)
}

if (!args.category) {
  console.error('Укажи --category "<имя>", --all или --list. См. шапку файла.')
  process.exit(1)
}

const out = args.out || outPath(args.category)
console.error(`Категория: ${args.category}  →  цель ${args.limit} вопросов  (задержка ${args.delay}мс)`)
const questions = await scrape(args.category, args.limit, args.delay)
const withCorrect = questions.filter((q) => q.correctAnswerIndex !== null).length
const payload = { category: args.category, source: slug(args.category), count: questions.length, withCorrect, questions }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')
console.error(`\nГотово: ${questions.length} вопросов (${withCorrect} с правильным ответом) → ${out}`)
