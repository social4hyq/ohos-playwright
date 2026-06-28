// Copyright (c) Microsoft Corporation.
// Licensed under the Apache License, Version 2.0.
// Copied from playwright-official/tests/config/platformFixtures.ts (unmodified).

import { test } from '@playwright/test';
import os from 'os';

export type PlatformWorkerFixtures = {
  platform: 'win32' | 'darwin' | 'linux';
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  macVersion: number;
};

function platform(): 'win32' | 'darwin' | 'linux' {
  if (process.env.PLAYWRIGHT_SERVICE_OS === 'linux') return 'linux';
  if (process.env.PLAYWRIGHT_SERVICE_OS === 'windows') return 'win32';
  if (process.env.PLAYWRIGHT_SERVICE_OS === 'macos') return 'darwin';
  return process.platform as 'win32' | 'darwin' | 'linux';
}

function macVersion() {
  if (process.platform !== 'darwin') return 0;
  const darwinMajor = +os.release().split('.')[0];
  if (darwinMajor >= 25) return darwinMajor + 1;
  return darwinMajor - 9;
}

export const platformTest = test.extend<{}, PlatformWorkerFixtures>({
  platform: [platform(), { scope: 'worker' }],
  isWindows: [platform() === 'win32', { scope: 'worker' }],
  isMac: [platform() === 'darwin', { scope: 'worker' }],
  isLinux: [platform() === 'linux', { scope: 'worker' }],
  macVersion: [macVersion(), { scope: 'worker' }],
});
