import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateAnswerText, validateNoDashes, validateNoProhibited } from '../src/content-rules.js'

const here = dirname(fileURLToPath(import.meta.url))
const questionsPath = join(here, '..', 'public', 'questions.json')

const data = JSON.parse(readFileSync(questionsPath, 'utf-8'))
const questions = Array.isArray(data.questions) ? data.questions : []

describe('public/questions.json — длина вариантов ответа', () => {
  it('файл содержит вопросы', () => {
    expect(questions.length).toBeGreaterThan(0)
  })

  it('каждый вариант ответа укладывается в контент-правило (≤2 строк без ужатия)', () => {
    const violations = []

    questions.forEach((question) => {
      const answers = Array.isArray(question.answers) ? question.answers : []
      answers.forEach((answer, index) => {
        const { ok, reasons } = validateAnswerText(answer)
        if (!ok) {
          violations.push(`${question.id} answer[${index}] "${answer}" — ${reasons.join(', ')}`)
        }
      })
    })

    expect(violations, `Слишком длинные ответы:\n${violations.join('\n')}`).toEqual([])
  })

  it('нигде нет длинного/среднего тире — только дефис «-»', () => {
    const violations = []

    questions.forEach((question) => {
      const fields = [['question', question.question], ['explanation', question.explanation]]
      const answers = Array.isArray(question.answers) ? question.answers : []
      answers.forEach((answer, index) => fields.push([`answer[${index}]`, answer]))

      fields.forEach(([field, text]) => {
        if (!validateNoDashes(text).ok) {
          violations.push(`${question.id} ${field}: "${text}"`)
        }
      })
    })

    expect(violations, `Тире вместо дефиса:\n${violations.join('\n')}`).toEqual([])
  })

  it('нет запрещённых ЯИ тем (3.4): эзотерика/гадания/предсказания', () => {
    const violations = []

    questions.forEach((question) => {
      const fields = [['question', question.question], ['explanation', question.explanation]]
      const answers = Array.isArray(question.answers) ? question.answers : []
      answers.forEach((answer, index) => fields.push([`answer[${index}]`, answer]))

      fields.forEach(([field, text]) => {
        const { ok, reasons } = validateNoProhibited(text)
        if (!ok) violations.push(`${question.id} ${field}: ${reasons.join(', ')} — "${text}"`)
      })
    })

    expect(violations, `Запрещённый по 3.4 контент:\n${violations.join('\n')}`).toEqual([])
  })
})
