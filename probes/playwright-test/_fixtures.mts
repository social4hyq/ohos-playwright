// Self-contained fixtures for porting upstream playwright-test specs.
//
// Replaces the upstream playwright-test-fixtures.ts (which depends on a CJS
// chain that does not import cleanly into ohos-playwright's ESM context).
// Provides the same `runInlineTest` API contract: write embedded test files
// to a temp dir, spawn ohos-playwright's dist/cli.mjs as a subprocess,
// capture output + JSON report, and return a RunResult.
//
// Reference (read-only): playwright-official/tests/playwright-test/playwright-test-fixtures.ts

import { test as base, expect } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import type { JSONReport, JSONReportSuite, JSONReportTestResult } from '@playwright/test/reporter';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export { expect };

export type Files = { [key: string]: string | Buffer };
export type Params = { [key: string]: string | number | boolean | string[] };

export type RunResult = {
  exitCode: number;
  output: string;
  stdout: string;
  stderr: string;
  outputLines: string[];
  rawOutput: string;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  interrupted: number;
  didNotRun: number;
  report?: JSONReport;
  results: JSONReportTestResult[];
};

type RunOptions = {
  cwd?: string;
  additionalArgs?: string[];
};

// ohos-playwright's own CLI. Resolved relative to this file: probes/playwright-test/ → ../../dist/cli.mjs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OHOS_CLI = path.resolve(__dirname, '../../dist/cli.mjs');

const DEFAULT_TSCONFIG = `{}`;

// Env vars to strip when invoking the subprocess (avoids leaking test runner
// state that would change child behavior). Mirrors upstream inheritAndCleanEnv.
function cleanEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: undefined,
    BUILD_URL: undefined,
    GITHUB_ACTIONS: undefined,
    GITHUB_REPOSITORY: undefined,
    GITHUB_RUN_ID: undefined,
    GITHUB_SHA: undefined,
    GITHUB_EVENT_PATH: undefined,
    PW_TEST_HTML_REPORT_OPEN: undefined,
    PLAYWRIGHT_HTML_OPEN: undefined,
    PW_TEST_DEBUG_REPORTERS: undefined,
    PW_TEST_REPORTER: undefined,
    PW_TEST_REPORTER_WS_ENDPOINT: undefined,
    PW_TEST_SOURCE_TRANSFORM: undefined,
    PW_TEST_SOURCE_TRANSFORM_SCOPE: undefined,
    PWTEST_BOT_NAME: undefined,
    PWTEST_SHARD_WEIGHTS: undefined,
    TEST_WORKER_INDEX: undefined,
    TEST_PARALLEL_INDEX: undefined,
    NODE_OPTIONS: undefined,
    ...env,
  };
}

const ANSI_RE = [
  /\x1B\[[0-9;]*[A-Za-z]/g,          // CSI sequences: ESC [ ... letter
  /\x1B\][^\x07]*\x07/g,             // OSC sequences: ESC ] ... BEL
  /\x1B[\u0020-\u002F]+[\x30-\x7E]/g // DCS/SOS/PM/APC: ESC intermediates F
];

export function stripAnsi(str: string): string {
  let result = str;
  for (const re of ANSI_RE)
    result = result.replace(re, '');
  return result;
}

export function countTimes(s: string, sub: string): number {
  let count = 0;
  let idx = s.indexOf(sub);
  while (idx >= 0) {
    count++;
    idx = s.indexOf(sub, idx + sub.length);
  }
  return count;
}

function parseOutputLines(output: string): string[] {
  return output.split('\n').map(line => line.trimEnd()).filter(line => line.length > 0);
}

export function parseTestRunnerOutput(output: string) {
  const summary = (re: RegExp) => {
    let result = 0;
    let match = re.exec(output);
    while (match) {
      result += (+match[1]);
      match = re.exec(output);
    }
    return result;
  };
  const passed = summary(/(\d+) passed/g);
  const failed = summary(/(\d+) failed/g);
  const flaky = summary(/(\d+) flaky/g);
  const skipped = summary(/(\d+) skipped/g);
  const interrupted = summary(/(\d+) interrupted/g);
  const didNotRun = summary(/(\d+) did not run/g);

  const strippedOutput = stripAnsi(output);
  return {
    output: strippedOutput,
    outputLines: parseOutputLines(strippedOutput),
    rawOutput: output,
    passed,
    failed,
    flaky,
    skipped,
    interrupted,
    didNotRun,
  };
}

