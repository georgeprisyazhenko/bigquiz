// Сборка пилотного чистового набора public/guestion-clean.json из результата
// воркфлоу clean-questions (ремонт + угол) + вручную вмёрженные веб-вердикты факта
// (в пилоте джойн по id в воркфлоу сломался - агент не вернул id; в полном прогоне
// баг уже поправлен). Одноразовый скрипт под пилот.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PILOT = process.argv[2] // путь к output воркфлоу
const items = JSON.parse(readFileSync(PILOT, 'utf8')).result.items
const guest = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion.json'), 'utf8'))
const origById = new Map(guest.questions.map((q) => [q.id, q]))

// Веб-вердикты из журнала фактчека (по содержанию сопоставлены с id).
const FACT = {
  g_2632: { verdict: 'myth', explanation: 'Ответ Waterman верен, но премиса-история про протёкшее перо и потерянный контракт - байка: Уотерман взял под управление готовую компанию (Wikipedia, NIHF). Угол построен на мифе.', correctedAnswer: 'Waterman' },
  g_3656: { verdict: 'unverifiable', explanation: 'Цитата широко приписывается Наполеону в сборниках афоризмов, но первоисточник не установлен - вероятная мисатрибуция.' },
  g_3378: { verdict: 'true', explanation: 'Подтверждается Historia Augusta (гл. 23), но это источник сомнительной надёжности - деталь может быть апокрифом.' },
  g_2899: { verdict: 'true', explanation: 'Seiko TV-Watch 1982 - первые наручные часы с ЖК-телевизором; офиц. Seiko Design и Epson.' },
  g_2850: { verdict: 'true', explanation: 'Nokia основана в 1865 как бумажная мельница (Wikipedia History of Nokia). Ответ сайта "Строительство" был неверен - исправлено на "Бумаги".', correctedAnswer: 'Бумаги' }
}

// Пере-расчёт судьбы с учётом факта: drop только непочиняемое / слабый угол / миф в премисе.
function disposition(it, fact) {
  if (!it.fixable) return 'drop-unfixable'
  if (fact && fact.verdict === 'myth') return 'drop-fact'      // премиса-байка - даже если ответ верен
  if (fact && fact.verdict === 'wrong' && !fact.correctedAnswer) return 'drop-fact'
  if (it.angle.score <= 2) return 'drop-weak-angle'
  return 'clean'
}

const questions = items.map((it) => {
  const orig = origById.get(it.id)
  const fact = FACT[it.id] || null
  return {
    id: it.id,
    sourceCategory: orig ? orig.sourceCategory : '',
    tags: orig ? orig.tags : [],
    original: orig ? { question: orig.question, answers: orig.answers, correctAnswer: orig.correctAnswer } : null,
    question: it.cleanedQuestion,
    answers: it.cleanedAnswers,
    correctAnswerIndex: it.correctAnswerIndex,
    correctAnswer: it.cleanedAnswers[it.correctAnswerIndex],
    changed: it.changed,
    fixable: it.fixable,
    guardrails: it.guardrails,
    angle: it.angle,
    banal: it.banal,
    fact,
    disposition: disposition(it, fact)
  }
})

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'guestion.ru (чистовик)',
  count: questions.length,
  clean: questions.filter((q) => q.disposition === 'clean').length,
  dropped: questions.filter((q) => q.disposition !== 'clean').length,
  questions
}
writeFileSync(join(ROOT, 'public', 'guestion-clean.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8')
console.log(`guestion-clean.json: ${payload.count} (clean ${payload.clean} / dropped ${payload.dropped})`)
for (const q of questions) console.log(`  ${q.id}  угол ${q.angle.score}  ${q.disposition}${q.fact ? '  факт:' + q.fact.verdict : ''}`)
