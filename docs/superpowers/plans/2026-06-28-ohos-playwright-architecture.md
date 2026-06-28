# ohos-playwright 架构重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ohos-playwright 重设计为对标 `playwright.android` 的 PR-ready 架构，通过真实 context 隔离和能力声明式降级，将 test:upstream 通过率从 96% 提升至 ≥ 98%。

**Architecture:** 提取 `src/ohos/`（OhosDevice / OhosDeviceConnection / OhosCapabilities / patches），`fixture.mts` 内部改用 `OhosDevice`，所有公开 API 保持不变。test:upstream 的 fixme 从硬编码正则表改为 capabilities 驱动。

**Tech Stack:** TypeScript ESM (.mts), @playwright/test 1.60, Node ≥ 24, hdc CLI, CDP WebSocket

**Spec:** `docs/superpowers/specs/2026-06-28-ohos-playwright-architecture-design.md`

---

## File Map

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `src/ohos/connection.mts` | OhosDeviceConnection（hdc + CDP 生命周期）|
| 新建 | `src/ohos/patches/page-patch.mts` | beforeunload tracking, goto/goBack/goForward, popup, evaluate 覆盖 |
| 新建 | `src/ohos/patches/input-patch.mts` | locator().hover() → CDP Input.dispatchMouseEvent |
| 新建 | `src/ohos/patches/context-patch.mts` | applyContextPatches()：newPage + close override |
| 新建 | `src/ohos/patches/browser-patch.mts` | applyBrowserPatches()：newContext wrap + newPage |
| 新建 | `src/ohos/capabilities.mts` | OhosCapabilities 接口 + detectCapabilities() |
| 新建 | `src/ohos/device.mts` | OhosDevice 类：browser() + capabilities() |
| 新建 | `src/ohos/namespace.mts` | ohos.devices() / ohos.connect() |
| 修改 | `src/setup.mts` | 薄 shim → OhosDeviceConnection.connect() |
| 修改 | `src/teardown.mts` | 薄 shim → OhosDeviceConnection.teardown() |
| 修改 | `src/fixture.mts` | 内部改用 OhosDevice，新增 device/capabilities fixture，加 clearCookies |
| 修改 | `src/register.mts` | 移除 PW_CHROMIUM_ATTACH_TO_OTHER 设置（移入 device.mts）|
| 修改 | `package.json` | `"."` export 指向新 index.mts |
| 新建 | `src/index.mts` | 主入口：re-export fixture + export ohos namespace |
| 修改 | `tests/upstream/fixtures/ohos-skip.ts` | 精简为 ARKWEB_ISSUE_URL 字典 |
| 修改 | `tests/upstream/fixtures/upstream-fixture.ts` | 添加 capabilities fixture，改写 ohosAutoSkip，简化 contextFactory |
| 修改 | `tests/upstream/playwright.config.ts` | multiContextOk = true |
| 新建 | `docs/arkweb-feature-requests.md` | ArkWeb CDP 优化诉求（7 条）|
| 新建 | `docs/playwright-upstream-requests.md` | Playwright 上游诉求（2 条）|

---

## Task 1：创建 `src/ohos/connection.mts`

**Files:**
- 新建：`src/ohos/connection.mts`
- 参考：`src/setup.mts`（逻辑来源）、`src/info-path.mts`（INFO_PATH 常量）

- [ ] **Step 1：建目录**

```bash
mkdir -p /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright/src/ohos/patches
```

- [ ] **Step 2：写 `src/ohos/connection.mts`**

将 `setup.mts` 的全部逻辑提取为 `OhosDeviceConnection` 类。`globalSetup()` 的逻辑 → `connect()`；`globalTeardown()` 的逻辑 → `teardown()`；`reconnect()` → 类方法。

