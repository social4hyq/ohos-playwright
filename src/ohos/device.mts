// src/ohos/device.mts
import { chromium } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { OhosDeviceConnection, type OhosConnectOptions } from './connection.mts'
import { applyBrowserPatches } from './patches/browser-patch.mts'
import { detectCapabilities, type OhosCapabilities } from './capabilities.mts'
import { INFO_PATH, type CdpInfo } from '../info-path.mts'

export class OhosDevice {
  readonly serial: string
  private readonly _conn: OhosDeviceConnection
  private _browser: Browser | null = null
  private _caps: OhosCapabilities | null = null
  // Stable Proxy returned by browser(). Forwards every access to the current live
  // realBrowser stored in _browser, so reconnects after ArkWeb disconnect are
  // invisible to test code. realBrowser is tagged with __ohosProxy back-reference
  // so context-patch can rewrite ctx.browser() to return the same Proxy — without
  // this, expect(browser).toBe(context.browser()) fails (Proxy !== realBrowser).
  private _proxy: Browser | null = null

  constructor(opts: OhosConnectOptions & { serial?: string } = {}) {
    this.serial = opts.serial ?? 'default'
    this._conn = new OhosDeviceConnection(opts)
  }

  async browser(): Promise<Browser> {
    if (!this._proxy) this._proxy = this._buildProxy()
    await this._ensureBrowser()
    return this._proxy
  }

  private _buildProxy(): Browser {
    const self = this
    return new Proxy({} as Browser, {
      get(_t, prop) {
        const current = self._browser
        if (!current) {
          if (prop === 'isConnected') return () => false
          if (prop === 'contexts') return () => []
          if (prop === '__cdpDefaultContext') return null
          if (prop === '__ohosProxy') return self._proxy
          // Async fallback: trigger reconnect then forward the call.
          return (...args: unknown[]) => self._ensureBrowser().then(
            live => (live as unknown as Record<string | symbol, (...a: unknown[]) => unknown>)[prop]?.(...args),
          )
        }
        const val = (current as unknown as Record<string | symbol, unknown>)[prop]
        return typeof val === 'function' ? (val as Function).bind(current) : val
      },
    })
  }

  private async _ensureBrowser(): Promise<Browser> {
    // ArkWeb drops CDP unstably ~2s after context.close(). Returning a dead Browser
    // would propagate "Target page, context or browser has been closed" into every
    // subsequent test. isConnected() check + reconnect makes the proxy transparent.
    if (this._browser && this._browser.isConnected()) return this._browser
    this._browser = null
    this._caps = null

    process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
    let endpoint: string
    try {
      const info: CdpInfo = JSON.parse(readFileSync(INFO_PATH, 'utf8'))
      endpoint = (await this._conn.probeEndpoint(info.endpoint))
        ? info.endpoint
        : await this._conn.connect()
    } catch {
      endpoint = await this._conn.connect()
    }
    const raw = await chromium.connectOverCDP(endpoint)
    // Back-reference: context-patch reads (ctx.browser() as any).__ohosProxy to
    // override ctx.browser() returning the proxy. Must be set before patches run.
    ;(raw as unknown as { __ohosProxy: Browser | null }).__ohosProxy = this._proxy
    applyBrowserPatches(raw, this._conn)
    raw.once('disconnected', () => {
      if (this._browser === raw) {
        this._browser = null
        this._caps = null
      }
    })
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
