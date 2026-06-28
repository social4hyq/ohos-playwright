/**
 * Copyright 2017 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Adapted from playwright-official/tests/config/testserver/index.ts.
// Replaced `utils.createHttpServer/createHttpsServer` (from playwright-core coreBundle)
// with native Node.js http/https + inline decorateServer, so this file has zero
// dependency on playwright-official's internal build artifacts.

import fs from 'fs';
import http from 'http';
import https from 'https';
import type net from 'net';
import mime from 'mime';
import path from 'path';
import util from 'util';
import type stream from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import zlib, { gzip } from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const gzipAsync = util.promisify(gzip.bind(zlib));

const fulfillSymbol = Symbol('fulfil callback');
const rejectSymbol = Symbol('reject callback');

type UpgradeActions = {
  doUpgrade: () => void;
  socket: stream.Duplex;
};

type IncomingMessageWithBody = http.IncomingMessage & { postBody: Promise<Buffer> };

// Mirrors playwright-core's decorateServer: tracks open sockets so server.close()
// destroys them immediately instead of waiting for idle connections to drain.
function decorateServer(server: http.Server | https.Server) {
  const sockets = new Set<net.Socket>();
  server.on('connection', (socket: net.Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const origClose = server.close.bind(server);
  (server as any).close = (cb?: (err?: Error) => void) => {
    for (const s of sockets) s.destroy();
    sockets.clear();
    return origClose(cb);
  };
}

export class TestServer {
  private _server: http.Server;
  private _wsServer: WebSocketServer;
  private _dirPath: string;
  readonly debugServer: (...args: any[]) => void;
  private _startTime: Date;
  private _cachedPathPrefix: string | null;
  private _routes = new Map<string, (req: IncomingMessageWithBody, res: http.ServerResponse) => any>();
  private _auths = new Map<string, { username: string; password: string }>();
  private _csp = new Map<string, string>();
  private _extraHeaders = new Map<string, object>();
  private _gzipRoutes = new Set<string>();
  private _requestSubscribers = new Map<string, Promise<any>>();
  private _upgradeCallback: ((actions: UpgradeActions) => void) | undefined;
  readonly PORT: number;
  readonly PREFIX: string;
  readonly CROSS_PROCESS_PREFIX: string;
  readonly EMPTY_PAGE: string;
  readonly HOST: string;
  readonly HOSTNAME: string;
  readonly HELLO_WORLD: string;

  static async create(dirPath: string, port: number, loopback?: string): Promise<TestServer> {
    const server = new TestServer(dirPath, port, loopback);
    await server.waitUntilReady();
    return server;
  }

  static async certOptions() {
    return {
      key: await fs.promises.readFile(path.join(__dirname, 'key.pem')),
      cert: await fs.promises.readFile(path.join(__dirname, 'cert.pem')),
      passphrase: 'aaaa',
    };
  }

  static async createHTTPS(dirPath: string, port: number, loopback?: string): Promise<TestServer> {
    const server = new TestServer(dirPath, port, loopback, await TestServer.certOptions());
    await server.waitUntilReady();
    return server;
  }

  constructor(dirPath: string, port: number, loopback?: string, sslOptions?: object) {
    if (sslOptions) {
      this._server = https.createServer(sslOptions as https.ServerOptions, this._onRequest.bind(this));
    } else {
      this._server = http.createServer(this._onRequest.bind(this));
    }
    decorateServer(this._server);
    this._server.on('connection', (socket: net.Socket) => this._onSocket(socket));
    this._wsServer = new WebSocketServer({ noServer: true });
    this._server.on('upgrade', async (request, socket, head) => {
      const doUpgrade = () => {
        this._wsServer.handleUpgrade(request, socket as stream.Duplex, head, ws => {
          this._wsServer.emit('connection', ws, request);
        });
      };
      if (this._upgradeCallback) {
        this._upgradeCallback({ doUpgrade, socket: socket as stream.Duplex });
        return;
      }
      const pathname = new URL(request.url!, 'http://localhost').pathname;
      if (pathname === '/ws-401') {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\nUnauthorized body');
        socket.destroy();
        return;
      }
      if (pathname === '/ws-slow')
        await new Promise(f => setTimeout(f, 2000));
      if (!['/ws', '/ws-slow'].includes(pathname)) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      doUpgrade();
    });
    this._server.listen(port);
    this._dirPath = dirPath;
    this.debugServer = (...args: any[]) => {};

    this._startTime = new Date();
    this._cachedPathPrefix = null;

    const cross_origin = loopback ?? '127.0.0.1';
    const same_origin = loopback ?? 'localhost';
    const protocol = sslOptions ? 'https' : 'http';
    this.PORT = port;
    this.PREFIX = `${protocol}://${same_origin}:${port}`;
    this.CROSS_PROCESS_PREFIX = `${protocol}://${cross_origin}:${port}`;
    this.EMPTY_PAGE = `${protocol}://${same_origin}:${port}/empty.html`;
    this.HOST = new URL(this.EMPTY_PAGE).host;
    this.HOSTNAME = new URL(this.EMPTY_PAGE).hostname;
    this.HELLO_WORLD = `${this.PREFIX}/hello-world`;
  }

  async waitUntilReady() {
    await new Promise(x => this._server.once('listening', x));
  }

  _onSocket(socket: net.Socket) {
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (!['ECONNRESET', 'HPE_INVALID_EOF_STATE', 'HPE_INVALID_METHOD'].includes(error.code!))
        throw error;
    });
  }

  enableHTTPCache(pathPrefix: string) {
    this._cachedPathPrefix = pathPrefix;
  }

  setAuth(path: string, username: string, password: string) {
    this._auths.set(path, { username, password });
  }

  enableGzip(path: string) {
    this._gzipRoutes.add(path);
  }

  setCSP(path: string, csp: string) {
    this._csp.set(path, csp);
  }

  setExtraHeaders(path: string, object: Record<string, string>) {
    this._extraHeaders.set(path, object);
  }

  async stop() {
    this.reset();
    await new Promise(x => (this._server as any).close(x));
  }

  setContent(path: string, content: string, mimeType: string) {
    this.setRoute(path, (req, res) => {
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(mimeType === 'text/html' ? `<!DOCTYPE html>${content}` : content);
    });
  }

  setRoute(path: string, handler: (req: IncomingMessageWithBody, res: http.ServerResponse) => any) {
    this._routes.set(path, handler);
  }

  setRedirect(from: string, to: string) {
    this.setRoute(from, (req, res) => {
      const headers = this._extraHeaders.get(req.url!) || {};
      res.writeHead(302, { ...(headers as any), location: to });
      res.end();
    });
  }

  waitForRequest(path: string): Promise<IncomingMessageWithBody> {
    let promise = this._requestSubscribers.get(path);
    if (promise) return promise;
    let fulfill: (v: any) => void;
    let reject: () => void;
    promise = new Promise((f, r) => { fulfill = f; reject = r; });
    (promise as any)[fulfillSymbol] = fulfill!;
    const error = new Error(`Request ${path} was not received before the test finished.`);
    (promise as any)[rejectSymbol] = () => (reject as any)(error);
    this._requestSubscribers.set(path, promise);
    return promise;
  }

  reset() {
    this._routes.clear();
    this._auths.clear();
    this._csp.clear();
    this._extraHeaders.clear();
    this._gzipRoutes.clear();
    this._upgradeCallback = undefined;
    this._wsServer.removeAllListeners('connection');
    this._server.closeAllConnections?.();
    for (const subscriber of this._requestSubscribers.values())
      (subscriber as any)[rejectSymbol].call(null);
    this._requestSubscribers.clear();
  }

  _onRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET') response.end();
      else throw error;
    });
    (request as any).postBody = new Promise<Buffer>(resolve => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => resolve(Buffer.concat(chunks)));
    });
    const url = new URL(request.url!, 'http://localhost');
    const pathWithSearch = url.pathname + url.search;
    if (this._auths.has(pathWithSearch)) {
      const auth = this._auths.get(pathWithSearch)!;
      const credentials = Buffer.from(
        (request.headers.authorization || '').split(' ')[1] || '', 'base64'
      ).toString();
      if (credentials !== `${auth.username}:${auth.password}`) {
        response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Secure Area"' });
        response.end('HTTP Error 401 Unauthorized: Access is denied');
        return;
      }
    }
    if (this._requestSubscribers.has(pathWithSearch)) {
      (this._requestSubscribers.get(pathWithSearch) as any)[fulfillSymbol].call(null, request);
      this._requestSubscribers.delete(pathWithSearch);
    }
    const handler = this._routes.get(pathWithSearch);
    if (handler) handler.call(null, request as IncomingMessageWithBody, response);
    else this.serveFile(request, response);
  }

  serveFile(request: http.IncomingMessage, response: http.ServerResponse, filePath?: string): void {
    this._serveFile(request, response, filePath).catch(e => {});
  }

  private async _serveFile(request: http.IncomingMessage, response: http.ServerResponse, filePath?: string): Promise<void> {
    let pathName = new URL(request.url!, 'http://localhost').pathname;
    if (!filePath) {
      if (pathName === '/') pathName = '/index.html';
      filePath = path.join(this._dirPath, pathName.substring(1));
    }

    if (this._cachedPathPrefix !== null && filePath.startsWith(this._cachedPathPrefix)) {
      if (request.headers['if-modified-since']) {
        response.statusCode = 304;
        response.end();
        return;
      }
      response.setHeader('Cache-Control', 'public, max-age=31536000, no-cache');
      response.setHeader('Last-Modified', this._startTime.toISOString());
    } else {
      response.setHeader('Cache-Control', 'no-cache, no-store');
    }
    if (this._csp.has(pathName))
      response.setHeader('Content-Security-Policy', this._csp.get(pathName)!);
    if (this._extraHeaders.has(pathName)) {
      const headers = this._extraHeaders.get(pathName) as Record<string, string>;
      for (const key of Object.keys(headers)) response.setHeader(key, headers[key]);
    }

    const { err, data } = await fs.promises.readFile(filePath)
      .then(data => ({ data, err: undefined }))
      .catch(err => ({ data: undefined, err }));
    if (response.writableEnded) return;
    if (err) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain');
      response.end(request.method !== 'HEAD' ? `File not found: ${filePath}` : null);
      return;
    }
    const extension = filePath.substring(filePath.lastIndexOf('.') + 1);
    const mimeType = mime.getType(extension) ?? 'application/octet-stream';
    const isTextEncoding = /^text\/|^application\/(javascript|json)/.test(mimeType);
    const contentType = isTextEncoding ? `${mimeType}; charset=utf-8` : mimeType;
    response.setHeader('Content-Type', contentType);
    if (this._gzipRoutes.has(pathName)) {
      response.setHeader('Content-Encoding', 'gzip');
      const result = await gzipAsync(data!);
      if (!response.writableEnded) response.end(request.method !== 'HEAD' ? result : null);
    } else {
      response.end(request.method !== 'HEAD' ? data : null);
    }
  }

  onceWebSocketConnection(handler: (socket: WebSocket, request: http.IncomingMessage) => void) {
    this._wsServer.once('connection', handler);
  }

  waitForWebSocketConnectionRequest() {
    return new Promise<http.IncomingMessage>(fulfill => {
      this._wsServer.once('connection', (ws, req) => fulfill(req));
    });
  }

  waitForUpgrade() {
    return new Promise<UpgradeActions>(fulfill => { this._upgradeCallback = fulfill; });
  }

  waitForWebSocket() {
    return new Promise<WebSocket>(fulfill => {
      this._wsServer.once('connection', (ws) => fulfill(ws));
    });
  }

  sendOnWebSocketConnection(data: any) {
    this.onceWebSocketConnection(ws => ws.send(data));
  }
}
