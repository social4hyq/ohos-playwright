// 探针：page.coverage JS/CSS（Chromium-only API）
import { test } from '@playwright/test'

test('coverage: JS coverage startJSCoverage / stopJSCoverage', async ({ page }) => {
  try {
    await page.coverage.startJSCoverage()
    await page.goto(`data:text/html,
      <script>
        function add(a,b){return a+b}
        function unused(){return 42}
        add(1,2)
      </script>`)
    const entries = await page.coverage.stopJSCoverage()
    console.log(`[PROBE coverage-js] RESULT entryCount=${entries.length}`)
    if (entries.length > 0) {
      const e = entries[0]
      console.log(`[PROBE coverage-js] RESULT url=${e.url.slice(0, 60)} rangeCount=${e.ranges.length}`)
    }
  } catch (e: any) {
    console.log(`[PROBE coverage-js] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('coverage: CSS coverage startCSSCoverage / stopCSSCoverage', async ({ page }) => {
  try {
    await page.coverage.startCSSCoverage()
    await page.goto(`data:text/html,
      <style>
        .used { color: red }
        .unused { color: blue }
      </style>
      <div class=used>hello</div>`)
    const entries = await page.coverage.stopCSSCoverage()
    console.log(`[PROBE coverage-css] RESULT entryCount=${entries.length}`)
    if (entries.length > 0) {
      const e = entries[0]
      console.log(`[PROBE coverage-css] RESULT url=${e.url.slice(0, 60)} rangeCount=${e.ranges.length} textLen=${e.text?.length ?? 0}`)
    }
  } catch (e: any) {
    console.log(`[PROBE coverage-css] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('coverage: JS coverage resetOnNavigation=false 跨页累积', async ({ page }) => {
  try {
    await page.coverage.startJSCoverage({ resetOnNavigation: false })
    await page.goto('data:text/html,<script>function f1(){}</script>')
    await page.goto('data:text/html,<script>function f2(){}</script>')
    const entries = await page.coverage.stopJSCoverage()
    console.log(`[PROBE coverage-js-multi] RESULT entryCount=${entries.length} (>=2=ok with resetOnNavigation=false)`)
  } catch (e: any) {
    console.log(`[PROBE coverage-js-multi] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
