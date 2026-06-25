import { describe, it, expect } from 'vitest'
import {
  validateAnswerText,
  validateOptionsHomogeneous,
  validateHedgeTell,
  validateExamShape,
  validateNumericRanges,
  validateNumericTell,
  validateEnumeration,
  MAX_ANSWER_CHARS,
  MAX_ANSWER_WORDS,
  MAX_WORD_CHARS,
} from '../src/content-rules.js'

describe('validateAnswerText', () => {
  it('пропускает короткий обычный ответ', () => {
    expect(validateAnswerText('Азурит').ok).toBe(true)
    expect(validateAnswerText('Восстановили ДНК из янтаря').ok).toBe(true)
  })

  it('граница по символам: ровно MAX ок, MAX+1 нет', () => {
    // 3 слова (≤ MAX_ANSWER_WORDS) по ≤ MAX_WORD_CHARS букв, чтобы единственным
    // фактором была общая длина: 16+16+10 + 2 пробела = 44.
    const ok = ['а'.repeat(16), 'а'.repeat(16), 'а'.repeat(10)].join(' ') // 44 символа, 3 слова
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

describe('validateOptionsHomogeneous («около»-спам)', () => {
  it('пропускает, если смягчитель не более чем в одном варианте', () => {
    expect(validateOptionsHomogeneous(['Треть', 'Половина', 'Около 80%', 'Пятая часть']).ok).toBe(
      true
    )
  })

  it('ловит «около» в нескольких вариантах', () => {
    const r = validateOptionsHomogeneous(['Около 40%', 'Около 60%', 'Около 80%', 'Около 95%'])
    expect(r.ok).toBe(false)
    expect(r.reasons[0]).toContain('4')
  })

  it('считает разные смягчители (примерно/порядка)', () => {
    expect(
      validateOptionsHomogeneous(['Примерно вдвое', 'Порядка втрое', 'Ровно столько', 'Одинаково'])
        .ok
    ).toBe(false)
  })
})

describe('validateHedgeTell (хедж ровно в 1 варианте телеграфирует)', () => {
  it('ловит «около» ровно в одном варианте среди голых (живой кейс q_252)', () => {
    const r = validateHedgeTell(['Около 4 лет', '15 лет', '7 лет', '30 лет'])
    expect(r.ok).toBe(false)
    expect(r.reasons[0]).toContain('1 варианте')
  })

  it('молчит, если хеджа нет вовсе', () => {
    expect(validateHedgeTell(['4 года', '15 лет', '7 лет', '30 лет']).ok).toBe(true)
  })

  it('молчит при ≥2 хеджах (это уже ловит validateOptionsHomogeneous)', () => {
    expect(validateHedgeTell(['Около 40%', 'Около 60%', '80%', '95%']).ok).toBe(true)
  })
})

describe('validateExamShape («Почему» + все 4 ответа длинные = эссе-экзамен)', () => {
  it('ловит «Почему X?» с 4 ответами-объяснениями (>2 значимых слова каждый)', () => {
    const r = validateExamShape('Почему солнечные панели дают меньше тока в жару?', [
      'Жара снижает КПД кремния',
      'Солнце стоит ниже летом',
      'Воздух рассеивает ультрафиолет',
      'Панели перегреваются и отключаются',
    ])
    expect(r.ok).toBe(false)
  })

  it('молчит, если ответы короткие (≤2 слова) даже при «Почему»', () => {
    expect(
      validateExamShape('Почему небо голубое?', [
        'Рассеяние света',
        'Отражение моря',
        'Слой озона',
        'Пыль в воздухе',
      ]).ok
    ).toBe(true)
  })

  it('молчит для не-«Почему» вопросов', () => {
    expect(
      validateExamShape('Какой газ окрашивает сияние в зелёный цвет?', [
        'Кислород плотных слоёв',
        'Азот верхних слоёв',
        'Водород солнечный ветер',
        'Гелий из короны',
      ]).ok
    ).toBe(true)
  })

  it('не триггерится на «почемучка» (граница слова)', () => {
    expect(
      validateExamShape('Почемучкин вопрос про длинные ответы тут', [
        'Раз два три слова',
        'Раз два три слова',
        'Раз два три слова',
        'Раз два три слова',
      ]).ok
    ).toBe(true)
  })
})

describe('validateNumericRanges (вложенные диапазоны)', () => {
  it('ловит несколько открытых нижних границ', () => {
    const r = validateNumericRanges([
      'Около 100 граммов',
      'Около 300 граммов',
      'Более 600 граммов',
      'Более 1 кг',
    ])
    expect(r.ok).toBe(false)
  })

  it('пропускает закрытую шкалу с одной границей с краёв', () => {
    expect(validateNumericRanges(['Менее 1 кг', '1-5 кг', '5-10 кг', 'Более 10 кг']).ok).toBe(true)
  })

  it('пропускает варианты без открытых границ', () => {
    expect(validateNumericRanges(['Треть', 'Половина', 'Десятая часть', 'Пятая часть']).ok).toBe(
      true
    )
  })
})

describe('validateNumericTell (верный - единственное не-круглое число)', () => {
  it('ловит верный не-круглый среди круглых дистракторов', () => {
    const r = validateNumericTell(['1227 км/ч', '1500 км/ч', '900 км/ч', '750 км/ч'], 0)
    expect(r.ok).toBe(false)
  })

  it('пропускает, если дистракторы тоже не кратны 10', () => {
    expect(validateNumericTell(['1227 км/ч', '1452 км/ч', '903 км/ч', '1086 км/ч'], 0).ok).toBe(
      true
    )
  })

  it('не флагует, если не-круглый - это дистрактор, а не верный', () => {
    expect(validateNumericTell(['100', '300', '600', '1'], 2).ok).toBe(true)
  })

  it('пропускает нечисловые наборы', () => {
    expect(validateNumericTell(['Якутск', 'Мурманск', 'Осло', 'Анкоридж'], 0).ok).toBe(true)
  })
})

describe('validateEnumeration (запятая → «и»)', () => {
  it('ловит перечисление двух слов через запятую', () => {
    expect(validateEnumeration('Разница солёности, температуры').ok).toBe(false)
  })

  it('не трогает десятичную запятую', () => {
    expect(validateEnumeration('Менее 0,1%').ok).toBe(true)
    expect(validateEnumeration('1,618').ok).toBe(true)
  })

  it('не трогает придаточное и цитаты', () => {
    expect(validateEnumeration('Дугу, как с земли').ok).toBe(true)
    expect(validateEnumeration('«Жизнь коротка, веселись»').ok).toBe(true)
  })

  it('пропускает вариант с уже имеющимся союзом', () => {
    expect(validateEnumeration('Реки и проливы').ok).toBe(true)
  })
})
