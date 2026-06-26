// 探针：geolocation + permissions
import { test, expect } from '@playwright/test'

test('geolocation: set + grant', async ({ context }) => {
  try {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 31.23, longitude: 121.47 })
    console.log(`[PROBE geolocation] RESULT=ok set-succeeded`)
  } catch (e: any) {
    console.log(`[PROBE geolocation] RESULT=error err=${e.message}`)
  }
})
