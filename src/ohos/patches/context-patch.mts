// src/ohos/patches/context-patch.mts
// applyContextPatches — 对每个 BrowserContext 对象注入 ArkWeb 兼容补丁。
// 幂等（__ohosPatch 标志防止重复调用）。

import type { BrowserContext } from '@playwright/test'
import { clearBeforeunload, makeSafePageClose, createPopupPage, BEFOREUNLOAD_TRACKING_SCRIPT } from './page-patch.mts'

export function applyContextPatches(ctx: BrowserContext): void {
  if ((ctx as any).__ohosPatch) return
  ;(ctx as any).__ohosPatch = true

  // close：navigate to about:blank + emit close（替代 Target.disposeBrowserContext）
  ;(ctx as any).close = async () => {
    for (const p of ctx.pages()) {
      await clearBeforeunload(p)
      try { await p.goto('about:blank') } catch {}
    }
    ;(ctx as unknown as { emit: (e: string) => void }).emit('close')
  }

  // newPage：
  //   - 空 context（browser.newPage() 路径）→ 真实 Playwright newPage()
  //   - 已有页面的 context → createPopupPage（Target.createTarget）
  //   - createPopupPage 失败 → reset seedPage to about:blank
  const realNewPage = (ctx.newPage as Function).bind(ctx)
  ;(ctx as any).newPage = async () => {
    const seedPage = ctx.pages()[0]

    if (!seedPage) {
      // 新建 context 没有 seed page，走真实的 Playwright newPage()
      const p = await realNewPage()
      if (!(p as any).__ohosPageClosePatch) {
        ;(p as any).__ohosPageClosePatch = true
        if (!(p as any).__ohosBeforeunloadPatched) {
          ;(p as any).__ohosBeforeunloadPatched = true
          await p.addInitScript(BEFOREUNLOAD_TRACKING_SCRIPT)
        }
        ;(p as any).close = makeSafePageClose(p)
      }
      return p
    }

    const newP = await createPopupPage(ctx, seedPage, 'about:blank')
    if (newP) {
      if (!(newP as any).__ohosPageClosePatch) {
        ;(newP as any).__ohosPageClosePatch = true
        if (!(newP as any).__ohosBeforeunloadPatched) {
          ;(newP as any).__ohosBeforeunloadPatched = true
          await newP.addInitScript(BEFOREUNLOAD_TRACKING_SCRIPT)
        }
        ;(newP as any).close = makeSafePageClose(newP)
      }
      return newP
    }

    // Fallback：reset seedPage to about:blank
    await clearBeforeunload(seedPage)
    const dismissDlg = (d: import('playwright-core').Dialog) => d.dismiss().catch(() => {})
    seedPage.on('dialog', dismissDlg)
    try { await seedPage.goto('about:blank') } catch {}
    seedPage.off('dialog', dismissDlg)
    return seedPage
  }

  // 对 context 内所有已有 page 补 close patch
  for (const p of ctx.pages()) {
    if (!(p as any).__ohosPageClosePatch) {
      ;(p as any).__ohosPageClosePatch = true
      ;(p as any).close = makeSafePageClose(p)
    }
  }
}
