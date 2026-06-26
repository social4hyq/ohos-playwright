// 精细化：locale/timezone/reducedMotion/video/touch 复测
import { test, expect } from '@playwright/test'

test('locale 精细化：原始值 vs 设置后', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const before = await page.evaluate(() => navigator.language)
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setLocaleOverride' as any, { locale: 'ja-JP' })
    await page.waitForTimeout(200)
    const after = await page.evaluate(() => navigator.language)
    console.log(`[REFINE locale] RESULT before=${before} after=${after} changed=${before !== after}`)
  } catch (e: any) {
    console.log(`[REFINE locale] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    await session.detach()
  }
})

test('timezone 精细化：原始值 vs 设置后', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const before = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
    await page.waitForTimeout(200)
    const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    console.log(`[REFINE timezone] RESULT before=${before} after=${after} changed=${before !== after}`)
  } catch (e: any) {
    console.log(`[REFINE timezone] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    await session.detach()
  }
})

test('reducedMotion 精细化：reduce vs no-preference 对照', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const noPref = await page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduce = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  console.log(`[REFINE reducedMotion] RESULT no-preference=${noPref} reduce=${reduce}`)
})

test('video 精细化：screencast 换监听姿势', async ({ page }) => {
  await page.goto('data:text/html,<h1 style="font-size:80px;color:red">VIDEO</h1>')
  const session = await page.context().newCDPSession(page)
  let frameData = ''
  session.on('Page.screencastFrame' as any, (payload: any) => {
    frameData = payload?.data?.slice(0, 20) ?? '(empty)'
  })
  try {
    await session.send('Page.startScreencast' as any, {
      format: 'jpeg', quality: 80, maxWidth: 400, maxHeight: 300,
    })
    await page.waitForTimeout(1500)
    await session.send('Page.stopScreencast' as any)
    console.log(`[REFINE video] RESULT frame-preview=${frameData ? 'got ' + frameData.length + ' chars' : 'none'}`)
  } catch (e: any) {
    console.log(`[REFINE video] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    await session.detach()
  }
})

test('touch 精细化：CDP dispatchTouchEvent 带可见监听', async ({ page }) => {
  await page.goto(`data:text/html,
    <div id=t style="width:200px;height:200px;background:cyan">tap here</div>
    <pre id=log>idle</pre>
    <script>
      document.getElementById('t').addEventListener('touchstart', e => {
        document.getElementById('log').textContent = 'touchstart touches=' + e.touches.length;
      });
      document.getElementById('t').addEventListener('touchend', () => {
        document.getElementById('log').textContent += ' | touchend';
      });
    </script>`)
  const session = await page.context().newCDPSession(page)
  try {
    // 先 attach touch listener 到具体坐标
    const r = await session.send('DOM.getDocument' as any)
    console.log(`[REFINE touch] doc-root=${r.root?.nodeId ? 'ok' : 'fail'}`)
    await session.send('Input.dispatchTouchEvent' as any, {
      type: 'touchStart',
      touchPoints: [{ x: 100, y: 100, id: 0, state: 'pressed' }],
      modifiers: 0,
      timeStamp: 0,
    })
    await page.waitForTimeout(100)
    await session.send('Input.dispatchTouchEvent' as any, {
      type: 'touchEnd',
      touchPoints: [{ x: 100, y: 100, id: 0, state: 'released' }],
      modifiers: 0,
      timeStamp: 0,
    })
    await page.waitForTimeout(200)
    const log = await page.locator('#log').textContent()
    console.log(`[REFINE touch] RESULT log=${log}`)
  } catch (e: any) {
    console.log(`[REFINE touch] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    await session.detach()
  }
})
