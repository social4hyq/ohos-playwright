// Copyright (c) Microsoft Corporation.
// Licensed under the Apache License, Version 2.0.
//
// Adapted from playwright-official/tests/config/serverFixtures.ts.
// Changes:
// - Import TestServer from local testserver.ts (no coreBundle deps)
// - Drop SocksProxy / proxyServer (proxy not supported via connectOverCDP)
// - Server listens on 0.0.0.0; browser-facing URLs use 127.0.0.1 (same machine)
// - Ports offset from 8907 per workerIndex to avoid collisions

import type { Fixtures } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { TestServer } from './testserver.js';
import { setupReversePort, teardownReversePort } from 'ohos-playwright/setup';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type ServerWorkerOptions = {
  loopback?: string;
  __servers: ServerFixtures;
};

export type ServerFixtures = {
  server: TestServer;
  httpsServer: TestServer;
  /** Always 0 — SocksProxy not available via connectOverCDP. */
  socksPort: number;
  asset: (p: string) => string;
};

export const serverFixtures: Fixtures<ServerFixtures, ServerWorkerOptions> = {
  loopback: [undefined, { scope: 'worker', option: true }],

  __servers: [async ({ loopback }, run, workerInfo) => {
    const assetsPath = path.join(__dirname, '..', 'assets');
    const cachedPath = path.join(__dirname, '..', 'assets', 'cached');

    const port = 8907 + workerInfo.workerIndex * 4;
    const server = await TestServer.create(assetsPath, port, loopback);
    server.enableHTTPCache(cachedPath);

    const httpsPort = port + 1;
    const httpsServer = await TestServer.createHTTPS(assetsPath, httpsPort, loopback);
    httpsServer.enableHTTPCache(cachedPath);

    // Reverse-forward host TestServer ports to the device so ArkWeb can reach
    // http://127.0.0.1:<port> and https://127.0.0.1:<httpsPort> from on-device.
    // Only needed when running against a real OHOS device (OHOS_PW_HOST is set
    // by ohos-playwright's register.mts). Fails silently in non-device environments.
    const isOhos = !!process.env.OHOS_PW_HOST;
    if (isOhos) {
      setupReversePort(port);
      setupReversePort(httpsPort);
    }

    await run({
      asset: (p: string) => path.join(__dirname, '..', 'assets', ...p.split('/')),
      server,
      httpsServer,
      socksPort: 0,
    });

    if (isOhos) {
      teardownReversePort(port);
      teardownReversePort(httpsPort);
    }
    await Promise.all([server.stop(), httpsServer.stop()]);
  }, { scope: 'worker' }],

  server: async ({ __servers }, run) => {
    __servers.server.reset();
    await run(__servers.server);
  },

  httpsServer: async ({ __servers }, run) => {
    __servers.httpsServer.reset();
    await run(__servers.httpsServer);
  },

  socksPort: async ({ __servers }, run) => {
    await run(__servers.socksPort);
  },

  asset: async ({ __servers }, run) => {
    await run(__servers.asset);
  },
};
