// 探针：dialog（alert/confirm/prompt）
import { test, expect } from '@playwright/test'

test('dialog: alert accept', async ({ page }) => {
  await page.goto('data:text/html,<button id=b onclick="alert(\'hi\')">x</button>')
  const dialogs: string[] = []
  page.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message()); await d.accept().catch(()=>{}) })
  await page.click('#b')
  await page.waitForTimeout(300)
  console.log(`[PROBE dialog] RESULT dialogs=${JSON.stringify(dialogs)}`)
})

test('dialog: confirm + dismiss', async ({ page }) => {
  await page.goto('data:text/html,<button id=b onclick="confirm(\'q?\')">x</button>')
  const dialogs: string[] = []
  page.on('dialog', async d => { dialogs.push(d.type()); await d.dismiss().catch(()=>{}) })
  await page.click('#b')
  await page.waitForTimeout(300)
  console.log(`[PROBE dialog-confirm] RESULT dialogs=${JSON.stringify(dialogs)}`)
})
