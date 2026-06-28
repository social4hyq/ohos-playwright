import { execFileSync, type ExecFileSyncOptions } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import http from 'node:http'
import { INFO_PATH } from './info-path.mts'

const HDC: string = process.env.OHOS_PW_HDC ?? '/data/service/hnp/bin/hdc'
const BUNDLE: string = process.env.OHOS_PW_BUNDLE ?? 'com.huawei.hmos.browser'
const LAUNCH_URL: string = process.env.OHOS_PW_LAUNCH_URL ?? 'about:blank'

// 校验环境变量，防止通过 hdc shell 注入恶意命令。
// BUNDLE 必须是点分隔的 Android 风格包名；LAUNCH_URL 必须是合法 URL。
const SAFE_BUNDLE_RE = /^[a-zA-Z][a-zA-Z0-9.]*$/
const SAFE_URL_RE = /^[a-z][a-z0-9+.-]*:(?:\/\/)?\S+$/i
if (!SAFE_BUNDLE_RE.test(BUNDLE) || BUNDLE.length > 256) {
  throw new Error(`[ohos-playwright] OHOS_PW_BUNDLE "${BUNDLE}" 不是合法的包名（期望: com.example.app）`)
}
if (!SAFE_URL_RE.test(LAUNCH_URL) || LAUNCH_URL.length > 2048) {
  throw new Error(`[ohos-playwright] OHOS_PW_LAUNCH_URL "${LAUNCH_URL}" 不是合法的 URL`)
}
if (!isAbsolute(HDC) || !existsSync(HDC)) {
  throw new Error(`[ohos-playwright] OHOS_PW_HDC "${HDC}" 不是有效的可执行文件路径（需绝对路径且文件存在）`)
}

// HarmonyOS host 提示：系统自带 hdc 与本机设备 hdcd 协议匹配；
// 其他 hdc（如 OHOS SDK 3.x）连本机设备会握手失败。
const SYSTEM_HDC_ON_HARMONY = '/data/service/hnp/bin/hdc'
if (existsSync(SYSTEM_HDC_ON_HARMONY) && HDC !== SYSTEM_HDC_ON_HARMONY) {
  console.warn(`[ohos-playwright] 注意：当前 OHOS_PW_HDC="${HDC}"，但系统自带 ${SYSTEM_HDC_ON_HARMONY} 才能与本机 HarmonyOS 设备通信；如握手失败请改用系统 hdc。`)
}

const HDC_OPTS: ExecFileSyncOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] } as const

function hdc(args: string[], opts?: Partial<ExecFileSyncOptions>): string {
  return String(execFileSync(HDC, args, { ...HDC_OPTS, ...opts })).trim()
}

function shellOnDevice(cmd: string): string { return hdc(['shell', cmd]) }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface RetryOptions { max?: number; interval?: number; label?: string }

// Exponential backoff: 100ms → 200ms → 400ms … capped at `interval` (default 1000ms).
export async function retry<T>(
  fn: () => T | Promise<T>,
  { max = 10, interval = 1000, label = '' }: RetryOptions = {},
): Promise<T> {
  for (let i = 0; i < max; i++) {
    try { const r = await fn(); if (r) return r } catch {}
    if (i < max - 1) {
      const delay = Math.min(100 * Math.pow(2, i), interval)
      await sleep(delay)
    }
  }
  throw new Error(label ? `${label}: exhausted retries (${max} attempts)` : `retry exhausted after ${max} attempts`)
}

// Batch ps + /proc/net/unix into a single hdc shell call — avoids two
// subprocess spawns and transfers.
// Separator uses shell $$ (device shell PID) so the echo output is a numeric
// string like "OHOS_SEP_12345". The hdc process itself is visible in ps with
// literal "$$" in its args — no collision with the actual separator value.
function fetchDeviceState(): { ps: string; unix: string } {
  const raw = shellOnDevice('ps -o pid,args; echo "OHOS_SEP_$$"; cat /proc/net/unix')
  const sepMatch = raw.match(/OHOS_SEP_\d+/)
  if (!sepMatch) return { ps: raw, unix: '' }
  const [ps, unix] = raw.split(sepMatch[0])
  return { ps: ps || '', unix: unix || '' }
}

