#!/usr/bin/env node
// Copy tests/assets/ from playwright-official into tests/upstream/assets/.
// Run once before the first test run; re-run after upstream updates.

import { cpSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'playwright-official', 'tests', 'assets');
const DEST = join(ROOT, 'tests', 'upstream', 'assets');

mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true, force: true });
console.log(`Copied ${SRC} → ${DEST}`);
