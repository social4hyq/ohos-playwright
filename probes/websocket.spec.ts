// 探针：WebSocket 拦截（page.routeWebSocket / CDP Network.webSocket* 事件）
// 使用 Node 原生 http + 手动 WebSocket 握手，无需 ws 包
import { test } from '@playwright/test'
import http from 'node:http'
import { serverHost } from './helpers.js'
import crypto from 'node:crypto'
import net from 'node:net'

function startWsServer(): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer()
    server.on('upgrade', (req, socket: net.Socket, head) => {
      const key = req.headers['sec-websocket-key'] as string
      const accept = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      )
      socket.on('data', (buf: Buffer) => {
        // 解析 WebSocket frame（fin+opcode byte, mask+len byte, 4-byte mask, payload）
        if (buf.length < 6) return
        const payloadLen = buf[1] & 0x7f
        const mask = buf.slice(2, 6)
        const payload = buf.slice(6, 6 + payloadLen)
        const decoded = Buffer.from(payload.map((b: number, i: number) => b ^ mask[i]))
        const msg = decoded.toString()
        // 送回 echo frame（无 mask，opcode=1=text）
        const reply = Buffer.from(`echo:${msg}`)
        const frame = Buffer.alloc(2 + reply.length)
        frame[0] = 0x81
        frame[1] = reply.length
        reply.copy(frame, 2)
        socket.write(frame)
      })
    })
    server.listen(0, '0.0.0.0', () => {
      resolve({ port: (server.address() as any).port, close: () => server.close() })
    })
  })
}

test('websocket: 真实 WS 连接（基线，无拦截）', async ({ page }) => {
  const srv = await startWsServer()
  try {
    await page.goto('data:text/html,<span id=o></span>')
    const result = await page.evaluate(async ([port, host]) => {
      return new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://${host}:${port}`)
        ws.onopen = () => ws.send('hello')
        ws.onmessage = e => { ws.close(); resolve(String(e.data)) }
        ws.onerror = () => reject('ws-error')
        setTimeout(() => reject('TIMEOUT'), 4000)
      })
    }, [srv.port, serverHost] as [number, string])
    console.log(`[PROBE websocket-baseline] RESULT result=${result} (echo:hello=ok)`)
  } catch (e: any) {
    console.log(`[PROBE websocket-baseline] RESULT=error err=${String(e).split('\n')[0]}`)
  } finally {
    srv.close()
  }
})

test('websocket: page.routeWebSocket 拦截（Playwright >= 1.48）', async ({ page }) => {
  const srv = await startWsServer()
  try {
    if (typeof (page as any).routeWebSocket !== 'function') {
      console.log(`[PROBE websocket-route] RESULT=skip (routeWebSocket API not available in this Playwright version)`)
      return
    }
    await (page as any).routeWebSocket(new RegExp(`ws://${serverHost}`), (ws: any) => {
      ws.onMessage((msg: string) => ws.send(`intercepted:${msg}`))
    })
    await page.goto('data:text/html,<span id=o></span>')
    const result = await page.evaluate(async ([port, host]) => {
      return new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://${host}:${port}`)
        ws.onopen = () => ws.send('hello')
        ws.onmessage = e => { ws.close(); resolve(String(e.data)) }
        ws.onerror = () => reject('ws-error')
        setTimeout(() => reject('TIMEOUT'), 4000)
      })
    }, [srv.port, serverHost] as [number, string])
    console.log(`[PROBE websocket-route] RESULT result=${result} (intercepted:hello=ok)`)
  } catch (e: any) {
    console.log(`[PROBE websocket-route] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})

test('websocket: CDP Network.webSocketCreated 事件', async ({ page }) => {
  const srv = await startWsServer()
  try {
    const session = await page.context().newCDPSession(page)
    const wsEvents: string[] = []
    session.on('Network.webSocketCreated' as any, (ev: any) => wsEvents.push(`created:${ev.url}`))
    session.on('Network.webSocketClosed' as any, () => wsEvents.push('closed'))
    await (session as any).send('Network.enable')
    await page.goto('data:text/html,<span id=o></span>')
    await page.evaluate(async ([port, host]) => {
      return new Promise<void>(resolve => {
        const ws = new WebSocket(`ws://${host}:${port}`)
        ws.onopen = () => ws.send('ping')
        ws.onmessage = () => { ws.close(); resolve() }
        setTimeout(resolve, 3000)
      })
    }, [srv.port, serverHost] as [number, string])
    await page.waitForTimeout(200)
    await session.detach()
    console.log(`[PROBE websocket-cdp-events] RESULT events=${JSON.stringify(wsEvents)}`)
  } catch (e: any) {
    console.log(`[PROBE websocket-cdp-events] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})
