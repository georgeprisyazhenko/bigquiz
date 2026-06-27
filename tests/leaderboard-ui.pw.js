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

  await canvas.click({ position: { x: 978, y: 330 } })
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
