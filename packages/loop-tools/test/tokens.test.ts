import { cpSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { memoryIo } from '../src/io';
import { REPORT_HEADER, type TokenReport, projectDirName, roundAt, tokensCli } from '../src/tokens';

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

// ---------- multi-session changes and orchestrator attribution ----------

interface Reply {
  id: string;
  ts: string;
  output: number;
  model?: string;
  input?: number;
}

const reply = (r: Reply) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: r.ts,
    requestId: `req_${r.id}`,
    message: {
      id: r.id,
      model: r.model ?? 'claude-opus-5-5',
      role: 'assistant',
      usage: {
        input_tokens: r.input ?? 1,
        output_tokens: r.output,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });

const prompt = (ts: string, text: string) =>
  JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: text } });

interface SubagentFixture {
  type: string;
  lines: string[];
}

/** Writes `<session>.jsonl` (main) and `<session>/subagents/agent-<id>.{jsonl,meta.json}`. */
function writeSession(
  dir: string,
  sessionId: string,
  mtime: string,
  main: string[],
  subagents: Record<string, SubagentFixture> = {},
) {
  mkdirSync(dir, { recursive: true });
  const mainPath = join(dir, `${sessionId}.jsonl`);
  writeFileSync(mainPath, `${main.join('\n')}\n`);
  const subDir = join(dir, sessionId, 'subagents');
  for (const [id, sub] of Object.entries(subagents)) {
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, `agent-${id}.jsonl`), `${sub.lines.join('\n')}\n`);
    writeFileSync(join(subDir, `agent-${id}.meta.json`), JSON.stringify({ agentType: sub.type }));
  }
  utimesSync(mainPath, new Date(mtime), new Date(mtime));
}

/**
 * A change `demo` whose round 1 ran in session `sess-a` and round 2 in session `sess-b`
 * (resumed after a spec-gap stop), plus a newer unrelated session `sess-c`.
 * The repo root holds the change folder so that `--mark` can record round windows.
 */
function splitChange() {
  const root = mkdtempSync(join(tmpdir(), 'loop-split-'));
  mkdirSync(join(root, 'openspec/changes/demo'), { recursive: true });
  const dir = join(root, 'transcripts');
  writeSession(
    dir,
    'sess-a',
    '2026-09-24T11:00:00Z',
    [
      prompt('2026-09-24T09:59:00Z', '/build-feature demo'),
      reply({ id: 'a_before', ts: '2026-09-24T09:59:59.999Z', output: 1 }), // before r1 start
      reply({ id: 'a_at_start', ts: '2026-09-24T10:00:00.000Z', output: 10 }), // == start
      reply({ id: 'a_stream', ts: '2026-09-24T10:10:00Z', output: 5 }), // streamed…
      reply({ id: 'a_stream', ts: '2026-09-24T10:10:01Z', output: 100 }), // …last record wins
      reply({ id: 'a_at_end', ts: '2026-09-24T10:30:00.000Z', output: 1000 }), // == end
      reply({ id: 'a_after', ts: '2026-09-24T10:30:00.001Z', output: 10000 }), // after r1 end
    ],
    {
      w1: {
        type: 'worker',
        lines: [
          prompt('2026-09-24T10:01:00Z', 'change=demo\nround=1'),
          reply({ id: 'w1', ts: '2026-09-24T10:01:01Z', output: 2, model: 'claude-sonnet-5' }),
        ],
      },
      v1: {
        type: 'validator',
        lines: [
          prompt('2026-09-24T10:20:00Z', 'change=demo\nbase=abc\nround=1'),
          reply({ id: 'v1', ts: '2026-09-24T10:20:01Z', output: 3 }),
        ],
      },
      o1: {
        type: 'worker',
        lines: [
          prompt('2026-09-24T10:40:00Z', 'change=other\nround=1'),
          reply({ id: 'o1', ts: '2026-09-24T10:40:01Z', output: 7, model: 'claude-sonnet-5' }),
        ],
      },
    },
  );
  writeSession(
    dir,
    'sess-b',
    '2026-09-25T12:00:00Z',
    [
      prompt('2026-09-25T10:59:00Z', '/build-feature demo'),
      // A resumed session repeats earlier records: the same response is still counted once.
      reply({ id: 'a_stream', ts: '2026-09-24T10:10:01Z', output: 100 }),
      reply({ id: 'b_in', ts: '2026-09-25T11:05:00Z', output: 20 }),
      reply({ id: 'b_after', ts: '2026-09-25T11:45:00Z', output: 30000 }),
    ],
    {
      w2: {
        type: 'worker',
        lines: [
          prompt('2026-09-25T11:01:00Z', 'change=demo\nround=2\nreview=…/round-1.md'),
          reply({ id: 'w2', ts: '2026-09-25T11:01:01Z', output: 4, model: 'claude-sonnet-5' }),
        ],
      },
      v2: {
        type: 'validator',
        lines: [
          prompt('2026-09-25T11:20:00Z', 'change=demo\nbase=abc\nround=2'),
          reply({ id: 'v2', ts: '2026-09-25T11:20:01Z', output: 6 }),
        ],
      },
    },
  );
  writeSession(dir, 'sess-c', '2026-09-25T13:00:00Z', [
    reply({ id: 'c_chat', ts: '2026-09-25T12:30:00Z', output: 50000 }),
  ]);

  const cli = (argv: string[], now?: string) => {
    const io = memoryIo();
    const code = tokensCli(
      argv,
      { cwd: root, home: root, env: {}, now: now ? () => new Date(now) : undefined },
      io,
    );
    return { code, out: io.stdout.join('\n'), err: io.stderr.join('\n') };
  };
  const report = (argv: string[]) => {
    const { code, out } = cli([...argv, '--dir', dir, '--format', 'json']);
    expect(code).toBe(0);
    return JSON.parse(out) as TokenReport;
  };
  const mark = (round: string, kind: string, now: string) => {
    const r = cli(['--mark', 'demo', round, kind], now);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
  };
  return { root, dir, cli, report, mark };
}

