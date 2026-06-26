// 探针：addInitScript（独立验证，popup 里隐式使用过但未单独测）
import { test } from '@playwright/test'

test('addInitScript: 在 goto 前注入全局变量', async ({ page }) => {
  try {
    await page.addInitScript(() => {
      (window as any).__probe_injected = 'hello-from-init'
    })
    await page.goto('data:text/html,<span id=o></span>')
    const val = await page.evaluate(() => (window as any).__probe_injected)
    console.log(`[PROBE initScript] RESULT val=${val} (hello-from-init=ok)`)
  } catch (e: any) {
    console.log(`[PROBE initScript] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('addInitScript: 跨 goto 持久（第二次导航仍注入）', async ({ page }) => {
  try {
    await page.addInitScript(() => {
      (window as any).__counter = ((window as any).__counter ?? 0) + 1
    })
    await page.goto('data:text/html,<b>p1</b>')
    const v1 = await page.evaluate(() => (window as any).__counter)
    await page.goto('data:text/html,<b>p2</b>')
    const v2 = await page.evaluate(() => (window as any).__counter)
    console.log(`[PROBE initScript-persist] RESULT p1=${v1} p2=${v2} (1,1=ok,ok)`)
  } catch (e: any) {
    console.log(`[PROBE initScript-persist] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('addInitScript: 注入字符串形式', async ({ page }) => {
  try {
    await page.addInitScript('window.__str_injected = "str-init"')
    await page.goto('data:text/html,<i>x</i>')
    const val = await page.evaluate(() => (window as any).__str_injected)
    console.log(`[PROBE initScript-str] RESULT val=${val} (str-init=ok)`)
  } catch (e: any) {
    console.log(`[PROBE initScript-str] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
