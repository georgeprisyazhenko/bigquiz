import { expect, test } from '@playwright/test'

test('guest leaderboard overlay opens', async ({ page }, testInfo) => {
  const events = []
  page.on('console', async (message) => {
    const args = message.args()
    if (args.length < 2) return

    try {
      const label = await args[0].jsonValue()
      const event = await args[1].jsonValue()
      if (label === '[BigQuiz event]' && event?.eventName) {
        events.push(event.eventName)
      }
    } catch (error) {
      // Console payloads from the browser can become unavailable after navigation.
    }
  })

  await page.goto('/')

  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  await expect.poll(() => events.includes('game_loaded'), { timeout: 10000 }).toBe(true)

  const leaderboardCenter = await page.evaluate(() => {
    const button = [...window.__scene.interactiveObjects].find((item) => {
      const hitArea = item.input?.hitArea
      return hitArea && item.x > 850 && item.y >= 300 && item.y < 380 && hitArea.width >= 120
    })
    const hitArea = button.input.hitArea
    return {
      x: button.x + hitArea.width / 2,
      y: button.y + hitArea.height / 2,
    }
  })
  await canvas.click({ position: leaderboardCenter })
  await expect.poll(() => events.includes('leaderboard_opened'), { timeout: 3000 }).toBe(true)

  const screenshot = await page.screenshot({
    fullPage: true,
    path: 'test-results/leaderboard-overlay.png',
  })
  await testInfo.attach('leaderboard-overlay', {
    body: screenshot,
    contentType: 'image/png',
  })
})
