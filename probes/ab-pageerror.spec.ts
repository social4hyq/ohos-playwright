// 探针：evaluate() 内 throw 是否原生触发 pageerror（不依赖 fixture wrapper）
//
// fixture.mts:174-182 包装了 page.evaluate()，catch 异常后手动 emit('pageerror')。
// 本探针验证：若移除该 wrapper，ArkWeb CDP 是否会自动触发 pageerror。
//
// 预期结论：不会（CDP 将 evaluate 异常作为 promise rejection 处理，
//   不触发 Runtime.exceptionThrown），因此 wrapper 应保留。
// 如果意外地通过（pageerror 自然触发）→ wrapper 可安全删除。
//
// 两条腿：
//   ArkWeb：OHOS_PW_HOST=1 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-pageerror.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://172.16.100.2:9222 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-pageerror.spec.ts
import { test } from '@playwright/test'

test('ab-pageerror: throw in evaluate → native pageerror without wrapper?', async ({ page }) => {
  const nativeErrors: string[] = []
  page.on('pageerror', (e) => nativeErrors.push(e.message))

  await page.goto('data:text/html,<div></div>')

  // Remove the fixture's evaluate wrapper (restore prototype method).
  // The fixture sets page.evaluate as an instance own-property override.
  // Deleting it falls back to Page.prototype.evaluate (the real Playwright impl).
  const savedWrapper = Object.getOwnPropertyDescriptor(page, 'evaluate')
  if (savedWrapper) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (page as any).evaluate
  }

  try {
    // Call the real evaluate — should reject, not become pageerror
    try {
      await page.evaluate(() => { throw new Error('native-throw-test') })
    } catch {
      // Promise rejection expected; note whether pageerror also fires
    }

    await page.waitForTimeout(300)
    const naturalFired = nativeErrors.some((m) => m.includes('native-throw-test'))
    console.log(
      `[PROBE ab-pageerror] wrapper-bypassed native-pageerror-fired=${naturalFired}` +
      ` (${naturalFired ? 'wrapper can be removed' : 'wrapper still needed'})`,
    )

    // Also test: uncaught window-level error (not via evaluate) — does pageerror fire?
    nativeErrors.length = 0
    await page.addScriptTag({ content: 'setTimeout(()=>{ throw new Error("uncaught-window") },10)' })
    await page.waitForTimeout(300)
    const windowFired = nativeErrors.some((m) => m.includes('uncaught-window'))
    console.log(`[PROBE ab-pageerror] uncaught-window-pageerror-fired=${windowFired}`)
  } finally {
    // Restore wrapper
    if (savedWrapper) {
      Object.defineProperty(page, 'evaluate', savedWrapper)
    }
  }
})

test('ab-pageerror: WITH fixture wrapper → pageerror fires on throw', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('data:text/html,<div></div>')

  try {
    await page.evaluate(() => { throw new Error('wrapper-throw-test') })
  } catch {
    // May or may not reject depending on wrapper behavior
  }

  await page.waitForTimeout(200)
  const fired = errors.some((m) => m.includes('wrapper-throw-test'))
  console.log(`[PROBE ab-pageerror] with-fixture-wrapper pageerror-fired=${fired}`)
})
