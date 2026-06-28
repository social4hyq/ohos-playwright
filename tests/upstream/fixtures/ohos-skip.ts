// Centralized ArkWeb / connectOverCDP limitation table.
//
// Used by upstream-fixture.ts's autoOhosSkip auto-fixture (if added) and as
// documentation for per-spec test.fixme() annotations added during the fixme
// pass (Commit 5). Source of truth: docs/superpowers/reports/2026-06-27-limitations-reaudit.md
//
// Format: { '<title pattern glob>': '<reason string>' }
// Patterns are matched against test.info().title using minimatch.

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