```typescript
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
      throw new Error(`[ohos] HDC "${this.HDC}" 不是有效路径`)
  }

  hdc(args: string[], opts?: Partial<ExecFileSyncOptions>): string {
    return String(execFileSync(this.HDC, args, { ...this.HDC_OPTS, ...opts })).trim()
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
    this.shellOnDevice(
      `aa start -b ${this.BUNDLE} -m entry -a MainAbility -U ${this.LAUNCH_URL}`
    )
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

  private async retry<T>(
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

  private ensureHdcKey(): boolean {
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
    if (browserWasRunning) {
      const listBefore = await this.cdpGet(port, '/json/list')
      const countBefore = this._countPages(listBefore.body ?? '[]')
      if (countBefore > 0) {
        this.launchBrowser()
        await this.retry(async () => {
          const r = await this.cdpGet(port, '/json/list')
          return this._countPages(r.body ?? '[]') > countBefore ? true : null
        }, { max: 10, interval: 500, label: 'new tab did not appear' })
        openedNewTab = true
      }
    }

    const endpoint = `http://127.0.0.1:${port}`
    mkdirSync(dirname(INFO_PATH), { recursive: true })
    writeFileSync(INFO_PATH, JSON.stringify(
      { port, pid, socket, endpoint, openedNewTab, launchUrl: this.LAUNCH_URL }, null, 2
    ))
    console.log(`[ohos] wrote ${INFO_PATH}`)
    return endpoint
  }

  private _countPages(listJson: string): number {
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
```

- [ ] **Step 3：typecheck**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright && npm run typecheck 2>&1 | head -40
```

期望：仅 connection.mts 相关错误（setup.mts 尚未改写），其他文件无新增错误。

- [ ] **Step 4：Commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
git add src/ohos/connection.mts
git commit -m "feat(ohos): add OhosDeviceConnection class extracted from setup.mts"
```

---

## Task 2：将 `src/setup.mts` 和 `src/teardown.mts` 改为薄 shim

**Files:**
- 修改：`src/setup.mts`（整体替换）
- 修改：`src/teardown.mts`（整体替换）

- [ ] **Step 1：改写 `src/setup.mts`**

```typescript
// src/setup.mts
// 薄 shim — 逻辑已移入 src/ohos/connection.mts
import { getDefaultConnection } from './ohos/connection.mts'

export { retry, findBrowserPid, hasDeviceConnected, ensureDeviceConnected,
         setupReversePort, teardownReversePort, reconnect, tryLocalDevice,
         ensureHdcKey, countCdpPages } from './ohos/connection.mts'

export default async function globalSetup(): Promise<void> {
  await getDefaultConnection().connect()
}
```

> **注意**：`setup.mts` 目前导出了 `retry`, `findBrowserPid`, `hasDeviceConnected`, `ensureDeviceConnected`, `setupReversePort`, `teardownReversePort`, `reconnect`, `tryLocalDevice`, `ensureHdcKey`, `countCdpPages`。这些成为 OhosDeviceConnection 的方法后，需要作为独立函数重新 export 以保持向后兼容。  
> 在 `connection.mts` 末尾添加对应的函数包装：
>
> ```typescript
> // connection.mts 末尾添加（compat exports）
> const _compat = new OhosDeviceConnection()
> export const retry = _compat['retry'].bind(_compat) as typeof _compat['retry']
> export const findBrowserPid = () => _compat.findBrowserPid()
> export const hasDeviceConnected = () => _compat.hasDeviceConnected()
> export const tryLocalDevice = () => _compat.tryLocalDevice()
> export const setupReversePort = (p: number) => _compat.setupReversePort(p)
> export const teardownReversePort = (p: number) => _compat.teardownReversePort(p)
> export const ensureDeviceConnected = () => _compat.ensureDeviceConnected()
> export const reconnect = () => _compat.reconnect()
> export const countCdpPages = (json: string) => _compat['_countPages'](json)
> export const ensureHdcKey = () => _compat['ensureHdcKey']()
> ```

- [ ] **Step 2：改写 `src/teardown.mts`**

```typescript
// src/teardown.mts
// 薄 shim — 逻辑已移入 src/ohos/connection.mts
import { getDefaultConnection } from './ohos/connection.mts'

export default async function globalTeardown(): Promise<void> {
  await getDefaultConnection().teardown()
}
```

- [ ] **Step 3：typecheck + test**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -40
npm test 2>&1 | tail -20
```

期望：typecheck 零错误，npm test 全部通过。

- [ ] **Step 4：Commit**

```bash
git add src/setup.mts src/teardown.mts src/ohos/connection.mts
git commit -m "refactor(setup): thin shim delegates to OhosDeviceConnection"
```

---

## Task 3：创建 `src/ohos/patches/page-patch.mts`

**Files:**
- 新建：`src/ohos/patches/page-patch.mts`
- 参考：`src/fixture.mts` 第 148-480 行（BEFOREUNLOAD_TRACKING_SCRIPT 到 installPageWrappers 结束）

从 `fixture.mts` 提取 `installPageWrappers` 及其所有依赖函数：`BEFOREUNLOAD_TRACKING_SCRIPT`、`clearBeforeunload`、`makeSafePageClose`、`createPopupPage`。

- [ ] **Step 1：写 `src/ohos/patches/page-patch.mts`**

```typescript
// src/ohos/patches/page-patch.mts
// ArkWeb per-page CDP 适配层：
//   - beforeunload tracking（防止系统弹窗挂起 WebSocket）
//   - goto/goBack/goForward 覆盖（CDP 路径兼容）
//   - window.open 拦截 + popup poller
//   - locator 存根（hover 实现见 input-patch.mts）
//   - evaluate 错误 re-emit

import type { Page, BrowserContext } from '@playwright/test'

export type PageCleanup = (opts?: { navigateTo?: string }) => Promise<void>

// ── 从 fixture.mts 原样搬入 ───────────────────────────────────────────────
// 粘贴 fixture.mts 第 148-164 行（BEFOREUNLOAD_TRACKING_SCRIPT 函数定义）
export const BEFOREUNLOAD_TRACKING_SCRIPT = () => {
  if ((window as any).__ohosBeforeunloadPatched) return
  ;(window as any).__ohosBeforeunloadPatched = true
  const _handlers: EventListenerOrEventListenerObject[] = []
  const _origAdd = window.addEventListener.bind(window)
  const _origRemove = window.removeEventListener.bind(window)
  ;(window as any).addEventListener = (type: string, listener: any, ...rest: any[]) => {
    if (type === 'beforeunload' && listener) _handlers.push(listener)
    return (_origAdd as any)(type, listener, ...rest)
  }
  ;(window as any).removeEventListener = (type: string, listener: any, ...rest: any[]) => {
    if (type === 'beforeunload') {
      const idx = _handlers.indexOf(listener)
      if (idx !== -1) _handlers.splice(idx, 1)
    }
    return (_origRemove as any)(type, listener, ...rest)
  }
  ;(window as any).__ohosRemoveAllBeforeunload = () => {
    ;(window as any).onbeforeunload = null
    for (const h of _handlers) {
      try { _origRemove('beforeunload', h) } catch {}
    }
    _handlers.length = 0
  }
}

export async function clearBeforeunload(p: Page): Promise<void> {
  try {
    await p.evaluate(() => {
      if ((window as any).__ohosRemoveAllBeforeunload) (window as any).__ohosRemoveAllBeforeunload()
      else { (window as any).onbeforeunload = null }
    })
  } catch {}
}

export function makeSafePageClose(p: Page): (_opts?: { runBeforeUnload?: boolean }) => Promise<void> {
  return async (_opts?: { runBeforeUnload?: boolean }) => {
    await clearBeforeunload(p)
    const dismissDlg = (d: import('playwright-core').Dialog) => d.dismiss().catch(() => {})
    p.on('dialog', dismissDlg)
    try { await p.goto('about:blank') } catch {}
    p.off('dialog', dismissDlg)
    ;(p as unknown as { emit: (e: string) => void }).emit('close')
  }
}

// createPopupPage — ArkWeb 新 tab 通过 Target.createTarget 创建
export async function createPopupPage(
  context: BrowserContext,
  seedPage: Page,
  popupUrl: string,
): Promise<Page | null> {
  let session: import('@playwright/test').CDPSession | null = null
  try {
    session = await context.newCDPSession(seedPage)
    const r = await Promise.race([
      (session as unknown as { send: (cmd: string, args?: unknown) => Promise<unknown> })
        .send('Target.createTarget', { url: 'about:blank' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('createTarget timeout')), 3000)),
    ]) as { targetId?: string }
    if (!r.targetId) return null

    const newPage = await (async () => {
      const deadline = Date.now() + 2000
      while (Date.now() < deadline) {
        const allPages = context.pages()
        const p = allPages.find((p) => p !== seedPage && p.url() === 'about:blank')
          ?? allPages.find((p) => p !== seedPage)
        if (p) return p
        await new Promise(r => setTimeout(r, 50))
      }
      return null
    })()
    if (!newPage) return null

    if (popupUrl && popupUrl !== 'about:blank') {
      try { await newPage.goto(popupUrl, { timeout: 5000 }) } catch {}
    }
    return newPage
  } catch { return null }
  finally {
    if (session) await session.detach().catch(() => {})
  }
}

// ── installPageWrappers — 从 fixture.mts 原样搬入 ────────────────────────
// 将 fixture.mts 第 204-400 行（installPageWrappers 函数体）粘贴到此处。
// 唯一改动：将 import { createPopupPage } 替换为本文件内的定义（已在上方）。
// 函数签名不变：
export async function installPageWrappers(
  page: Page,
  context: BrowserContext,
  baseURL: string | undefined,
  options?: { skipCreateTarget?: boolean },
): Promise<PageCleanup> {
  // 完整代码：从 fixture.mts 的 installPageWrappers 函数体复制，hover 段落除外
  // （hover 已移入 input-patch.mts 的 applyInputPatches，此处保留 savedLocator 存根）
  const ctxEmit = (context as unknown as { emit: (e: string, v: unknown) => void }).emit.bind(context)

  const session = await context.newCDPSession(page)
  try {
    try {
      const { cssVisualViewport } = await session.send('Page.getLayoutMetrics' as 'Page.getLayoutMetrics')
      const cached = {
        width: Math.round((cssVisualViewport as { clientWidth: number }).clientWidth),
        height: Math.round((cssVisualViewport as { clientHeight: number }).clientHeight),
      }
      const origViewportSize = page.viewportSize.bind(page)
      page.viewportSize = () => origViewportSize() ?? cached
    } catch {}
  } finally {
    await session.detach()
  }

  if (!(page as any).__ohosBeforeunloadPatched) {
    ;(page as any).__ohosBeforeunloadPatched = true
    await page.addInitScript(BEFOREUNLOAD_TRACKING_SCRIPT)
  }

  const savedClose = (page as unknown as Record<string, unknown>)['close'] as typeof page.close
  ;(page as any).close = makeSafePageClose(page)

  const savedGoto = (page as unknown as Record<string, unknown>)['goto'] as typeof page.goto
  const origGoto = page.goto.bind(page)
  ;(page as any).origGoto = origGoto
  ;(page as any).goto = async (url: string, options?: Parameters<typeof page.goto>[1]) => {
    if (baseURL && url && !url.includes('://') && !url.startsWith('about:') && !url.startsWith('data:')) {
      url = new URL(url, baseURL).toString()
    }
    return origGoto(url, options)
  }

  ;(page as any).goBack = async (options?: Parameters<typeof page.goBack>[0]) => {
    const timeout = options?.timeout ?? 30000
    const s = await page.context().newCDPSession(page)
    try {
      const nav = await (s as any).send('Page.getNavigationHistory')
      const prevIndex = nav.currentIndex as number
      if (prevIndex <= 0) return null
      await page.evaluate(() => history.back())
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const nav2 = await (s as any).send('Page.getNavigationHistory')
        if ((nav2.currentIndex as number) < prevIndex) break
        await new Promise(r => setTimeout(r, 80))
      }
      if (Date.now() >= deadline) throw new Error(`page.goBack: Timeout ${timeout}ms exceeded`)
    } finally { await s.detach() }
    return null
  }

  ;(page as any).goForward = async (options?: Parameters<typeof page.goForward>[0]) => {
    const timeout = options?.timeout ?? 30000
    const s = await page.context().newCDPSession(page)
    try {
      const nav = await (s as any).send('Page.getNavigationHistory')
      const prevIndex = nav.currentIndex as number
      if (prevIndex >= (nav.entries as any[]).length - 1) return null
      await page.evaluate(() => history.forward())
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const nav2 = await (s as any).send('Page.getNavigationHistory')
        if ((nav2.currentIndex as number) > prevIndex) break
        await new Promise(r => setTimeout(r, 80))
      }
      if (Date.now() >= deadline) throw new Error(`page.goForward: Timeout ${timeout}ms exceeded`)
    } finally { await s.detach() }
    return null
  }

  // hover：已移入 input-patch.mts 的 applyInputPatches()
  // installPageWrappers 不再覆盖 locator；applyInputPatches 在 page fixture 中单独调用。

  const alreadyPatched = (page as unknown as Record<string, unknown>)['__ohosPopupPatched']
  if (!alreadyPatched) {
    ;(page as unknown as Record<string, unknown>)['__ohosPopupPatched'] = true
    await page.addInitScript(() => {
      if ((window as unknown as Record<string, unknown>)['__ohosPopupPatched']) return
      ;(window as unknown as Record<string, unknown>)['__ohosPopupPatched'] = true
      ;(window as unknown as Record<string, unknown>)['__ohosPopupQueue'] = [] as Array<{ url: string }>
      window.open = (url?: string | URL) => {
        ;((window as unknown as Record<string, unknown>)['__ohosPopupQueue'] as Array<{ url: string }>)
          .push({ url: String(url ?? '') })
        return null
      }
    })
  }

  const origEvaluate = page.evaluate.bind(page)
  const popupPoller = setInterval(async () => {
    try {
      const pending = await origEvaluate(() => {
        const q = (window as unknown as Record<string, unknown>)['__ohosPopupQueue'] as Array<{ url: string }>
        ;(window as unknown as Record<string, unknown>)['__ohosPopupQueue'] = []
        return q
      })
      for (const { url } of pending ?? []) {
        let emitted: Page | null = null
        if (!options?.skipCreateTarget) {
          try { emitted = await createPopupPage(context, page, url || 'about:blank') } catch {}
        }
        if (!emitted) {
          const idle = context.pages().find(p => p !== page && p.url() === 'about:blank')
          if (idle) {
            try {
              if (url && url !== 'about:blank') await idle.goto(url, { timeout: 5000 })
              if (!(idle as any).__ohosPageClosePatch) {
                ;(idle as any).__ohosPageClosePatch = true
                ;(idle as any).close = makeSafePageClose(idle)
              }
              emitted = idle
            } catch {}
          }
        }
        if (!emitted) {
          ctxEmit('page', { waitForLoadState: async () => {}, url: () => url, close: async () => {} } as unknown as Page)
        } else {
          ctxEmit('page', emitted)
        }
      }
    } catch {}
  }, 150)

  const savedEvaluate = (page as unknown as Record<string, unknown>)['evaluate'] as typeof origEvaluate
  ;(page as unknown as { evaluate: unknown }).evaluate = async (fn: unknown, arg?: unknown) => {
    try {
      return await origEvaluate(fn as Parameters<typeof origEvaluate>[0], arg as Parameters<typeof origEvaluate>[1])
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e))
      ;(page as unknown as { emit: (e: string, v: unknown) => void }).emit('pageerror', err)
    }
  }

  return async (opts?: { navigateTo?: string }) => {
    clearInterval(popupPoller)
    ;(page as unknown as { evaluate: unknown }).evaluate = savedEvaluate
    ;(page as unknown as { goto: unknown }).goto = savedGoto
    ;(page as unknown as { close: unknown }).close = savedClose
    if (opts?.navigateTo) {
      await clearBeforeunload(page)
      const dismissDialog = (d: import('playwright-core').Dialog) => d.dismiss().catch(() => {})
      page.on('dialog', dismissDialog)
      try { await page.goto(opts.navigateTo) } catch {}
      page.off('dialog', dismissDialog)
    }
  }
}
```

- [ ] **Step 2：typecheck**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright && npm run typecheck 2>&1 | head -30
```

- [ ] **Step 3：Commit**

```bash
git add src/ohos/patches/page-patch.mts
git commit -m "feat(ohos/patches): add page-patch.mts with installPageWrappers"
```

---

## Task 4：创建 `src/ohos/patches/input-patch.mts`

**Files:**
- 新建：`src/ohos/patches/input-patch.mts`

CDP `Input.dispatchMouseEvent` 替代现有的 JS `dispatchEvent`（isTrusted:false 副作用）。

- [ ] **Step 1：写 `src/ohos/patches/input-patch.mts`**

```typescript
// src/ohos/patches/input-patch.mts
// hover override：CDP Input.dispatchMouseEvent（isTrusted:true）
// 替代 fixture.mts 中 page.mouse.move() 方案（同样 isTrusted:false）。
// :hover 伪类激活仍待 ArkWeb 修复（CAP-03）。

import type { Page } from '@playwright/test'

export function applyInputPatches(page: Page): void {
  const origLocator = page.locator.bind(page)
  ;(page as any).locator = (...args: Parameters<typeof page.locator>) => {
    const loc = origLocator(...args)
    ;(loc as any).hover = async (_options?: Parameters<typeof loc.hover>[0]) => {
      const box = await loc.boundingBox()
      if (!box) throw new Error('[ohos] hover: element has no bounding box')
      const x = Math.round(box.x + box.width / 2)
      const y = Math.round(box.y + box.height / 2)
      const session = await page.context().newCDPSession(page)
      try {
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x, y,
          button: 'none', modifiers: 0, buttons: 0,
          clickCount: 0, deltaX: 0, deltaY: 0, pointerType: 'mouse',
        } as any)
      } finally {
        await session.detach()
      }
    }
    return loc
  }
}
```

- [ ] **Step 2：typecheck + commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -20
git add src/ohos/patches/input-patch.mts
git commit -m "feat(ohos/patches): add input-patch.mts with CDP hover"
```

