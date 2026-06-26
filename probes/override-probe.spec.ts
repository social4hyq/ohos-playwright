// 验证：能否在 fixture 里覆盖 browser.newContext（先确认对象可写）
import { test, expect } from '@playwright/test'

test('probe: browser.newContext 是否可覆盖', async ({ browser }) => {
  const desc = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(browser),
    'newContext',
  )
  console.log(`[PROBE-OVERRIDE] newContext desc on proto:`, desc ? {
    writable: desc.writable,
    configurable: desc.configurable,
    has: 'value' in desc || 'get' in desc,
  } : 'not-found')

  // 尝试直接赋值
  const orig = browser.newContext.bind(browser)
  let intercepted = false
  try {
    ;(browser as any).newContext = (...args: any[]) => {
      intercepted = true
      return orig(...args)
    }
    await browser.newContext()
    console.log(`[PROBE-OVERRIDE] direct-assign intercepted=${intercepted}`)
  } catch (e: any) {
    console.log(`[PROBE-OVERRIDE] direct-assign err=${e.message}`)
  }
})
