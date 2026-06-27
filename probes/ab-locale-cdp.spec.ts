// 探针：Emulation.setLocaleOverride 是否在 ArkWeb 真正生效
//
// fixture.mts:384-391 用 addInitScript 覆盖 navigator.language，
// 因为 ArkWeb 的 Emulation.setLocaleOverride 被 ack 但不生效。
// 本探针直接验证 CDP 命令效果，对比 Edge 行为。
//
// 通过标准：navigator.language === 'ja-JP'（或指定 locale）
// 两条腿：
//   ArkWeb：OHOS_PW_HOST=1 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-locale-cdp.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://172.16.100.2:9222 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-locale-cdp.spec.ts
import { test } from '@playwright/test'

const TARGET_LOCALE = 'ja-JP'

test('ab-locale-cdp: Emulation.setLocaleOverride via CDP session', async ({ page }) => {
  const session = await page.context().newCDPSession(page)

  let setResult = ''
  try {
    await (session as any).send('Emulation.setLocaleOverride', { locale: TARGET_LOCALE })
    setResult = 'ok'
  } catch (e: unknown) {
    setResult = `throw:${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`
  }

  await page.goto('data:text/html,<div></div>')

  const lang = await page.evaluate(() => navigator.language)
  const langs = await page.evaluate(() => JSON.stringify(Array.from(navigator.languages)))
  const matches = lang === TARGET_LOCALE

  console.log(
    `[PROBE ab-locale-cdp] setLocaleOverride=${setResult}` +
    ` navigator.language="${lang}" languages=${langs} matches=${matches}` +
    ` (${matches ? 'CDP works → fixture removable' : 'CDP ignored → fixture needed'})`,
  )

  await session.detach()
})

test('ab-locale-cdp: fixture emulateLocale via addInitScript (baseline)', async ({ page, emulateLocale }) => {
  await emulateLocale(TARGET_LOCALE)
  await page.goto('data:text/html,<div></div>')
  const lang = await page.evaluate(() => navigator.language)
  const matches = lang === TARGET_LOCALE
  console.log(
    `[PROBE ab-locale-cdp] initScript-emulateLocale="${lang}" matches=${matches}`,
  )
})
