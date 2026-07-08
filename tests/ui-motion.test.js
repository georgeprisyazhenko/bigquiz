import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const gameJs = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8')

function methodBody(name) {
  const marker = `  ${name}(`
  const start = gameJs.indexOf(marker)
  expect(start, `${name} method is missing`).toBeGreaterThanOrEqual(0)

  const bodyStart = gameJs.indexOf('{', start)
  let depth = 0
  for (let i = bodyStart; i < gameJs.length; i += 1) {
    if (gameJs[i] === '{') depth += 1
    if (gameJs[i] === '}') depth -= 1
    if (depth === 0) return gameJs.slice(bodyStart + 1, i)
  }

  throw new Error(`${name} method body is not closed`)
}

describe('arcade UI motion guards', () => {
  it('wrong answer shake moves only horizontally', () => {
    const body = methodBody('playArcadeWrongShake')

    expect(body).toMatch(/\bx:\s*`?\+=/)
    expect(body).not.toMatch(/\by\s*:/)
    expect(body).not.toMatch(/scale[XY]\s*:/)
  })

  it('answer press is the only answer motion that moves vertically', () => {
    const body = methodBody('playArcadeAnswerPress')

    expect(body).toMatch(/\by:\s*'\+=3'/)
    expect(body).not.toMatch(/\bx\s*:/)
  })

  it('arcade answer press runs only after choosing the correct answer', () => {
    const body = methodBody('renderArcadeAnswers')

    expect(body).toMatch(
      /if \(index === this\.currentCorrectAnswerIndex\) \{\s*this\.playArcadeAnswerPress/
    )
  })

  it('wrong answer branch uses the wrong-shake helper without starting raw tweens', () => {
    const body = methodBody('highlightArcadeAnswers')
    const wrongBranch = body.match(
      /if \(index === selectedAnswerIndex && !isCorrect\) \{([\s\S]*?)\n\s*return\n\s*\}/
    )?.[1]

    expect(wrongBranch).toBeTruthy()
    expect(wrongBranch).toMatch(/this\.playArcadeWrongShake\(visualTargets\)/)
    expect(wrongBranch).not.toMatch(/this\.tweens\.add/)
  })

  it('correct pulse and wrong shake share one feedback duration', () => {
    const correctBody = methodBody('playArcadeCorrectPulse')
    const wrongBody = methodBody('playArcadeWrongShake')

    expect(correctBody).toMatch(/duration:\s*ARCADE_FEEDBACK_DURATION_MS/)
    expect(wrongBody).toMatch(/duration:\s*ARCADE_FEEDBACK_DURATION_MS/)
  })

  it('score popup fades linearly without easing slowdown', () => {
    const body = methodBody('playScorePopupMotion')

    expect(body).toMatch(/ease:\s*'Linear'/)
    expect(body).toMatch(/alpha:\s*\{\s*from:\s*1,\s*to:\s*0\s*\}/)
  })

  it('streak display uses the current session record only after a streak reset', () => {
    const body = methodBody('formatStreakDisplay')

    expect(body).toMatch(/if \(!this\.hasSessionStreakRecord\)/)
    expect(body).toMatch(/return `\$\{this\.currentStreak\}`/)
    expect(body).toMatch(/return `\$\{this\.currentStreak\} \/ \$\{this\.sessionMaxStreak\}`/)
    expect(body).not.toMatch(/return `\$\{this\.currentStreak\} \/ \$\{this\.maxStreak\}`/)
  })

  it('current streak record highlight starts only after the session has a saved streak', () => {
    const body = methodBody('updateSessionStats')

    expect(body).toMatch(/const prevSessionMaxStreak = this\.sessionMaxStreak/)
    expect(body).toMatch(
      /this\.sessionMaxStreak = Math\.max\(this\.sessionMaxStreak, this\.currentStreak\)/
    )
    expect(body).toMatch(
      /this\.hasSessionStreakRecord && this\.currentStreak > prevSessionMaxStreak/
    )
    expect(body).toMatch(/this\.hasSessionStreakRecord = true/)
  })
})
