# Component Testing (CT) — Feasibility Report

**Conclusion: NOT SUPPORTED in connectOverCDP mode**

## Why CT doesn't work with ohos-playwright

Playwright Component Testing (`@playwright/experimental-ct-vue`, `-react`, `-svelte`) requires:

1. `browserType.launch()` — CT spawns a fresh Chromium/Firefox/WebKit instance it controls
2. A Vite dev server that the browser loads a special `index.html` from
3. The `mount()` fixture communicates with the Vite server via WebSocket from inside the browser

ohos-playwright uses `chromium.connectOverCDP()` to attach to an **already-running** ArkWeb or Edge browser. There is no `launch()` call. The CT runner's fixture system assumes it owns the browser lifecycle, which is incompatible with `connectOverCDP`.

**Specific failure mode:** `@playwright/experimental-ct-vue` fixture setup calls
`browserType.launch(launchOptions)` internally. In connectOverCDP mode, Playwright re-routes this to a no-op or throws — either way, the `mount()` function cannot establish its control channel.

## Alternative: use `page.goto()` + `page.addScriptTag()` + `page.evaluate()`

For testing Vue/React/Svelte components against ArkWeb, the closest viable pattern is:

```typescript
import { test, expect } from 'ohos-playwright'

test('component renders', async ({ page }) => {
  // Serve a component bundle from Node.js
  await page.goto('data:text/html,<!DOCTYPE html><div id="app"></div>')
  await page.addScriptTag({ url: 'http://localhost:5173/src/MyComponent.js' })
  await page.evaluate(() => {
    // Mount manually if using Vue 3:
    // createApp(MyComponent).mount('#app')
  })
  await expect(page.locator('#app')).toContainText('expected text')
})
```

This works but loses CT's `mount()` ergonomics and snapshot isolation.

## What would be needed for real CT support

1. A custom CT playwright plugin that replaces `browserType.launch()` with `chromium.connectOverCDP()`
2. The Vite dev server would need to run separately (already the case for ohos testing)
3. The CT control WebSocket would need to work through ArkWeb — feasible but not tested

This is a P3 enhancement; open a GitHub issue if there's demand.
