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
  const tcpArg = `tcp:${info.port}`
  const sockArg = `localabstract:${info.socket}`
  try {
    // hdc fport rm requires separate arguments — a single combined string is
    // silently ignored.
    execFileSync(HDC, ['fport', 'rm', tcpArg, sockArg], { stdio: ['ignore', 'pipe', 'pipe'] })
    console.log(`[ohos-playwright] removed fport ${tcpArg} ${sockArg}`)
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
