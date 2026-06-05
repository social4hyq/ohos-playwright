import { register } from 'node:module'

// Adapter only activates on OpenHarmony — elsewhere this file is a no-op so
// the same ohos-playwright entry point and the same playwright.config.ts can
// run on Windows / Linux / macOS with stock Playwright.
if (process.platform === 'openharmony') {
  // Mark the run as OpenHarmony before we lie about the platform — any code
  // downstream (notably withOpenHarmony in the user's config) should consult
  // OHOS_PW_HOST instead of process.platform, which is about to read 'linux'.
  process.env.OHOS_PW_HOST = '1'

  // Playwright's hostPlatform detection only branches on linux/darwin/win32.
  // On OpenHarmony it falls through to "<unknown>" and various code paths
  // break. We connect over CDP and never touch Playwright's bundled browser
  // binaries, so it's safe to advertise linux for the duration of this
  // process.
  Object.defineProperty(process, 'platform', { value: 'linux' })

  register('./loader.mjs', import.meta.url)
}
