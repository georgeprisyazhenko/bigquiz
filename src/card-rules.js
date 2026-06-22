// Правила ОТОБРАЖЕНИЯ карточки вопроса — единый источник правды для:
//   * игры (src/main.js → как реально видит игрок в режиме «Случайный вопрос»);
//   * админки-препрода (src/admin/admin.js → превью обязано совпадать с продом).
//
// Чистый модуль без Phaser и без DOM — импортируется и в браузере (игра/админка),
// и в Node (vitest). Любое новое правило показа добавляй СЮДА — и игра, и админка
// подхватят автоматически, не разъезжаясь.

const SPACE_RE = /[   ]/g // не-разрывные/узкие пробелы → обычный

// --- Числовой набор ответов ---
// Ответ считается числовым, если начинается с числа (пробелы как разделитель тысяч,
// запятая как десятичный разделитель допускаются): «5», «15 000 литров», «20%».
// «Около 50» — НЕ числовой (начинается со слова) → набор не трогаем.
export function parseLeadingNumber(answer) {
  const s = String(answer).trim().replace(SPACE_RE, ' ')
  const compact = s.replace(/(\d) (?=\d)/g, '$1') // «15 000» → «15000»
  const m = compact.match(/^-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function isNumericAnswerSet(answers) {
  return Array.isArray(answers) && answers.length === 4 &&
    answers.every((a) => parseLeadingNumber(a) !== null)
}

// Детерминированное перемешивание по строковому seed (одинаковый seed → один порядок).
// Нужно превью-админке: верный не должен быть всегда первым (как в данных), но порядок
// для конкретного вопроса стабилен между перерисовками. mulberry32 + FNV-1a — без зависимостей.
function hashSeed(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function seededShuffle(arr, seedStr) {
  let a = hashSeed(String(seedStr))
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Порядок ответов по правилам показа. Возвращает { answers, correctAnswerIndex }
// с пересчитанным индексом верного.
// ПРАВИЛО: числовой набор → по убыванию значения (а не вразнобой).
// Нечисловой набор: с opts.seed → детерминированно перемешан (превью-админка, чтобы
// верный не был всегда первым); без seed → как есть (игра перемешивает сама случайно
// при каждом показе — анти-чит позиции).
export function orderAnswers(question, opts = {}) {
  const answers = (question && question.answers) || []
  const ci = question ? question.correctAnswerIndex : 0
  const correctText = answers[ci]
  if (isNumericAnswerSet(answers)) {
    const sorted = [...answers].sort((a, b) => parseLeadingNumber(b) - parseLeadingNumber(a))
    return { answers: sorted, correctAnswerIndex: sorted.indexOf(correctText) }
  }
  if (opts.seed != null) {
    const shuffled = seededShuffle(answers, opts.seed)
    return { answers: shuffled, correctAnswerIndex: shuffled.indexOf(correctText) }
  }
  return { answers: [...answers], correctAnswerIndex: ci }
}

// Кандидаты пути картинки (.webp первым — build-конвейер всегда отдаёт webp,
// а расширение в данных может быть устаревшим). Та же логика, что грузит игра.
export function imageCandidatePaths(imagePath) {
  const normalized = imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('/')
    ? imagePath
    : `/${imagePath}`
  const withoutExt = normalized.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '')
  const hasExt = /\.(jpg|jpeg|png|webp|gif)$/i.test(normalized)
  const candidates = hasExt
    ? [`${withoutExt}.webp`, normalized, `${withoutExt}.jpg`, `${withoutExt}.jpeg`, `${withoutExt}.png`, `${withoutExt}.gif`]
    : [`${withoutExt}.webp`, `${withoutExt}.jpg`, `${withoutExt}.jpeg`, `${withoutExt}.png`, `${withoutExt}.gif`]
  return [...new Set(candidates)]
}
