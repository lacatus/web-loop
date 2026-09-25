/**
 * The single quality gate. Identical locally, in CI, and for the worker/validator agents.
 *
 *   pnpm verify                all gates, full output streamed (humans)
 *   pnpm verify --fast         skip build + e2e (inner-loop speed)
 *   pnpm verify --keep-going   run every gate even after a failure
 *   pnpm verify --summary      full output to artifacts/verify/<gate>.log; print only the summary
 *                              table plus the last 40 lines and log path of failing gates (agents)
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Io } from './io';

export interface Gate {
  name: string;
  cmd: string;
  /** Skipped by --fast. */
  slow?: boolean;
}

export const DEFAULT_GATES: Gate[] = [
  { name: 'spec', cmd: 'pnpm spec:validate' },
  { name: 'agents', cmd: 'pnpm check:agents' },
  { name: 'traceability', cmd: 'node scripts/check-traceability.mjs' },
  { name: 'lint', cmd: 'pnpm lint' },
  { name: 'typecheck', cmd: 'pnpm typecheck' },
  { name: 'test', cmd: 'pnpm test' },
  { name: 'build', cmd: 'pnpm build', slow: true },
  { name: 'e2e', cmd: 'pnpm e2e', slow: true },
];

export const TAIL_LINES = 40;

export interface VerifyOptions {
  cwd: string;
  io: Io;
  gates?: Gate[];
  fast?: boolean;
  keepGoing?: boolean;
  summary?: boolean;
  /** Log directory for --summary (default `<cwd>/artifacts/verify`). */
  logDir?: string;
  env?: NodeJS.ProcessEnv;
}

interface GateResult {
  gate: Gate;
  ok: boolean;
  secs: string;
  log?: string;
}

export function parseVerifyArgs(argv: string[]) {
  const args = new Set(argv);
  return {
    fast: args.has('--fast'),
    keepGoing: args.has('--keep-going'),
    summary: args.has('--summary'),
  };
}

export function tail(text: string, lines: number): string[] {
  const all = text.replace(/\n+$/, '').split('\n');
  return all.slice(Math.max(0, all.length - lines));
}

export function runVerify(options: VerifyOptions): number {
  const { cwd, io, fast = false, keepGoing = false, summary = false } = options;
  const gates = (options.gates ?? DEFAULT_GATES).filter((g) => !(fast && g.slow));
  const logDir = options.logDir ?? join(cwd, 'artifacts/verify');
  const color = !summary;
  const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s);
  const green = (s: string) => (color ? `\x1b[32m${s}\x1b[0m` : s);
  const red = (s: string) => (color ? `\x1b[31m${s}\x1b[0m` : s);

  const env: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
    OPENSPEC_TELEMETRY: '0',
    // Logs read by agents stay free of ANSI escapes; humans keep colours.
    ...(summary
      ? { FORCE_COLOR: '0', NO_COLOR: '1' }
      : { FORCE_COLOR: process.env.FORCE_COLOR ?? '1' }),
  };
  if (summary) mkdirSync(logDir, { recursive: true });

  const results: GateResult[] = [];
  for (const gate of gates) {
    const start = Date.now();
    let status: number | null;
    let log: string | undefined;
    if (summary) {
      log = join(logDir, `${gate.name}.log`);
      const fd = openSync(log, 'w');
      try {
        ({ status } = spawnSync(gate.cmd, { cwd, stdio: ['ignore', fd, fd], shell: true, env }));
      } finally {
        closeSync(fd);
      }
    } else {
      io.out(`\n${bold(`━━ ${gate.name} ━━`)}  ${gate.cmd}`);
      ({ status } = spawnSync(gate.cmd, { cwd, stdio: 'inherit', shell: true, env }));
    }
    const ok = status === 0;
    results.push({ gate, ok, secs: ((Date.now() - start) / 1000).toFixed(1), log });
    if (!ok && !keepGoing) break;
  }

  const rel = (p: string) => relative(cwd, p) || p;
  for (const r of results.filter((x) => !x.ok && x.log)) {
    const log = r.log ?? '';
    io.out(`\n━━ ${r.gate.name} FAILED — last ${TAIL_LINES} lines (full log: ${rel(log)}) ━━`);
    for (const line of tail(readFileSync(log, 'utf8'), TAIL_LINES)) io.out(line);
  }

  io.out(`\n${bold('━━ verify summary ━━')}`);
  for (const r of results) {
    const mark = r.ok ? green('✓') : red('✗');
    const where = r.log ? `  ${rel(r.log)}` : '';
    io.out(`${mark} ${r.gate.name.padEnd(13)} ${r.secs.padStart(6)}s${where}`);
  }
  const skipped = gates.slice(results.length).map((g) => g.name);
  if (skipped.length) io.out(`  skipped: ${skipped.join(', ')}`);
  if (fast) io.out('  (--fast: build and e2e not run)');

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    io.out(`\n${red('VERIFY FAILED')}: ${failed.map((r) => r.gate.name).join(', ')}`);
    return 1;
  }
  io.out(`\n${green('VERIFY PASSED')}`);
  return 0;
}
