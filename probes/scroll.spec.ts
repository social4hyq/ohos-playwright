// 探针：mouse.wheel no-op 确认 + evaluate scrollTo 绕过验证
import { test } from '@playwright/test'

const PAGE_HTML = `data:text/html,
  <div id=box style="height:200px;overflow-y:scroll;border:1px solid">
    <div style="height:1000px;background:linear-gradient(blue,red)"></div>
  </div>`

test('scroll: mouse.wheel 命令是否生效', async ({ page }) => {
  await page.goto(PAGE_HTML)
  const box = await page.locator('#box').boundingBox()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2
  const before = await page.locator('#box').evaluate((el: HTMLElement) => el.scrollTop)
  try {
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(300)
  } catch (e: any) {
    console.log(`[PROBE scroll-wheel] RESULT=error err=${e.message.split('\n')[0]}`)
  }
  const after = await page.locator('#box').evaluate((el: HTMLElement) => el.scrollTop)
  console.log(`[PROBE scroll-wheel] RESULT before=${before} after=${after} delta=${after - before}`)
})

test('scroll: evaluate scrollTo 绕过', async ({ page }) => {
  await page.goto(PAGE_HTML)
  await page.locator('#box').evaluate((el: HTMLElement) => el.scrollTo({ top: 200 }))
  await page.waitForTimeout(100)
  const st = await page.locator('#box').evaluate((el: HTMLElement) => el.scrollTop)
  console.log(`[PROBE scroll-evaluate] RESULT scrollTop=${st} (200=ok)`)
})

test('scroll: window.scrollTo page-level', async ({ page }) => {
  await page.goto(`data:text/html,<div style="height:3000px"></div>`)
  await page.evaluate(() => window.scrollTo(0, 500))
  await page.waitForTimeout(100)
  const y = await page.evaluate(() => window.scrollY)
  console.log(`[PROBE scroll-window] RESULT scrollY=${y} (500=ok)`)
})
