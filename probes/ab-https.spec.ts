// HTTPS 安全上下文下的 A/B 探针
// 用 https://www.baidu.com 区分 ArkWeb vs Chrome/Edge 真实能力（避免 data:/about:blank 非安全上下文干扰）
import { test } from '@playwright/test'
// 推荐按顺序选择：baidu.com（国内极稳）、cn.bing.com（国内 + 微软）、example.com（国际极简但部分网络不可达）
const HTTPS_PAGE = 'https://www.baidu.com'

test('ab-https: ServiceWorkerContainer class + register attempt', async ({ page }) => {
  await page.goto(HTTPS_PAGE, { waitUntil: 'domcontentloaded' })
  const swc = await page.evaluate(() => typeof ServiceWorkerContainer)
  const inNav = await page.evaluate(() => 'serviceWorker' in navigator)
  const isSecure = await page.evaluate(() => window.isSecureContext)
  const swReg = await page.evaluate(async () => {
    try {
      await navigator.serviceWorker.register('/ohos-pw-sw-nonexistent-test.js')
      return 'registered'
    } catch (e: any) {
      return `${e.name}:${e.message?.split('\n')[0]?.slice(0, 80)}`
    }
  })
  console.log(`[PROBE ab-https] ServiceWorkerContainer=${swc} inNavigator=${inNav} isSecureContext=${isSecure}`)
  console.log(`[PROBE ab-https] sw-register=${swReg}`)
  // Chrome/Edge: swc="function", inNav=true, swReg 报 TypeError/NetworkError（文件不存在，但 API 工作）
  // ArkWeb 若不支持: swReg 报 NotSupportedError
})

test('ab-https: Clipboard read/write on HTTPS', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
  await page.goto(HTTPS_PAGE, { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(async () => {
    try {
      await navigator.clipboard.writeText('ohos-pw-test')
      const txt = await navigator.clipboard.readText()
      return `ok:${txt}`
    } catch (e: any) {
      return `throw:${e.name}:${e.message?.slice(0, 60)}`
    }
  })
  console.log(`[PROBE ab-https] clipboard=${result}`)
  // Chrome/Edge 预期: ok:ohos-pw-test  ArkWeb 若未接系统剪贴板: throw:...
})

test('ab-https: navigator.userAgent', async ({ page }) => {
  await page.goto(HTTPS_PAGE, { waitUntil: 'domcontentloaded' })
  const ua = await page.evaluate(() => navigator.userAgent)
  console.log(`[PROBE ab-https] ua="${ua}"`)
})
