// 探针：page.pdf（Chromium-only API，ArkWeb 是否实现 Page.printToPDF）
import { test, expect } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'

test('pdf: page.pdf 生成', async ({ page }) => {
  await page.goto('data:text/html,<h1>PDF Content</h1><p>line2</p>')
  const pdfPath = '/storage/Users/currentUser/.tmp/probe-out.pdf'
  try {
    const buf = await page.pdf({ format: 'A4' })
    console.log(`[PROBE pdf] RESULT bytes=${buf.length} header=${buf.slice(0,4).toString('ascii')}`)
  } catch (e: any) {
    console.log(`[PROBE pdf] RESULT=error err=${e.message}`)
  }
})
