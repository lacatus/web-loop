import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, memoryIo } from '../src/io';
import { normalizeFindingTitle, parseFindings, routeCli } from '../src/route';

/** A throwaway repo root with this repo's real policy and one change `demo`. */
function repoWithChange(design: string, reviews: Record<number, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'loop-route-'));
  mkdirSync(join(root, '.claude'), { recursive: true });
  cpSync(join(REPO_ROOT, '.claude/loop-policy.json'), join(root, '.claude/loop-policy.json'));
  const change = join(root, 'openspec/changes/demo');
  mkdirSync(join(change, 'reviews'), { recursive: true });
  writeFileSync(join(change, 'design.md'), design);
  for (const [round, text] of Object.entries(reviews)) {
    writeFileSync(join(change, 'reviews', `round-${round}.md`), text);
  }
  return root;
}

function route(root: string, round: number) {
  const io = memoryIo();
  const code = routeCli(root, ['--change', 'demo', '--round', String(round)], io);
  return { code, lines: io.stdout, err: io.stderr.join('\n') };
}

const review = (findings: string) =>
  `VERDICT: REQUEST_CHANGES\n\n## Review — demo\n### Findings\n${findings}\n### Previous findings (round > 1)\n`;

const PLAIN_DESIGN =
  '# Design\n\ncomplexity: medium\n\n## Decisions\n- Something highly specific.\n';

describe('pnpm loop:route', () => {
  it('Scenario: No escalation by default — round 1 of a change without complexity: high prints sonnet, "policy default"', () => {
    const { code, lines } = route(repoWithChange(PLAIN_DESIGN), 1);
    expect(code).toBe(0);
    expect(lines).toEqual(['sonnet', 'reason: policy default']);
  });

  it('Scenario: Escalate a complex change — design.md with complexity: high prints opus for every round', () => {
    const root = repoWithChange('# Design\n\ncomplexity: high\n\n## Context\n');
    for (const round of [1, 2, 3]) {
      expect(route(root, round).lines).toEqual([
        'opus',
        'reason: design declares complexity: high',
      ]);
    }
    // Markdown emphasis around the declaration still counts.
    expect(route(repoWithChange('**Complexity:** High\n'), 1).lines[0]).toBe('opus');
  });

  it('Scenario: Escalate on a repeated blocking finding — same blocking title in rounds 1 and 2 → opus for round 3, naming it', () => {
    const root = repoWithChange(PLAIN_DESIGN, {
      1: review(
        '#### F1 [blocking] Half-entered due date is silently dropped\n- Where: x\n#### F2 [nit] Naming\n',
      ),
      2: review(
        '#### F4 [blocking]   half-entered   DUE date is silently dropped\n- still open\n#### F5 [blocking] New bug\n',
      ),
    });
    const { code, lines } = route(root, 3);
    expect(code).toBe(0);
    expect(lines[0]).toBe('opus');
    expect(lines[1]).toContain('Half-entered due date is silently dropped');
    expect(lines[1]).toContain('rounds 1 and 2');
    // Round 2 only has one previous review: no repeat possible yet.
    expect(route(root, 2).lines[0]).toBe('sonnet');
  });

  it('Scenario: Resolved finding does not escalate — blocking in round 1 but not blocking in round 2 → default for round 3', () => {
    const root = repoWithChange(PLAIN_DESIGN, {
      1: review('#### F1 [blocking] Missing scenario test\n#### F2 [blocking] Wrong status code\n'),
      // F1 fixed; the same title now only appears as a nit; F2 resolved entirely.
      2: review('#### F3 [nit] Missing scenario test\n#### F4 [blocking] Something else\n'),
    });
    expect(route(root, 3).lines).toEqual(['sonnet', 'reason: policy default']);
  });

  it('normalizes finding titles and ignores non-finding headings', () => {
    expect(normalizeFindingTitle('F12:  Foo   BAR ')).toBe('foo bar');
    const findings = parseFindings(
      '### Findings\n#### F1 [blocking] A\n#### F2 [spec-gap] B\n#### Not a finding\n',
    );
    expect(findings.map((f) => [f.severity, f.key])).toEqual([
      ['blocking', 'a'],
      ['spec-gap', 'b'],
    ]);
  });

  it('prints usage for bad arguments and an error for an unknown change', () => {
    const io = memoryIo();
    expect(routeCli(REPO_ROOT, ['--change', 'x'], io)).toBe(2);
    expect(io.stderr.join('\n')).toContain('usage: pnpm loop:route');
    const io2 = memoryIo();
    expect(routeCli(REPO_ROOT, ['--change', 'nope-not-here', '--round', '1'], io2)).toBe(1);
    expect(io2.stderr.join('\n')).toContain('change not found');
  });
});
