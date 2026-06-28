// src/teardown.mts
// 薄 shim — 逻辑已移入 src/ohos/connection.mts
import { getDefaultConnection } from './ohos/connection.mts'

export default async function globalTeardown(): Promise<void> {
  await getDefaultConnection().teardown()
}
