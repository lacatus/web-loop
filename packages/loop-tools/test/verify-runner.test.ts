import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryIo } from '../src/io';
import {
  DEFAULT_GATES,
  type Gate,
  gateEnv,
  parseVerifyArgs,
  runVerify,
} from '../src/verify-runner';

/** A gate that prints `lines` numbered lines (stdout and stderr interleaved) and exits with `code`. */
const gate = (name: string, lines: number, code = 0): Gate => ({
  name,
  cmd:
    `node -e "for (let i = 1; i <= ${lines}; i++) (i % 2 ? console.log : console.error)('${name} line ' + i);` +
    ` process.exit(${code})"`,
});

function summaryRun(
  gates: Gate[],
  extra: { keepGoing?: boolean; env?: NodeJS.ProcessEnv; cwd?: string } = {},
) {
  const cwd = extra.cwd ?? mkdtempSync(join(tmpdir(), 'loop-verify-'));
  const io = memoryIo();
  const code = runVerify({ cwd, io, gates, summary: true, ...extra });
  return { cwd, code, out: io.stdout.join('\n'), logDir: join(cwd, 'artifacts/verify') };
}

describe('verify runner', () => {
  it('keeps the gate order with the agents gate right after spec', () => {
    expect(DEFAULT_GATES.map((g) => g.name)).toEqual([
      'spec',
      'agents',
      'traceability',
      'lint',
      'typecheck',
      'test',
      'build',
      'e2e',
    ]);
    expect(DEFAULT_GATES.find((g) => g.name === 'agents')?.cmd).toBe('pnpm check:agents');
    expect(parseVerifyArgs(['--summary', '--fast'])).toEqual({
      fast: true,
      keepGoing: false,
      summary: true,
    });
  });

  it('Scenario: Passing gates print only the summary — no gate output, full output in artifacts/verify/<gate>.log', () => {
    const { code, out, logDir } = summaryRun([gate('alpha', 5), gate('beta', 3)]);
    expect(code).toBe(0);
    expect(out).toContain('━━ verify summary ━━');
    expect(out).toMatch(/✓ alpha\s+\d+\.\ds {2}artifacts\/verify\/alpha\.log/);
    expect(out).toMatch(/✓ beta\s+\d+\.\ds {2}artifacts\/verify\/beta\.log/);
    expect(out).toContain('VERIFY PASSED');
    expect(out).not.toContain('line 1');
    expect(out).not.toContain('\x1b['); // no ANSI escapes for agents

    const alpha = readFileSync(join(logDir, 'alpha.log'), 'utf8');
    for (let i = 1; i <= 5; i++) expect(alpha).toContain(`alpha line ${i}`);
    expect(readFileSync(join(logDir, 'beta.log'), 'utf8')).toContain('beta line 3');
  });

  it('Scenario: A failing gate prints its tail and log path — last 40 lines + log path, exits non-zero', () => {
    const { code, out, logDir } = summaryRun([
      gate('ok', 2),
      gate('broken', 100, 3),
      gate('after', 1),
    ]);
    expect(code).not.toBe(0);
    expect(out).toContain('broken FAILED — last 40 lines (full log: artifacts/verify/broken.log)');
    const shown = out.split('\n').filter((l) => l.startsWith('broken line '));
    expect(shown).toEqual(Array.from({ length: 40 }, (_, i) => `broken line ${61 + i}`));
    expect(out).not.toContain('ok line');
    expect(out).toMatch(/✗ broken/);
    expect(out).toContain('skipped: after');
    expect(out).toContain('VERIFY FAILED: broken');
    // The full output (stdout and stderr) is in the log.
    const log = readFileSync(join(logDir, 'broken.log'), 'utf8');
    expect(log).toContain('broken line 1\n');
    expect(log).toContain('broken line 100');
    expect(existsSync(join(logDir, 'after.log'))).toBe(false);
  });

  it('--keep-going runs the remaining gates after a failure', () => {
    const { code, out } = summaryRun([gate('broken', 2, 1), gate('after', 1)], { keepGoing: true });
    expect(code).toBe(1);
    expect(out).toMatch(/✓ after/);
    expect(out).not.toContain('skipped');
  });

  it('--fast skips slow gates', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loop-verify-'));
    const io = memoryIo();
    const code = runVerify({
      cwd,
      io,
      summary: true,
      fast: true,
      gates: [gate('quick', 1), { ...gate('slowpoke', 1), slow: true }],
    });
    expect(code).toBe(0);
    expect(io.stdout.join('\n')).not.toContain('slowpoke');
    expect(io.stdout.join('\n')).toContain('(--fast: build and e2e not run)');
  });

  it('keeps gate logs complete when invoked through `pnpm -s` (quiet pnpm/npm settings are not inherited)', () => {
    // A two-package workspace: `pnpm -r run` prints nothing when npm_config_reporter=silent
    // or npm_config_loglevel=silent reach it, which is what `pnpm -s verify` exports.
    const cwd = mkdtempSync(join(tmpdir(), 'loop-verify-ws-'));
    writeFileSync(join(cwd, 'package.json'), '{"name":"ws","private":true}');
    writeFileSync(join(cwd, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    for (const name of ['pkg-a', 'pkg-b']) {
      mkdirSync(join(cwd, 'packages', name), { recursive: true });
      const script = `node -e "console.log('hello from ' + process.env.npm_package_name)"`;
      writeFileSync(
        join(cwd, 'packages', name, 'package.json'),
        JSON.stringify({ name, private: true, scripts: { hello: script } }),
      );
    }
    const quiet = {
      npm_config_reporter: 'silent',
      npm_config_loglevel: 'silent',
      NPM_CONFIG_LOGLEVEL: 'silent',
      pnpm_config_reporter: 'silent',
      npm_config_silent: 'true',
    };
    const { code, logDir } = summaryRun([{ name: 'recursive', cmd: 'pnpm -r run hello' }], {
      cwd,
      env: { ...process.env, ...quiet },
    });
    expect(code).toBe(0);
    const log = readFileSync(join(logDir, 'recursive.log'), 'utf8');
    expect(log.length).toBeGreaterThan(0);
    expect(log).toContain('hello from pkg-a');
    expect(log).toContain('hello from pkg-b');

    const env = gateEnv(
      { ...quiet, npm_config_registry: 'https://r.example/', FORCE_COLOR: '1' },
      true,
    );
    for (const key of Object.keys(quiet)) expect(env).not.toHaveProperty(key);
    expect(env.npm_config_registry).toBe('https://r.example/'); // other settings are kept
    // Streaming mode (humans) is left alone.
    expect(gateEnv(quiet, false)).toMatchObject(quiet);
  });

  it('summary mode removes FORCE_COLOR instead of setting it, so Node prints no colour warning', () => {
    const env = gateEnv({ FORCE_COLOR: '1', NO_COLOR: '1', PATH: process.env.PATH }, true);
    expect(env).not.toHaveProperty('FORCE_COLOR');
    expect(env).not.toHaveProperty('NO_COLOR');
    expect(gateEnv({}, false).FORCE_COLOR).toBe('1');

    // Like Playwright's web servers and workers: a gate whose own child gets FORCE_COLOR=1.
    // Node warns there if NO_COLOR is inherited, so the runner must not pass it down.
    const spawnsForced =
      `node -e "require('node:child_process').execFileSync(process.execPath,` +
      ` ['-e', 'console.log(String(42))'], { stdio: 'inherit', env: { ...process.env, FORCE_COLOR: '1' } })"`;
    const { code, logDir } = summaryRun([gate('plain', 1), { name: 'nested', cmd: spawnsForced }], {
      env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: '1' },
    });
    expect(code).toBe(0);
    expect(readFileSync(join(logDir, 'plain.log'), 'utf8')).toBe('plain line 1\n');
    const nested = readFileSync(join(logDir, 'nested.log'), 'utf8');
    expect(nested).not.toContain('NO_COLOR');
    expect(nested).toBe('42\n');
  });

  it('summary mode clears logs left by earlier runs', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'loop-verify-'));
    const logDir = join(cwd, 'artifacts/verify');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'e2e.log'), 'stale output from an earlier run\n');
    writeFileSync(join(logDir, 'notes.txt'), 'not a log\n');
    const { code } = summaryRun([gate('broken', 1, 1), gate('e2e', 1)], { cwd });
    expect(code).toBe(1);
    expect(existsSync(join(logDir, 'broken.log'))).toBe(true);
    expect(existsSync(join(logDir, 'e2e.log'))).toBe(false); // skipped this run → no stale log
    expect(existsSync(join(logDir, 'notes.txt'))).toBe(true);
  });
});
