// 探针：tracing（connectOverCDP 下能否采集）
import { test, expect } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'

test('tracing: start/stop/tracePath', async ({ page, context }) => {
  const tracePath = '/storage/Users/currentUser/.tmp/probe-trace.zip'
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    await page.goto('data:text/html,<h1>trace-me</h1>')
    await page.locator('h1').click()
    await context.tracing.stop({ path: tracePath })
    const exists = existsSync(tracePath)
    const size = exists ? statSync(tracePath).size : 0
    console.log(`[PROBE tracing] RESULT exists=${exists} size=${size}`)
  } catch (e: any) {
    console.log(`[PROBE tracing] RESULT=error err=${e.message}`)
  }
})
