import { execFileSync } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { INFO_PATH, type CdpInfo } from './info-path.mts'

const HDC: string = process.env.OHOS_PW_HDC ?? '/data/service/hnp/bin/hdc'

export default async function globalTeardown(): Promise<void> {
  let info: CdpInfo
  try {
    info = JSON.parse(readFileSync(INFO_PATH, 'utf8'))
  } catch {
    return
  }
  const ruler = `tcp:${info.port} localabstract:${info.socket}`
  try {
    execFileSync(HDC, ['fport', 'rm', ruler], { stdio: ['ignore', 'pipe', 'pipe'] })
    console.log(`[ohos-playwright] removed fport ${ruler}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message?.split('\n')[0] : String(e)
    console.warn(`[ohos-playwright] fport rm failed (non-fatal): ${msg}`)
  }
  try {
    unlinkSync(INFO_PATH)
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') {
      console.warn(`[ohos-playwright] Failed to remove ${INFO_PATH}: ${err.message}`)
    }
  }
}
