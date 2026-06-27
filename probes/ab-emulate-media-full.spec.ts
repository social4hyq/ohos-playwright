// 探针：page.emulateMedia 完整选项 —— 跨引擎 A/B
//
// 已知 colorScheme 工作（api-coverage.test.mts）。
// 本探针验证其余三个选项：
//   reducedMotion  ('no-preference' | 'reduce')
//   forcedColors   ('none' | 'active')
//   media          ('screen' | 'print' | null)
//
// 两条腿：
//   ArkWeb：OHOS_PW_HOST=1 ./dist/cli.mjs test --config=probes/playwright.config.ts \
//             probes/ab-emulate-media-full.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://172.16.100.2:9222 ./dist/cli.mjs test \
//             --config=probes/playwright.config.ts probes/ab-emulate-media-full.spec.ts
import { test, expect } from '@playwright/test'

test('ab-emulate-media-full: colorScheme dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  const matches = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  console.log(`[PROBE ab-emulate-media-full] colorScheme=dark matches=${matches}`)
  expect(matches).toBe(true)
})

test('ab-emulate-media-full: reducedMotion reduce', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const matches = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  console.log(`[PROBE ab-emulate-media-full] reducedMotion=reduce matches=${matches}`)
  // Not asserting — documents ArkWeb support status
})

test('ab-emulate-media-full: reducedMotion no-preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const matches = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: no-preference)').matches)
  console.log(`[PROBE ab-emulate-media-full] reducedMotion=no-preference matches=${matches}`)
})

test('ab-emulate-media-full: forcedColors active', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  const matches = await page.evaluate(() => window.matchMedia('(forced-colors: active)').matches)
  console.log(`[PROBE ab-emulate-media-full] forcedColors=active matches=${matches}`)
})

test('ab-emulate-media-full: forcedColors none', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'none' })
  const matches = await page.evaluate(() => window.matchMedia('(forced-colors: none)').matches)
  console.log(`[PROBE ab-emulate-media-full] forcedColors=none matches=${matches}`)
})

test('ab-emulate-media-full: media print', async ({ page }) => {
  await page.emulateMedia({ media: 'print' })
  const matchesPrint = await page.evaluate(() => window.matchMedia('print').matches)
  const matchesScreen = await page.evaluate(() => window.matchMedia('screen').matches)
  console.log(`[PROBE ab-emulate-media-full] media=print matchesPrint=${matchesPrint} matchesScreen=${matchesScreen}`)
})

test('ab-emulate-media-full: media screen (restore)', async ({ page }) => {
  await page.emulateMedia({ media: 'print' })
  await page.emulateMedia({ media: 'screen' })
  const matches = await page.evaluate(() => window.matchMedia('screen').matches)
  console.log(`[PROBE ab-emulate-media-full] media=screen-restore matches=${matches}`)
  expect(matches).toBe(true)
})

test('ab-emulate-media-full: combined colorScheme + reducedMotion', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  const [dark, reduced] = await page.evaluate(() => [
    window.matchMedia('(prefers-color-scheme: dark)').matches,
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ])
  console.log(`[PROBE ab-emulate-media-full] combined dark=${dark} reducedMotion=${reduced}`)
})
