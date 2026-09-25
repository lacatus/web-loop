/**
 * The single quality gate. Identical locally, in CI, and for the worker/validator agents.
 *
 *   pnpm verify                all gates, full output streamed (humans)
 *   pnpm verify --fast         skip build + e2e (inner-loop speed)
 *   pnpm verify --keep-going   run every gate even after a failure
 *   pnpm verify --summary      full output to artifacts/verify/<gate>.log; print only the summary
 *                              table plus the last 40 lines and log path of failing gates (agents).
 *                              Logs of earlier runs are removed first; quiet pnpm/npm settings
 *                              (e.g. from `pnpm -s verify`) are not passed to the gates.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

/**
 * pnpm/npm settings that silence nested `pnpm -r` output. `pnpm -s verify` exports e.g.
 * `npm_config_reporter=silent` to its children, which would leave summary-mode logs empty.
 */
export const QUIET_ENV_PATTERN = /^(npm|pnpm)_config_(reporter|loglevel|silent)$/i;

/** The gate child environment: summary mode drops colour forcing and quiet pnpm/npm settings. */
export function gateEnv(base: NodeJS.ProcessEnv, summary: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, OPENSPEC_TELEMETRY: '0' };
  if (!summary) return { ...env, FORCE_COLOR: base.FORCE_COLOR ?? '1' };
  // Logs read by agents stay free of ANSI escapes because gate output goes to a file (no TTY),
  // so tools choose plain output themselves. Both colour variables are removed rather than set:
  // Node warns in every child that sees NO_COLOR and FORCE_COLOR together, and Playwright
  // re-adds FORCE_COLOR=1 for its web servers and workers.
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  for (const key of Object.keys(env)) if (QUIET_ENV_PATTERN.test(key)) delete env[key];
  return env;
}

/** Summary mode: removes logs of earlier runs so every log in the directory is from this run. */
function clearLogs(logDir: string): void {
  mkdirSync(logDir, { recursive: true });
  for (const f of readdirSync(logDir)) {
    if (f.endsWith('.log')) rmSync(join(logDir, f), { force: true });
  }
}

export function runVerify(options: VerifyOptions): number {
  const { cwd, io, fast = false, keepGoing = false, summary = false } = options;
  const gates = (options.gates ?? DEFAULT_GATES).filter((g) => !(fast && g.slow));
  const logDir = options.logDir ?? join(cwd, 'artifacts/verify');
  const color = !summary;
  const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s);
  const green = (s: string) => (color ? `\x1b[32m${s}\x1b[0m` : s);
  const red = (s: string) => (color ? `\x1b[31m${s}\x1b[0m` : s);

  const env = gateEnv(options.env ?? process.env, summary);
  if (summary) clearLogs(logDir);

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
