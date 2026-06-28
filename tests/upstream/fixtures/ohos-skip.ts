// Centralized ArkWeb / connectOverCDP limitation table.
//
// Two tables:
//   OHOS_FILE_FIXME — matched by spec file path (regex), applied via ohosAutoSkip auto-fixture
//   OHOS_FIXME      — matched by title glob, used for per-spec annotations
//
// Source of truth: docs/superpowers/reports/2026-06-27-limitations-reaudit.md

export interface OhosSkipRule {
  filePattern?: RegExp;
  titlePattern?: RegExp;
  reason: string;
}

// File-level rules: entire spec files that are hard-limited by ArkWeb architecture.
// Applied automatically by the ohosAutoSkip fixture in upstream-fixture.ts.
export const OHOS_FILE_FIXME: OhosSkipRule[] = [
  // recordHar is a context-creation-time option; shared-context mode cannot set it.
  {
    filePattern: /browsercontext-har\.spec/,
    reason: 'ArkWeb: recordHar requires context-creation-time options, unavailable in connectOverCDP shared-context mode',
  },
  // ArkWeb shows a system-level "Leave page?" beforeunload dialog that CDP cannot dismiss.
  {
    filePattern: /beforeunload\.spec/,
    reason: 'ArkWeb: native beforeunload dialog cannot be dismissed via CDP — crashes WebSocket',
  },
  // Proxy is a launch-time option; connectOverCDP has no launch step.
  {
    filePattern: /browsercontext-proxy\.spec/,
    reason: 'ArkWeb: proxy is launch-time config, unavailable in connectOverCDP mode',
  },
  // launch / launchServer / remote connect not available.
  {
    filePattern: /browser-server\.spec|browsertype-launch-server\.spec|browsertype-connect\.spec|multiclient\.spec/,
    reason: 'ArkWeb: launch / launchServer / WebSocket connect not supported in connectOverCDP mode',
  },
  // Persistent context requires launchPersistentContext (launch-time).
  {
    filePattern: /defaultbrowsercontext|browsercontext-reuse/,
    reason: 'ArkWeb: persistent context unavailable — system browser cannot be relaunched via CDP',
  },
  // Codegen / Inspector / Debug UI require the Playwright inspector process.
  {
    filePattern: /inspector|debug-controller|debugger\.spec|locator-generator|selector-generator/,
    reason: 'ArkWeb: codegen / inspector / debug UI not available in connectOverCDP mode',
  },
  // Page.startScreencast not implemented in ArkWeb CDP.
  {
    filePattern: /screencast\.spec|video\.spec/,
    reason: 'ArkWeb: Page.startScreencast not implemented',
  },
];

// Title-glob rules (legacy format — used for per-spec annotations).
export const OHOS_FIXME: Record<string, string> = {
  // Raw mouse API — DOM events not dispatched by ArkWeb for page.mouse.* calls
  'page.mouse.*': 'ArkWeb: page.mouse.* raw CDP input does not trigger DOM events; use locator-driven APIs',

  // isMobile viewport — ArkWeb forces 980px layout width when isMobile:true
  '*isMobile*viewport*': 'ArkWeb: isMobile:true emulation does not produce expected viewport width',

  // setExtraHTTPHeaders User-Agent — context-level UA override ignored
  '*setExtraHTTPHeaders*User-Agent*': 'ArkWeb: context.setExtraHTTPHeaders User-Agent is ignored; use emulateDevice({ userAgent })',

  // JS coverage resetOnNavigation:false
  '*coverage*resetOnNavigation*': 'ArkWeb: JS coverage does not accumulate across navigations with resetOnNavigation:false',

  // CDP Network.webSocketCreated not emitted (raw CDP only)
  '*webSocketCreated*': 'ArkWeb: CDP Network.webSocketCreated not emitted',

  // exposeBinding handle:true silently ignored
  '*exposeBinding*handle*': 'ArkWeb: exposeBinding({ handle: true }) silently ignored; Playwright 1.60 removed from public API',

  // Locale emulation — OS-level locale and Accept-Language header unaffected
  '*emulateLocale*Accept-Language*': 'ArkWeb: Emulation.setLocaleOverride is ignored; only navigator.language patched via init-script',
};

// Tests that require browser.newContext() / context.newPage() only work when
// PW_CHROMIUM_ATTACH_TO_OTHER=1 is set. Without it contextFactory will throw.
export const NEEDS_MULTI_CONTEXT = 'Requires PW_CHROMIUM_ATTACH_TO_OTHER=1 (contextFactory)';

// Tests that require launch-time options are fundamentally incompatible.
export const NEEDS_LAUNCH = 'connectOverCDP does not support launch-time options';
