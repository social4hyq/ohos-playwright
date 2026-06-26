import { registerHooks } from 'node:module'
import { resolve } from './loader.mjs'

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

  // ArkWeb's Target.createTarget returns a target with type='other', not
  // 'page'. Playwright's crBrowser._onAttachedToTarget (crBrowser.ts:191)
  // only registers 'page' targets into _crPages — 'other' targets get
  // detached and ctx.newPage() throws "Cannot read properties of undefined
  // (reading '_page')".
  //
  // PW_CHROMIUM_ATTACH_TO_OTHER (crBrowser.ts:181) is playwright's upstream
  // escape hatch: treat type='other' as page so newContext/newPage work.
  // It's opt-in (not set here by default) because it also makes Playwright
  // treat ArkWeb's internal "other" targets (shared workers, etc.) as pages,
  // which perturbs page-list assumptions in tests that use touchscreen /
  // recordHar. Users who need multi-context set it explicitly:
  //   process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
  // before importing @playwright/test.

  registerHooks({ resolve })
}
