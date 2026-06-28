// Utility functions adapted from playwright-official/tests/config/utils.ts.
// Only the pure-JS subset is included — functions depending on coreBundle
// (TraceLoader, ZipFile, etc.) are omitted since tracing tests are SKIPped.

import type { Frame, Locator, Page } from 'playwright-core';

export type BoundingBox = Awaited<ReturnType<Locator['boundingBox']>>;

export async function attachFrame(page: Page, frameId: string, url: string): Promise<Frame> {
  const handle = await page.evaluateHandle(async ({ frameId, url }) => {
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.id = frameId;
    document.body.appendChild(frame);
    await new Promise(x => (frame.onload = x));
    return frame;
  }, { frameId, url });
  return handle.asElement().contentFrame() as Promise<Frame>;
}

export async function detachFrame(page: Page, frameId: string) {
  await page.evaluate(frameId => {
    document.getElementById(frameId)!.remove();
  }, frameId);
}

export async function verifyViewport(page: Page, width: number, height: number) {
  const { expect } = await import('@playwright/test');
  expect(page.viewportSize()!.width).toBe(width);
  expect(page.viewportSize()!.height).toBe(height);
  expect(await page.evaluate('window.innerWidth')).toBe(width);
  expect(await page.evaluate('window.innerHeight')).toBe(height);
}

export function expectedSSLError(browserName: string, _platform: string, _channel: string | undefined): RegExp {
  if (browserName === 'chromium') return /net::(ERR_CERT_AUTHORITY_INVALID|ERR_CERT_INVALID)/;
  return /SSL_ERROR_UNKNOWN/;
}

export function isBidiChannel(channel: string | undefined): boolean {
  return channel?.startsWith('bidi-chrom') || channel?.startsWith('moz-firefox') || false;
}

export function chromiumVersionLessThan(a: string, b: string) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    if (left[i] > right[i]) return false;
    if (left[i] < right[i]) return true;
  }
  return false;
}

export function suppressCertificateWarning() {
  const orig = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    if (typeof warning === 'string' && warning.includes('NODE_TLS_REJECT_UNAUTHORIZED')) {
      process.emitWarning = orig;
      return;
    }
    return orig.call(process, warning, ...args);
  };
}

// Double-requestAnimationFrame flush. ArkWeb may not expose window.builtins,
// so fall back to a plain rAF or a 50ms sleep.
export async function rafraf(target: Page | Frame, count = 1) {
  for (let i = 0; i < count; i++) {
    await target.evaluate(async () => {
      await new Promise<void>(f => {
        const raf = (window as any).builtins?.requestAnimationFrame ?? requestAnimationFrame;
        raf(() => raf(f));
      });
    });
  }
}

export function roundBox(box: BoundingBox): BoundingBox {
  return {
    x: Math.round(box!.x),
    y: Math.round(box!.y),
    width: Math.round(box!.width),
    height: Math.round(box!.height),
  };
}

export function unshift(snapshot: string): string {
  const lines = snapshot.split('\n');
  let prefix = 100;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^(\s*)/);
    if (m && m[1].length < prefix) prefix = m[1].length;
  }
  return lines.filter(t => t.trim()).map(l => l.substring(prefix)).join('\n');
}

const ansiRegex = new RegExp(
  '[\u001B\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
  'g'
);
export function stripAnsi(str: string): string {
  return str.replace(ansiRegex, '');
}

export function parseHar(_file: string): Promise<Map<string, Buffer>> {
  throw new Error('parseHar not available in upstream fixtures — tracing tests should be marked fixme');
}

export async function parseTraceRaw(_file: string): Promise<{ events: any[]; resources: Map<string, Buffer>; actions: string[]; actionObjects: any[]; stacks: Map<string, any[]> }> {
  throw new Error('parseTraceRaw not available in upstream fixtures — tracing tests should be marked fixme');
}

export function parseHarFile(_file: string): Map<string, Buffer> {
  throw new Error('parseHarFile not available in upstream fixtures');
}
