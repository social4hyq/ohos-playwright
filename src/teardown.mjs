import { execSync } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { INFO_PATH } from './info-path.mjs'

const HDC = process.env.OHOS_PW_HDC ?? '/data/service/hnp/bin/hdc'

export default async function globalTeardown() {
  let info
  try {
    info = JSON.parse(readFileSync(INFO_PATH, 'utf8'))
  } catch {
    return
  }
  const ruler = `tcp:${info.port} localabstract:${info.socket}`
  try {
    execSync(`${HDC} fport rm "${ruler}"`, { stdio: ['ignore', 'pipe', 'pipe'] })
    console.log(`[ohos-playwright] removed fport ${ruler}`)
  } catch (e) {
    console.warn(`[ohos-playwright] fport rm failed (non-fatal): ${e.message?.split('\n')[0]}`)
  }
  try {
    unlinkSync(INFO_PATH)
  } catch {}
}