---

## Task 5：创建 `src/ohos/patches/context-patch.mts`

**Files:**
- 新建：`src/ohos/patches/context-patch.mts`
- 参考：`src/fixture.mts` 第 490-540 行（context fixture 中的 newPage/close patch 块）

- [ ] **Step 1：写 `src/ohos/patches/context-patch.mts`**

```typescript
// src/ohos/patches/context-patch.mts
// applyContextPatches — 对每个 BrowserContext 对象注入 ArkWeb 兼容补丁。
// 幂等（__ohosPatch 标志防止重复调用）。

import type { BrowserContext } from '@playwright/test'
import { clearBeforeunload, makeSafePageClose, createPopupPage, BEFOREUNLOAD_TRACKING_SCRIPT } from './page-patch.mts'

export function applyContextPatches(ctx: BrowserContext): void {
  if ((ctx as any).__ohosPatch) return
  ;(ctx as any).__ohosPatch = true

  // close：navigate to about:blank + emit close（替代 Target.disposeBrowserContext）
  ;(ctx as any).close = async () => {
    for (const p of ctx.pages()) {
      await clearBeforeunload(p)
      try { await p.goto('about:blank') } catch {}
    }
    ;(ctx as unknown as { emit: (e: string) => void }).emit('close')
  }

  // newPage：createPopupPage（Target.createTarget + PW_CHROMIUM_ATTACH_TO_OTHER=1）
  //          失败时 fallback → reset seedPage to about:blank
  ;(ctx as any).newPage = async () => {
    const seedPage = ctx.pages()[0]
    if (!seedPage) throw new Error('[ohos] context.newPage(): no pages in context')

    const newP = await createPopupPage(ctx, seedPage, 'about:blank')
    if (newP) {
      if (!(newP as any).__ohosPageClosePatch) {
        ;(newP as any).__ohosPageClosePatch = true
        if (!(newP as any).__ohosBeforeunloadPatched) {
          ;(newP as any).__ohosBeforeunloadPatched = true
          await newP.addInitScript(BEFOREUNLOAD_TRACKING_SCRIPT)
        }
        ;(newP as any).close = makeSafePageClose(newP)
      }
      return newP
    }

    // Fallback：reset seedPage to about:blank
    await clearBeforeunload(seedPage)
    const dismissDlg = (d: import('playwright-core').Dialog) => d.dismiss().catch(() => {})
    seedPage.on('dialog', dismissDlg)
    try { await seedPage.goto('about:blank') } catch {}
    seedPage.off('dialog', dismissDlg)
    return seedPage
  }

  // 对 context 内所有已有 page 补 close patch
  for (const p of ctx.pages()) {
    if (!(p as any).__ohosPageClosePatch) {
      ;(p as any).__ohosPageClosePatch = true
      ;(p as any).close = makeSafePageClose(p)
    }
  }
}
```

