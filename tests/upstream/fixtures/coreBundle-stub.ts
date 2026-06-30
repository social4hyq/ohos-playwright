// Re-export devices from playwright-core (CJS compatible via require, runs after
// register.mts patches process.platform = 'linux').
// Lazily evaluated so the HarmonyOS platform guard doesn't trigger at import time.
let _devices: Record<string, any> | undefined;
export function getDevices(): Record<string, any> {
  if (!_devices) {
    try {
      _devices = require('playwright-core').devices ?? {};
    } catch { _devices = {}; }
  }
  return _devices!;
}
// Named export for: import { devices } from '...'
export const devices: Record<string, any> = new Proxy({} as any, {
  get(_, key) { return getDevices()[key as string]; },
  has(_, key) { return key in getDevices(); },
  ownKeys() { return Object.keys(getDevices()); },
  getOwnPropertyDescriptor(_, key) {
    const v = getDevices()[key as string];
    return v !== undefined ? { value: v, writable: false, enumerable: true, configurable: true } : undefined;
  },
});

// Stub for playwright-core internals used by some upstream specs.
// These symbols are playwright-core-internal and NOT available via connectOverCDP.
// Tests that call these at runtime will throw — add test.fixme() in the fixme pass.

export const utils = {
  hostPlatform: process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ?? process.platform ?? 'linux',
  ZipFile: class { entries() { return []; } read() { return Buffer.alloc(0); } close() {} },
  waitForEvent: () => Promise.resolve({}),
  ManualPromise: class {
    promise = Promise.resolve();
    resolve() {}
    reject() {}
  },
};

export const iso = {
  parseClientSideCallMetadata: () => new Map(),
  SnapshotStorage: class {},
  TraceModel: class {},
  TraceLoader: class { static load() { return Promise.resolve({}); } },
};

export const server = {
  nullProgress: { sinceLastCallMs: () => 0, isAborted: () => false, throwIfAborted() {} } as any,
  Frame: class {} as any,
};

export const tools = {} as any;

export async function setupSocksForwardingServer(_opts?: any) {
  throw new Error('setupSocksForwardingServer not available via connectOverCDP — skip this test');
}

export function getPlaywrightVersion() { return '1.60.0'; }
export function getUserAgent() { return `Playwright/1.60.0`; }
export function parseHar(_path: string) { return new Map<string, Buffer>(); }

// Simplified PNG comparator: returns null (no diff) if buffers are identical,
// otherwise returns a non-null diff object. Tests requiring pixel-level diffing
// beyond byte equality will get fixme'd during the fixme pass.
type ComparatorResult = { diff?: Buffer; errorMessage: string } | null;
type ImageComparatorOptions = { threshold?: number; maxDiffPixels?: number; maxDiffPixelRatio?: number };
export function comparePNGs(actual: Buffer, expected: Buffer, _options: ImageComparatorOptions = {}): ComparatorResult {
  if (actual.equals(expected)) return null;
  return { errorMessage: 'Buffers differ (stub comparator — install jimp for pixel diff)' };
}

export const extractZip = async (_file: string, _dest: string) => {
  throw new Error('extractZip not available in upstream fixture stub');
};

export const artifactsFolderName = (workerHash: string) => `pw-${workerHash}`;

// Trace/HAR type stubs (type-only in specs)
export type Log = any;
export type ActionTraceEvent = any;
