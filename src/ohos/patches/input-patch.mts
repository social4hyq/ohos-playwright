// src/ohos/patches/input-patch.mts
// hover override：CDP Input.dispatchMouseEvent（isTrusted:true）
// 替代 fixture.mts 中 page.mouse.move() 方案（同样 isTrusted:false）。
// :hover 伪类激活仍待 ArkWeb 修复（CAP-03）。

import type { Page } from '@playwright/test'

export function applyInputPatches(page: Page): void {
  const origLocator = page.locator.bind(page)
  ;(page as any).locator = (...args: Parameters<typeof page.locator>) => {
    const loc = origLocator(...args)
    ;(loc as any).hover = async (_options?: Parameters<typeof loc.hover>[0]) => {
      const box = await loc.boundingBox()
      if (!box) throw new Error('[ohos] hover: element has no bounding box')
      const x = Math.round(box.x + box.width / 2)
      const y = Math.round(box.y + box.height / 2)
      const session = await page.context().newCDPSession(page)
      try {
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x, y,
          button: 'none', modifiers: 0, buttons: 0,
          clickCount: 0, deltaX: 0, deltaY: 0, pointerType: 'mouse',
        } as any)
      } finally {
        await session.detach()
      }
    }
    return loc
  }
}