- [ ] **Step 2：typecheck + commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -20
git add src/ohos/patches/context-patch.mts
git commit -m "feat(ohos/patches): add context-patch.mts"
```

---

## Task 6：创建 `src/ohos/patches/browser-patch.mts`

**Files:**
- 新建：`src/ohos/patches/browser-patch.mts`

- [ ] **Step 1：写 `src/ohos/patches/browser-patch.mts`**

```typescript
// src/ohos/patches/browser-patch.mts
// applyBrowserPatches — browser 对象级 ArkWeb 补丁：
//   1. 对所有已有 context 调用 applyContextPatches
//   2. 包裹 browser.newContext()：创建真实隔离 context + 自动注入补丁
//   3. 新增 browser.newPage()：委托给 patched newContext + ctx.newPage()

import type { Browser, BrowserContextOptions } from '@playwright/test'
import { applyContextPatches } from './context-patch.mts'
import type { OhosDeviceConnection } from '../connection.mts'

export function applyBrowserPatches(
  browser: Browser,
  conn: OhosDeviceConnection,
): void {
  // 1. 默认 context（connectOverCDP 时已存在，不经过 newContext wrapper）
  for (const ctx of browser.contexts()) {
    applyContextPatches(ctx)
  }

  // 2. 包裹 newContext：创建真实隔离 context + 立即注入补丁
  const realNewContext = browser.newContext.bind(browser)
  ;(browser as any).newContext = async (opts?: BrowserContextOptions) => {
    const ctx = await realNewContext(opts ?? {})
    applyContextPatches(ctx)
    return ctx
  }

  // 3. 新增 newPage：委托给 patched newContext + ctx.newPage()
  ;(browser as any).newPage = async (opts?: BrowserContextOptions) => {
    const ctx = await (browser as any).newContext(opts)
    return ctx.newPage()
  }

  // 4. 断线自动重连
  browser.on('disconnected', () => { void conn.reconnect() })
}
```

- [ ] **Step 2：typecheck + commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -20
git add src/ohos/patches/browser-patch.mts
git commit -m "feat(ohos/patches): add browser-patch.mts"
```

---

## Task 7：创建 `src/ohos/capabilities.mts`

**Files:**
- 新建：`src/ohos/capabilities.mts`

- [ ] **Step 1：写能力声明文件**

