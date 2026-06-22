import { describe, it, expect } from 'vitest'
import {
  validateAnswerText,
  MAX_ANSWER_CHARS,
  MAX_ANSWER_WORDS,
  MAX_WORD_CHARS
} from '../src/content-rules.js'

describe('validateAnswerText', () => {
  it('пропускает короткий обычный ответ', () => {
    expect(validateAnswerText('Азурит').ok).toBe(true)
    expect(validateAnswerText('Восстановили ДНК из янтаря').ok).toBe(true)
  })

  it('граница по символам: ровно MAX ок, MAX+1 нет', () => {
    // 3 слова (≤ MAX_ANSWER_WORDS) по ≤ MAX_WORD_CHARS букв, чтобы единственным
    // фактором была общая длина: 16+16+10 + 2 пробела = 44.
    const ok = ['а'.repeat(16), 'а'.repeat(16), 'а'.repeat(10)].join(' ')   // 44 символа, 3 слова
    const tooLong = ['а'.repeat(16), 'а'.repeat(16), 'а'.repeat(11)].join(' ') // 45 символов, 3 слова
    expect(ok.length).toBe(MAX_ANSWER_CHARS)
    expect(tooLong.length).toBe(MAX_ANSWER_CHARS + 1)
    expect(validateAnswerText(ok).ok).toBe(true)
    expect(validateAnswerText(tooLong).ok).toBe(false)
  })

  it('граница по словам: MAX слов ок, MAX+1 нет', () => {
    const ok = Array.from({ length: MAX_ANSWER_WORDS }, () => 'аб').join(' ')
    const tooMany = Array.from({ length: MAX_ANSWER_WORDS + 1 }, () => 'аб').join(' ')
    expect(validateAnswerText(ok).ok).toBe(true)
    expect(validateAnswerText(tooMany).ok).toBe(false)
  })

  it('ловит слишком длинное одиночное слово', () => {
    const longWord = 'я'.repeat(MAX_WORD_CHARS + 1)
    const result = validateAnswerText(longWord)
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('длинное слово'))).toBe(true)
  })

  it('ловит реальный проблемный ответ (6 слов, 46 символов)', () => {
    const result = validateAnswerText('Изучили пигментные клетки в окаменевших перьях')
    expect(result.ok).toBe(false)
  })

  it('возвращает причины при нарушении', () => {
    const result = validateAnswerText('я'.repeat(MAX_ANSWER_CHARS + 5))
    expect(result.reasons.length).toBeGreaterThan(0)
  })
})
