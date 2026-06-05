import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import http from 'node:http'
import { INFO_PATH } from './info-path.mjs'

const HDC = process.env.OHOS_PW_HDC ?? '/data/service/hnp/bin/hdc'
const BUNDLE = process.env.OHOS_PW_BUNDLE ?? 'com.huawei.hmos.browser'
const LAUNCH_URL = process.env.OHOS_PW_LAUNCH_URL ?? 'http://localhost:5173'

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function shellOnDevice(cmd) {
  return sh(`${HDC} shell "${cmd.replace(/"/g, '\\"')}"`)
}

function findBrowserPid() {
  const ps = shellOnDevice('ps -ef')
  for (const line of ps.split('\n')) {
    const parts = line.trim().split(/\s+/)
    const cmd = parts[parts.length - 1]
    if (cmd === BUNDLE) return parseInt(parts[1], 10)
  }
  return null
}

function launchBrowser() {
  shellOnDevice(`aa start -b ${BUNDLE} -m entry -a MainAbility -U ${LAUNCH_URL}`)
}

function findDevToolsSocket(pid) {
  const unix = shellOnDevice('cat /proc/net/unix')
  const name = `webview_devtools_remote_${pid}`
  return unix.includes(`@${name}`) ? name : null
}

function pickFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close((err) => (err ? rej(err) : res(port)))
    })
    srv.on('error', rej)
  })
}

function setupForward(port, socketName) {
  sh(`${HDC} fport tcp:${port} localabstract:${socketName}`)
}

function probeCdp(port) {
  return new Promise((res) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (r) => {
      let body = ''
      r.on('data', (c) => (body += c))
      r.on('end', () => res({ ok: r.statusCode === 200, body }))
    })
    req.on('error', (e) => res({ ok: false, err: e.code }))
    req.setTimeout(3000, () => {
      req.destroy()
      res({ ok: false, err: 'TIMEOUT' })
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const IP_PORT_RE = /^(\d{1,3}\.){3}\d{1,3}:\d+$/

function listTargets() {
  // hdc emits literal '[Empty]' when no devices are connected.
  return sh(`${HDC} list targets`)
}

function discoverDevices() {
  // `hdc discover` broadcasts on UDP:8710 and blocks for a few seconds. Lines
  // beginning with [Info] are noise; real entries are bare ip:port. Exit code
  // is always 0 — parse stdout, don't trust status.
  let out = ''
  try {
    out = execSync(`${HDC} discover`, {
      encoding: 'utf8',
      timeout: 6000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    out = e.stdout?.toString() ?? ''
  }
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => IP_PORT_RE.test(s))
}

function tconn(addr) {
  try {
    const out = execSync(`${HDC} tconn ${addr}`, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out.includes('Connect OK')
  } catch {
    return false
  }
}

function promptAddress() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question('[ohos-playwright] paste device ip:port (Enter to abort): ', (ans) => {
      rl.close()
      resolve(ans.trim())
    })
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

async function ensureDeviceConnected() {
  if (process.env.OHOS_PW_AUTO_CONNECT === '0') return

  if (listTargets() !== '[Empty]') return

  console.log('[ohos-playwright] no device connected, broadcasting (hdc discover)...')
  const found = discoverDevices()

  if (found.length > 0) {
    console.log(`[ohos-playwright] discovered: ${found.join(', ')}`)
    for (const addr of found) {
      console.log(`[ohos-playwright] hdc tconn ${addr}`)
      if (tconn(addr) && listTargets() !== '[Empty]') return
    }
    console.warn('[ohos-playwright] discovered devices but none connected successfully')
  }

  if (!process.stdin.isTTY) throw new Error(CONNECT_HELP)

  console.log(CONNECT_HELP)
  const addr = await promptAddress()
  if (!addr) throw new Error('[ohos-playwright] no device address provided; aborting.')
  if (!IP_PORT_RE.test(addr)) {
    throw new Error(`[ohos-playwright] "${addr}" is not a valid ip:port.`)
  }
  if (!tconn(addr)) throw new Error(`[ohos-playwright] hdc tconn ${addr} failed.`)
  if (listTargets() === '[Empty]') {
    throw new Error('[ohos-playwright] tconn reported OK but list targets is still empty.')
  }
  console.log(`[ohos-playwright] connected: ${addr}`)
}

export default async function globalSetup() {
  await ensureDeviceConnected()
  console.log(`[ohos-playwright] locating ${BUNDLE}...`)
  let pid = findBrowserPid()
  if (!pid) {
    console.log('[ohos-playwright] browser not running, launching...')
    launchBrowser()
    for (let i = 0; i < 20 && !pid; i++) {
      await sleep(500)
      pid = findBrowserPid()
    }
    if (!pid) throw new Error(`Failed to launch ${BUNDLE}`)
  }
  console.log(`[ohos-playwright] browser pid=${pid}`)

  let socket = findDevToolsSocket(pid)
  for (let i = 0; i < 10 && !socket; i++) {
    await sleep(500)
    socket = findDevToolsSocket(pid)
  }
  if (!socket) throw new Error(`DevTools socket not found for pid ${pid}`)
  console.log(`[ohos-playwright] socket=${socket}`)

  const port = await pickFreePort()
  setupForward(port, socket)
  console.log(`[ohos-playwright] hdc fport tcp:${port} -> localabstract:${socket}`)

  const probe = await probeCdp(port)
  if (!probe.ok) throw new Error(`CDP probe failed: ${probe.err || probe.body}`)
  const info = JSON.parse(probe.body)
  console.log(`[ohos-playwright] CDP ready: ${info.Browser}`)

  mkdirSync(dirname(INFO_PATH), { recursive: true })
  writeFileSync(
    INFO_PATH,
    JSON.stringify({ port, pid, socket, endpoint: `http://127.0.0.1:${port}` }, null, 2),
  )
  console.log(`[ohos-playwright] wrote ${INFO_PATH}`)
}
