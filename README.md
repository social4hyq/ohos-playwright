# ohos-playwright

鸿蒙 PC 上跑 Playwright e2e。

```bash
pnpm add -D ohos-playwright @playwright/test
```

`playwright.config.ts` 包一层：

```ts
import { withOpenHarmony } from 'ohos-playwright/config'
export default defineConfig(withOpenHarmony({ ... }))
```

`package.json` 换一个命令：

```json
{ "scripts": { "test:e2e": "ohos-playwright test" } }
```

Windows / macOS / Linux 上跑的还是原生 Playwright。鸿蒙上自动接管系统浏览器。

---

Playwright 不认鸿蒙这个平台，直接跑会崩。ohos-playwright 不下载浏览器二进制，用 `hdc` 连上系统里已经跑着的浏览器，通过 Chrome DevTools Protocol 接管它。浏览器没跑就自动拉起来。spec 文件一行不用改。跑完清理 hdc 转发规则，浏览器不关。

非鸿蒙系统上 `withOpenHarmony` 什么都不做，config 原样返回。

---

## 局限

- 只能跑 Chromium。firefox 和 webkit 在鸿蒙上不可用。
- 只有一个 context 和一个 page，不支持 `newContext()` 和 `newPage()`。用例之间用 `localStorage.clear()` 加 `page.reload()` 隔离。
- 鸿蒙上 `process.platform` 的值是 `linux`。如果 spec 里需要判断平台，用 `process.env.OHOS_PW_HOST`。

---

## 环境变量

| 变量 | 默认值 |
|---|---|
| `OHOS_PW_BUNDLE` | `com.huawei.hmos.browser` |
| `OHOS_PW_LAUNCH_URL` | `http://localhost:5173` |
| `OHOS_PW_HDC` | `/data/service/hnp/bin/hdc` |
| `OHOS_PW_AUTO_CONNECT` | 自动（设 `0` 跳过） |

---

## 排错

**`Cannot find module 'ohos-playwright/config'`**

没装或者没跑 `pnpm install`。

**`defineConfig(...)` 没有类型提示**

`tsconfig.json` 里把 `moduleResolution` 改成 `bundler` 或 `nodenext`。

**`未发现设备`**

设备上开无线调试、和本机在同一个 Wi-Fi、本机防火墙放行 UDP 8710。CI 里需要提前手动 `hdc tconn <ip:port>`。

**`Failed to launch` 浏览器**

设备里没装这个浏览器，或者 bundle 名字不对。用下面命令看系统里装了哪些浏览器：

```
hdc shell "bm dump -a" | grep -iE "browser|webview|chrom|arkweb"
```

找到后设 `OHOS_PW_BUNDLE`，比如 `OHOS_PW_BUNDLE=com.quark.ohosbrowser`。

**`DevTools socket not found`**

浏览器没有暴露 CDP 调试端口，或者还没加载完。等几秒重试通常能过。持续失败说明这个浏览器不支持 CDP。

**`CDP probe failed`**

之前跑崩了，hdc 转发规则还残留着。`hdc fport ls` 看有哪些，`hdc fport rm tcp:<端口> localabstract:<socket>` 清掉。

**`page.goto('/foo')` 没有自动拼上 baseURL**

Playwright 标准行为是 `/foo` 自动变成 `http://localhost:5173/foo`。如果没生效，检查 `playwright.config.ts` 里 `use.baseURL` 有没有设置。

---

## 兼容性

| | 要求 |
|---|---|
| Node | ≥ 24 |
| Playwright | ≥ 1.59 |
| 已验证 | `com.huawei.hmos.browser`（Chromium 132） |

MIT
