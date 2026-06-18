// Контент-правила вариантов ответа — единый источник правды для:
//   * валидации в игре (src/main.js → validateQuestions);
//   * тестов (tests/) и генерации вопросов (docs/category-risks.md).
//
// Чистый модуль без Phaser — импортируется и в браузере, и в Node (vitest).
//
// Лимиты подобраны так, чтобы валидный ответ гарантированно влезал в ≤2 строки
// на плашке ответа (ширина ~261px, шрифт 17px bold) без ужатия шрифта. Рантайм
// (makeAnswerLabel) дополнительно страхует ужатием, но цель — чтобы до него не доходило.

export const MAX_ANSWER_WORDS = 5   // 1–3 слова идеал, до 5 допустимо
export const MAX_ANSWER_CHARS = 44  // влезает в 2 строки на плашке ответа
export const MAX_WORD_CHARS = 18    // одиночное слово (без пробелов) — в одну строку

// Проверяет один вариант ответа. Возвращает { ok, reasons }.
export function validateAnswerText(text) {
  const reasons = []
  const value = (text ?? '').trim()

  if (value.length > MAX_ANSWER_CHARS) {
    reasons.push(`длина ${value.length} > ${MAX_ANSWER_CHARS} символов`)
  }

  const words = value.split(/\s+/).filter(Boolean)
  if (words.length > MAX_ANSWER_WORDS) {
    reasons.push(`слов ${words.length} > ${MAX_ANSWER_WORDS}`)
  }

  const longestWord = words.reduce((max, word) => Math.max(max, word.length), 0)
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