export function findBrowserPid(): number | null {
  const { ps } = fetchDeviceState()
  // Match the main process only: its cmdline equals BUNDLE exactly.
  // Child processes like "com.huawei.hmos.browser:render" / ":gpu" must be
  // excluded — the DevTools abstract socket only exists on the main process,
  // so picking a child PID leads to socket-not-found errors downstream.
  for (const line of ps.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const s = t.indexOf(' ')
    if (s === -1) continue
    if (t.slice(s + 1).trim() === BUNDLE) {
      const pid = parseInt(t.slice(0, s), 10)
      if (!Number.isNaN(pid)) return pid
    }
  }
  return null
}

function launchBrowser(): void {
  shellOnDevice(`aa start -b ${BUNDLE} -m entry -a MainAbility -U ${LAUNCH_URL}`)
}

function findDevToolsSocket(pid: number, cachedUnix?: string): string | null {
  const unix = cachedUnix ?? shellOnDevice('cat /proc/net/unix')
  const name = `webview_devtools_remote_${pid}`
  return unix.includes(`@${name}`) ? name : null
}

function pickFreePort(): Promise<number> {
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

function parseFportRules(lsOutput: string): { port: string; socket: string }[] {
  const rules: { port: string; socket: string }[] = []
  for (const line of lsOutput.split('\n')) {
    const m = line.match(/tcp:(\d+)\s+(localabstract:\S+)/)
    if (m) rules.push({ port: m[1], socket: m[2] })
  }
  return rules
}

function setupForward(port: number, socketName: string): void {
  // Remove all existing rules for this socket (any port) before creating a new
  // one — prevents rule accumulation from crashed runs. hdc fport rm requires
  // separate arguments; a single "tcp:PORT localabstract:SOCKET" string is
  // silently ignored by hdc.
  try {
    const ls = hdc(['fport', 'ls'])
    const target = `localabstract:${socketName}`
    for (const { port: p, socket: s } of parseFportRules(ls)) {
      if (s === target) {
        try { hdc(['fport', 'rm', `tcp:${p}`, s]) } catch {}
      }
    }
  } catch {}
  hdc(['fport', `tcp:${port}`, `localabstract:${socketName}`])
}

interface CdpProbeResult { ok: boolean; err?: string; body?: string }

function cdpGet(port: number, path: string): Promise<CdpProbeResult> {
  return new Promise((res) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (r) => {
      let b = ''
      r.on('data', (c: string) => (b += c))
      r.on('end', () => res({ ok: r.statusCode === 200, body: b }))
    })
    req.on('error', (e: NodeJS.ErrnoException) => res({ ok: false, err: e.code }))
    req.setTimeout(2000, () => { req.destroy(); res({ ok: false, err: 'TIMEOUT' }) })
  })
}

function probeCdp(port: number): Promise<CdpProbeResult> { return cdpGet(port, '/json/version') }

export function countCdpPages(listJson: string): number {
  try {
    const targets = JSON.parse(listJson) as { type: string }[]
    return targets.filter((t) => t.type === 'page').length
  } catch { return 0 }
}

const IP_PORT_RE = /^(\d{1,3}\.){3}\d{1,3}:\d+$/

function listTargets(): string { return hdc(['list', 'targets']) }

export function hasDeviceConnected(): boolean {
  const t = listTargets()
  return t.length > 0 && t !== '[Empty]'
}

// 已连接时 hdc tconn 返回 "Target is connected, repeat operation"，也视作成功。
function tconn(addr: string): boolean {
  try {
    const out = hdc(['tconn', addr], { timeout: 10000 })
    return out.includes('Connect OK') || out.includes('repeat operation')
  } catch { return false }
}

function promptAddress(): Promise<string> {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question('[ohos-playwright] paste device ip:port (Enter to abort): ', (a) => { rl.close(); res(a.trim()) })
  })
}

