// Контент-правила вариантов ответа — единый источник правды для:
//   * валидации в игре (src/main.js → validateQuestions);
//   * тестов (tests/) и генерации вопросов (docs/category-risks.md).
//
// Чистый модуль без Phaser — импортируется и в браузере, и в Node (vitest).
//
// Лимиты подобраны так, чтобы валидный ответ влезал в ≤2 строки на плашке ответа
// (ширина ~261px, шрифт 17px bold). Шрифт НЕ ужимается ни в игре, ни в превью —
// если ответ не влезает по лимиту, его НУЖНО ПЕРЕФОРМУЛИРОВАТЬ, а не мельчить.

export const MAX_ANSWER_WORDS = 3   // значимых слов (предлоги не в счёт); идеал 1–2
export const MAX_ANSWER_CHARS = 44  // влезает в 2 строки на плашке ответа
export const MAX_WORD_CHARS = 18    // одиночное слово (без пробелов) — в одну строку

// Русские предлоги — не считаются за «значимое слово» (правило лимита по словам).
const PREPOSITIONS = new Set([
  'в', 'во', 'на', 'над', 'под', 'подо', 'при', 'про', 'за', 'к', 'ко', 'у', 'о', 'об', 'обо',
  'от', 'ото', 'до', 'из', 'изо', 'с', 'со', 'по', 'для', 'без', 'через', 'между', 'меж',
  'перед', 'передо', 'среди', 'около', 'возле', 'вокруг', 'вдоль', 'после', 'кроме', 'ради',
  'сквозь', 'против', 'насчёт', 'вместо', 'из-за', 'из-под'
])

// Значимые слова в ответе: токены без пунктуации, исключая предлоги.
export function contentWords(text) {
  return (text ?? '').trim().split(/\s+/).filter(Boolean)
    .filter((w) => !PREPOSITIONS.has(w.toLowerCase().replace(/[.,!?;:()«»"'`]/g, '')))
}

// Проверяет один вариант ответа. Возвращает { ok, reasons }.
export function validateAnswerText(text) {
  const reasons = []
  const value = (text ?? '').trim()

  if (value.length > MAX_ANSWER_CHARS) {
    reasons.push(`длина ${value.length} > ${MAX_ANSWER_CHARS} символов`)
  }

  const words = contentWords(value)
  if (words.length > MAX_ANSWER_WORDS) {
    reasons.push(`значимых слов ${words.length} > ${MAX_ANSWER_WORDS} (предлоги не в счёт)`)
  }

  const allTokens = value.split(/\s+/).filter(Boolean)
  const longestWord = allTokens.reduce((max, word) => Math.max(max, word.length), 0)
  if (longestWord > MAX_WORD_CHARS) {
    reasons.push(`длинное слово ${longestWord} > ${MAX_WORD_CHARS} символов`)
  }

  return { ok: reasons.length === 0, reasons }
}

// Запрещённые тире: длинное «—» (U+2014) и среднее «–» (U+2013). В тексте вопросов,
// ответах и explanation допустим только дефис «-». LLM стабильно ставит тире вопреки
// инструкции, поэтому правило держим в коде (проверка + автозамена), а не на доверии.
export const FORBIDDEN_DASH_RE = /[—–]/

// Находит длинное/среднее тире в строке. Возвращает { ok, reasons }.
export function validateNoDashes(text) {
  const value = text ?? ''
  const ok = !FORBIDDEN_DASH_RE.test(value)
  return { ok, reasons: ok ? [] : ['содержит тире «—»/«–» вместо дефиса «-»'] }
}

// Заменяет все «—»/«–» на дефис «-» (для автозачистки при слиянии).
export function stripDashes(text) {
  return typeof text === 'string' ? text.replace(/[—–]/g, '-') : text
}

// Запрещённые Яндекс Играми темы (требования к содержанию, п. 3.4) - см. A.0 в
// docs/category-risks.md. Регэкспом ловим только надёжно детектируемую полосу:
// эзотерику/гадания/предсказания-как-практику. Политику и религию по ключевым
// словам не отсечь без ложных срабатываний - они остаются на правилах (A.0) и
// LLM-судье (флаг prohibitedYG в пайплайнах). Высокоточные термины эзотерики-как-
// ПРАКТИКИ; намеренно БЕЗ «маг»/«гадал»/«зодиак»/«пророчеств» — они ловили бы
// «магазин»/«угадал», астрономию (созвездия зодиака) и мифологию (пророчество в мифах,
// разрешённую по A.0).
export const PROHIBITED_TOPIC_RE =
  /гороскоп|астролог|гадани|гадалк|ворожб|нумеролог|ясновид|экстрасенс|спиритизм|эзотери|оккульт|хиромант|телекинез|чакр|рейки|фэн-?шуй|феншуй|таролог/i

// Проверяет текст (вопрос/ответ/explanation) на явный запрещённый по 3.4 контент.
export function validateNoProhibited(text) {
  const value = text ?? ''
  const m = value.match(PROHIBITED_TOPIC_RE)
  return m ? { ok: false, reasons: [`запрещённая тема ЯИ (3.4): «${m[0]}»`] } : { ok: true, reasons: [] }
}
