// src/setup.mts
// 薄 shim — 逻辑已移入 src/ohos/connection.mts
import { getDefaultConnection } from './ohos/connection.mts'

// Eagerly create (and validate) the singleton at module-load time,
// matching the old setup.mts behaviour where env-var validation ran on import.
getDefaultConnection()

export {
  retry,
  findBrowserPid,
  hasDeviceConnected,
  ensureDeviceConnected,
  setupReversePort,
  teardownReversePort,
  reconnect,
  tryLocalDevice,
  ensureHdcKey,
  countCdpPages,
} from './ohos/connection.mts'

export default async function globalSetup(): Promise<void> {
  await getDefaultConnection().connect()
}
