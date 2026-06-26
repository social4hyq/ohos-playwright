// 探针：web worker / service worker
import { test, expect } from '@playwright/test'

test('worker: page.workers() 列表', async ({ page }) => {
  await page.goto('data:text/html,<span id=o></span><script>const w=new Worker("data:application/javascript,self.onmessage=e=>postMessage(e.data+1);");w.onmessage=e=>document.getElementById("o").textContent=e.data;w.postMessage(41);</script>')
  await page.waitForTimeout(500)
  try {
    const workers = page.workers()
    console.log(`[PROBE webworker] RESULT workers_count=${workers.length}`)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE webworker] RESULT output=${out} (预期42)`)
  } catch (e: any) {
    console.log(`[PROBE webworker] RESULT=error err=${e.message}`)
  }
})

test('serviceWorker: 注册 + context 等待', async ({ page, context }) => {
  // 用 data: 注册 SW 不被允许，跳过实际注册，仅探测 API 是否报错
  try {
    const swPromise = context.waitForEvent('serviceworker', { timeout: 3000 }).catch(() => null)
    // 仍尝试在 data: 页面里注册（预期失败但记录行为）
    const regErr = await page.evaluate(async () => {
      try {
        await navigator.serviceWorker.register('data:application/javascript,')
        return 'ok'
      } catch (e: any) { return e.message }
    })
    console.log(`[PROBE serviceWorker] RESULT reg-result=${regErr}`)
    const sw = await swPromise
    console.log(`[PROBE serviceWorker] RESULT sw-event=${sw ? 'got' : 'timeout'}`)
  } catch (e: any) {
    console.log(`[PROBE serviceWorker] RESULT=error err=${e.message}`)
  }
})
