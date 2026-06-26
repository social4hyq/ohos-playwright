// 探针：storage（localStorage / sessionStorage / cookies）
import { test, expect } from '@playwright/test'

test('storage: localStorage set/get', async ({ page }) => {
  await page.goto('data:text/html,<h1>s</h1>')
  await page.evaluate(() => localStorage.setItem('k', 'v'))
  const v = await page.evaluate(() => localStorage.getItem('k'))
  console.log(`[PROBE localStorage] RESULT val=${v}`)
})

test('storage: sessionStorage', async ({ page }) => {
  await page.goto('data:text/html,<h1>s</h1>')
  await page.evaluate(() => sessionStorage.setItem('sk', 'sv'))
  const v = await page.evaluate(() => sessionStorage.getItem('sk'))
  console.log(`[PROBE sessionStorage] RESULT val=${v}`)
})

test('storage: cookies add/get/clear', async ({ context }) => {
  try {
    await context.addCookies([{ name: 'c', value: '1', url: 'http://localhost' }])
    const cs = await context.cookies()
    console.log(`[PROBE cookies] RESULT after-add count=${cs.length}`)
    await context.clearCookies()
    const cs2 = await context.cookies()
    console.log(`[PROBE cookies] RESULT after-clear count=${cs2.length}`)
  } catch (e: any) {
    console.log(`[PROBE cookies] RESULT=error err=${e.message}`)
  }
})
