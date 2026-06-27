// When the browser is remote (OHOS_PW_CDP_URL set, e.g. Edge on Windows),
// browser-facing URLs must use the HarmonyOS host's LAN IP rather than
// 127.0.0.1, which would hit the Windows machine's own localhost instead.
// Servers must also listen on 0.0.0.0 (not 127.0.0.1) to be reachable.
export const serverHost = process.env.OHOS_PW_CDP_URL ? '172.16.100.1' : '127.0.0.1'
