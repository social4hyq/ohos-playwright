// 探针：frame / iframe
import { test, expect } from '@playwright/test'

test('frames: page.frames() + mainFrame', async ({ page }) => {
  await page.goto('data:text/html,<iframe src="data:text/html,<p>inner</p>"></iframe>')
  await page.frameLocator('iframe').locator('p').waitFor({ timeout: 3000 }).catch(() => {})
  const frames = page.frames()
  console.log(`[PROBE frames] RESULT frames_count=${frames.length} mainFrame=${page.mainFrame().url()}`)
  for (const f of frames) console.log(`  frame: url=${f.url()}`)
})

test('frames: nested iframe content', async ({ page }) => {
  await page.goto('data:text/html,<h1>outer</h1><iframe src="data:text/html,<h2>inner</h2>"></iframe>')
  await page.waitForTimeout(500)
  const inner = page.frames().find(f => f !== page.mainFrame())
  if (inner) {
    try {
      const text = await inner.evaluate(() => document.querySelector('h2')?.textContent)
      console.log(`[PROBE frames-nested] RESULT=ok inner_text=${text}`)
    } catch (e: any) {
      console.log(`[PROBE frames-nested] RESULT=eval-error err=${e.message}`)
    }
  } else {
    console.log(`[PROBE frames-nested] RESULT=no-inner-frame`)
  }
})