const byAgent = (report: TokenReport) =>
  Object.fromEntries(report.rows.map((r) => [r.agent, r.usage.output]));

describe('pnpm tokens across sessions and rounds', () => {
  it('Scenario: Change total spans sessions — --change without --session includes the rounds of both sessions and names both', () => {
    const { dir, cli, report } = splitChange();

    const total = report(['--change', 'demo']);
    expect(total.sessions).toEqual(['sess-a', 'sess-b']); // sess-c has no usage for demo
    expect(byAgent(total)).toEqual({
      'worker r1': 2,
      'validator r1': 3,
      'worker r2': 4,
      'validator r2': 6,
    });
    expect(total.total.requests).toBe(4);
    expect(total.total.output).toBe(2 + 3 + 4 + 6);

    // Both sessions are named in the text and markdown output.
    const text = cli(['--change', 'demo', '--dir', dir]).out;
    expect(text).toContain('Token usage — sessions sess-a, sess-b');
    const md = cli(['--change', 'demo', '--dir', dir, '--format', 'md']).out;
    expect(md).toContain('_Sessions `sess-a`, `sess-b`.');
    expect(md).toMatch(/^\| worker r1 \|/m);
    expect(md).toMatch(/^\| validator r2 \|/m);

    // --latest and --session still narrow it to one session; without --change the default stays the latest.
    expect(cli(['--change', 'demo', '--latest', '--dir', dir]).out).toMatch(/^No usage found/);
    expect(report(['--change', 'demo', '--session', 'sess-a']).sessions).toEqual(['sess-a']);
    expect(report([]).sessions).toEqual(['sess-c']);
    expect(cli(['--change', 'nope', '--dir', dir]).out).toContain(
      `No usage found (all sessions, change nope) in ${dir}`,
    );
  });

  it('Scenario: Orchestrator usage is attributed to its round — exactly the main-session usage inside the start/end window, deduped', () => {
    const { root, cli, report, mark } = splitChange();
    mark('1', 'start', '2026-09-24T10:00:00.000Z');
    mark('1', 'end', '2026-09-24T10:30:00.000Z');
    mark('2', 'start', '2026-09-25T11:00:00.000Z');
    mark('2', 'end', '2026-09-25T11:30:00.000Z');
    const marks = JSON.parse(
      readFileSync(join(root, 'openspec/changes/demo/reviews/.marks.json'), 'utf8'),
    ) as unknown;
    expect(marks).toEqual({
      rounds: {
        '1': { start: '2026-09-24T10:00:00.000Z', end: '2026-09-24T10:30:00.000Z' },
        '2': { start: '2026-09-25T11:00:00.000Z', end: '2026-09-25T11:30:00.000Z' },
      },
    });

    const r1 = report(['--change', 'demo', '--round', '1']);
    expect(r1.rows.map((r) => r.agent)).toEqual(['orchestrator r1', 'worker r1', 'validator r1']);
    const orch1 = r1.rows.find((r) => r.agent === 'orchestrator r1');
    // Inside (boundaries inclusive): a_at_start 10 + a_stream 100 (streamed twice, and repeated
    // in the resumed sess-b, counted once) + a_at_end 1000. Outside: a_before, a_after.
    expect(orch1?.model).toBe('claude-opus-5-5');
    expect(orch1?.usage).toMatchObject({ requests: 3, input: 3, output: 1110 });

    const r2 = report(['--change', 'demo', '--round', '2']);
    expect(byAgent(r2)).toEqual({ 'orchestrator r2': 20, 'worker r2': 4, 'validator r2': 6 });
    expect(r2.rows[0]?.usage.requests).toBe(1);

    // The change total carries every round's orchestrator row; usage outside all windows
    // (a_before, a_after, b_after, the unrelated sess-c) is not in it.
    const total = report(['--change', 'demo']);
    expect(total.rows.map((r) => r.agent)).toEqual([
      'orchestrator r1',
      'worker r1',
      'validator r1',
      'orchestrator r2',
      'worker r2',
      'validator r2',
    ]);
    expect(total.total.output).toBe(1110 + 2 + 3 + 20 + 4 + 6);
    expect(total.total.requests).toBe(3 + 1 + 1 + 1 + 1 + 1);

    // The round record gets the orchestrator row too.
    const review = join(root, 'openspec/changes/demo/reviews/round-1.md');
    writeFileSync(review, 'VERDICT: APPROVE\n');
    const round1 = ['--change', 'demo', '--round', '1', '--dir', join(root, 'transcripts')];
    expect(cli([...round1, '--append', review]).out).toMatch(
      /^orchestrator r1\s+claude-opus-5-5\s+3\s/m,
    );
    const section = readFileSync(review, 'utf8');
    expect(section).toMatch(/^\| orchestrator r1 \| claude-opus-5-5 \| 3 \|/m);
    expect(section.indexOf('| orchestrator r1 |')).toBeGreaterThan(section.indexOf('## Tokens'));
  });

  it('Scenario: Orchestrator usage is attributed to its round — only from the session that ran the change, not a concurrent unrelated session', () => {
    const { dir, report, mark } = splitChange();
    mark('1', 'start', '2026-09-24T10:00:00.000Z');
    mark('1', 'end', '2026-09-24T10:30:00.000Z');
    mark('2', 'start', '2026-09-25T11:00:00.000Z');
    mark('2', 'end', '2026-09-25T11:30:00.000Z');
    // A concurrent session in the same project, busy inside both windows. It spawned a subagent,
    // but for another change; it also repeats (forks) sess-b's `b_in` record and is newer than
    // sess-b, so without the fix its copy would win the dedupe.
    writeSession(
      dir,
      'sess-x',
      '2026-09-25T12:30:00Z',
      [
        reply({ id: 'x_r1', ts: '2026-09-24T10:15:00Z', output: 77777 }),
        reply({ id: 'b_in', ts: '2026-09-25T11:05:00Z', output: 20 }),
        reply({ id: 'x_r2', ts: '2026-09-25T11:10:00Z', output: 99999 }),
      ],
      {
        xw: {
          type: 'worker',
          lines: [
            prompt('2026-09-25T11:02:00Z', 'change=other\nround=2'),
            reply({ id: 'xw', ts: '2026-09-25T11:02:01Z', output: 8 }),
          ],
        },
      },
    );

    const r1 = report(['--change', 'demo', '--round', '1']);
    expect(byAgent(r1)).toEqual({ 'orchestrator r1': 1110, 'worker r1': 2, 'validator r1': 3 });
    expect(r1.sessions).toEqual(['sess-a', 'sess-b']); // sess-b holds the deduped a_stream copy

    const r2 = report(['--change', 'demo', '--round', '2']);
    expect(byAgent(r2)).toEqual({ 'orchestrator r2': 20, 'worker r2': 4, 'validator r2': 6 });
    expect(r2.rows[0]?.usage.requests).toBe(1);
    expect(r2.sessions).toEqual(['sess-b']);

    const total = report(['--change', 'demo']);
    expect(total.sessions).toEqual(['sess-a', 'sess-b']);
    expect(total.total.output).toBe(1110 + 2 + 3 + 20 + 4 + 6);
    // The unrelated session still reports its own subagent under its own change.
    expect(byAgent(report(['--change', 'other', '--session', 'sess-x']))).toEqual({
      'worker r2': 8,
    });
  });

  it('Scenario: Orchestrator usage is attributed to its round — a round left open ends at the next round start', () => {
    const open2 = {
      '2': { start: '2026-09-25T10:00:00.000Z' },
      '3': { start: '2026-09-25T11:00:00.000Z', end: '2026-09-25T11:30:00.000Z' },
    };
    expect(roundAt(open2, '2026-09-25T10:30:00Z')).toBe('2');
    expect(roundAt(open2, '2026-09-25T10:59:59.999Z')).toBe('2');
    expect(roundAt(open2, '2026-09-25T11:00:00.000Z')).toBe('3');
    expect(roundAt(open2, '2026-09-25T11:10:00Z')).toBe('3'); // inside round 3, not round 2
    expect(roundAt(open2, '2026-09-25T11:30:00.001Z')).toBeUndefined(); // round 2 is closed by 3
    expect(roundAt(open2, '2026-09-25T09:59:59Z')).toBeUndefined();

    // End to end: round 2 left open (e.g. an interrupted run), round 3 marked in full.
    const { report, mark } = splitChange();
    mark('1', 'start', '2026-09-24T10:00:00.000Z');
    mark('1', 'end', '2026-09-24T10:30:00.000Z');
    mark('2', 'start', '2026-09-25T11:00:00.000Z');
    mark('3', 'start', '2026-09-25T11:40:00.000Z');
    mark('3', 'end', '2026-09-25T11:50:00.000Z');
    expect(byAgent(report(['--change', 'demo', '--round', '2']))).toEqual({
      'orchestrator r2': 20, // b_in only; b_after (11:45) is inside round 3
      'worker r2': 4,
      'validator r2': 6,
    });
    expect(byAgent(report(['--change', 'demo', '--round', '3']))).toEqual({
      'orchestrator r3': 30000,
    });
  });

  it('Scenario: Orchestrator usage is attributed to its round — the latest round without an end mark still counts (mid-round report)', () => {
    const closed2open3 = {
      '2': { start: '2026-09-25T10:00:00.000Z', end: '2026-09-25T10:30:00.000Z' },
      '3': { start: '2026-09-25T11:00:00.000Z' },
    };
    expect(roundAt(closed2open3, '2026-09-25T10:45:00Z')).toBeUndefined();
    expect(roundAt(closed2open3, '2026-09-26T09:00:00Z')).toBe('3');

    const { report, mark } = splitChange();
    mark('1', 'start', '2026-09-24T10:00:00.000Z');
    mark('1', 'end', '2026-09-24T10:30:00.000Z');
    mark('2', 'start', '2026-09-25T11:00:00.000Z'); // round 2 in progress
    const r2 = report(['--change', 'demo', '--round', '2']);
    // b_in + b_after; sess-c's later chat is not an orchestrating session and stays out.
    expect(byAgent(r2)).toEqual({ 'orchestrator r2': 30020, 'worker r2': 4, 'validator r2': 6 });
    expect(r2.sessions).toEqual(['sess-b']);
  });

  it('--mark validates its arguments and needs a start before an end', () => {
    const { root, cli } = splitChange();
    const noStart = cli(['--mark', 'demo', '1', 'end'], '2026-09-24T10:00:00Z');
    expect(noStart.code).toBe(2);
    expect(noStart.err).toContain('round 1 of demo has no start mark');
    const missing = cli(['--mark', 'ghost', '1', 'start'], '2026-09-24T10:00:00Z');
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('no such change');
    expect(cli(['--mark', 'demo', '1', 'middle']).code).toBe(2);
    expect(cli(['--mark', '../demo', '1', 'start']).code).toBe(2);
    expect(cli(['--mark', 'demo', '1']).code).toBe(2);

    expect(cli(['--mark', 'demo', '1', 'start'], '2026-09-24T10:00:00Z').code).toBe(0);
    const early = cli(['--mark', 'demo', '1', 'end'], '2026-09-24T09:00:00Z');
    expect(early.code).toBe(2);
    expect(early.err).toContain('before the start');
    const ok = cli(['--mark', 'demo', '1', 'end'], '2026-09-24T10:30:00Z');
    expect(ok.out).toBe(
      `Marked demo round 1 end at 2026-09-24T10:30:00.000Z (${join(root, 'openspec/changes/demo/reviews/.marks.json')})`,
    );
    // Re-starting a round reopens its window.
    cli(['--mark', 'demo', '1', 'start'], '2026-09-24T11:00:00Z');
    const text = readFileSync(join(root, 'openspec/changes/demo/reviews/.marks.json'), 'utf8');
    expect(JSON.parse(text)).toEqual({ rounds: { '1': { start: '2026-09-24T11:00:00.000Z' } } });
  });
});