```typescript
// src/ohos/capabilities.mts
// ArkWeb 能力声明。静态表基于 2026-06-27 实测结论。
// false 项对应 docs/arkweb-feature-requests.md 中的诉求条目。

import type { Browser } from '@playwright/test'
import { execFileSync } from 'node:child_process'

export interface OhosCapabilities {
  // Context & Pages
  multipleContexts: boolean
  newPageInNonDefaultContext: boolean
  contextScreenshot: boolean
  // Lifecycle
  beforeunloadDismiss: boolean
  persistentContext: boolean
  // Input
  rawMouseEvents: boolean
  cssHoverFromInput: boolean
  // Network
  userAgentOverride: boolean
  proxyConfig: boolean
  // 媒体 / 录制
  recordHar: boolean
  videoRecording: boolean
  screencast: boolean
  // 覆盖率 & 事件
  jsCoverageAcrossNavigations: boolean
  webSocketCreatedEvent: boolean
  // Playwright 内部
  exposeBindingHandle: boolean
  playwrightInspector: boolean
  // 元信息
  readonly arkwebVersion: string
  readonly ohosVersion: string
}

function parseArkWebMajor(version: string): number {
  const m = version.match(/(\d+)\./)
  return m ? parseInt(m[1], 10) : 0
}

function detectOhosVersion(hdcBinary: string): string {
  try {
    return execFileSync(hdcBinary, ['shell', 'param get const.ohos.apiversion'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 }).trim()
  } catch { return 'unknown' }
}

export async function detectCapabilities(
  browser: Browser,
  hdcBinary = '/data/service/hnp/bin/hdc',
): Promise<OhosCapabilities> {
  const arkwebVersion = browser.version()
  const majorVersion = parseArkWebMajor(arkwebVersion)

  const caps: OhosCapabilities = {
    // ✅ reaudit L1
    multipleContexts:              true,
    // ✅ capability matrix T1（需 PW_CHROMIUM_ATTACH_TO_OTHER=1，由 OhosDevice 管理）
    newPageInNonDefaultContext:    true,
    // ❌ S1: Page.captureScreenshot 在新 context 无响应（CAP-01）
    contextScreenshot:             false,
    // ❌ 系统级 beforeunload 弹窗 CDP 无法 dismiss（CAP-02）
    beforeunloadDismiss:           false,
    // ❌ 无 launch 步骤
    persistentContext:             false,
    // ✅ reaudit L3
    rawMouseEvents:                true,
    // ❌ reaudit L4（CAP-03）
    cssHoverFromInput:             false,
    // ✅ reaudit L2
    userAgentOverride:             true,
    // ❌ 无 launch 步骤
    proxyConfig:                   false,
    // ❌ 需 context 创建选项
    recordHar:                     false,
    // ❌ Page.startScreencast 未实现（CAP-06）
    videoRecording:                false,
    screencast:                    false,
    // ❌ 实测不累计（CAP-05）
    jsCoverageAcrossNavigations:   false,
    // ❌ 事件未触发（CAP-04）
    webSocketCreatedEvent:         false,
    // ❌ PW 1.60 已移除公开 API
    exposeBindingHandle:           false,
    // ❌ 需 Inspector 进程
    playwrightInspector:           false,
    arkwebVersion,
    ohosVersion: detectOhosVersion(hdcBinary),
  }

  // 动态探针：ArkWeb ≥ 140 时重测 cssHoverFromInput（未来版本可能修复）
  if (majorVersion >= 140) {
    caps.cssHoverFromInput = await probeCssHover(browser)
  }

  return caps
}

async function probeCssHover(browser: Browser): Promise<boolean> {
  const ctx = browser.contexts()[0]
  if (!ctx) return false
  const page = ctx.pages()[0]
  if (!page) return false
  try {
    const session = await ctx.newCDPSession(page)
    try {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: 1, y: 1,
        button: 'none', modifiers: 0, buttons: 0,
        clickCount: 0, deltaX: 0, deltaY: 0, pointerType: 'mouse',
      } as any)
      // 简单探针：命令成功 = 事件投递基础可用。:hover 激活仍需单独验证。
      return false // 保守：直到有真实 :hover 激活证据
    } finally {
      await session.detach()
    }
  } catch { return false }
}
```

- [ ] **Step 2：typecheck + commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -20
git add src/ohos/capabilities.mts
git commit -m "feat(ohos): add OhosCapabilities + detectCapabilities()"
```

---

## Task 8：创建 `src/ohos/device.mts` 和 `src/ohos/namespace.mts`

**Files:**
- 新建：`src/ohos/device.mts`
- 新建：`src/ohos/namespace.mts`

- [ ] **Step 1：写 `src/ohos/device.mts`**

```typescript
// src/ohos/device.mts
import { chromium } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { OhosDeviceConnection, type OhosConnectOptions } from './connection.mts'
import { applyBrowserPatches } from './patches/browser-patch.mts'
import { detectCapabilities, type OhosCapabilities } from './capabilities.mts'

export class OhosDevice {
  readonly serial: string
  private readonly _conn: OhosDeviceConnection
  private _browser: Browser | null = null
  private _caps: OhosCapabilities | null = null

  constructor(opts: OhosConnectOptions & { serial?: string } = {}) {
    this.serial = opts.serial ?? 'default'
    this._conn = new OhosDeviceConnection(opts)
  }

  async browser(): Promise<Browser> {
    if (this._browser) return this._browser
    // PW_CHROMIUM_ATTACH_TO_OTHER=1：ArkWeb Target.createTarget → type='other'
    // Playwright 需此 flag 才会把 'other' type target 接入 ctx.pages()。
    process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
    const endpoint = await this._conn.connect()
    const raw = await chromium.connectOverCDP(endpoint)
    applyBrowserPatches(raw, this._conn)
    this._browser = raw
    return raw
  }

  async capabilities(): Promise<OhosCapabilities> {
    if (this._caps) return this._caps
    this._caps = await detectCapabilities(
      await this.browser(),
      this._conn['HDC'] as string,
    )
    return this._caps
  }

  async close(): Promise<void> {
    await this._conn.teardown()
    this._browser = null
    this._caps = null
  }
}

// Worker-level singleton（fixture.mts 通过此函数获取 OhosDevice）
let _workerDevice: OhosDevice | null = null

export function getOhosDevice(opts?: OhosConnectOptions): OhosDevice {
  if (!_workerDevice) _workerDevice = new OhosDevice(opts)
  return _workerDevice
}

export function resetOhosDevice(): void {
  _workerDevice = null
}
```

- [ ] **Step 2：写 `src/ohos/namespace.mts`**

```typescript
// src/ohos/namespace.mts
// ohos namespace — 镜像 playwright.android
import { OhosDevice, type OhosConnectOptions } from './device.mts'
import { execFileSync } from 'node:child_process'