const CONNECT_HELP = [
  '[ohos-playwright] 未发现设备。请在设备上：',
  '  1) 进入「设置 → 关于本机」连点版本号开启「开发者选项」',
  '  2) 进入「开发者选项」启用「无线调试」',
  '  3) 确认设备与本机在同一 Wi-Fi 下',
  '也可手动跑 `hdc tconn <ip:port>` 后重新启动测试。',
  '若不希望自动连接，设 OHOS_PW_AUTO_CONNECT=0 跳过。',
].join('\n')

export function tryLocalDevice(): boolean {
  try {
    const raw = String(execFileSync('param', ['get', 'persist.hdc.port'], { ...HDC_OPTS, timeout: 3000 })).trim()
    const port = parseInt(raw, 10)
    if (!port || port < 1 || port > 65535) return false
    console.log(`[ohos-playwright] local device port from param: ${port}`)
    const addr = `127.0.0.1:${port}`
    if (tconn(addr) && hasDeviceConnected()) { console.log(`[ohos-playwright] connected: ${addr}`); return true }
    console.warn(`[ohos-playwright] tconn ${addr} failed`)
  } catch {}
  return false
}

// HarmonyOS host 自愈：缺 hdc key 时自动生成 RSA-3072，并重启本机 hdc server。
// 仅在 host 看似 HarmonyOS 时触发（/data/service/hnp/bin/hdc 存在）；最多 1 次。
const HARMONY_HDC_PATH = '/data/service/hnp/bin/hdc'
const HARMONY_KEY_DIR = join(homedir(), '.harmony')
let selfHealAttempted = false

function isHarmonyHost(): boolean { return existsSync(HARMONY_HDC_PATH) }

export function ensureHdcKey(): boolean {
  const priv = join(HARMONY_KEY_DIR, 'hdckey')
  const pub = join(HARMONY_KEY_DIR, 'hdckey.pub')
  if (existsSync(priv) && existsSync(pub)) return false
  mkdirSync(HARMONY_KEY_DIR, { recursive: true })
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
  console.warn(`[ohos-playwright] generated RSA-3072 hdc key at ${priv} (设备首次连接需 UI 授权)`)
  return true
}

async function restartHdcServer(): Promise<void> {
  try { hdc(['kill']) } catch {}
  await sleep(500)
  try { hdc(['start']) } catch (e: unknown) {
    console.warn(`[ohos-playwright] hdc start failed: ${e instanceof Error ? e.message : e}`)
  }
}

async function selfHealHdc(): Promise<void> {
  if (selfHealAttempted) return
  selfHealAttempted = true
  if (process.env.OHOS_PW_AUTO_HEAL === '0') return
  if (!isHarmonyHost()) return
  console.log('[ohos-playwright] self-heal: 检查 hdc key 与重启本机 hdc server...')
  const keyChanged = ensureHdcKey()
  await restartHdcServer()
  await sleep(keyChanged ? 1500 : 500)
}

export async function ensureDeviceConnected(): Promise<void> {
  if (process.env.OHOS_PW_AUTO_CONNECT === '0') return
  if (hasDeviceConnected()) return
  if (tryLocalDevice()) return

  await selfHealHdc()
  if (hasDeviceConnected()) return
  if (tryLocalDevice()) return

  if (!process.stdin.isTTY) throw new Error(CONNECT_HELP)
  console.log(CONNECT_HELP)
  const addr = await promptAddress()
  if (!addr) throw new Error('[ohos-playwright] no device address provided; aborting.')
  if (!IP_PORT_RE.test(addr)) throw new Error(`[ohos-playwright] "${addr}" is not a valid ip:port.`)
  if (!tconn(addr)) throw new Error(`[ohos-playwright] hdc tconn ${addr} failed.`)
  if (!hasDeviceConnected()) throw new Error('[ohos-playwright] tconn reported OK but list targets still empty.')
  console.log(`[ohos-playwright] connected: ${addr}`)
}

