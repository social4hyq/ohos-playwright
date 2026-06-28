# Popup 真 Page 代理实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 fixture.mts 的 stub popup 机制替换为基于 `Target.createTarget` 的真 Page 创建，让 P1/P2 用例（window.open 后获得支持 evaluate/setContent 的真 Page）通过。

**Architecture:** window.open 触发时，在默认 context 的 CDP session 上调用 `Target.createTarget({url:'about:blank'})` 创建新 tab，等 Playwright（PW_CHROMIUM_ATTACH_TO_OTHER=1 模式下）识别为 page，导航到 popup URL，emit 这个真 Page 对象。三层 fallback：createTarget 失败 → 找闲置 about:blank tab 代理 → 退回 stub。

**Tech Stack:** TypeScript, Playwright, CDP（Target.createTarget）, ohos-playwright fixture

## Global Constraints

- 必须保留 `PW_CHROMIUM_ATTACH_TO_OTHER=1` 前置约束（README 已声明 ctx.newPage() 必需）
- 不修改 setup.mts（不主动开额外 pool tab）
- 不 patch playwright-core 内部
- 保留现有 stub 作为最终 fallback（不破坏其他依赖 stub 行为的探针）
- 集成验证用现有 `probes/capability-matrix.spec.ts` 中 P1/P2，不新增测试 spec
- commit 风格沿用项目历史（英文，`<type>: <subject>` 格式）

---

## File Structure

| 文件 | 角色 | 改动 |
|---|---|---|
| `src/fixture.mts` | popup 拦截 + 代理实现 | 新增 createPopupPage helper，改 popupPoller |
| `probes/capability-matrix.spec.ts` | P1/P2 集成测试 | 已存在，作为 TDD 验证 |
| `README.md` | popup 能力说明 | 更新 popup 行 |

---

## Task 1：实现 createPopupPage + 替换 stub（TDD via P1/P2 集成）

**Files:**
- Modify: `src/fixture.mts:163-181`（popupPoller 中 stub 创建逻辑）
- Modify: `src/fixture.mts`（在 installPageWrappers 之前新增 createPopupPage export）

**Interfaces:**
- Consumes: `BrowserContext`, `Page`（已有 import）, `PW_CHROMIUM_ATTACH_TO_OTHER=1` env
- Produces: `createPopupPage(context, seedPage, popupUrl) => Promise<Page | null>` exportable helper

- [ ] **Step 1: 验证 P1/P2 当前 fail（TDD RED）**

Run:
```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test --config=probes/playwright.config.ts probes/capability-matrix.spec.ts -g "P1|P2" 2>&1 | grep -E '\[P[12]\]|✘|✓' | head -10
```
Expected:
- `[P1] RESULT=fail ... evalErr="newPage.evaluate is not a function"`
- `[P2] RESULT=fail ... apiErr="newPage.setContent is not a function"`
- 测试用例通过 console.log RESULT 输出 fail（Playwright 标 ✓ 因为用例本身只 console.log 没 expect 断言）

- [ ] **Step 2: 新增 createPopupPage helper**

在 `src/fixture.mts` 中 `installPageWrappers` 函数定义之前（约第 35 行附近，`PageCleanup` export 之后），新增：

```typescript
// Create a real Page in the default context via Target.createTarget.
// Returns the new page (already navigated to popupUrl) on success, or null
// to let the caller fall back to idle-tab proxy or stub.
//
// Precondition: PW_CHROMIUM_ATTACH_TO_OTHER=1 must be set, otherwise the new
// target created by ArkWeb will be type:'other' and Playwright won't pick
// it up into ctx.pages().
export async function createPopupPage(
  context: BrowserContext,
  seedPage: Page,
  popupUrl: string,
): Promise<Page | null> {
  let session: import('@playwright/test').CDPSession | null = null
  try {
    session = await context.newCDPSession(seedPage)
    const r = await Promise.race([
      (session as unknown as { send: (cmd: string, args?: unknown) => Promise<unknown> })
        .send('Target.createTarget', { url: 'about:blank' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('createTarget timeout')), 3000)),
    ]) as { targetId?: string }
    if (!r.targetId) return null

    // Poll ctx.pages() until Playwright picks up the new target (max 2s).
    const pagesBefore = context.pages().length
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      if (context.pages().length > pagesBefore) break
      await new Promise((r) => setTimeout(r, 50))
    }
    const allPages = context.pages()
    if (allPages.length <= pagesBefore) return null

    // Pick the newly-added page (any page not equal to seedPage, preferring
    // about:blank which is the createTarget's initial URL).
    const newPage =
      allPages.find((p) => p !== seedPage && p.url() === 'about:blank') ??
      allPages.find((p) => p !== seedPage)
    if (!newPage) return null

    // Navigate to the popup URL (skip for about:blank which is already loaded).
    if (popupUrl && popupUrl !== 'about:blank') {
      await newPage.goto(popupUrl, { timeout: 5000 }).catch(() => {})
    }
    return newPage
  } catch {
    return null
  } finally {
    if (session) await session.detach().catch(() => {})
  }
}
```

