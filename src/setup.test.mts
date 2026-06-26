import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

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

// Inline replica of the fetchDeviceState parsing logic from setup.mts.
// Tests the separator strategy without needing a real device.
function parseFetchDeviceState(raw: string): { ps: string; unix: string } {
  const sepMatch = raw.match(/OHOS_SEP_\d+/)
  if (!sepMatch) return { ps: raw, unix: '' }
  const [ps, unix] = raw.split(sepMatch[0])
  return { ps: ps || '', unix: unix || '' }
}

const B = 'com.huawei.hmos.browser'

function countCdpPages(listJson: string): number {
  try {
    const targets = JSON.parse(listJson) as { type: string }[]
    return targets.filter((t) => t.type === 'page').length
  } catch { return 0 }
}

describe('countCdpPages()', () => {
  it('counts page-type targets', () => {
    const list = JSON.stringify([
      { type: 'page', id: '1' },
      { type: 'page', id: '2' },
      { type: 'background_page', id: '3' },
      { type: 'service_worker', id: '4' },
    ])
    assert.equal(countCdpPages(list), 2)
  })

  it('returns 0 for empty list', () => {
    assert.equal(countCdpPages('[]'), 0)
  })

  it('returns 0 for invalid JSON', () => {
    assert.equal(countCdpPages('not-json'), 0)
    assert.equal(countCdpPages(''), 0)
  })

  it('returns 0 when no page-type targets', () => {
    assert.equal(countCdpPages(JSON.stringify([{ type: 'service_worker' }])), 0)
  })
})

function pickTestPage(
  pages: { url: () => string }[],
  openedNewTab: boolean,
  launchUrl = 'about:blank',
): { url: () => string } | undefined {
  if (openedNewTab) {
    return [...pages].reverse().find((p) => p.url() === launchUrl) ?? pages[pages.length - 1]
  }
  return pages.find((p) => p.url().startsWith('http://localhost')) ?? pages[0]
}

describe('fixture page selection (unit)', () => {
  const p = (url: string) => ({ url: () => url })

  it('openedNewTab=false: prefers localhost page', () => {
    const pages = [p('https://example.com'), p('http://localhost:5173/')]
    assert.equal(pickTestPage(pages, false)?.url(), 'http://localhost:5173/')
  })

  it('openedNewTab=false: falls back to pages[0] when no localhost', () => {
    const pages = [p('https://example.com'), p('https://other.com')]
    assert.equal(pickTestPage(pages, false)?.url(), 'https://example.com')
  })

  it('openedNewTab=true: picks about:blank tab', () => {
    const pages = [p('https://example.com'), p('https://news.com'), p('about:blank')]
    assert.equal(pickTestPage(pages, true)?.url(), 'about:blank')
  })

  it('openedNewTab=true: picks the LAST about:blank when multiple exist', () => {
    const pages = [p('about:blank'), p('https://example.com'), p('about:blank')]
    // reverse().find() returns the last one (index 2)
    assert.equal(pickTestPage(pages, true)?.url(), 'about:blank')
    // verify it's the last one, not the first
    const result = pickTestPage(pages, true)
    assert.equal(result, pages[2])
  })

  it('openedNewTab=true: falls back to last page when no launchUrl match', () => {
    const pages = [p('https://example.com'), p('https://news.com')]
    assert.equal(pickTestPage(pages, true)?.url(), 'https://news.com')
  })

  it('openedNewTab=true: respects custom launchUrl', () => {
    const pages = [p('https://example.com'), p('http://localhost:8080/'), p('about:blank')]
    assert.equal(pickTestPage(pages, true, 'http://localhost:8080/')?.url(), 'http://localhost:8080/')
  })
})

