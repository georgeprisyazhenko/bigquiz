export const RANDOM_BASE_POINTS = 100
export const ACCURACY_BONUS_MIN_ANSWERS = 10

export function getRandomSpeedBonus(answerTimeMs) {
  if (answerTimeMs < 5000) return 50
  if (answerTimeMs < 10000) return 30
  return 0
}

export function getRandomStreakMultiplier(streak) {
  if (streak >= 15) return 2
  if (streak >= 10) return 1.5
  if (streak >= 5) return 1.25
  return 1
}

export function calculateRandomAnswerPoints(answerTimeMs, streakAfterCorrect) {
  const speedBonus = getRandomSpeedBonus(answerTimeMs)
  const multiplier = getRandomStreakMultiplier(streakAfterCorrect)
  const gained = Math.round((RANDOM_BASE_POINTS + speedBonus) * multiplier)

  return { gained, speedBonus, multiplier }
}

export function calculateAccuracyBonus(correctAnswers, totalAnswers) {
  if (totalAnswers < ACCURACY_BONUS_MIN_ANSWERS) return 0

  const percent = totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0
  if (percent === 100) return 1000
  if (percent >= 80) return 600
  if (percent >= 50) return 300
  return 0
}

export function calculateBlitzFinalScore(answerScore, correctAnswers, totalAnswers) {
  const accuracyPercent = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0
  const accuracyBonus = calculateAccuracyBonus(correctAnswers, totalAnswers)

  return {
    answerScore,
    accuracyBonus,
    accuracyPercent,
    finalScore: answerScore + accuracyBonus,
  }
}
