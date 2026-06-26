// 探针：emulateLocale fixture — addInitScript 兜底改写 navigator.language / languages
// （Emulation.setLocaleOverride 在 ArkWeb 下被 ack 但忽略）
import { test, expect } from '../dist/fixture.mjs'

test('locale: emulateLocale rewrites navigator.language', async ({ page, emulateLocale }) => {
  await emulateLocale('zh-CN')
  await page.goto('about:blank')
  const lang = await page.evaluate(() => navigator.language)
  const langs = await page.evaluate(() => navigator.languages.slice())
  console.log(`[PROBE locale] language="${lang}" languages=${JSON.stringify(langs)}`)
  expect(lang).toBe('zh-CN')
  expect(langs).toEqual(['zh-CN'])
})

test('locale: emulateLocale persists across same-origin navigation', async ({ page, emulateLocale }) => {
  await emulateLocale('fr-FR')
  await page.goto('about:blank')
  const lang1 = await page.evaluate(() => navigator.language)
  await page.goto('about:blank')
  const lang2 = await page.evaluate(() => navigator.language)
  console.log(`[PROBE locale-persist] nav1="${lang1}" nav2="${lang2}"`)
  expect(lang1).toBe('fr-FR')
  expect(lang2).toBe('fr-FR')
})
