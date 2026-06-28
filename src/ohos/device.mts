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
      this._conn.hdcBinary,
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
