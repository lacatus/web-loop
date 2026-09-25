#!/usr/bin/env node
/**
 * Launches the Playwright MCP server (stdio) for Claude Code with project defaults:
 * headless, isolated profile, output in artifacts/playwright-mcp, and a pre-installed
 * Chromium when one exists (cloud containers ship one at /opt/pw-browsers).
 *
 * Extra CLI args are passed through, e.g. `node scripts/playwright-mcp.mjs --caps vision`.
 * Set PLAYWRIGHT_MCP_HEADED=1 to watch the browser locally.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromiumExecutable } from './chromium-path.mjs';

const root = join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');

const args = [
  '--isolated',
  '--output-dir',
  join(root, 'artifacts/playwright-mcp'),
  '--console-level',
  'warning',
  '--viewport-size',
  '1280x800',
];
if (!process.env.PLAYWRIGHT_MCP_HEADED) args.push('--headless');

const executable = chromiumExecutable();
if (executable) args.push('--executable-path', executable);

// Chromium's sandbox cannot start as root (e.g. cloud containers, Docker). @playwright/test
// already disables it by default; do the same here only where it would otherwise crash.
if (process.getuid?.() === 0 || process.env.PLAYWRIGHT_MCP_NO_SANDBOX) args.push('--no-sandbox');

const child = spawn(process.execPath, [cli, ...args, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});
child.on('exit', (code, signal) =>
  signal ? process.kill(process.pid, signal) : process.exit(code ?? 0),
);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
