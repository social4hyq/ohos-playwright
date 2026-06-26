// 探针：screenshot（page / locator）
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'

test('screenshot: page.png', async ({ page }) => {
  await page.goto('data:text/html,<div style="width:100px;height:100px;background:red"></div>')
  const buf = await page.screenshot({ type: 'png' })
  writeFileSync('/storage/Users/currentUser/.tmp/probe-page.png', buf)
  console.log(`[PROBE screenshot-page] RESULT bytes=${buf.length}`)
})

test('screenshot: page.jpeg', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const buf = await page.screenshot({ type: 'jpeg', quality: 80 })
  console.log(`[PROBE screenshot-jpeg] RESULT bytes=${buf.length}`)
})

test('screenshot: locator', async ({ page }) => {
  await page.goto('data:text/html,<div id=t style="width:50px;height:50px;background:blue">t</div>')
  const buf = await page.locator('#t').screenshot()
  console.log(`[PROBE screenshot-locator] RESULT bytes=${buf.length}`)
})
