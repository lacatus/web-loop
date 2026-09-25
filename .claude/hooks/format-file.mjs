#!/usr/bin/env node
/**
 * PostToolUse hook: after Claude edits a file, format it with Prettier and auto-fix ESLint.
 * Remaining ESLint errors are fed back to Claude (exit 2 + stderr) so it fixes them right away
 * instead of discovering them later in `pnpm verify`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let file;
try {
  file = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (!file || !existsSync(file)) process.exit(0);

const rel = relative(root, file);
if (rel.startsWith('..') || /(^|\/)(node_modules|dist|artifacts|\.claude|openspec)\//.test(rel)) {
  process.exit(0);
}

const run = (cmd, args) =>
  spawnSync('pnpm', ['exec', cmd, ...args], { cwd: root, encoding: 'utf8' });

if (/\.(ts|tsx|js|mjs|cjs|jsx|json|css|md|ya?ml|html)$/.test(rel)) {
  run('prettier', ['--write', '--log-level', 'warn', rel]);
}

if (/\.(ts|tsx|js|mjs|jsx)$/.test(rel)) {
  const res = run('eslint', ['--fix', '--max-warnings=0', rel]);
  if (res.status !== 0) {
    process.stderr.write(`ESLint problems remain in ${rel}:\n${res.stdout}${res.stderr}`);
    process.exit(2);
  }
}
process.exit(0);
