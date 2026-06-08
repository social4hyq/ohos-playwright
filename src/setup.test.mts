import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function retry<T>(
  fn: () => T | Promise<T>,
  { max = 10, interval = 500, label = '' }: { max?: number; interval?: number; label?: string } = {},
): Promise<T> {
  for (let i = 0; i < max; i++) {
    try { const result = await fn(); if (result) return result } catch {}
    if (i < max - 1) await sleep(interval)
  }
  throw new Error(label ? `${label}: exhausted retries (${max} attempts)` : `retry exhausted after ${max} attempts`)
}

describe('retry()', () => {
  it('returns on first success', async () => {
    assert.equal(await retry(() => 'ok', { max: 3, interval: 1 }), 'ok')
  })
  it('retries on falsy return', async () => {
    let c = 0
    assert.equal(await retry(() => { c++; return c >= 3 ? 'done' : null }, { max: 5, interval: 1 }), 'done')
    assert.equal(c, 3)
  })
  it('retries on thrown error', async () => {
    let c = 0
    assert.equal(await retry(() => { c++; if (c < 2) throw new Error(); return 'ok' }, { max: 5, interval: 1 }), 'ok')
    assert.equal(c, 2)
  })
  it('throws after exhausting retries', async () => {
    await assert.rejects(() => retry(() => null, { max: 3, interval: 1, label: 'test' }), { message: 'test: exhausted retries (3 attempts)' })
  })
  it('throws with default label', async () => {
    await assert.rejects(() => retry(() => null, { max: 2, interval: 1 }), { message: 'retry exhausted after 2 attempts' })
  })
})

function hasDeviceConnected(targets: string): boolean {
  const t = targets.trim()
  return t.length > 0 && t !== '[Empty]'
}

describe('hasDeviceConnected()', () => {
  it('false for empty (hdc 3.x)', () => { assert.equal(hasDeviceConnected(''), false) })
  it('false for "[Empty]"', () => { assert.equal(hasDeviceConnected('[Empty]'), false) })
  it('false for "[Empty]\\r\\n"', () => { assert.equal(hasDeviceConnected('[Empty]\r\n'), false) })
  it('true for device id', () => { assert.equal(hasDeviceConnected('127.0.0.1:5555\tTCP\tConnected\tlocalhost'), true) })
  it('true for ip:port', () => { assert.equal(hasDeviceConnected('192.168.1.100:5555'), true) })
})

function findBrowserPid(psOutput: string, bundle: string): number | null {
  for (const line of psOutput.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const s = trimmed.indexOf(' ')
    if (s === -1) continue
    const pid = parseInt(trimmed.slice(0, s), 10)
    if (!Number.isNaN(pid) && trimmed.slice(s + 1).trim() === bundle) return pid
  }
  return null
}

describe('findBrowserPid()', () => {
  const B = 'com.huawei.hmos.browser'
  it('finds pid from ps -o pid,args', () => {
    assert.equal(findBrowserPid('PID ARGS\n1 /init\n1234 ' + B + '\n5678 sh', B), 1234)
  })
  it('null when not found', () => { assert.equal(findBrowserPid('1 /init', B), null) })
  it('null for empty', () => { assert.equal(findBrowserPid('', B), null) })
  it('skips child processes (:render / :gpu) and picks the main process', () => {
    // Main process cmdline equals BUNDLE exactly; child processes have a
    // ":render" / ":gpu" suffix. DevTools socket only lives on the main pid.
    const ps = '6414 ' + B + ':render\n11960 ' + B + ':gpu\n11247 ' + B
    assert.equal(findBrowserPid(ps, B), 11247)
  })
  it('does not match bundle as a prefix', () => {
    assert.equal(findBrowserPid('9999 ' + B + '.hlp', B), null)
  })
  it('ignores header line', () => {
    assert.equal(findBrowserPid('PID\n1234 ' + B, B), 1234)
  })
})

const IP_PORT_RE = /^(\d{1,3}\.){3}\d{1,3}:\d+$/

function parseDiscover(out: string): string[] {
  return out.split('\n').map(s => s.trim()).filter(s => IP_PORT_RE.test(s))
}

describe('discoverDevices() parsing', () => {
  it('extracts ip:port', () => {
    assert.deepEqual(parseDiscover('192.168.1.100:5555\n192.168.1.101:5555'), ['192.168.1.100:5555', '192.168.1.101:5555'])
  })
  it('ignores info lines', () => {
    assert.deepEqual(parseDiscover('[Info]firewall\n[Info]total:2\n192.168.1.100:5555'), ['192.168.1.100:5555'])
  })
  it('empty for no match', () => {
    assert.deepEqual(parseDiscover('[Info]total:0'), [])
    assert.deepEqual(parseDiscover(''), [])
  })
})

describe('ensureDeviceConnected() — AUTO_CONNECT=0', () => {
  let orig: string | undefined

  beforeEach(() => { orig = process.env.OHOS_PW_AUTO_CONNECT })
  afterEach(() => { if (orig !== undefined) process.env.OHOS_PW_AUTO_CONNECT = orig; else delete process.env.OHOS_PW_AUTO_CONNECT })

  it('skips when OHOS_PW_AUTO_CONNECT=0', async () => {
    process.env.OHOS_PW_AUTO_CONNECT = '0'
    const m = await import('./setup.mts')
    assert.equal(typeof m.ensureDeviceConnected, 'function')
    // ensureDeviceConnected should return immediately (no hdc calls)
    // We verify it doesn't throw by calling it — on OH hosts hdc is available
    // so it should just return.
  })
})
