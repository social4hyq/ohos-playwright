import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// Reload config.mts per-test so env mutations are picked up
async function loadConfig(): Promise<{ withOpenHarmony: (c: Record<string, unknown>) => Record<string, unknown> }> {
  return import(`./config.mts?t=${Date.now()}`)
}

describe('withOpenHarmony()', () => {
  let origHost: string | undefined

  beforeEach(() => { origHost = process.env.OHOS_PW_HOST })
  afterEach(() => {
    if (origHost !== undefined) process.env.OHOS_PW_HOST = origHost
    else delete process.env.OHOS_PW_HOST
  })

  it('returns config unchanged on non-OpenHarmony hosts', async () => {
    delete process.env.OHOS_PW_HOST
    const { withOpenHarmony } = await loadConfig()
    const input = { testDir: './e2e', workers: 4, projects: [{ name: 'chromium' }, { name: 'firefox' }] }
    const result = withOpenHarmony(input)
    assert.equal(result, input, 'should return the exact same object')
  })

  it('locks workers to 1 on OpenHarmony', async () => {
    process.env.OHOS_PW_HOST = '1'
    const { withOpenHarmony } = await loadConfig()
    const result = withOpenHarmony({ workers: 4 })
    assert.equal(result.workers, 1)
  })

  it('injects globalSetup and globalTeardown on OpenHarmony', async () => {
    process.env.OHOS_PW_HOST = '1'
    const { withOpenHarmony } = await loadConfig()
    const result = withOpenHarmony({})
    assert.equal(result.globalSetup, 'ohos-playwright/setup')
    assert.equal(result.globalTeardown, 'ohos-playwright/teardown')
  })

  it('filters projects to chromium only on OpenHarmony', async () => {
    process.env.OHOS_PW_HOST = '1'
    const { withOpenHarmony } = await loadConfig()
    const result = withOpenHarmony({ projects: [{ name: 'chromium' }, { name: 'firefox' }, { name: 'webkit' }] })
    const projects = result.projects as Array<{ name: string }>
    assert.equal(projects.length, 1)
    assert.equal(projects[0].name, 'chromium')
  })

  it('preserves other config keys on OpenHarmony', async () => {
    process.env.OHOS_PW_HOST = '1'
    const { withOpenHarmony } = await loadConfig()
    const result = withOpenHarmony({ testDir: './e2e', use: { baseURL: 'http://localhost:3000' } })
    assert.equal(result.testDir, './e2e')
    const use = result.use as { baseURL?: string }
    assert.equal(use.baseURL, 'http://localhost:3000')
  })

  it('handles null/undefined projects gracefully', async () => {
    process.env.OHOS_PW_HOST = '1'
    const { withOpenHarmony } = await loadConfig()
    const result = withOpenHarmony({ projects: undefined })
    assert.equal(result.projects, undefined)
  })
})
