import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

// Setup writes the CDP endpoint info here; fixture and teardown read from it.
// Override with OHOS_PW_INFO_PATH if you need a deterministic location.
export const INFO_PATH: string =
  process.env.OHOS_PW_INFO_PATH ?? resolve(tmpdir(), 'ohos-playwright-cdp.json')

export interface CdpInfo {
  port: number
  pid: number
  socket: string
  endpoint: string
}
