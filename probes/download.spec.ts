// 探针：download
import { test, expect } from '@playwright/test'

test('download: a[download] click', async ({ page }) => {
  await page.goto('data:text/html,<a id=dl download="x.txt" href="data:text/plain,hello">dl</a>')
  const start = Date.now()
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      page.click('#dl'),
    ])
    if (download) {
      console.log(`[PROBE download] RESULT=ok suggested=${download.suggestedFilename()} elapsed=${Date.now()-start}ms`)
    } else {
      console.log(`[PROBE download] RESULT=no-event elapsed=${Date.now()-start}ms`)
    }
  } catch (e: any) {
    console.log(`[PROBE download] RESULT=error err=${e.message}`)
  }
})
