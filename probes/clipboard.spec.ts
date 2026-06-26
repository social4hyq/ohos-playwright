// 探针：clipboard（permissions + read/writeText）
import { test, expect } from '@playwright/test'

test('clipboard: writeText + readText', async ({ page, context }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate(() => navigator.clipboard.writeText('clip-test'))
    const v = await page.evaluate(() => navigator.clipboard.readText())
    console.log(`[PROBE clipboard] RESULT val=${v}`)
  } catch (e: any) {
    console.log(`[PROBE clipboard] RESULT=error err=${e.message}`)
  }
})
