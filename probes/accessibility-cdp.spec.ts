// 探针：Accessibility.getFullAXTree 裸 CDP（绕过 page.accessibility.snapshot 的单-context 限制）
import { test } from '@playwright/test'

test('a11y-cdp: Accessibility.getFullAXTree 基本调用', async ({ page }) => {
  await page.goto(`data:text/html,
    <button id=btn>Save</button>
    <input id=inp aria-label="Name" type=text>
    <h1>Title</h1>`)
  try {
    const session = await page.context().newCDPSession(page)
    const result: any = await (session as any).send('Accessibility.getFullAXTree')
    await session.detach()
    const nodes = result.nodes ?? []
    console.log(`[PROBE a11y-cdp] RESULT nodeCount=${nodes.length}`)
    const roles = nodes.map((n: any) => n.role?.value).filter(Boolean)
    const hasButton = roles.includes('button')
    const hasHeading = roles.includes('heading')
    console.log(`[PROBE a11y-cdp] RESULT hasButton=${hasButton} hasHeading=${hasHeading} roles(sample)=${roles.slice(0,8).join(',')}`)
  } catch (e: any) {
    console.log(`[PROBE a11y-cdp] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('a11y-cdp: 按 role 过滤节点', async ({ page }) => {
  await page.goto(`data:text/html,
    <nav><a href=#>Home</a><a href=#>About</a></nav>
    <main><p>Content</p></main>`)
  try {
    const session = await page.context().newCDPSession(page)
    const result: any = await (session as any).send('Accessibility.getFullAXTree')
    await session.detach()
    const nodes = result.nodes ?? []
    const links = nodes.filter((n: any) => n.role?.value === 'link')
    const names = links.map((n: any) => n.name?.value).filter(Boolean)
    console.log(`[PROBE a11y-cdp-filter] RESULT linkCount=${links.length} names=${JSON.stringify(names)}`)
  } catch (e: any) {
    console.log(`[PROBE a11y-cdp-filter] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('a11y-cdp: Accessibility.enable + getPartialAXTree', async ({ page }) => {
  await page.goto(`data:text/html,<button id=b>Click me</button>`)
  try {
    const session = await page.context().newCDPSession(page)
    await (session as any).send('Accessibility.enable')
    const nodeId: any = await page.evaluate(() => {
      // backendNodeId 通过 DOM.getDocument + DOM.querySelector 取，这里用简化路径
      return null
    })
    // getPartialAXTree 需 backendNodeId；若为 null 测整页
    const result: any = await (session as any).send('Accessibility.getPartialAXTree', {
      fetchRelatives: false,
    }).catch((e: any) => ({ error: e.message }))
    await session.detach()
    console.log(`[PROBE a11y-cdp-partial] RESULT=${JSON.stringify(result).slice(0, 120)}`)
  } catch (e: any) {
    console.log(`[PROBE a11y-cdp-partial] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
