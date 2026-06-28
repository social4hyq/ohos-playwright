// src/ohos/namespace.mts
// ohos namespace — 镜像 playwright.android
import { OhosDevice } from './device.mts'
import type { OhosConnectOptions } from './connection.mts'
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
