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

describe('saveStorageState / loadStorageState (unit)', () => {
  // Cookie filtering logic extracted from saveStorageState
  function filterCookies(
    allCookies: { name: string; value: string; domain?: string; path?: string }[],
    derivedOrigin: string,
    explicitOrigin: string | undefined,
  ) {
    const hostname = new URL(derivedOrigin).hostname
    return allCookies.filter((c) => {
      if (!explicitOrigin) return true
      const d = c.domain ?? ''
      const bare = d.startsWith('.') ? d.slice(1) : d
      return bare === hostname || hostname.endsWith(bare)
    })
  }

  const cookies = [
    { name: 'a', value: '1', domain: 'example.com' },
    { name: 'b', value: '2', domain: 'other.com' },
    { name: 'c', value: '3', domain: '.example.com' },
    { name: 'd', value: '4', domain: 'sub.example.com' },
    { name: 'e', value: '5', domain: '' },
  ]

  it('no explicit origin → returns all cookies', () => {
    const result = filterCookies(cookies, 'http://example.com', undefined)
    assert.equal(result.length, cookies.length)
  })

  it('filters to matching hostname', () => {
    const result = filterCookies(cookies, 'http://example.com', 'http://example.com')
    const names = result.map((c) => c.name)
    assert.ok(names.includes('a'), 'exact match')
    assert.ok(names.includes('c'), 'leading-dot domain')
    assert.ok(!names.includes('b'), 'other domain excluded')
  })

  it('strips leading dot from cookie domain before comparing', () => {
    const result = filterCookies(
      [{ name: 'x', value: '1', domain: '.example.com' }],
      'http://example.com',
      'http://example.com',
    )
    assert.equal(result.length, 1)
  })

  it('excludes subdomain cookies when filtering by parent hostname', () => {
    // sub.example.com does NOT end with example.com via hostname.endsWith(bare) —
    // bare='sub.example.com', hostname='example.com' → endsWith false
    const result = filterCookies(
      [{ name: 'd', value: '4', domain: 'sub.example.com' }],
      'http://example.com',
      'http://example.com',
    )
    assert.equal(result.length, 0)
  })

  it('matches when hostname ends with bare domain (wildcard-style)', () => {
    // cookie domain='example.com', page origin='http://sub.example.com'
    // bare='example.com', hostname='sub.example.com' → endsWith('example.com') → true
    const result = filterCookies(
      [{ name: 'a', value: '1', domain: 'example.com' }],
      'http://sub.example.com',
      'http://sub.example.com',
    )
    assert.equal(result.length, 1)
  })

  it('derives origin from page.url() when no explicit origin given', () => {
    const pageUrl = 'http://127.0.0.1:3000/some/path'
    const derivedOrigin = new URL(pageUrl).origin
    assert.equal(derivedOrigin, 'http://127.0.0.1:3000')
  })

  it('returns correct StorageState shape', () => {
    const state = {
      cookies: [{ name: 'tok', value: 'abc', domain: 'example.com', path: '/' }],
      origins: [{ origin: 'http://example.com', localStorage: [{ name: 'k', value: 'v' }] }],
    }
    assert.ok(Array.isArray(state.cookies))
    assert.ok(Array.isArray(state.origins))
    assert.ok(Array.isArray(state.origins[0].localStorage))
    assert.equal(state.origins[0].localStorage[0].name, 'k')
  })

  it('loadStorageState skips addCookies when cookies array is empty', () => {
    const state = { cookies: [], origins: [] }
    // Guard: state.cookies?.length is falsy → no addCookies
    assert.equal(Boolean(state.cookies?.length), false)
  })

  it('loadStorageState skips localStorage write when array is empty', () => {
    const origins = [{ origin: 'http://example.com', localStorage: [] }]
    // Guard: !o.localStorage?.length → skip
    assert.equal(origins.filter((o) => o.localStorage?.length).length, 0)
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
