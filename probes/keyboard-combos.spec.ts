// 探针：键盘组合键（Ctrl+A / Shift+Tab / Ctrl+C 等）
import { test } from '@playwright/test'

test('keyboard-combos: Ctrl+A 全选', async ({ page }) => {
  await page.goto('data:text/html,<input id=i value="hello world">')
  await page.locator('#i').focus()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  const val = await page.inputValue('#i')
  console.log(`[PROBE kbd-ctrl-a] RESULT val="${val}" (empty=ok)`)
})

test('keyboard-combos: Shift+Tab 反向 focus', async ({ page }) => {
  await page.goto(`data:text/html,
    <input id=a><input id=b><input id=c>
    <script>
      document.querySelectorAll('input').forEach(el =>
        el.addEventListener('focus', () => el.setAttribute('data-focused','1'))
      )
    </script>`)
  await page.locator('#c').focus()
  await page.keyboard.press('Shift+Tab')
  const focused = await page.evaluate(() => document.activeElement?.id)
  console.log(`[PROBE kbd-shift-tab] RESULT focused=${focused} (b=ok)`)
})

test('keyboard-combos: Ctrl+Z 撤销', async ({ page }) => {
  await page.goto('data:text/html,<input id=i>')
  await page.locator('#i').fill('abc')
  await page.locator('#i').focus()
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(100)
  const val = await page.inputValue('#i')
  console.log(`[PROBE kbd-ctrl-z] RESULT val="${val}" (撤销后值，空或abc减少=ok)`)
})

test('keyboard-combos: 修饰键 Shift+ArrowRight 选中字符', async ({ page }) => {
  await page.goto('data:text/html,<input id=i value="abcdef">')
  await page.locator('#i').focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  // 选中后删除，应剩 def
  await page.keyboard.press('Delete')
  const val = await page.inputValue('#i')
  console.log(`[PROBE kbd-shift-arrow] RESULT val="${val}" (def=ok)`)
})

test('keyboard-combos: Meta/Alt 键（仅测不报错）', async ({ page }) => {
  await page.goto('data:text/html,<input id=i>')
  try {
    await page.keyboard.press('Alt+ArrowLeft')
    console.log(`[PROBE kbd-alt] RESULT=ok`)
  } catch (e: any) {
    console.log(`[PROBE kbd-alt] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
