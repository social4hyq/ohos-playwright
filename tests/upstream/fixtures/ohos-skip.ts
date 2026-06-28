// tests/upstream/fixtures/ohos-skip.ts
// ArkWeb CDP 限制对应的 issue URL 表。
// 匹配逻辑见 upstream-fixture.ts ohosAutoSkip fixture。
// Issue 提交后更新 URL（当前为占位符，待提交到 gitee.com/openharmony/web_webview）。

export const ARKWEB_ISSUE_URL: Record<string, string> = {
  contextScreenshot:            'https://gitee.com/openharmony/web_webview/issues (CAP-01 待提交)',
  beforeunloadDismiss:          'https://gitee.com/openharmony/web_webview/issues (CAP-02 待提交)',
  cssHoverFromInput:            'https://gitee.com/openharmony/web_webview/issues (CAP-03 待提交)',
  webSocketCreatedEvent:        'https://gitee.com/openharmony/web_webview/issues (CAP-04 待提交)',
  jsCoverageAcrossNavigations:  'https://gitee.com/openharmony/web_webview/issues (CAP-05 待提交)',
  screencast:                   'https://gitee.com/openharmony/web_webview/issues (CAP-06 待提交)',
  proxyConfig:                  '无 launch 步骤（connectOverCDP 架构限制）',
  persistentContext:             '无 launch 步骤（connectOverCDP 架构限制）',
  recordHar:                    '需 context 创建选项（connectOverCDP 架构限制）',
  playwrightInspector:          '需 Inspector 进程（connectOverCDP 架构限制）',
}
