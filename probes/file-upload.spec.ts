// 探针：file upload（setInputFiles）— ArkWeb 文件选择器
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'

test('fileUpload: setInputFiles + 输入读取', async ({ page }) => {
  const tmpFile = '/storage/Users/currentUser/.tmp/probe-upload.txt'
  writeFileSync(tmpFile, 'hello-upload')
  await page.goto('data:text/html,<input id=f type=file><span id=o></span>')
  await page.evaluate(() => {
    ;(document.getElementById('f') as HTMLInputElement).addEventListener('change', async () => {
      const f = (document.getElementById('f') as HTMLInputElement).files![0]
      const t = await f.text()
      ;(document.getElementById('o') as HTMLElement).textContent = t
    })
  })
  try {
    await page.setInputFiles('#f', tmpFile)
    await page.waitForTimeout(500)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE fileUpload] RESULT file-content=${out}`)
  } catch (e: any) {
    console.log(`[PROBE fileUpload] RESULT=error err=${e.message}`)
  }
})
