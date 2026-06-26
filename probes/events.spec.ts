// 探针：page events（console / pageerror）
import { test, expect } from '@playwright/test'

test('events: console.log captured', async ({ page }) => {
  const logs: string[] = []
  page.on('console', m => logs.push(m.type() + ':' + m.text()))
  await page.goto('data:text/html,<script>console.log("hello-event")</script>')
  await page.waitForTimeout(500)
  console.log(`[PROBE console-event] RESULT logs=${JSON.stringify(logs)}`)
})

test('events: pageerror captured', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('data:text/html,<script>setTimeout(()=>{throw new Error("boom")},100)</script>')
  await page.waitForTimeout(800)
  console.log(`[PROBE pageerror-event] RESULT errors=${JSON.stringify(errors)}`)
})
