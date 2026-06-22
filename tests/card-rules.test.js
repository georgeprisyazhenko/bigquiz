import { describe, it, expect } from 'vitest'
import { parseLeadingNumber, isNumericAnswerSet, orderAnswers, imageCandidatePaths } from '../src/card-rules.js'

describe('card-rules: числовой набор ответов', () => {
  it('парсит ведущее число с пробелами-тысячами и единицами', () => {
    expect(parseLeadingNumber('15 000 литров')).toBe(15000)
    expect(parseLeadingNumber('20%')).toBe(20)
    expect(parseLeadingNumber('5')).toBe(5)
    expect(parseLeadingNumber('1,5 кг')).toBe(1.5)
  })

  it('слово в начале → не число', () => {
    expect(parseLeadingNumber('Около 50')).toBeNull()
    expect(parseLeadingNumber('Тихоходка')).toBeNull()
  })

  it('набор числовой только если все 4 ответа числовые', () => {
    expect(isNumericAnswerSet(['5', '4', '6', '7'])).toBe(true)
    expect(isNumericAnswerSet(['5', '4', 'Около 6', '7'])).toBe(false)
  })
})

describe('card-rules: orderAnswers', () => {
  it('числовой набор — по убыванию, индекс верного пересчитан', () => {
    const q = { answers: ['350 литров', '700 литров', '7 000 литров', '15 000 литров'], correctAnswerIndex: 2 }
    const o = orderAnswers(q)
    expect(o.answers).toEqual(['15 000 литров', '7 000 литров', '700 литров', '350 литров'])
    expect(o.answers[o.correctAnswerIndex]).toBe('7 000 литров')
  })

  it('чистые числа — по убыванию', () => {
    const o = orderAnswers({ answers: ['5', '4', '6', '7'], correctAnswerIndex: 0 })
    expect(o.answers).toEqual(['7', '6', '5', '4'])
    expect(o.answers[o.correctAnswerIndex]).toBe('5')
  })

  it('текстовый набор без seed не трогаем', () => {
    const q = { answers: ['Тихоходка', 'Дафния', 'Планария', 'Морская звезда'], correctAnswerIndex: 0 }
    const o = orderAnswers(q)
    expect(o.answers).toEqual(q.answers)
    expect(o.correctAnswerIndex).toBe(0)
  })

  it('текстовый набор с seed: детерминированно перемешан, индекс верного отслежен', () => {
    const q = { id: 'q_999', answers: ['А', 'Б', 'В', 'Г'], correctAnswerIndex: 0 }
    const o1 = orderAnswers(q, { seed: q.id })
    const o2 = orderAnswers(q, { seed: q.id })
    expect(o1.answers).toEqual(o2.answers) // тот же seed → тот же порядок
    expect(o1.answers.slice().sort()).toEqual(['А', 'Б', 'В', 'Г']) // те же 4 варианта
    expect(o1.answers[o1.correctAnswerIndex]).toBe('А') // верный отслежен после перемешивания
  })

  it('seed разбрасывает верный по позициям (не всегда первый)', () => {
    // на наборе id у вопросов с верным index 0 хотя бы часть НЕ остаётся первой
    const positions = new Set()
    for (let i = 0; i < 20; i++) {
      const o = orderAnswers({ id: 'q_' + i, answers: ['A', 'B', 'C', 'D'], correctAnswerIndex: 0 }, { seed: 'q_' + i })
      positions.add(o.correctAnswerIndex)
    }
    expect(positions.size).toBeGreaterThan(1)
  })
})

describe('card-rules: imageCandidatePaths', () => {
  it('webp первым, затем оригинал и прочие; путь нормализован', () => {
    expect(imageCandidatePaths('assets/images/q_018.jpg')).toEqual([
      '/assets/images/q_018.webp',
      '/assets/images/q_018.jpg',
      '/assets/images/q_018.jpeg',
      '/assets/images/q_018.png',
      '/assets/images/q_018.gif'
    ])
  })
})
