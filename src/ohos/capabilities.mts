// src/ohos/capabilities.mts
// ArkWeb 能力声明。静态表基于 2026-06-27 实测结论。
// false 项对应 docs/arkweb-feature-requests.md 中的诉求条目。

import type { Browser } from '@playwright/test'
import { execFileSync } from 'node:child_process'

export interface OhosCapabilities {
  // Context & Pages
  multipleContexts: boolean
  newPageInNonDefaultContext: boolean
  contextScreenshot: boolean
  // Lifecycle
  beforeunloadDismiss: boolean
  persistentContext: boolean
  // Input
  rawMouseEvents: boolean
  cssHoverFromInput: boolean
  // Network
  userAgentOverride: boolean
  proxyConfig: boolean
  // 媒体 / 录制
  recordHar: boolean
  videoRecording: boolean
  screencast: boolean
  // 覆盖率 & 事件
  jsCoverageAcrossNavigations: boolean
  webSocketCreatedEvent: boolean
  // Playwright 内部
  exposeBindingHandle: boolean
  playwrightInspector: boolean
  // CustomTabAbility 单页约束
  cdpReconnectStable: boolean
  multiPageSimultaneous: boolean
  // 元信息
  readonly arkwebVersion: string
  readonly ohosVersion: string
}

function parseArkWebMajor(version: string): number {
  const m = version.match(/(\d+)\./)
  return m ? parseInt(m[1], 10) : 0
}

function detectOhosVersion(hdcBinary: string): string {
  try {
    return execFileSync(hdcBinary, ['shell', 'param get const.ohos.apiversion'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 }).trim()
  } catch { return 'unknown' }
}

export async function detectCapabilities(
  browser: Browser,
  hdcBinary = '/data/service/hnp/bin/hdc',
): Promise<OhosCapabilities> {
  const arkwebVersion = browser.version()
  const majorVersion = parseArkWebMajor(arkwebVersion)

  const caps: OhosCapabilities = {
    // ✅ reaudit L1
    multipleContexts:              true,
    // ✅ capability matrix T1（需 PW_CHROMIUM_ATTACH_TO_OTHER=1，由 OhosDevice 管理）
    newPageInNonDefaultContext:    true,
    // ❌ S1: Page.captureScreenshot 在新 context 无响应（CAP-01）
    contextScreenshot:             false,
    // ❌ 系统级 beforeunload 弹窗 CDP 无法 dismiss（CAP-02）
    beforeunloadDismiss:           false,
    // ❌ 无 launch 步骤
    persistentContext:             false,
    // ✅ reaudit L3
    rawMouseEvents:                true,
    // ❌ reaudit L4（CAP-03）
    cssHoverFromInput:             false,
    // ✅ reaudit L2
    userAgentOverride:             true,
    // ❌ 无 launch 步骤
    proxyConfig:                   false,
    // ❌ 需 context 创建选项
    recordHar:                     false,
    // ❌ Page.startScreencast 未实现（CAP-06）
    videoRecording:                false,
    screencast:                    false,
    // ❌ 实测不累计（CAP-05）
    jsCoverageAcrossNavigations:   false,
    // ❌ 事件未触发（CAP-04）
    webSocketCreatedEvent:         false,
    // ❌ PW 1.60 已移除公开 API
    exposeBindingHandle:           false,
    // ❌ 需 Inspector 进程
    playwrightInspector:           false,
    // CustomTabAbility 单页约束（CT）
    cdpReconnectStable:            false, // spec 文件间需重启浏览器
    multiPageSimultaneous:          false, // Target.createTarget 创建的是独立页面，非标签
    arkwebVersion,
    ohosVersion: detectOhosVersion(hdcBinary),
  }

  // 动态探针：ArkWeb ≥ 140 时重测 cssHoverFromInput（未来版本可能修复）
  if (majorVersion >= 140) {
    caps.cssHoverFromInput = await probeCssHover(browser)
  }

  return caps
}

async function probeCssHover(browser: Browser): Promise<boolean> {
  const ctx = browser.contexts()[0]
  if (!ctx) return false
  const page = ctx.pages()[0]
  if (!page) return false
  try {
    const session = await ctx.newCDPSession(page)
    try {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: 1, y: 1,
        button: 'none', modifiers: 0, buttons: 0,
        clickCount: 0, deltaX: 0, deltaY: 0, pointerType: 'mouse',
      } as any)
      // 简单探针：命令成功 = 事件投递基础可用。:hover 激活仍需单独验证。
      return false // 保守：直到有真实 :hover 激活证据
    } finally {
      await session.detach()
    }
  } catch { return false }
}
