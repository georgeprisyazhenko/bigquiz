// Готовит вход для final-pass.workflow.js. node scripts/prep-final.mjs --source old|guestion
//   old      — non-rejected из public/questions.json (с explanation).
//   guestion — clean из public/guestion-clean.json (explanation пуст → сгенерится; есть original).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = (process.argv.find((a) => a === 'old' || a === 'guestion') || (process.argv.includes('--source') ? process.argv[process.argv.indexOf('--source') + 1] : '')) || ''
if (source !== 'old' && source !== 'guestion') { console.error('Укажи --source old|guestion'); process.exit(1) }

const OUT = join(ROOT, 'scripts', 'final-in')
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

let items = []
if (source === 'old') {
  const q = JSON.parse(readFileSync(join(ROOT, 'public', 'questions.json'), 'utf8')).questions
  // ТВОЯ обратная связь vs авто-заметки merge. Ручной «не ок» с фидбеком = запрос на ПОЧИНКУ,
  // а не на удаление - такие rejected тоже берём в работу, а заметку отдаём как userNote.
  const AUTO = /^(final-drop|flow-drop|факт:|ремонт нарушил|Перевёрн|Убра|Сокра|Замен|Добавлен|Дистрактор|Вопрос |Ответы |Тире|Кавычки|без изменений|Минимальн|из guestion)/i
  const userFb = (x) => (x.reviewNote || '').trim() && !AUTO.test((x.reviewNote || '').trim())
  // флоу-дроп чинимого класса (как q_207 verify) - тоже возвращаем в recovery; issue из ноты - как hint.
  const FIXABLE_DROP = /^(?:final-drop|flow-drop):\s*(verify[\w-]*|distractors|multiple-correct|absurd-distractors|comparison|angle|weak-angle|leak-obvious|why-not-answered|phrasing|too-hard)/i
  const isGuestionOrigin = (x) => /из guestion/i.test(x.reviewNote || '')
  // userNote — ТВОЁ замечание (выполнять); priorFlag — авто-причина прошлого дропа (ПЕРЕПРОВЕРИТЬ, бывает ложной).
  items = q
    .filter((x) => !isGuestionOrigin(x) && (x.reviewStatus !== 'rejected' || userFb(x) || FIXABLE_DROP.test((x.reviewNote || '').trim())))
    .map((x) => ({
      id: x.id, question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex, explanation: x.explanation || '',
      userNote: (x.reviewStatus === 'rejected' && userFb(x)) ? x.reviewNote.trim() : '',
      priorFlag: (x.reviewStatus === 'rejected' && !userFb(x) && FIXABLE_DROP.test((x.reviewNote || '').trim())) ? x.reviewNote.trim() : '',
      _cat: (x.categories && x.categories[0]) || 'прочее'
    }))
} else {
  const q = JSON.parse(readFileSync(join(ROOT, 'public', 'guestion-clean.json'), 'utf8')).questions
  // ТВОИ комменты по guestion (из вкладки «Чистовик») - скармливаем как userNote.
  const reviewP = join(ROOT, 'public', 'guestion-clean-review.json')
  const review = existsSync(reviewP) ? JSON.parse(readFileSync(reviewP, 'utf8')) : {}
  // --recover: брать НЕ clean, а чинимые дропы (форма/дистракторы/угол), чтобы вернуть их.
  // Топик-неспасаемое (prohibited/fact/banal-school/ultra-niche/street-niche/scandal/social) не берём.
  const FIXABLE = /^drop-(verify|distractors|multiple-correct|absurd-distractors|leak-obvious|comparison|angle|weak-angle|too-hard|other)$/
  const recover = process.argv.includes('--recover')
  const pick = recover ? (x) => FIXABLE.test(x.disposition || '') : (x) => x.disposition === 'clean'
  items = q.filter(pick).map((x) => ({ id: x.id, question: x.question, answers: x.answers, correctAnswerIndex: x.correctAnswerIndex, explanation: x.explanation || '', original: x.original ? x.original.question : null, userNote: ((review[x.id] || {}).reviewNote || '').trim(), _cat: x.sourceCategory || 'прочее' }))
}

const groups = new Map()
for (const it of items) { const c = it._cat; delete it._cat; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it) }
let i = 0
for (const [cat, qs] of groups) {
  const slug = String(i).padStart(2, '0') + '-' + String(cat).replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify({ category: cat, source, questions: qs }, null, 2) + '\n')
  i++
}
console.log(`final-in (${source}): ${items.length} вопросов, ${groups.size} групп → scripts/final-in/`)
