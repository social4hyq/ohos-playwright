import { execFileSync, type ExecFileSyncOptions } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import http from 'node:http'
import { INFO_PATH } from './info-path.mts'

const HDC: string = process.env.OHOS_PW_HDC ?? '/data/service/hnp/bin/hdc'
const BUNDLE: string = process.env.OHOS_PW_BUNDLE ?? 'com.huawei.hmos.browser'
const LAUNCH_URL: string = process.env.OHOS_PW_LAUNCH_URL ?? 'about:blank'

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
function fetchDeviceState(): { ps: string; unix: string } {
  const raw = shellOnDevice('ps -o pid,args; echo "---SOCKET---"; cat /proc/net/unix')
  const [ps, unix] = raw.split('---SOCKET---')
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

function setupForward(port: number, socketName: string): void {
  const ruler = `tcp:${port} localabstract:${socketName}`
  try { hdc(['fport', 'rm', ruler]) } catch {}
  hdc(['fport', 'tcp:' + port, 'localabstract:' + socketName])
}

interface CdpProbeResult { ok: boolean; err?: string; body?: string }

function probeCdp(port: number): Promise<CdpProbeResult> {
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

const IP_PORT_RE = /^(\d{1,3}\.){3}\d{1,3}:\d+$/

function listTargets(): string { return hdc(['list', 'targets']) }

export function hasDeviceConnected(): boolean {
  const t = listTargets()
  return t.length > 0 && t !== '[Empty]'
}

// discoverDevices timeout reduced from 6s to 3s — LAN broadcast on local
// network should respond within 1-2s; longer wait is unlikely to help.
export function discoverDevices(): string[] {
  let out = ''
  try { out = hdc(['discover'], { timeout: 3000 }) } catch (e: unknown) {
    out = (e as { stdout?: Buffer | string }).stdout?.toString() ?? ''
  }
  return out.split('\n').map(s => s.trim()).filter(s => IP_PORT_RE.test(s))
}

function tconn(addr: string): boolean {
  try { return hdc(['tconn', addr], { timeout: 10000 }).includes('Connect OK') } catch { return false }
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
  '  4) 防火墙放行本机 UDP:8710 入站（hdc discover 广播用）',
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

export async function ensureDeviceConnected(): Promise<void> {
  if (process.env.OHOS_PW_AUTO_CONNECT === '0') return
  if (hasDeviceConnected()) return
  if (tryLocalDevice()) return

  console.log('[ohos-playwright] no local device, broadcasting (hdc discover)...')
  const found = discoverDevices()
  for (const addr of found) {
    console.log(`[ohos-playwright] hdc tconn ${addr}`)
    if (tconn(addr) && hasDeviceConnected()) return
  }
  if (found.length > 0) console.warn('[ohos-playwright] discovered devices but none connected')

  if (!process.stdin.isTTY) throw new Error(CONNECT_HELP)
  console.log(CONNECT_HELP)
  const addr = await promptAddress()
  if (!addr) throw new Error('[ohos-playwright] no device address provided; aborting.')
  if (!IP_PORT_RE.test(addr)) throw new Error(`[ohos-playwright] "${addr}" is not a valid ip:port.`)
  if (!tconn(addr)) throw new Error(`[ohos-playwright] hdc tconn ${addr} failed.`)
  if (!hasDeviceConnected()) throw new Error('[ohos-playwright] tconn reported OK but list targets still empty.')
  console.log(`[ohos-playwright] connected: ${addr}`)
}

export default async function globalSetup(): Promise<void> {
  await ensureDeviceConnected()
  console.log(`[ohos-playwright] locating ${BUNDLE}...`)

  // Batch ps + /proc/net/unix into a single hdc call.
  let pid = findBrowserPid()

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
  const info = JSON.parse(probe.body!)
  console.log(`[ohos-playwright] CDP ready: ${info.Browser}`)

  mkdirSync(dirname(INFO_PATH), { recursive: true })
  writeFileSync(INFO_PATH, JSON.stringify({ port, pid, socket, endpoint: `http://127.0.0.1:${port}` }, null, 2))
  console.log(`[ohos-playwright] wrote ${INFO_PATH}`)
}
