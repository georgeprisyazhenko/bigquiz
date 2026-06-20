// Собирает public/guestion-clean.json из scripts/clean-out/*.json (результат
// clean-questions.workflow.js) + оригиналы из public/guestion.json. Твои баллы в
// public/guestion-clean-review.json не трогает.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripDashes, validateAnswerText, validateNoProhibited } from '../src/content-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Категории сайта guestion, запрещённые по A.0 (ЯИ 3.4) - вопросы из них дропаем.
// Мифология сайтом в отдельную категорию не вынесена, политика/религия - да.
const RISKY_SITE_CATS = new Set(['Религии', 'Политика и геополитика'])

// Код-гейты поверх LLM-чистки: автозамена тире на дефис (бесплатно), флаг нарушений
// длины ответа (≤44/≤5 слов), автодроп эзотерики (PROHIBITED_TOPIC_RE) и дроп вопросов
// из запрещённых категорий сайта - те же проверки, что роняют npm test для прода.
function applyCodeGates(rec) {
  // A.0: вопрос из запрещённой категории сайта - дроп (до прочего).
  const cats = [rec.sourceCategory, ...(rec.tags || [])]
  if (rec.disposition === 'clean' && cats.some((c) => RISKY_SITE_CATS.has(c))) rec.disposition = 'drop-prohibited'
  rec.question = stripDashes(rec.question)
  rec.answers = (rec.answers || []).map(stripDashes)
  rec.correctAnswer = rec.answers[rec.correctAnswerIndex]
  const formIssues = []
  rec.answers.forEach((a, i) => {
    const { ok, reasons } = validateAnswerText(a)
    if (!ok) formIssues.push(`answer[${i}] "${a}": ${reasons.join(', ')}`)
  })
  if (formIssues.length) rec.formIssues = formIssues // флаг на ре-ремонт, не автодроп
  for (const t of [rec.question, ...rec.answers]) {
    if (!validateNoProhibited(t).ok && rec.disposition === 'clean') rec.disposition = 'drop-prohibited'
  }
  return rec
}
const DIR = join(ROOT, 'scripts', 'clean-out')
if (!existsSync(DIR)) { console.error('Нет scripts/clean-out - сначала прогони воркфлоу.'); process.exit(1) }

const guest = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion.json'), 'utf8'))
const origById = new Map(guest.questions.map((q) => [q.id, q]))

const questions = []
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  for (const it of data.items || []) {
    const orig = origById.get(it.id)
    // если факт исправил ответ - подставим (ответ уже в cleanedAnswers по индексу, но фиксируем correctedAnswer в fact)
    questions.push(applyCodeGates({
      id: it.id,
      sourceCategory: orig ? orig.sourceCategory : '',
      tags: orig ? orig.tags : [],
      original: orig ? { question: orig.question, answers: orig.answers, correctAnswer: orig.correctAnswer } : null,
      question: it.cleanedQuestion,
      answers: it.cleanedAnswers,
      correctAnswerIndex: it.correctAnswerIndex,
      correctAnswer: it.cleanedAnswers[it.correctAnswerIndex],
      changed: it.changed,
      proofNote: it.proofNote || '',
      fixable: it.fixable,
      guardrails: it.guardrails,
      angle: it.angle,
      banal: it.banal,
      fact: it.fact || null,
      disposition: it.disposition
    }))
  }
}
questions.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'guestion.ru (чистовик)',
  count: questions.length,
  clean: questions.filter((q) => q.disposition === 'clean').length,
  dropped: questions.filter((q) => q.disposition !== 'clean').length,
  questions
}
writeFileSync(join(ROOT, 'public', 'guestion-clean.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8')
const d = (k) => questions.filter((q) => q.disposition === k).length
console.log(`guestion-clean.json: ${payload.count} (clean ${payload.clean} / dropped ${payload.dropped})`)
console.log(`  drop-weak-angle ${d('drop-weak-angle')} · drop-fact ${d('drop-fact')} · drop-unfixable ${d('drop-unfixable')} · drop-prohibited ${d('drop-prohibited')}`)
const formFlagged = questions.filter((q) => q.formIssues).length
if (formFlagged) console.log(`  с нарушением длины ответа (флаг formIssues, на ре-ремонт): ${formFlagged}`)
