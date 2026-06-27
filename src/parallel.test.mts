import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const origPlatform = process.platform
Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

let tmpInfoPath: string | null = null

function createInfoFile(endpoint = 'http://127.0.0.1:9222'): string {
  tmpInfoPath = resolve(tmpdir(), `ohos-pw-parallel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  process.env.OHOS_PW_INFO_PATH = tmpInfoPath
  mkdirSync(resolve(tmpInfoPath, '..'), { recursive: true })
  writeFileSync(tmpInfoPath, JSON.stringify({ endpoint, port: 9222, pid: 1, socket: 'test_socket' }))
  return tmpInfoPath
}

afterEach(() => {
  if (tmpInfoPath) {
    try { unlinkSync(tmpInfoPath) } catch {}
    tmpInfoPath = null
  }
  Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
})

describe('parallel module structure', () => {
  it('exports test (function) and expect', async () => {
    createInfoFile()
    const parallel = await import('./parallel.mts')
    assert.ok(parallel.test, 'should export test')
    assert.equal(typeof parallel.test, 'function', 'test should be a function')
    assert.ok(parallel.expect, 'should export expect')
  })

  it('test has extend method (is a Playwright TestType)', async () => {
    createInfoFile()
    const parallel = await import('./parallel.mts')
    assert.equal(typeof parallel.test.extend, 'function')
  })

  it('installPageWrappers is exported from fixture', async () => {
    createInfoFile()
    const fixture = await import('./fixture.mts')
    assert.equal(typeof fixture.installPageWrappers, 'function')
  })
})
