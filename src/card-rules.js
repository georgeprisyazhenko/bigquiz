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

// Порядок ответов по детерминированным правилам показа.
// ПРАВИЛО: числовой набор → по убыванию значения (а не вразнобой).
// Остальное возвращаем как есть (в игре нечисловые дополнительно перемешиваются
// при показе для анти-чита позиции; это косметика, не правило).
// Возвращает { answers, correctAnswerIndex } с пересчитанным индексом верного.
export function orderAnswers(question) {
  const answers = (question && question.answers) || []
  const ci = question ? question.correctAnswerIndex : 0
  if (!isNumericAnswerSet(answers)) {
    return { answers: [...answers], correctAnswerIndex: ci }
  }
  const correctText = answers[ci]
  const sorted = [...answers].sort((a, b) => parseLeadingNumber(b) - parseLeadingNumber(a))
  return { answers: sorted, correctAnswerIndex: sorted.indexOf(correctText) }
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
