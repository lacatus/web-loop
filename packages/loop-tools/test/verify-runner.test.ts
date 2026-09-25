import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryIo } from '../src/io';
import { DEFAULT_GATES, type Gate, parseVerifyArgs, runVerify } from '../src/verify-runner';

/** A gate that prints `lines` numbered lines (stdout and stderr interleaved) and exits with `code`. */
const gate = (name: string, lines: number, code = 0): Gate => ({
  name,
  cmd:
    `node -e "for (let i = 1; i <= ${lines}; i++) (i % 2 ? console.log : console.error)('${name} line ' + i);` +
    ` process.exit(${code})"`,
});

function summaryRun(gates: Gate[], extra: { keepGoing?: boolean } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'loop-verify-'));
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
});
