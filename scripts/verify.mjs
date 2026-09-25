#!/usr/bin/env node
/**
 * The single quality gate. Identical locally, in CI, and for the worker/validator agents.
 *
 *   pnpm verify            all gates
 *   pnpm verify --fast     skip build + e2e (inner-loop speed)
 *   pnpm verify --keep-going   run every gate even after a failure
 */
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const fast = args.has('--fast');
const keepGoing = args.has('--keep-going');

const gates = [
  { name: 'spec', cmd: 'pnpm spec:validate' },
  { name: 'traceability', cmd: 'node scripts/check-traceability.mjs' },
  { name: 'lint', cmd: 'pnpm lint' },
  { name: 'typecheck', cmd: 'pnpm typecheck' },
  { name: 'test', cmd: 'pnpm test' },
  { name: 'build', cmd: 'pnpm build', slow: true },
  { name: 'e2e', cmd: 'pnpm e2e', slow: true },
].filter((g) => !(fast && g.slow));

const env = {
  ...process.env,
  OPENSPEC_TELEMETRY: '0',
  FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
};
const results = [];

for (const gate of gates) {
  console.log(`\n\x1b[1m━━ ${gate.name} ━━\x1b[0m  ${gate.cmd}`);
  const start = Date.now();
  const { status } = spawnSync(gate.cmd, { stdio: 'inherit', shell: true, env });
  const ok = status === 0;
  results.push({ ...gate, ok, secs: ((Date.now() - start) / 1000).toFixed(1) });
  if (!ok && !keepGoing) break;
}

console.log('\n\x1b[1m━━ verify summary ━━\x1b[0m');
for (const r of results) {
  console.log(`${r.ok ? '\x1b[32m✓' : '\x1b[31m✗'} ${r.name.padEnd(13)}\x1b[0m ${r.secs}s`);
}
const skipped = gates.slice(results.length).map((g) => g.name);
if (skipped.length) console.log(`  skipped: ${skipped.join(', ')}`);
if (fast) console.log('  (--fast: build and e2e not run)');

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n\x1b[31mVERIFY FAILED\x1b[0m: ${failed.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\n\x1b[32mVERIFY PASSED\x1b[0m');
