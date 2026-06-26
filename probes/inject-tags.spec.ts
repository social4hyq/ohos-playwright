// 探针：addScriptTag / addStyleTag
import { test } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

test('addScriptTag: content 字符串注入', async ({ page }) => {
  await page.goto('data:text/html,<span id=o></span>')
  try {
    await page.addScriptTag({ content: 'window.__injected = "script-tag"' })
    const val = await page.evaluate(() => (window as any).__injected)
    console.log(`[PROBE addScriptTag-content] RESULT val=${val} (script-tag=ok)`)
  } catch (e: any) {
    console.log(`[PROBE addScriptTag-content] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('addScriptTag: type=module', async ({ page }) => {
  await page.goto('data:text/html,<span id=o></span>')
  try {
    await page.addScriptTag({
      content: 'window.__module_injected = "module-ok"',
      type: 'module',
    })
    await page.waitForTimeout(200)
    const val = await page.evaluate(() => (window as any).__module_injected)
    console.log(`[PROBE addScriptTag-module] RESULT val=${val} (module-ok=ok)`)
  } catch (e: any) {
    console.log(`[PROBE addScriptTag-module] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('addStyleTag: content 字符串注入', async ({ page }) => {
  await page.goto('data:text/html,<div id=t>hello</div>')
  try {
    await page.addStyleTag({ content: '#t { color: rgb(255, 0, 0); }' })
    const color = await page.locator('#t').evaluate(el => getComputedStyle(el).color)
    console.log(`[PROBE addStyleTag-content] RESULT color=${color} (rgb(255,0,0)=ok)`)
  } catch (e: any) {
    console.log(`[PROBE addStyleTag-content] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('addScriptTag: path 本地文件', async ({ page }) => {
  const tmp = path.join(os.tmpdir(), 'probe-inject.js')
  fs.writeFileSync(tmp, 'window.__path_injected = "from-file"')
  await page.goto('data:text/html,<span id=o></span>')
  try {
    await page.addScriptTag({ path: tmp })
    const val = await page.evaluate(() => (window as any).__path_injected)
    console.log(`[PROBE addScriptTag-path] RESULT val=${val} (from-file=ok)`)
  } catch (e: any) {
    console.log(`[PROBE addScriptTag-path] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    fs.unlinkSync(tmp)
  }
})
