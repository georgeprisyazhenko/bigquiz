import { describe, expect, it } from 'vitest'
import {
  calculateRandomAnswerPoints,
  getRandomSpeedBonus,
  getRandomStreakMultiplier,
} from '../src/score-rules.js'

describe('score-rules: random mode speed bonus', () => {
  it('uses exact speed boundaries', () => {
    expect(getRandomSpeedBonus(4999)).toBe(50)
    expect(getRandomSpeedBonus(5000)).toBe(30)
    expect(getRandomSpeedBonus(9999)).toBe(30)
    expect(getRandomSpeedBonus(10000)).toBe(0)
  })
})

describe('score-rules: random mode streak multiplier', () => {
  it('uses multiplier by streak after the correct answer', () => {
    expect(getRandomStreakMultiplier(1)).toBe(1)
    expect(getRandomStreakMultiplier(2)).toBe(1)
    expect(getRandomStreakMultiplier(3)).toBe(1.1)
    expect(getRandomStreakMultiplier(4)).toBe(1.1)
    expect(getRandomStreakMultiplier(5)).toBe(1.25)
    expect(getRandomStreakMultiplier(9)).toBe(1.25)
    expect(getRandomStreakMultiplier(10)).toBe(1.5)
    expect(getRandomStreakMultiplier(14)).toBe(1.5)
    expect(getRandomStreakMultiplier(15)).toBe(2)
  })
})

describe('score-rules: random mode answer points', () => {
  it('calculates documented examples', () => {
    expect(calculateRandomAnswerPoints(4000, 1).gained).toBe(150)
    expect(calculateRandomAnswerPoints(7000, 5).gained).toBe(163)
    expect(calculateRandomAnswerPoints(4000, 10).gained).toBe(225)
    expect(calculateRandomAnswerPoints(12000, 15).gained).toBe(200)
  })
})