- [ ] **Step 3: 替换 popupPoller 中的 stub 创建为三层 fallback**

定位 `src/fixture.mts` 中 popupPoller 的 `for (const { url } of pending ?? [])` 循环体（约第 170 行附近），把整个 for 循环体（当前是直接 emit stub）替换为：

```typescript
      for (const { url } of pending ?? []) {
        // 1) Target.createTarget（首选）
        let emitted: Page | null = null
        try {
          emitted = await createPopupPage(context, page, url || 'about:blank')
        } catch {}
        // 2) Fallback A：默认 context 闲置 about:blank tab
        if (!emitted) {
          const idle = context
            .pages()
            .find((p) => p !== page && p.url() === 'about:blank')
          if (idle) {
            try {
              if (url && url !== 'about:blank') {
                await idle.goto(url, { timeout: 5000 })
              }
              emitted = idle
            } catch {}
          }
        }
        // 3) Fallback B：退回原 stub（保持兼容）
        if (!emitted) {
          const stub = {
            waitForLoadState: async () => {},
            url: () => url,
            close: async () => {},
          }
          ctxEmit('page', stub as unknown as Page)
        } else {
          ctxEmit('page', emitted)
        }
      }
```

- [ ] **Step 4: 运行 typecheck**

Run: `cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright && npm run typecheck`
Expected: 无错误

- [ ] **Step 5: 跑 P1/P2 集成测试（TDD GREEN）**

Run:
```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test --config=probes/playwright.config.ts probes/capability-matrix.spec.ts -g "P1|P2" 2>&1 | grep -E '\[P[12]\]|✘|✓' | head -10
```
Expected:
- `[P1] RESULT=pass title="" evalErr=""`
- `[P2] RESULT=pass text="Hello from new tab" apiErr=""`

- [ ] **Step 6: 跑 build 确认打包成功**

Run: `npm run build`
Expected: tsc + fix-extensions 成功，dist/ 更新

- [ ] **Step 7: Commit**

```bash
git add src/fixture.mts
git commit -m "feat: emit real Page on window.open via Target.createTarget"
```

---

## Task 2：跑全 capability-matrix + popup 探针回归 + 更新 README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 跑完整 capability-matrix**

Run:
```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test --config=probes/playwright.config.ts probes/capability-matrix.spec.ts 2>&1 | tee logs/capability-matrix-postfix-$(date +%Y%m%d-%H%M%S).log | tail -25
```
Expected: 之前通过的 9 个用例继续通过（T1/T2/T3/S2/L1/C1/C2 + 新增 P1/P2），S1 仍 fail（ArkWeb 内核限制，本计划不修），S3 状态保持

- [ ] **Step 2: 跑 popup 相关其他探针确认兼容**

Run:
```bash
PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test --config=probes/playwright.config.ts \
  probes/popup.spec.ts probes/popup-bug.spec.ts probes/popup-repro.spec.ts 2>&1 | tail -30
```
Expected: 探针继续运行（可能用例内容变化，因为 popup 现在返回真 page url 而非 stub url，但不应有新增 hang/crash）

- [ ] **Step 3: 更新 README popup 行**

定位 README：
Run: `grep -n "Popup" README.md`
Expected: 命中第 59 行附近

把原行：
```
| Popup | `context.waitForEvent('page')` + `window.open()` — stub Page with `url()`, `waitForLoadState()`, `close()` |
```

替换为：
```
| Popup | `context.waitForEvent('page')` + `window.open()` — real Page with full API. Requires `PW_CHROMIUM_ATTACH_TO_OTHER=1`. Falls back to idle-tab proxy or minimal stub when Target.createTarget is unavailable. |
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update Popup row to reflect real Page support"
```

---

## Self-Review

**Spec coverage:**
- createPopupPage 实现 → Task 1 Step 2 ✅
- stub 替换为三层 fallback → Task 1 Step 3 ✅
- P1/P2 集成验证通过 → Task 1 Step 5 ✅
- 全 capability-matrix 回归 → Task 2 Step 1 ✅
- popup 探针兼容性 → Task 2 Step 2 ✅
- README 更新 → Task 2 Step 3 ✅
- S1/S3 不修 → Global Constraints 已声明 ✅

**Placeholder scan:** 无 TODO/TBD；每步都有具体代码或命令 ✅

**Type consistency:**
- `createPopupPage(context, seedPage, popupUrl)` 签名在 Step 2 实现中明确 ✅
- `Page | null` 返回类型一致 ✅
- `ctxEmit` 名字沿用现有代码 ✅
