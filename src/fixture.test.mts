import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

// Patch process.platform before @playwright/test is loaded, mirroring register.mts.
const origPlatform = process.platform
Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

let tmpInfoPath: string | null = null

function createInfoFile(endpoint = 'http://127.0.0.1:9222'): string {
  tmpInfoPath = resolve(tmpdir(), `ohos-pw-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
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
})

describe('fixture module structure', () => {
  it('exports test (function) and expect', async () => {
    createInfoFile()
    const fixture = await import('./fixture.mts')
    assert.ok(fixture.test, 'should export test')
    assert.equal(typeof fixture.test, 'function', 'test should be a function')
    assert.ok(fixture.expect, 'should export expect')
  })

  it('test has extend method (from Playwright base.extend)', async () => {
    const fixture = await import('./fixture.mts')
    assert.equal(typeof fixture.test.extend, 'function')
  })
})

describe('page.goto URL resolution (unit)', () => {
  it('resolves relative /foo against baseURL', () => {
    const baseURL = 'http://localhost:3000'
    const root = baseURL.replace(/\/+$/, '')

    function resolveUrl(url: string | null | undefined): string | null | undefined {
      return (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//'))
        ? root + url
        : url
    }

    assert.equal(resolveUrl('/foo'), 'http://localhost:3000/foo')
    assert.equal(resolveUrl('/api/test'), 'http://localhost:3000/api/test')
    assert.equal(resolveUrl('http://example.com'), 'http://example.com')
    assert.equal(resolveUrl('https://other.com/page'), 'https://other.com/page')
  })

  it('does not resolve protocol-relative URLs', () => {
    const baseURL = 'http://localhost:3000'
    const root = baseURL.replace(/\/+$/, '')

    function resolveUrl(url: string | null | undefined): string | null | undefined {
      return (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//'))
        ? root + url
        : url
    }

    assert.equal(resolveUrl('//cdn.example.com/lib.js'), '//cdn.example.com/lib.js')
  })

  it('passes non-string URLs through unchanged', () => {
    const baseURL = 'http://localhost:3000'
    const root = baseURL.replace(/\/+$/, '')

    function resolveUrl(url: string | null | undefined): string | null | undefined {
      return (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//'))
        ? root + url
        : url
    }

    assert.equal(resolveUrl(null), null)
    assert.equal(resolveUrl(undefined), undefined)
  })

  it('handles baseURL with trailing slash', () => {
    const baseURL = 'http://localhost:3000/'
    const root = baseURL.replace(/\/+$/, '')
    assert.equal(root, 'http://localhost:3000')

    function resolveUrl(url: string | null | undefined): string | null | undefined {
      return (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//'))
        ? root + url
        : url
    }

    assert.equal(resolveUrl('/path'), 'http://localhost:3000/path')
  })
})
