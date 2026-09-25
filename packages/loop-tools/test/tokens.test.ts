import { cpSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { memoryIo } from '../src/io';
import { REPORT_HEADER, type TokenReport, projectDirName, tokensCli } from '../src/tokens';

const FIXTURES = join(import.meta.dirname, 'fixtures/projects');
const PROJECT = '-work-demo-app';

/** Copies the fixture transcripts into a fake home so the session mtimes can be controlled. */
function fakeHome(): { home: string; dir: string } {
  const home = mkdtempSync(join(tmpdir(), 'loop-tokens-'));
  const dir = join(home, '.claude/projects', PROJECT);
  mkdirSync(join(home, '.claude/projects'), { recursive: true });
  cpSync(join(FIXTURES, PROJECT), dir, { recursive: true });
  const old = new Date('2026-09-20T10:00:00Z');
  const recent = new Date('2026-09-25T10:10:00Z');
  utimesSync(join(dir, 'session-old.jsonl'), old, old);
  utimesSync(join(dir, 'session-new.jsonl'), recent, recent);
  return { home, dir };
}

function run(argv: string[], home: string, cwd = '/work/demo.app') {
  const io = memoryIo();
  const code = tokensCli(argv, { cwd, home, env: {} }, io);
  return { code, io, out: io.stdout.join('\n') };
}

function json(argv: string[], home: string): TokenReport {
  const { code, out } = run([...argv, '--format', 'json'], home);
  expect(code).toBe(0);
  return JSON.parse(out) as TokenReport;
}

/** Splits a text-table line into its cells (columns are separated by 2+ spaces). */
const cells = (line: string) => line.trim().split(/\s{2,}/);

describe('pnpm tokens', () => {
  let home: string;
  beforeEach(() => {
    ({ home } = fakeHome());
  });

  it('maps the cwd to Claude Code project directory names', () => {
    expect(projectDirName('/home/user/web-loop')).toBe('-home-user-web-loop');
    expect(projectDirName('/work/demo.app')).toBe(PROJECT);
  });

  it('Scenario: Report per agent — one row per agent and model with every token column, then a total row', () => {
    const { code, out } = run(['--latest'], home);
    expect(code).toBe(0);
    const lines = out.split('\n');
    const headerIdx = lines.findIndex((l) => l.startsWith('Agent'));
    expect(cells(lines[headerIdx] ?? '')).toEqual(REPORT_HEADER);
    // Subscription-first: token columns and cache-hit % come before the dollar column.
    expect(REPORT_HEADER.indexOf('Cache hit')).toBeLessThan(
      REPORT_HEADER.indexOf('list-price est.'),
    );
    expect(REPORT_HEADER.at(-1)).toBe('list-price est.');

    const rows = lines
      .slice(headerIdx + 2)
      .filter((l) => l.trim() && !l.startsWith('list-price'))
      .map(cells);
    expect(rows.map((r) => `${r[0]} / ${r[1] ?? ''}`)).toEqual([
      'main / claude-opus-5-5',
      'worker r1 / claude-sonnet-5',
      'browser-qa r1 / claude-sonnet-5',
      'validator r1 / claude-opus-5-5',
      'worker r2 / claude-sonnet-5', // agent type from the transcript's own attribution
      'agent-x9 / claude-mystery-9', // no metadata, no change/round prompt → raw agent id
      'Total / 8', // empty model cell collapses; next cell is the total request count
    ]);
    // worker r1: requests, input, output, cache write, cache read, cache hit, list-price est.
    expect(rows[1]?.slice(2)).toEqual(['1', '100', '1.0K', '10.0K', '100.0K', '91%', '~$0.06']);
    // Total requests: main 2 + w1 1 + b1 1 + v1 2 + w2 1 + x9 1 = 8
    expect(out).toContain('list-price est. = Anthropic API list prices');
    expect(out).toContain('subscription plans are not billed per token');

    const report = json(['--latest'], home);
    expect(report.sessions).toEqual(['session-new']);
    const validator = report.rows.find((r) => r.agent === 'validator r1');
    expect(validator?.usage).toMatchObject({
      requests: 2,
      input: 100,
      output: 1000,
      cacheWrite: 4000,
      cacheWrite1h: 4000,
      cacheRead: 84000,
    });
    // 1h cache writes are priced at 2x input: (100*4 + 1000*20 + 4000*4*2 + 84000*0.4) / 1e6
    expect(validator?.listPriceUsd).toBeCloseTo(0.086, 6);
    expect(report.total.requests).toBe(8);
    expect(report.total.output).toBe(300 + 1000 + 100 + 1000 + 300 + 1000);
  });

  it('selects a session by id and defaults to the latest one', () => {
    expect(json([], home).sessions).toEqual(['session-new']);
    const old = json(['--session', 'session-old'], home);
    expect(old.rows.map((r) => r.agent)).toEqual(['main']);
    expect(old.total.requests).toBe(1);
  });

  it('Scenario: Streaming duplicates counted once — a response id repeated while streaming is counted once, last record wins', () => {
    const report = json(['--latest'], home);
    const worker = report.rows.find((r) => r.agent === 'worker r1');
    // agent-w1.jsonl has three records for msg_w1 with output 10, 500, 1000
    expect(worker?.usage).toMatchObject({
      requests: 1,
      input: 100,
      output: 1000,
      cacheWrite: 10000,
      cacheRead: 100000,
    });
    const main = report.rows.find((r) => r.agent === 'main');
    // msg_m1 twice (output 1 then 200) + msg_m2 once; the <synthetic> record is not a response
    expect(main?.usage).toMatchObject({ requests: 2, input: 5, output: 300, cacheWrite: 1500 });
  });

  it('Scenario: Unknown model is unpriced — its tokens are reported and its estimate reads "unpriced"', () => {
    const report = json(['--latest'], home);
    const unknown = report.rows.find((r) => r.model === 'claude-mystery-9');
    expect(unknown?.usage).toMatchObject({ requests: 1, input: 1000, output: 1000 });
    expect(unknown?.listPriceUsd).toBeUndefined();
    expect(report.total.unpricedModels).toEqual(['claude-mystery-9']);

    const { out } = run(['--latest'], home);
    const row = out.split('\n').find((l) => l.startsWith('agent-x9'));
    expect(cells(row ?? '')).toEqual([
      'agent-x9',
      'claude-mystery-9',
      '1',
      '1.0K',
      '1.0K',
      '0',
      '0',
      '0%',
      'unpriced',
    ]);
    expect(out).not.toMatch(/agent-x9.*\$0\.00/);
    const total = out.split('\n').find((l) => l.startsWith('Total'));
    expect(total).toContain('(excl. unpriced)');
  });

  it('Scenario: No transcripts found — prints "no usage found" naming the searched directory and exits 0', () => {
    const empty = mkdtempSync(join(tmpdir(), 'loop-tokens-empty-'));
    const missingProject = run([], empty, '/nowhere/project');
    expect(missingProject.code).toBe(0);
    const expectedDir = join(empty, '.claude/projects', '-nowhere-project');
    expect(missingProject.out).toMatch(/^No usage found/);
    expect(missingProject.out).toContain(expectedDir);

    const missingSession = run(['--session', 'does-not-exist'], home);
    expect(missingSession.code).toBe(0);
    expect(missingSession.out).toContain('No usage found (session does-not-exist)');
    expect(missingSession.out).toContain(join(home, '.claude/projects', PROJECT));

    const byDir = run(['--dir', join(empty, 'nothing-here')], home);
    expect(byDir.code).toBe(0);
    expect(byDir.out).toContain(
      `No usage found (latest session) in ${join(empty, 'nothing-here')}`,
    );
  });

  it('Scenario: Round record includes token usage — the review record ends with a Tokens section, one row per agent of that round', () => {
    const review = join(mkdtempSync(join(tmpdir(), 'loop-review-')), 'round-1.md');
    writeFileSync(
      review,
      'VERDICT: REQUEST_CHANGES\n\n## Review — demo round 1\n\n## Worker report\n...\n',
    );
    const { code } = run(
      ['--latest', '--change', 'demo', '--round', '1', '--format', 'md', '--append', review],
      home,
    );
    expect(code).toBe(0);

    const text = readFileSync(review, 'utf8');
    expect(text.startsWith('VERDICT: REQUEST_CHANGES')).toBe(true);
    const section = text.slice(text.lastIndexOf('## Tokens'));
    expect(text.lastIndexOf('## Tokens')).toBeGreaterThan(text.indexOf('## Worker report'));
    // Nothing follows the Tokens section except its own table and footnote.
    expect(section.split('\n').filter((l) => l.startsWith('## '))).toEqual(['## Tokens']);

    const tableLines = section.split('\n').filter((l) => l.startsWith('|'));
    const mdCells = (l: string) =>
      l
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
    // Same columns as `pnpm tokens`
    expect(mdCells(tableLines[0] ?? '')).toEqual(REPORT_HEADER);
    const agents = tableLines.slice(2).map((l) => mdCells(l)[0]);
    expect(agents).toEqual(['worker r1', 'browser-qa r1', 'validator r1', '**Total**']);
    expect(section).toContain('list-price est.');
  });
});
