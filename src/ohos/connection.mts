// src/ohos/connection.mts
// OhosDeviceConnection — hdc 设备发现 + CDP 生命周期管理
// 从 setup.mts 提取；setup.mts / teardown.mts 变为薄 shim。

import {
  execFileSync, type ExecFileSyncOptions,
} from 'node:child_process'
import {
  writeFileSync, mkdirSync, existsSync, copyFileSync, readFileSync, unlinkSync,
} from 'node:fs'
import { isAbsolute, join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import http from 'node:http'
import { INFO_PATH, type CdpInfo } from '../info-path.mts'

// ── 从 setup.mts 搬入：所有顶层函数和常量 ──────────────────────────────────

export interface OhosConnectOptions {
  hdcBinary?: string
  bundle?: string
  launchUrl?: string
  serial?: string
}

export class OhosDeviceConnection {
  private readonly HDC: string
  private readonly BUNDLE: string
  private readonly LAUNCH_URL: string
  private readonly HDC_OPTS: ExecFileSyncOptions
  private readonly _serial: string | undefined

  constructor(opts: OhosConnectOptions = {}) {
    this.HDC = opts.hdcBinary
      ?? process.env.OHOS_PW_HDC
      ?? '/data/service/hnp/bin/hdc'
    this.BUNDLE = opts.bundle
      ?? process.env.OHOS_PW_BUNDLE
      ?? 'com.huawei.hmos.browser'
    this.LAUNCH_URL = opts.launchUrl
      ?? process.env.OHOS_PW_LAUNCH_URL
      ?? 'about:blank'
    this.HDC_OPTS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    this._serial = opts.serial

    this._validateOpts()
  }

  private _validateOpts(): void {
    const SAFE_BUNDLE_RE = /^[a-zA-Z][a-zA-Z0-9.]*$/
    const SAFE_URL_RE = /^[a-z][a-z0-9+.-]*:(?:\/\/)?\S+$/i
    if (!SAFE_BUNDLE_RE.test(this.BUNDLE) || this.BUNDLE.length > 256)
      throw new Error(`[ohos] BUNDLE "${this.BUNDLE}" 不是合法包名`)
    if (!SAFE_URL_RE.test(this.LAUNCH_URL) || this.LAUNCH_URL.length > 2048)
      throw new Error(`[ohos] LAUNCH_URL "${this.LAUNCH_URL}" 不是合法 URL`)
    if (!isAbsolute(this.HDC) || !existsSync(this.HDC))
      throw new Error(`[ohos-playwright] OHOS_PW_HDC "${this.HDC}" 不是有效的可执行文件路径（需绝对路径且文件存在）`)
  }

  get hdcBinary(): string { return this.HDC }

  hdc(args: string[], opts?: Partial<ExecFileSyncOptions>): string {
    const fullArgs = this._serial ? ['-t', this._serial, ...args] : args
    return String(execFileSync(this.HDC, fullArgs, { ...this.HDC_OPTS, ...opts })).trim()
  }

  shellOnDevice(cmd: string): string { return this.hdc(['shell', cmd]) }

  findBrowserPid(): number | null {
    const ps = this.shellOnDevice('ps -o pid,args')
    for (const line of ps.split('\n')) {
      const t = line.trim()
      if (!t) continue
      const s = t.indexOf(' ')
      if (s === -1) continue
      if (t.slice(s + 1).trim() === this.BUNDLE) {
        const pid = parseInt(t.slice(0, s), 10)
        if (!Number.isNaN(pid)) return pid
      }
    }
    return null
  }

  private launchBrowser(): void {
    // MainAbility: single-page browser, no tab bar, no session restore.
    // Default for E2E testing. Set OHOS_PW_MAIN_BROWSER=1 for full browser UI.
    const ability = process.env.OHOS_PW_MAIN_BROWSER ? 'MainAbility' : 'MainAbility'
    this.shellOnDevice(
      `aa start -b ${this.BUNDLE} -m entry -a ${ability} -U ${this.LAUNCH_URL}`)
  }

  private findDevToolsSocket(pid: number): string | null {
    const unix = this.shellOnDevice('cat /proc/net/unix')
    const name = `webview_devtools_remote_${pid}`
    return unix.includes(`@${name}`) ? name : null
  }

  private pickFreePort(): Promise<number> {
    return new Promise((res, rej) => {
      const srv = createServer()
      srv.listen(0, '127.0.0.1', () => {
        const a = srv.address()
        if (a && typeof a === 'object') srv.close((e) => e ? rej(e) : res(a.port))
        else srv.close(() => rej(new Error('Failed to get port')))
      })
      srv.on('error', rej)
    })
  }

  private setupForward(port: number, socketName: string): void {
    try {
      const ls = this.hdc(['fport', 'ls'])
      const target = `localabstract:${socketName}`
      for (const line of ls.split('\n')) {
        const m = line.match(/tcp:(\d+)\s+(localabstract:\S+)/)
        if (m && m[2] === target) {
          try { this.hdc(['fport', 'rm', `tcp:${m[1]}`, m[2]]) } catch {}
        }
      }
    } catch {}
    this.hdc(['fport', `tcp:${port}`, `localabstract:${socketName}`])
  }

  setupReversePort(hostPort: number): void {
    try { this.hdc(['fport', 'rm', `tcp:${hostPort}`, `tcp:${hostPort}`]) } catch {}
    try { this.hdc(['rport', `tcp:${hostPort}`, `tcp:${hostPort}`]) } catch (e) {
      console.warn(`[ohos] rport tcp:${hostPort} failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  teardownReversePort(hostPort: number): void {
    try { this.hdc(['fport', 'rm', `tcp:${hostPort}`, `tcp:${hostPort}`]) } catch {}
  }

  private probeCdp(port: number): Promise<{ ok: boolean; err?: string; body?: string }> {
    return new Promise((res) => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (r) => {
        let b = ''
        r.on('data', (c: string) => (b += c))
        r.on('end', () => res({ ok: r.statusCode === 200, body: b }))
      })
      req.on('error', (e: NodeJS.ErrnoException) => res({ ok: false, err: e.code }))
      req.setTimeout(2000, () => { req.destroy(); res({ ok: false, err: 'TIMEOUT' }) })
    })
  }

  // Public liveness check for a cached endpoint URL (used by OhosDevice to decide
  // whether to reuse INFO_PATH's endpoint or call connect() to re-establish).
  async probeEndpoint(endpoint: string): Promise<boolean> {
    const m = endpoint.match(/^https?:\/\/[^:]+:(\d+)/)
    if (!m) return false
    const r = await this.probeCdp(parseInt(m[1]!, 10))
    return r.ok
  }

  private cdpGet(port: number, path: string): Promise<{ ok: boolean; body?: string }> {
    return new Promise((res) => {
      const req = http.get(`http://127.0.0.1:${port}${path}`, (r) => {
        let b = ''
        r.on('data', (c: string) => (b += c))
        r.on('end', () => res({ ok: r.statusCode === 200, body: b }))
      })
      req.on('error', () => res({ ok: false }))
      req.setTimeout(2000, () => { req.destroy(); res({ ok: false }) })
    })
  }

  async retry<T>(
    fn: () => T | Promise<T>,
    opts: { max?: number; interval?: number; label?: string } = {},
  ): Promise<T> {
    const { max = 10, interval = 1000, label = '' } = opts
    for (let i = 0; i < max; i++) {
      try { const r = await fn(); if (r != null) return r } catch {}
      if (i < max - 1) {
        const delay = Math.min(100 * Math.pow(2, i), interval)
        await new Promise(r => setTimeout(r, delay))
      }
    }
    throw new Error(label ? `${label}: exhausted ${max} retries` : `retry exhausted after ${max} attempts`)
  }

  hasDeviceConnected(): boolean {
    try {
      const t = this.hdc(['list', 'targets'])
      return t.length > 0 && t !== '[Empty]'
    } catch { return false }
  }

  private tconn(addr: string): boolean {
    try {
      const out = this.hdc(['tconn', addr], { timeout: 10000 })
      return out.includes('Connect OK') || out.includes('repeat operation')
    } catch { return false }
  }

  tryLocalDevice(): boolean {
    try {
      const raw = String(execFileSync('param', ['get', 'persist.hdc.port'],
        { ...this.HDC_OPTS, timeout: 3000 })).trim()
      const port = parseInt(raw, 10)
      if (!port || port < 1 || port > 65535) return false
      const addr = `127.0.0.1:${port}`
      if (this.tconn(addr) && this.hasDeviceConnected()) return true
    } catch {}
    return false
  }

  ensureHdcKey(): boolean {
    const keyDir = join(homedir(), '.harmony')
    const priv = join(keyDir, 'hdckey')
    const pub = join(keyDir, 'hdckey.pub')
    if (existsSync(priv) && existsSync(pub)) return false
    mkdirSync(keyDir, { recursive: true })
    for (const f of [priv, pub]) {
      if (existsSync(f)) { try { copyFileSync(f, f + '.bak') } catch {} }
    }
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    writeFileSync(priv, privateKey, { mode: 0o600 })
    writeFileSync(pub, publicKey, { mode: 0o644 })
    return true
  }

  private async selfHealHdc(): Promise<void> {
    if (process.env.OHOS_PW_AUTO_HEAL === '0') return
    if (!existsSync('/data/service/hnp/bin/hdc')) return
    this.ensureHdcKey()
    try { this.hdc(['kill']) } catch {}
    await new Promise(r => setTimeout(r, 500))
    try { this.hdc(['start']) } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }

  async ensureDeviceConnected(): Promise<void> {
    if (process.env.OHOS_PW_AUTO_CONNECT === '0') return
    if (this.hasDeviceConnected()) return
    if (this.tryLocalDevice()) return
    await this.selfHealHdc()
    if (this.hasDeviceConnected()) return
    if (this.tryLocalDevice()) return
    if (!process.stdin.isTTY) throw new Error('[ohos] No device connected')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const addr = await new Promise<string>((res) => {
      rl.question('[ohos] paste device ip:port (Enter to abort): ', (a) => { rl.close(); res(a.trim()) })
    })
    if (!addr) throw new Error('[ohos] no device address provided')
    if (!this.tconn(addr)) throw new Error(`[ohos] hdc tconn ${addr} failed`)
  }

  async connect(): Promise<string> {
    await this.ensureDeviceConnected()
    console.log(`[ohos] locating ${this.BUNDLE}...`)

    let pid = this.findBrowserPid()
    const browserWasRunning = !!pid

    if (!pid) {
      this.launchBrowser()
      pid = await this.retry(() => this.findBrowserPid(),
        { max: 20, interval: 1000, label: `Failed to launch ${this.BUNDLE}` }) as number
    }
    console.log(`[ohos] pid=${pid}`)

    const socket = await this.retry(
      () => this.findDevToolsSocket(pid as number),
      { max: 10, interval: 500, label: 'DevTools socket not found' },
    ) as string

    const port = await this.pickFreePort()
    this.setupForward(port, socket)
    console.log(`[ohos] fport tcp:${port} -> localabstract:${socket}`)

    const probe = await this.probeCdp(port)
    if (!probe.ok) throw new Error(`CDP probe failed: ${probe.err || probe.body}`)

    let info: Record<string, unknown>
    try { info = JSON.parse(probe.body!) }
    catch { throw new Error(`CDP response not valid JSON`) }
    console.log(`[ohos] CDP ready: ${info.Browser}`)

    let openedNewTab = false
    // When the browser is already running with pages, reuse existing tabs
    // instead of opening a new one. When running but has no open pages, the
    // browser may be in a stale state and won't accept new intents.
    if (browserWasRunning) {
      const listBefore = await this.cdpGet(port, '/json/list')
      const countBefore = this._countPages(listBefore.body ?? '[]')
      // countBefore > 0: reuse existing tabs, don't create new ones
    }

    const endpoint = `http://127.0.0.1:${port}`
    mkdirSync(dirname(INFO_PATH), { recursive: true })
    writeFileSync(INFO_PATH, JSON.stringify(
      { port, pid, socket, endpoint, openedNewTab, launchUrl: this.LAUNCH_URL }, null, 2
    ))
    console.log(`[ohos] wrote ${INFO_PATH}`)
    return endpoint
  }

  _countPages(listJson: string): number {
    try {
      return (JSON.parse(listJson) as { type: string }[]).filter(t => t.type === 'page').length
    } catch { return 0 }
  }

  async reconnect(): Promise<string> {
    console.log('[ohos] reconnect: restarting browser...')
    this.launchBrowser()
    const pid = await this.retry(() => this.findBrowserPid(),
      { max: 30, interval: 500, label: 'reconnect: browser pid' }) as number
    const socket = await this.retry(
      () => this.findDevToolsSocket(pid),
      { max: 10, interval: 500, label: 'reconnect: DevTools socket' },
    ) as string
    const port = await this.pickFreePort()
    this.setupForward(port, socket)
    await this.retry(async () => {
      const p = await this.probeCdp(port); return p.ok ? true : null
    }, { max: 10, interval: 500, label: 'reconnect: CDP probe' })
    const endpoint = `http://127.0.0.1:${port}`
    writeFileSync(INFO_PATH, JSON.stringify(
      { port, pid, socket, endpoint, openedNewTab: false, launchUrl: this.LAUNCH_URL }, null, 2
    ))
    console.log(`[ohos] reconnect: ready at ${endpoint}`)
    return endpoint
  }

  async teardown(): Promise<void> {
    let info: CdpInfo
    try { info = JSON.parse(readFileSync(INFO_PATH, 'utf8')) }
    catch { return }
    try {
      execFileSync(this.HDC,
        ['fport', 'rm', `tcp:${info.port}`, `localabstract:${info.socket}`],
        { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message?.split('\n')[0] : String(e)
      console.warn(`[ohos] fport rm failed: ${msg}`)
    }
    try { unlinkSync(INFO_PATH) } catch {}
  }
}

// Module-level singleton for shim compatibility (setup.mts / teardown.mts 使用)
let _defaultConn: OhosDeviceConnection | null = null

export function getDefaultConnection(): OhosDeviceConnection {
  if (!_defaultConn) _defaultConn = new OhosDeviceConnection()
  return _defaultConn
}

// ── Compat exports for backward compatibility with setup.mts consumers ────────
// These wrap the singleton instance so callers that imported named functions
// from setup.mts (before the refactor) continue to work unchanged.

export interface RetryOptions { max?: number; interval?: number; label?: string }

export async function retry<T>(
  fn: () => T | Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  return getDefaultConnection().retry(fn, opts)
}

export function findBrowserPid(): number | null {
  return getDefaultConnection().findBrowserPid()
}

export function hasDeviceConnected(): boolean {
  return getDefaultConnection().hasDeviceConnected()
}

export async function ensureDeviceConnected(): Promise<void> {
  return getDefaultConnection().ensureDeviceConnected()
}

export function setupReversePort(hostPort: number): void {
  return getDefaultConnection().setupReversePort(hostPort)
}

export function teardownReversePort(hostPort: number): void {
  return getDefaultConnection().teardownReversePort(hostPort)
}

export async function reconnect(): Promise<string> {
  return getDefaultConnection().reconnect()
}

export function tryLocalDevice(): boolean {
  return getDefaultConnection().tryLocalDevice()
}

export function ensureHdcKey(): boolean {
  return getDefaultConnection().ensureHdcKey()
}

export function countCdpPages(listJson: string): number {
  return getDefaultConnection()._countPages(listJson)
}
