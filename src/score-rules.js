export const RANDOM_BASE_POINTS = 100

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