// Re-connects to ArkWeb after a CDP WebSocket crash.
// Called by fixture.mts when browser.on('disconnected') fires.
// Returns the new CDP endpoint URL.
export async function reconnect(): Promise<string> {
  console.log('[ohos-playwright] reconnect: restarting browser...')
  // aa start: if browser is already running this opens a new tab; if it crashed it relaunches.
  launchBrowser()

  // Wait for the main browser process (may take a moment after aa start).
  const pid = await retry(findBrowserPid, { max: 30, interval: 500, label: 'reconnect: browser pid' }) as number
  console.log(`[ohos-playwright] reconnect: pid=${pid}`)

  const socket = await retry(
    () => findDevToolsSocket(pid),
    { max: 10, interval: 500, label: 'reconnect: DevTools socket' },
  ) as string

  const port = await pickFreePort()
  setupForward(port, socket)
  console.log(`[ohos-playwright] reconnect: fport tcp:${port} -> localabstract:${socket}`)

  await retry(
    async () => { const p = await probeCdp(port); return p.ok ? true : null },
    { max: 10, interval: 500, label: 'reconnect: CDP probe' },
  )

  const endpoint = `http://127.0.0.1:${port}`
  writeFileSync(INFO_PATH, JSON.stringify({ port, pid, socket, endpoint, openedNewTab: false, launchUrl: LAUNCH_URL }, null, 2))
  console.log(`[ohos-playwright] reconnect: ready at ${endpoint}`)
  return endpoint
}

export default async function globalSetup(): Promise<void> {
  await ensureDeviceConnected()
  console.log(`[ohos-playwright] locating ${BUNDLE}...`)

  // Batch ps + /proc/net/unix into a single hdc call.
  let pid = findBrowserPid()
  const browserWasRunning = !!pid

  if (!pid) {
    console.log('[ohos-playwright] browser not running, launching...')
    launchBrowser()
    // Backoff: 100, 200, 400, 800, 1000, 1000, … (max 20 attempts ≈ 10s total)
    pid = await retry(findBrowserPid, { max: 20, interval: 1000, label: `Failed to launch ${BUNDLE}` }) as number
  }
  console.log(`[ohos-playwright] browser pid=${pid}`)

  // Wait for the DevTools socket to appear — each retry fetches fresh
  // /proc/net/unix since the socket appears asynchronously after launch.
  const socket = await retry(
    () => findDevToolsSocket(pid),
    { max: 10, interval: 500, label: `DevTools socket not found for pid ${pid}` },
  ) as string
  console.log(`[ohos-playwright] socket=${socket}`)

  const port = await pickFreePort()
  setupForward(port, socket)
  console.log(`[ohos-playwright] hdc fport tcp:${port} -> localabstract:${socket}`)

  const probe = await probeCdp(port)
  if (!probe.ok) throw new Error(`CDP probe failed: ${probe.err || probe.body}`)
  let info: Record<string, unknown>
  try {
    info = JSON.parse(probe.body!)
  } catch {
    throw new Error(`CDP response is not valid JSON (body preview: ${probe.body?.slice(0, 300) ?? '(empty)'})`)
  }
  console.log(`[ohos-playwright] CDP ready: ${info.Browser}`)

  // If browser was already running with user tabs, open a fresh tab so tests
  // don't disturb the user's browsing session.
  let openedNewTab = false
  if (browserWasRunning) {
    const listBefore = await cdpGet(port, '/json/list')
    const countBefore = countCdpPages(listBefore.body ?? '[]')
    if (countBefore > 0) {
      launchBrowser()
      console.log(`[ohos-playwright] opened new tab (${countBefore} existing page(s))`)
      await retry(
        async () => {
          const r = await cdpGet(port, '/json/list')
          return countCdpPages(r.body ?? '[]') > countBefore ? true : null
        },
        { max: 10, interval: 500, label: 'new tab did not appear in CDP' },
      )
      openedNewTab = true
    }
  }

  mkdirSync(dirname(INFO_PATH), { recursive: true })
  writeFileSync(INFO_PATH, JSON.stringify({ port, pid, socket, endpoint: `http://127.0.0.1:${port}`, openedNewTab, launchUrl: LAUNCH_URL }, null, 2))
  console.log(`[ohos-playwright] wrote ${INFO_PATH}`)
}
