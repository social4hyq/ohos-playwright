// tests/upstream/fixtures/ohos-skip.ts
// ohos-playwright 与上游 Playwright 的已知差异分类表。
// 匹配逻辑见 upstream-fixture.ts ohosAutoSkip fixture。
//
// 根因分类：
//   CT-*  = CustomTabAbility 单页限制（patch 层理论上可修）
//   CAP-* = ArkWeb 引擎 CDP 缺口（浏览器层，不可修）
//   ARCH-* = connectOverCDP 架构限制（不可修）
//
// Issue 提交后更新 URL（当前为占位符，待提交到 gitee.com/openharmony/web_webview）。

export const ARKWEB_ISSUE_URL: Record<string, string> = {
  // ── CustomTabAbility 单页限制（patch 层可改进）──

  popupPageEvent:                 'https://gitee.com/openharmony/web_webview/issues (CT-01 待提交)',
  popupOpenerRelationship:        'https://gitee.com/openharmony/web_webview/issues (CT-02 待提交)',
  popupWindowClose:               'https://gitee.com/openharmony/web_webview/issues (CT-03 待提交)',
  nonDefaultContextWindowOpen:    'https://gitee.com/openharmony/web_webview/issues (CT-04 待提交)',
  pageCrashCdpDisconnect:         'https://gitee.com/openharmony/web_webview/issues (CT-05 待提交)',

  // ── ArkWeb 引擎 CDP 缺口 ──

  contextScreenshot:              'https://gitee.com/openharmony/web_webview/issues (CAP-01 待提交)',
  beforeunloadDismiss:            'https://gitee.com/openharmony/web_webview/issues (CAP-02 待提交)',
  cssHoverFromInput:              'https://gitee.com/openharmony/web_webview/issues (CAP-03 待提交)',
  webSocketCreatedEvent:          'https://gitee.com/openharmony/web_webview/issues (CAP-04 待提交)',
  jsCoverageAcrossNavigations:    'https://gitee.com/openharmony/web_webview/issues (CAP-05 待提交)',
  screencast:                     'https://gitee.com/openharmony/web_webview/issues (CAP-06 待提交)',

  // ── connectOverCDP 架构限制 ──

  proxyConfig:                    '无 launch 步骤（connectOverCDP 架构限制）',
  persistentContext:              '无 launch 步骤（connectOverCDP 架构限制）',
  recordHar:                      '需 context 创建选项（connectOverCDP 架构限制）',
  playwrightInspector:            '需 Inspector 进程（connectOverCDP 架构限制）',
}

/**
 * Fixme 标注分类统计（2026-06-30 审查）：
 *
 *   CustomTabAbility 可修复   47   (8.0%)  — popup/page lifecycle/CDP stability
 *   ArkWeb 引擎行为差异       374  (63.6%) — 纯浏览器差异，不可修
 *   上游原生条件 skip         148  (25.2%) — browserName/isAndroid/isElectron 等
 *   connectOverCDP 架构限制    2   (0.3%)  — grep 可见的 it.fixme（另有 fixture 层动态 skip）
 *   其他未分类                17   (2.9%)
 *   ─────────────────────────────────────
 *   总计                     588  (100%)
 */