function toParamList(params: Params): string[] {
  const paramList: string[] = [];
  for (const key of Object.keys(params)) {
    const raw = params[key];
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const k = key.startsWith('-') ? key : '--' + key;
      paramList.push(raw === true ? `${k}` : `${k}=${value}`);
    }
  }
  return paramList;
}

async function writeFilesInternal(baseDir: string, files: Files, initial: boolean): Promise<void> {
  await fs.promises.mkdir(baseDir, { recursive: true });
  let patched = files;
  if (initial && !Object.keys(files).some(name => name.includes('package.json'))) {
    // type:module forces .ts files in tempdir to be treated as ESM. This avoids
    // the CJS-ESM interop failure when our registerHooks (CJS-only) would
    // otherwise redirect the embedded test's `import '@playwright/test'` to
    // our dist/fixture.mjs (ESM) and CJS require cannot load .mjs.
    patched = { ...files, 'package.json': `{ "name": "test-project", "type": "module" }` };
  }
  if (initial && !Object.keys(patched).some(name => name.includes('tsconfig.json') || name.includes('jsconfig.json'))) {
    patched = { ...patched, 'tsconfig.json': DEFAULT_TSCONFIG };
  }
  await Promise.all(Object.keys(patched).map(async (name) => {
    const fullName = path.join(baseDir, name);
    await fs.promises.mkdir(path.dirname(fullName), { recursive: true });
    await fs.promises.writeFile(fullName, patched[name]);
  }));
}

function spawnCli(args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const child = spawn('node', [OHOS_CLI, ...args], {
    env,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
  // Hard timeout: 60s per subprocess. Without this, a hung child (e.g., embedded
  // browser test that should have been fixme'd, or stdin wait in watch stub)
  // would hang the entire suite until the outer 120s config timeout kills the
  // parent — but the orphaned child could keep running. This guarantees cleanup.
  const TIMEOUT_MS = 60_000;
  let timer: NodeJS.Timeout | undefined;
  const exited = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(124);  // timeout exit code (matches `timeout` command convention)
    }, TIMEOUT_MS);
    child.on('exit', code => {
      if (timer) clearTimeout(timer);
      resolve(code ?? 0);
    });
    child.on('error', () => {
      if (timer) clearTimeout(timer);
      resolve(1);
    });
  });
  return {
    stdout: () => Buffer.concat(stdoutChunks).toString(),
    stderr: () => Buffer.concat(stderrChunks).toString(),
    exited,
    kill: (signal: NodeJS.Signals = 'SIGKILL') => {
      if (timer) clearTimeout(timer);
      child.kill(signal);
    },
  };
}

async function runPlaywrightTest(testInfo: TestInfo, files: Files, params: Params, env: NodeJS.ProcessEnv, options: RunOptions): Promise<RunResult> {
  const baseDir = testInfo.outputPath();
  await writeFilesInternal(baseDir, files, true);

  const paramList = toParamList(params);
  const args = ['test', '--workers=2', ...paramList];
  if (options.additionalArgs)
    args.push(...options.additionalArgs);

  const reportFile = path.join(baseDir, 'report.json');
  const envWithJsonReporter: NodeJS.ProcessEnv = {
    PW_TEST_REPORTER: 'json',
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
    ...env,
  };

  const cwd = options.cwd ? path.resolve(baseDir, options.cwd) : baseDir;
  const child = spawnCli(args, cleanEnv(envWithJsonReporter), cwd);
  const exitCode = await child.exited;
  const stdout = child.stdout();
  const stderr = child.stderr();
  const output = stdout + stderr;

  const parsed = parseTestRunnerOutput(output);

  let report: JSONReport | undefined;
  try {
    report = JSON.parse(fs.readFileSync(reportFile).toString());
  } catch {
    // No JSON report — keep output as the only signal.
  }

  const results: JSONReportTestResult[] = [];
  function visitSuites(suites?: JSONReportSuite[]) {
    if (!suites)
      return;
    for (const suite of suites) {
      for (const spec of suite.specs) {
        for (const t of spec.tests)
          results.push(...t.results);
      }
      visitSuites(suite.suites);
    }
  }
  if (report)
    visitSuites(report.suites);

  return {
    ...parsed,
    exitCode,
    rawOutput: output,
    stdout,
    stderr,
    report,
    results,
  };
}