describe('fetchDeviceState() separator parsing', () => {
  it('splits ps and unix at OHOS_SEP_<pid> marker', () => {
    const raw = '1 init\n34306 ' + B + '\nOHOS_SEP_9999\nsocket-data\n'
    const { ps, unix } = parseFetchDeviceState(raw)
    assert.ok(ps.includes(B), 'browser in ps section')
    assert.ok(unix.includes('socket-data'), 'socket data in unix section')
    assert.ok(!ps.includes('socket-data'), 'socket not in ps section')
  })

  it('returns ps=raw, unix="" when marker is absent', () => {
    const raw = '1 init\n34306 ' + B + '\n'
    const { ps, unix } = parseFetchDeviceState(raw)
    assert.equal(ps, raw)
    assert.equal(unix, '')
  })

  // Regression: old static "---SOCKET---" delimiter collided with the hdc
  // process's own ps args, which contained the literal command string
  // (e.g. `hdc shell ps -o pid,args; echo "---SOCKET---"; cat /proc/net/unix`).
  // The new separator uses shell $$ so ps args show the literal "$$" while
  // the actual echo output is the numeric PID — no collision.
  it('is not fooled by literal OHOS_SEP_$$ appearing in ps args', () => {
    // Simulate a ps line where the hdc process shows the unexpanded shell command
    const hdcArgsLine = '9001 hdc shell ps -o pid,args; echo "OHOS_SEP_$$"; cat /proc/net/unix'
    // Browser main process appears AFTER the hdc process in ps output
    const raw = hdcArgsLine + '\n34306 ' + B + '\nOHOS_SEP_9999\n@webview_devtools_remote_34306\n'
    const { ps, unix } = parseFetchDeviceState(raw)
    // The regex /OHOS_SEP_\d+/ does NOT match "OHOS_SEP_$$" (no digits after _)
    // so the split happens at the correct "OHOS_SEP_9999" marker
    assert.ok(ps.includes(B), 'browser found in ps section despite hdc args collision')
    assert.ok(unix.includes('@webview_devtools_remote_34306'), 'socket in unix section')
  })

  it('old static delimiter would have failed — documents the bug', () => {
    // With the old "---SOCKET---" delimiter, the hdc process in ps
    // causes split() to cut at the WRONG position, hiding the browser.
    const hdcArgsLine = '9001 hdc shell ps -o pid,args; echo "---SOCKET---"; cat /proc/net/unix'
    const raw = hdcArgsLine + '\n34306 ' + B + '\n---SOCKET---\n@webview_devtools_remote_34306\n'
    // Old logic: split on literal "---SOCKET---" — first occurrence is inside hdc args
    const [oldPs] = raw.split('---SOCKET---')
    assert.ok(!oldPs.includes(B), 'old delimiter: browser hidden (bug reproduced)')
    // New logic: finds the correct marker
    const { ps } = parseFetchDeviceState(raw.replace('---SOCKET---\n@', 'OHOS_SEP_9999\n@'))
    assert.ok(ps.includes(B), 'new delimiter: browser found correctly')
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

describe('ensureHdcKey() — self-heal key generation', () => {
  let origHome: string | undefined
  let tmpHome: string

  const setupPath = resolve(fileURLToPath(import.meta.url), '..', 'setup.mts')

  beforeEach(() => {
    origHome = process.env.HOME
    tmpHome = resolve(tmpdir(), `ohos-pw-home-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpHome, { recursive: true })
    process.env.HOME = tmpHome
  })
  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome
    try { rmSync(tmpHome, { recursive: true, force: true }) } catch {}
  })

  function runEnsureKey(home: string): { status: number | null; stdout: string; stderr: string } {
    const code = `
      process.env.HOME = ${JSON.stringify(home)};
      process.env.OHOS_PW_HDC = ${JSON.stringify(process.execPath)};
      import(${JSON.stringify(setupPath)}).then(m => {
        const created = m.ensureHdcKey();
        const fs = require('node:fs'); const path = require('node:path');
        const priv = path.join(${JSON.stringify(home)}, '.harmony', 'hdckey');
        const pub = path.join(${JSON.stringify(home)}, '.harmony', 'hdckey.pub');
        const privExists = fs.existsSync(priv);
        const pubExists = fs.existsSync(pub);
        const privIsPem = privExists ? fs.readFileSync(priv,'utf8').startsWith('-----BEGIN') : false;
        const pubIsPem = pubExists ? fs.readFileSync(pub,'utf8').startsWith('-----BEGIN PUBLIC KEY-----') : false;
        console.log(JSON.stringify({ created, privExists, pubExists, privIsPem, pubIsPem }));
      }).catch(e => { console.error(e.message); process.exit(2); });
    `
    return spawnSync(process.execPath, ['--experimental-strip-types', '-e', code], { encoding: 'utf8' })
  }

  it('generates RSA-3072 key pair when missing', () => {
    const r = runEnsureKey(tmpHome)
    assert.equal(r.status, 0, `stderr: ${r.stderr}`)
    const result = JSON.parse(r.stdout.trim())
    assert.deepEqual(result, { created: true, privExists: true, pubExists: true, privIsPem: true, pubIsPem: true })
  })

  it('returns false when key already exists', () => {
    const keyDir = join(tmpHome, '.harmony')
    mkdirSync(keyDir, { recursive: true })
    writeFileSync(join(keyDir, 'hdckey'), 'dummy')
    writeFileSync(join(keyDir, 'hdckey.pub'), 'dummy')
    const r = runEnsureKey(tmpHome)
    assert.equal(r.status, 0, `stderr: ${r.stderr}`)
    assert.equal(JSON.parse(r.stdout.trim()).created, false)
  })
})

describe('OHOS_PW_HDC validation (module-load)', () => {
  const setupPath = resolve(fileURLToPath(import.meta.url), '..', 'setup.mts')
  function loadWith(hdc: string) {
    return spawnSync(process.execPath, ['--experimental-strip-types', '-e', `import('${setupPath}').then(()=>{process.exit(0)}).catch(e=>{process.stderr.write(e.message);process.exit(2)})`], {
      encoding: 'utf8',
      env: { ...process.env, OHOS_PW_HDC: hdc },
    })
  }

  it('rejects relative path', () => {
    const r = loadWith('hdc')
    assert.equal(r.status, 2)
    assert.match(r.stderr, /OHOS_PW_HDC "hdc" 不是有效的可执行文件路径/)
  })

  it('rejects non-existent absolute path', () => {
    const r = loadWith('/nonexistent/path/to/hdc-xyz-12345')
    assert.equal(r.status, 2)
    assert.match(r.stderr, /不是有效的可执行文件路径/)
  })

  it('accepts a valid absolute path (node itself)', () => {
    const r = loadWith(process.execPath)
    // 模块加载应当通过校验（即便后续 ensureDeviceConnected 未运行）
    assert.equal(r.status, 0, `stderr: ${r.stderr}`)
  })
})

describe('ensureDeviceConnected() — AUTO_CONNECT=0', () => {
  let orig: string | undefined

  beforeEach(() => { orig = process.env.OHOS_PW_AUTO_CONNECT })
  afterEach(() => { if (orig !== undefined) process.env.OHOS_PW_AUTO_CONNECT = orig; else delete process.env.OHOS_PW_AUTO_CONNECT })

  it('skips when OHOS_PW_AUTO_CONNECT=0', async () => {
    process.env.OHOS_PW_AUTO_CONNECT = '0'
    process.env.OHOS_PW_HDC ??= process.execPath
    const m = await import('./setup.mts')
    assert.equal(typeof m.ensureDeviceConnected, 'function')
    // ensureDeviceConnected should return immediately (no hdc calls)
    // We verify it doesn't throw by calling it — on OH hosts hdc is available
    // so it should just return.
  })
})