function listHdcTargets(hdcBinary: string): string[] {
  try {
    const out = execFileSync(hdcBinary, ['list', 'targets'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim()
    if (!out || out === '[Empty]') return []
    return out.split('\n').map(s => s.trim()).filter(Boolean)
  } catch { return [] }
}

export const ohos = {
  async devices(opts: { hdcBinary?: string } = {}): Promise<OhosDevice[]> {
    const hdc = opts.hdcBinary ?? process.env.OHOS_PW_HDC ?? '/data/service/hnp/bin/hdc'
    const serials = listHdcTargets(hdc)
    if (serials.length === 0) return [new OhosDevice({ hdcBinary: hdc })]
    return serials.map(serial => new OhosDevice({ hdcBinary: hdc, serial }))
  },

  async connect(opts: OhosConnectOptions = {}): Promise<OhosDevice> {
    return new OhosDevice(opts)
  },
}
```

- [ ] **Step 3：typecheck + commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -20
git add src/ohos/device.mts src/ohos/namespace.mts
git commit -m "feat(ohos): add OhosDevice + ohos namespace"
```

---

## Task 9：创建 `src/index.mts` 并更新 `package.json`

**Files:**
- 新建：`src/index.mts`
- 修改：`package.json`（`"."` export）

现有 `"."` 指向 `dist/fixture.mjs`。新建 `index.mts` re-export fixture 的全部导出并新增 `ohos` namespace。

- [ ] **Step 1：写 `src/index.mts`**

```typescript
// src/index.mts
// 主入口：re-export fixture + ohos namespace
export * from './fixture.mts'
export { ohos } from './ohos/namespace.mts'
```

- [ ] **Step 2：更新 `package.json` 的 `"."` 指向**

将：
```json
".": "./dist/fixture.mjs",
```
改为：
```json
".": "./dist/index.mjs",
```

- [ ] **Step 3：typecheck + build + test**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -20
npm run build 2>&1 | tail -10
npm test 2>&1 | tail -20
```

期望：typecheck 零错误，build 成功，npm test 全部通过。

- [ ] **Step 4：Commit**

```bash
git add src/index.mts package.json
git commit -m "feat: add src/index.mts with ohos namespace export"
```

---

## Task 10：改写 `src/fixture.mts`

**Files:**
- 修改：`src/fixture.mts`（大幅精简，内部改用 OhosDevice）

**关键变化：**
- `browser` fixture：`chromium.connectOverCDP()` 替换为 `getOhosDevice().browser()`
- `context` fixture：新增 `await ctx.clearCookies()`
- `page` fixture：`installPageWrappers` 调用改为从 `page-patch.mts` import，追加 `applyInputPatches`
- 新增 `device`（worker 级）和 `capabilities`（worker 级）fixture
- 保留所有公开导出（`test`, `expect`, `DeviceDescriptor`, `StorageState`, `PageCleanup`, `installPageWrappers`, `createPopupPage`）

- [ ] **Step 1：在 fixture.mts 顶部更新 import 块**

将现有的 `_patchBrowser`, `triggerReconnect`, `_activeBrowser` 等内部变量替换为 `getOhosDevice()` 调用。  
在文件顶部添加：

```typescript
import { getOhosDevice, resetOhosDevice } from './ohos/device.mts'
import { applyInputPatches } from './ohos/patches/input-patch.mts'
import {
  installPageWrappers, createPopupPage, clearBeforeunload, makeSafePageClose,
  BEFOREUNLOAD_TRACKING_SCRIPT, type PageCleanup,
} from './ohos/patches/page-patch.mts'
```

删除：`_patchBrowser`, `triggerReconnect`, `_activeBrowser`, `_reconnectPromise`,  
`createPopupPage`（从 page-patch.mts 重新 export），  
`BEFOREUNLOAD_TRACKING_SCRIPT`, `clearBeforeunload`, `makeSafePageClose`,  
`installPageWrappers`（从 page-patch.mts 重新 export）。

- [ ] **Step 2：替换 `browser` fixture**

将现有 `browser` fixture（约 fixture.mts 450-490 行）替换为：

```typescript
browser: [
  async ({}, use: (b: Browser) => Promise<void>) => {
    const device = getOhosDevice()
    const b = await device.browser()
    await use(b)
  },
  { scope: 'worker' as const },
],
```

- [ ] **Step 3：更新 `context` fixture — 新增 clearCookies**

在 `context` fixture 的 `use(ctx)` 之前插入：

```typescript
// 每次测试前清空 cookie（共享 context 的兜底，真实 context 不需要此步）
await ctx.clearCookies().catch(() => {})
```

- [ ] **Step 4：更新 `page` fixture — 追加 applyInputPatches**

在 `installPageWrappers(page, context, baseURL)` 调用之后，`use(page)` 之前添加：

```typescript
applyInputPatches(page)
```

- [ ] **Step 5：新增 `device` 和 `capabilities` fixture**

在 `test = base.extend<...>({` 块内添加：

```typescript
device: [
  async ({}, use) => {
    await use(getOhosDevice())
  },
  { scope: 'worker' as const },
],

capabilities: [
  async ({}, use) => {
    await use(await getOhosDevice().capabilities())
  },
  { scope: 'worker' as const },
],
```

- [ ] **Step 6：typecheck + test**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -40
npm test 2>&1 | tail -30
```

期望：typecheck 零错误，npm test 全部通过（fixture.test.mts 中 "exports test" 等测试仍然通过）。

- [ ] **Step 7：Commit**

```bash
git add src/fixture.mts
git commit -m "refactor(fixture): use OhosDevice internally, add device/capabilities fixtures, clearCookies"
```

---

## Task 11：精简 `src/register.mts`

**Files:**
- 修改：`src/register.mts`

移除 `PW_CHROMIUM_ATTACH_TO_OTHER` 的设置（已移入 `OhosDevice.browser()`），保留 `process.platform` patch 和 `registerHooks`。

- [ ] **Step 1：从 register.mts 中删除 PW_CHROMIUM_ATTACH_TO_OTHER 相关注释和逻辑**

找到如下注释块并删除（约 register.mts 第 24-40 行）：
```typescript
  // ArkWeb's Target.createTarget returns a target with type='other'...
  // PW_CHROMIUM_ATTACH_TO_OTHER (crBrowser.ts:181) is playwright's upstream
  // escape hatch...
  // process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
```

保留其余内容不变（`process.env.OHOS_PW_HOST`、`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`、`process.platform = 'linux'`、`registerHooks`）。

- [ ] **Step 2：更新 register.mts 中的注释**

在 `process.platform = 'linux'` 行附近添加说明：
```typescript
  // PW_CHROMIUM_ATTACH_TO_OTHER=1 现在由 OhosDevice.browser() 在连接时设置。
```

- [ ] **Step 3：typecheck + test + commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -20
npm test 2>&1 | tail -20
git add src/register.mts
git commit -m "refactor(register): remove PW_CHROMIUM_ATTACH_TO_OTHER (moved to OhosDevice)"
```

---

## Task 12：精简 `tests/upstream/fixtures/ohos-skip.ts`

**Files:**
- 修改：`tests/upstream/fixtures/ohos-skip.ts`

删除 `OHOS_FILE_FIXME` 和 `OHOS_FIXME` 正则表（逻辑移入 `ohosAutoSkip` fixture），只保留 `ARKWEB_ISSUE_URL` 字典。

- [ ] **Step 1：重写 `ohos-skip.ts`**

```typescript
// tests/upstream/fixtures/ohos-skip.ts
// ArkWeb CDP 限制对应的 issue URL 表。
// 匹配逻辑见 upstream-fixture.ts ohosAutoSkip fixture。
// Issue 提交后更新 URL（当前为占位符，待提交到 gitee.com/openharmony/web_webview）。

export const ARKWEB_ISSUE_URL: Record<string, string> = {
  contextScreenshot:            'https://gitee.com/openharmony/web_webview/issues (CAP-01 待提交)',
  beforeunloadDismiss:          'https://gitee.com/openharmony/web_webview/issues (CAP-02 待提交)',
  cssHoverFromInput:            'https://gitee.com/openharmony/web_webview/issues (CAP-03 待提交)',
  webSocketCreatedEvent:        'https://gitee.com/openharmony/web_webview/issues (CAP-04 待提交)',
  jsCoverageAcrossNavigations:  'https://gitee.com/openharmony/web_webview/issues (CAP-05 待提交)',
  screencast:                   'https://gitee.com/openharmony/web_webview/issues (CAP-06 待提交)',
  proxyConfig:                  '无 launch 步骤（connectOverCDP 架构限制）',
  persistentContext:             '无 launch 步骤（connectOverCDP 架构限制）',
  recordHar:                    '需 context 创建选项（connectOverCDP 架构限制）',
  playwrightInspector:          '需 Inspector 进程（connectOverCDP 架构限制）',
}
```

- [ ] **Step 2：typecheck + commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -20
git add tests/upstream/fixtures/ohos-skip.ts
git commit -m "refactor(upstream): simplify ohos-skip.ts to ARKWEB_ISSUE_URL dictionary"
```

---

## Task 13：改写 `tests/upstream/fixtures/upstream-fixture.ts`

**Files:**
- 修改：`tests/upstream/fixtures/upstream-fixture.ts`

三处改动：① 新增 `capabilities` fixture；② 改写 `ohosAutoSkip`；③ 简化 `contextFactory`。

- [ ] **Step 1：在 import 块末尾添加新 import**

```typescript
import type { OhosCapabilities } from 'ohos-playwright/fixture'
import { ARKWEB_ISSUE_URL } from './ohos-skip.js'
```

删除旧的 `import { OHOS_FILE_FIXME } from './ohos-skip.js'`。

- [ ] **Step 2：在 `BrowserTestTestFixtures` 类型中新增 `capabilities`**

```typescript
type BrowserTestTestFixtures = {
  // ... 现有字段 ...
  capabilities: OhosCapabilities   // ← 新增
}
```

- [ ] **Step 3：替换 `ohosAutoSkip` fixture 实现**

将现有的 `ohosAutoSkip` fixture 替换为：

```typescript
ohosAutoSkip: [async ({ capabilities: caps }, run, testInfo) => {
  const file: string = (testInfo as any).file ?? ''

  const check = (
    flag: keyof OhosCapabilities,
    pattern: RegExp,
    note: string,
  ) => {
    if (!caps[flag] && pattern.test(file)) {
      testInfo.fixme(true, `ArkWeb[${flag}]: ${note} — ${ARKWEB_ISSUE_URL[flag] ?? ''}`)
    }
  }

  check('recordHar',          /browsercontext-har/,
    'HAR 录制需 context 创建选项')
  check('beforeunloadDismiss',/beforeunload/,
    '系统级 beforeunload 弹窗无法通过 CDP dismiss')
  check('proxyConfig',        /browsercontext-proxy/,
    'proxy 为 launch-time 选项')
  check('screencast',         /screencast|video/,
    'Page.startScreencast 未实现')
  check('playwrightInspector',/inspector|debug-ctrl|debugger/,
    'Inspector 进程不可用')
  check('persistentContext',  /defaultbrowsercontext|browsercontext-reuse/,
    'persistent context 需 launch 步骤')

  await run()
}, { auto: true, scope: 'test' }],
```

- [ ] **Step 4：新增 `capabilities` fixture**

```typescript
capabilities: [async ({ device }, use) => {
  await use(await (device as any).capabilities())
}, { scope: 'worker' }],
```

- [ ] **Step 5：简化 `contextFactory` teardown**

将现有 teardown：
```typescript
for (const ctx of contexts) {
  for (const p of ctx.pages()) await p.goto('about:blank').catch(() => {});
}
```
替换为：
```typescript
// patched close()：navigate to about:blank + emit close（安全，不会断 WebSocket）
for (const ctx of contexts) {
  await ctx.close().catch(() => {})
}
```

- [ ] **Step 6：typecheck + commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -30
git add tests/upstream/fixtures/upstream-fixture.ts
git commit -m "refactor(upstream): capabilities-driven ohosAutoSkip, simplify contextFactory"
```

---

## Task 14：更新 `tests/upstream/playwright.config.ts`

**Files:**
- 修改：`tests/upstream/playwright.config.ts`

- [ ] **Step 1：修改 `multiContextOk` 常量**

将：
```typescript
const multiContextOk = process.env.PW_CHROMIUM_ATTACH_TO_OTHER === '1'
```
替换为：
```typescript
// OhosDevice.browser() 自动设置 PW_CHROMIUM_ATTACH_TO_OTHER=1；上游测试始终启用多 context。
const multiContextOk = true
```

- [ ] **Step 2：更新 `workers` 配置**

将：
```typescript
workers: isOhos && !multiContextOk ? 1 : undefined,
```
替换为：
```typescript
workers: isOhos ? (process.env.OHOS_PW_WORKERS ? parseInt(process.env.OHOS_PW_WORKERS) : 1) : undefined,
```

> 默认仍用 1 worker 保守运行；设 `OHOS_PW_WORKERS=2` 可并行。

- [ ] **Step 3：typecheck + commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run typecheck 2>&1 | head -20
git add tests/upstream/playwright.config.ts
git commit -m "refactor(upstream/config): multiContextOk=true, OHOS_PW_WORKERS env"
```

---

## Task 15：运行 test:upstream 验证通过率

**前提：** 设备已连接（`hdc list targets` 有输出）。

- [ ] **Step 1：完整构建**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run build 2>&1 | tail -10
```

期望：`build` 成功，`dist/` 下有新增的 `index.mjs`。

- [ ] **Step 2：运行 test:upstream（单 worker，稳定模式）**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
npm run test:upstream 2>&1 | tee logs/test-upstream-post-refactor.log | tail -30
```

期望：失败数 ≤ 4，(passed + fixme) / total ≥ 98%。

- [ ] **Step 3：检查残余失败**

```bash
grep -E "^\s+\d+ failed" logs/test-upstream-post-refactor.log || echo "no failures line"
ls test-results/ | wc -l
```

若仍有失败，针对每条失败：
- 读取 `test-results/<name>/error-context.md`
- 判断是 (a) port defect（需修复）、(b) ArkWeb known limitation（加 capabilities fixme）、(c) 架构不兼容（不修）
- Port defect：返回对应 patch 文件修复；ArkWeb limitation：在 `ohosAutoSkip` 补 `check()` 规则

- [ ] **Step 4：若有 port defect 需修复，修复后重跑**

```bash
npm run build && npm run test:upstream 2>&1 | tail -20
```

- [ ] **Step 5：Commit 最终状态**

```bash
git add -A
git commit -m "test(upstream): verify ≥98% pass rate after architecture refactor"
```

---

## Task 16：创建 ArkWeb 和 Playwright 优化诉求文档

**Files:**
- 新建：`docs/arkweb-feature-requests.md`
- 新建：`docs/playwright-upstream-requests.md`

- [ ] **Step 1：创建 `docs/arkweb-feature-requests.md`**

```markdown
# ArkWeb CDP 优化诉求

目标仓库：https://gitee.com/openharmony/web_webview

| ID | Capability | 状态 | Issue |
|---|---|---|---|
| CAP-01 | contextScreenshot | 🔴 待提交 | — |
| CAP-02 | beforeunloadDismiss | 🔴 待提交 | — |
| CAP-03 | cssHoverFromInput | 🔴 待提交 | — |
| CAP-04 | webSocketCreatedEvent | 🟡 待提交 | — |
| CAP-05 | jsCoverageAcrossNavigations | 🟢 待提交 | — |
| CAP-06 | screencast | 🟡 待提交 | — |

---

## CAP-01：新 context 截图无响应

**Capability:** `contextScreenshot`  
**现状：** `Target.createBrowserContext` 创建的 context 中，`Page.captureScreenshot` CDP 命令无回复（5 s timeout）；默认 context 正常（bytes=20475）。  
**期望：** 新 context 中的 target 实现完整 `Page.*` 命令路径，与 Chromium / Edge 一致。  
**对照：** Edge 149 同命令正常响应（bytes=4254）。  
**影响：** screenshot 相关测试无法在新 context 中运行。  
**优先级：** 🔴 高

---

## CAP-02：beforeunload 弹窗无法通过 CDP dismiss

**Capability:** `beforeunloadDismiss`  
**现状：** ArkWeb 触发系统级 "离开页面？" 弹窗，`Page.javascriptDialogOpening` 事件不触发，`Dialog.handleJavaScriptDialog` 无法 dismiss，导致 CDP WebSocket 挂起。  
**期望：** CDP 标准 Dialog 事件流触发，允许程序化 dismiss。  
**影响：** `beforeunload.spec` 全部失败。  
**优先级：** 🔴 高

---

## CAP-03：CDP 鼠标输入不激活 `:hover` 伪类

**Capability:** `cssHoverFromInput`  
**现状：** `Input.dispatchMouseEvent(mouseMoved)` 可触发 DOM `mousemove` 事件，但不激活 CSS `:hover` 状态。  
**期望：** CDP 鼠标输入产生与真实用户操作等价的悬停效果。  
**对照：** Edge 149 同样行为（可能是 headless CDP 通用问题）。  
**优先级：** 🟡 中

---

## CAP-04：`Network.webSocketCreated` 事件未触发

**Capability:** `webSocketCreatedEvent`  
**现状：** 页面创建 WebSocket 时，CDP 不发出 `Network.webSocketCreated` 事件。  
**期望：** 与 Chromium 一致触发完整 WebSocket 生命周期事件。  
**优先级：** 🟡 中

---

## CAP-05：JS 覆盖率不跨导航累计

**Capability:** `jsCoverageAcrossNavigations`  
**现状：** `Profiler.startPreciseCoverage` + `resetOnNavigation:false` 导航后覆盖率重置。  
**期望：** 跨导航保持累计覆盖率。  
**优先级：** 🟢 低

---

## CAP-06：`Page.startScreencast` 未实现

**Capability:** `screencast` / `videoRecording`  
**现状：** `Page.startScreencast` CDP 命令无响应或返回错误。  
**期望：** 实现 screencast 完整命令路径。  
**优先级：** 🟡 中
```

- [ ] **Step 2：创建 `docs/playwright-upstream-requests.md`**

```markdown
# Playwright 上游诉求

目标仓库：https://github.com/microsoft/playwright

| ID | 内容 | 状态 |
|---|---|---|
| P-01 | 识别 `openharmony` 平台 | 🔴 待提交 |
| P-02 | `playwright.ohos` namespace | 🟡 待提交 |

---

## P-01：`calculatePlatform()` 识别 `openharmony` 平台

**文件：** `packages/playwright-core/src/utils/hostPlatform.ts`  
**现状：** `calculatePlatform()` 只识别 `linux/darwin/win32`；OpenHarmony 上返回 `<unknown>`。当前 workaround：`process.platform = 'linux'`（全局副作用，PR 不友好）。  
**期望：**
```typescript
// hostPlatform.ts（建议修改）
case 'openharmony':
  return `ubuntu24.04-${arch}`  // 或专属 ohos-arm64
```
**或** 提供官方 `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` 文档化支持，避免 process.platform 欺骗。  
**PR 优先级：** 🔴 高（是 ohos-playwright 进入上游的入口点）

---

## P-02：`playwright.ohos` namespace（长期目标）

**参照：** `packages/playwright-core/src/server/android/`  
**期望：** 在 playwright-core 中添加 `playwright.ohos` namespace，内置 hdc 设备发现、`OhosDevice`、`OhosCapabilities`，使 OpenHarmony 成为 Playwright 一等公民平台（镜像 Android WebView 支持）。  
**当前状态：** ohos-playwright 的 `src/ohos/` 作为参考实现，架构已对齐。  
**PR 优先级：** 🟡 中（先提 P-01）
```

- [ ] **Step 3：Commit**

```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
git add docs/arkweb-feature-requests.md docs/playwright-upstream-requests.md
git commit -m "docs: add ArkWeb feature requests and Playwright upstream requests"
```

---

## 验证清单

完成全部 Task 后确认：

- [ ] `npm run typecheck` — 零错误
- [ ] `npm test` — 全部通过（fixture.test.mts / config.test.mts / loader.test.mts 等）
- [ ] `npm run build` — 成功，`dist/index.mjs` 存在
- [ ] `import { ohos } from 'ohos-playwright'` 可用（无 TS 错误）
- [ ] `import { test } from 'ohos-playwright/fixture'` 行为不变
- [ ] `withOpenHarmony()` 在现有 playwright.config.ts 中零改动可用
- [ ] `npm run test:upstream` — 通过率 ≥ 98%，失败数 ≤ 4（均有对应 capability fixme）
