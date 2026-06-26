// 探针：popup（window.open）— ohos-playwright fixture 有 stub popup 机制
import { test, expect } from '@playwright/test'

test('popup: window.open + waitForEvent(page)', async ({ page, context }) => {
  await page.goto('data:text/html,<button id=b>open</button>')
  await page.evaluate(() => {
    (document.getElementById('b')!).addEventListener('click', () => window.open('https://example.com'))
  })
  const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(e => null)
  await page.click('#b')
  const popup = await popupPromise
  if (popup) {
    console.log(`[PROBE popup] RESULT=ok url=${popup.url()}`)
  } else {
    console.log(`[PROBE popup] RESULT=timeout-or-none`)
  }
})
