// 探针：accessibility snapshot + role= selector
import { test, expect } from '@playwright/test'

test('accessibility: page.accessibility.snapshot', async ({ page }) => {
  await page.goto(`data:text/html,
    <button id=b>Save</button>
    <nav><a href="/x">Link</a></nav>
    <input id=i type=checkbox checked>`)
  try {
    const snap = await Promise.race([
      page.accessibility.snapshot(),
      new Promise<any>(r => setTimeout(() => r(null), 5000)),
    ])
    if (snap) {
      console.log(`[PROBE2 a11y-snapshot] RESULT got=root role=${snap.role} children=${snap.children?.length ?? 0}`)
    } else {
      console.log(`[PROBE2 a11y-snapshot] RESULT=timeout`)
    }
  } catch (e: any) {
    console.log(`[PROBE2 a11y-snapshot] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('role=: get_by_role selector', async ({ page }) => {
  await page.goto(`data:text/html,
    <button id=b>Save</button>
    <a href="/x">Link</a>`)
  try {
    const btnText = await page.getByRole('button', { name: 'Save' }).textContent()
    console.log(`[PROBE2 role-button] RESULT text=${btnText}`)
  } catch (e: any) {
    console.log(`[PROBE2 role-button] RESULT=error err=${e.message.split('\n')[0]}`)
  }
  try {
    const linkText = await page.getByRole('link').first().textContent()
    console.log(`[PROBE2 role-link] RESULT text=${linkText}`)
  } catch (e: any) {
    console.log(`[PROBE2 role-link] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('复杂选择器: :has-text / :has', async ({ page }) => {
  await page.goto(`data:text/html,
    <ul><li>apple</li><li>banana</li></ul>
    <div class=c><span class=t>target</span></div>`)
  try {
    const t1 = await page.locator('li:has-text("banana")').textContent()
    console.log(`[PROBE2 has-text] RESULT text=${t1}`)
  } catch (e: any) {
    console.log(`[PROBE2 has-text] RESULT=error err=${e.message.split('\n')[0]}`)
  }
  try {
    const t2 = await page.locator('div:has(span.t)').locator('span').textContent()
    console.log(`[PROBE2 has] RESULT text=${t2}`)
  } catch (e: any) {
    console.log(`[PROBE2 has] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
