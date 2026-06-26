import { register } from 'node:module'

// Adapter only activates on OpenHarmony — elsewhere this file is a no-op so
// the same ohos-playwright entry point and the same playwright.config.ts can
// run on Windows / Linux / macOS with stock Playwright.
if ((process.platform as string) === 'openharmony') {
  // Mark the run as OpenHarmony before we lie about the platform — any code
  // downstream (notably withOpenHarmony in the user's config) should consult
  // OHOS_PW_HOST instead of process.platform, which is about to read 'linux'.
  process.env.OHOS_PW_HOST = '1'

  // Playwright's calculatePlatform() (hostPlatform.ts:40) only branches on
  // linux/darwin/win32 — on OpenHarmony it falls through to "<unknown>" and
  // registry/hostPlatform consumers break. PLAYWRIGHT_HOST_PLATFORM_OVERRIDE
  // (hostPlatform.ts:41) is the upstream escape hatch; pin to ubuntu24.04-arm64
  // to skip the distro probing that would also reach "<unknown>".
  process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-arm64'

  // Beyond calculatePlatform(), playwright-core has 20+ direct process.platform
  // reads on hot paths (userAgent.ts:39 UA string, crPage.ts:940 headful
  // insets, input.ts:182 modifier key, registry/index.ts:479 Unsupported
  // platform, tracing.ts:120 trace metadata). The env override above cannot
  // reach those — we still must advertise 'linux' for the duration of this
  // process. Safe because we connect over CDP and never touch Playwright's
  // bundled browser binaries. Clean fix requires upstream openharmony branch.
  Object.defineProperty(process, 'platform', { value: 'linux' })

  register('./loader.mts', import.meta.url)
}
