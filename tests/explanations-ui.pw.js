import { expect, test } from '@playwright/test'

test('help mode waits for next question button', async ({ page }) => {
  const events = []
  page.on('console', async (message) => {
    const args = message.args()
    if (args.length < 2) return

    try {
      const label = await args[0].jsonValue()
      const event = await args[1].jsonValue()
      if (label === '[BigQuiz event]' && event?.eventName) {
        events.push(event)
      }
    } catch (error) {
      // Console payloads from the browser can become unavailable after navigation.
    }
  })

  await page.goto('/')

  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  await expect
    .poll(() => events.some((event) => event.eventName === 'game_loaded'), {
      timeout: 10000,
    })
    .toBe(true)

  const helpToggleCenter = await page.evaluate(() => {
    const toggle = [...window.__scene.interactiveObjects].find((item) => {
      const hitArea = item.input?.hitArea
      return hitArea && item.x > 850 && item.y > 360 && hitArea.width > 120
    })
    const hitArea = toggle.input.hitArea
    return {
      x: toggle.x + hitArea.width / 2,
      y: toggle.y + hitArea.height / 2,
    }
  })
  await canvas.click({ position: helpToggleCenter })
  await expect
    .poll(() => page.evaluate(() => window.__scene?.explanationModeEnabled), {
      timeout: 3000,
    })
    .toBe(true)

  const answerCenter = await page.evaluate(() => {
    const answerButton = window.__scene.answerButtons[0]
    return {
      x: answerButton.button.x + answerButton.width / 2,
      y: answerButton.button.y + answerButton.height / 2,
    }
  })
  await canvas.click({ position: answerCenter })
  await page.waitForTimeout(2100)

  expect(events.filter((event) => event.eventName === 'question_shown')).toHaveLength(1)
  await expect
    .poll(() => page.evaluate(() => window.__scene?.answerState), {
      timeout: 1000,
    })
    .not.toBe('idle')

  const nextCenter = await page.evaluate(() => {
    const nextButton = window.__scene.explanationItems.find((item) => item?.input)
    const hitArea = nextButton.input?.hitArea
    return {
      x: nextButton.x + hitArea.width / 2,
      y: nextButton.y + hitArea.height / 2,
    }
  })
  await canvas.click({ position: nextCenter })

  await expect
    .poll(() => page.evaluate(() => window.__scene?.answerState), {
      timeout: 3000,
    })
    .toBe('idle')
  expect(events.filter((event) => event.eventName === 'question_shown')).toHaveLength(2)
})