// Extend the test fixture with `runInlineTest`. Each test gets its own bound to its testInfo.outputPath().
// Also provide stubs for upstream fixtures (server, runTSC, mergeReports, git, nodeVersion,
// interactWithTestRunner, runWatchTest, writeFiles) so that ported spec files LOAD — individual
// tests that actually need real implementations of these will fail at runtime and should be marked
// test.fixme with a comment.
export const test = base.extend<{
  runInlineTest: (files: Files, params?: Params, env?: NodeJS.ProcessEnv, options?: RunOptions) => Promise<RunResult>;
  runTSC: (files: Files) => Promise<{ output: string; exitCode: number }>;
  mergeReports: (reportFolder: string, env?: NodeJS.ProcessEnv, options?: RunOptions) => Promise<{ output: string; exitCode: number }>;
  server: { PREFIX: string; EMPTY_PAGE: string; PORT: number };
  git: (command: string) => string;
  nodeVersion: { major: number; minor: number; patch: number };
  interactWithTestRunner: (files: Files, params?: Params, env?: NodeJS.ProcessEnv, options?: RunOptions) => Promise<{ output: string; exitCode: number; kill: () => void }>;
  runWatchTest: (files: Files, params?: Params, env?: NodeJS.ProcessEnv, options?: RunOptions) => Promise<RunResult>;
  writeFiles: (files: Files) => Promise<string>;
}>({
  runInlineTest: async ({}, use, testInfo: TestInfo) => {
    await use((files: Files, params: Params = {}, env: NodeJS.ProcessEnv = {}, options: RunOptions = {}) =>
      runPlaywrightTest(testInfo, files, params, env, options));
  },
  runTSC: async ({}, use) => {
    await use(async (_files: Files) => {
      // STUB: not implemented. Returns non-zero exitCode (2 = TS compilation error convention)
      // so tests asserting `exitCode === 0` for valid TS do NOT spuriously pass on broken input.
      // Real implementation should spawn `tsc` against the embedded files.
      return { output: 'runTSC stub: TypeScript compile not implemented in ohos-playwright _fixtures', exitCode: 2 };
    });
  },
  mergeReports: async ({}, use) => {
    await use(async (_reportFolder: string, _env?: NodeJS.ProcessEnv, _options?: RunOptions) => {
      // STUB: blob report merging not implemented. Returns non-zero to avoid false positives.
      return { output: 'mergeReports stub', exitCode: 2 };
    });
  },
  server: async ({}, use) => {
    // STUB: provides shape but no HTTP server. Tests using server.EMPTY_PAGE / PREFIX will get placeholders.
    await use({ PREFIX: 'http://localhost:0', EMPTY_PAGE: 'data:text/html,', PORT: 0 });
  },
  git: async ({}, use) => {
    await use((_command: string) => {
      // STUB: no git operations from ported specs.
      return '';
    });
  },
  nodeVersion: async ({}, use) => {
    const [major, minor, patch] = process.versions.node.split('.').map(Number);
    await use({ major, minor, patch });
  },
  interactWithTestRunner: async ({}, use) => {
    await use(async (_files: Files, _params?: Params, _env?: NodeJS.ProcessEnv, _options?: RunOptions) => {
      // STUB: interactive stdin test runner not implemented. Tests needing real interactive
      // behavior (watch, UI mode) will fail; mark test.fixme.
      return { output: 'interactWithTestRunner stub', exitCode: 0, kill: () => {} };
    });
  },
  runWatchTest: async ({ runInlineTest }, use) => {
    // STUB: delegates to runInlineTest with PW_TEST_WATCH=1. Real watch behavior (interactive
    // stdin) requires more work; tests asserting watch-specific output will fail.
    await use(async (files: Files, params: Params = {}, env: NodeJS.ProcessEnv = {}, options: RunOptions = {}) =>
      runInlineTest(files, params, { PW_TEST_WATCH: '1', ...env }, options));
  },
  writeFiles: async ({}, use, testInfo: TestInfo) => {
    await use(async (files: Files) => {
      const baseDir = testInfo.outputPath();
      await writeFilesInternal(baseDir, files, true);
      return baseDir;
    });
  },
});

export type { RunOptions };

// Stub: CT config text used by a few specs (loader, esm, only-changed, test-server, watch).
// Upstream value parameterizes ctPort; we just provide a minimal valid config since these
// specs' CT-specific behavior isn't part of ohos-playwright's runner conformance scope.
export const playwrightCtConfigText = `
import { defineConfig } from '@playwright/experimental-ct-react';
export default defineConfig({
  use: { ctPort: ${3200 + (+process.env.TEST_PARALLEL_INDEX || 0)} },
  projects: [{ name: 'default' }],
});
`;
