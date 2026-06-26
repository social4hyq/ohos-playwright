// 探针：exposeFunction / exposeBinding（page ↔ Node 通信）
import { test } from '@playwright/test'

test('exposeFunction: 页面调用 Node 函数', async ({ page }) => {
  try {
    await page.exposeFunction('nodeAdd', (a: number, b: number) => a + b)
    await page.goto('data:text/html,<span id=o></span>')
    const result = await page.evaluate(async () => {
      return await (window as any).nodeAdd(3, 4)
    })
    console.log(`[PROBE exposeFunction] RESULT result=${result} (7=ok)`)
  } catch (e: any) {
    console.log(`[PROBE exposeFunction] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('exposeFunction: 跨 goto 保持注册', async ({ page }) => {
  try {
    await page.exposeFunction('nodeGreet', (name: string) => `hello-${name}`)
    await page.goto('data:text/html,<b>p1</b>')
    const v1 = await page.evaluate(async () => (window as any).nodeGreet('world'))
    await page.goto('data:text/html,<b>p2</b>')
    const v2 = await page.evaluate(async () => (window as any).nodeGreet('ohos'))
    console.log(`[PROBE exposeFunction-persist] RESULT v1=${v1} v2=${v2}`)
  } catch (e: any) {
    console.log(`[PROBE exposeFunction-persist] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('exposeBinding: 带 source（page/frame/element 信息）', async ({ page }) => {
  const received: any[] = []
  try {
    await page.exposeBinding('nodeBinding', (source, val: string) => {
      received.push({ url: source.page.url(), val })
      return `bound:${val}`
    })
    await page.goto('data:text/html,<span id=o></span>')
    const result = await page.evaluate(async () => (window as any).nodeBinding('test'))
    console.log(`[PROBE exposeBinding] RESULT result=${result} receivedCount=${received.length} url=${received[0]?.url}`)
  } catch (e: any) {
    console.log(`[PROBE exposeBinding] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('exposeBinding: handle 模式（传 JSHandle）', async ({ page }) => {
  try {
    await page.exposeBinding('nodeHandle', async (source, handle) => {
      const val = await handle.jsonValue()
      return `handle:${JSON.stringify(val)}`
    }, { handle: true })
    await page.goto('data:text/html,<div id=t data-x=42></div>')
    const result = await page.evaluate(async () => {
      const el = document.getElementById('t')
      return (window as any).nodeHandle(el)
    })
    console.log(`[PROBE exposeBinding-handle] RESULT result=${result}`)
  } catch (e: any) {
    console.log(`[PROBE exposeBinding-handle] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
