/**
 * `pnpm loop:route --change <id> --round <n>` — which model the worker runs on this round, and why.
 * First output line is the model (what the orchestrator passes as the Agent tool's `model`),
 * second line is `reason: …`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from './io';
import { type LoopPolicy, loadPolicy } from './policy';

export interface RouteDecision {
  model: string;
  reason: string;
}

export interface Finding {
  severity: 'blocking' | 'spec-gap' | 'nit';
  title: string;
  key: string;
}

/** Normalizes a finding title: case, whitespace and a leading finding number (`F3`, `F3:`) ignored. */
export function normalizeFindingTitle(title: string): string {
  return title
    .replace(/^\s*F\d+\s*[:.)-]?\s*/i, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts findings from review markdown headings like `#### F2 [blocking] Title`. */
export function parseFindings(markdown: string): Finding[] {
  const findings: Finding[] = [];
  const heading = /^#{2,6}\s+(F\d+\s*[:.)-]?\s*)?\[(blocking|spec-gap|nit)\]\s*(.+?)\s*$/gim;
  for (const m of markdown.matchAll(heading)) {
    const title = `${m[1] ?? ''}${m[3] ?? ''}`.trim();
    findings.push({
      severity: (m[2] ?? '').toLowerCase() as Finding['severity'],
      title: (m[3] ?? '').trim(),
      key: normalizeFindingTitle(title),
    });
  }
  return findings;
}

function declaresHighComplexity(designText: string, marker: string): boolean {
  const [key = '', value = ''] = marker.split(':').map((s) => s.trim());
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Line-level declaration, tolerating markdown emphasis/list markers: `complexity: high`, `**complexity:** high`
  const re = new RegExp(
    `^[\\s>*_-]*${escape(key)}[*_]*\\s*:[*_]*\\s*[*_]*${escape(value)}\\b`,
    'im',
  );
  return re.test(designText);
}

export function routeWorker(
  root: string,
  change: string,
  round: number,
  policy: LoopPolicy = loadPolicy(root),
): RouteDecision {
  const { escalation } = policy;
  const defaultModel = policy.agents[escalation.agent]?.model;
  if (!defaultModel) {
    throw new Error(`escalation.agent "${escalation.agent}" is not declared in the policy`);
  }
  const changeDir = join(root, 'openspec/changes', change);
  if (!existsSync(changeDir)) throw new Error(`change not found: openspec/changes/${change}`);

  const designPath = join(changeDir, 'design.md');
  if (
    existsSync(designPath) &&
    declaresHighComplexity(readFileSync(designPath, 'utf8'), escalation.complexityMarker)
  ) {
    return { model: escalation.model, reason: `design declares ${escalation.complexityMarker}` };
  }

  const n = escalation.repeatedBlockingRounds;
  if (round > n) {
    const rounds = Array.from({ length: n }, (_, i) => round - n + i);
    const blockingPerRound = rounds.map((r) => {
      const path = join(changeDir, 'reviews', `round-${r}.md`);
      const findings = existsSync(path) ? parseFindings(readFileSync(path, 'utf8')) : [];
      return findings.filter((f) => f.severity === 'blocking');
    });
    const [first = [], ...rest] = blockingPerRound;
    const repeated = first.find((f) => rest.every((fs) => fs.some((g) => g.key === f.key)));
    if (repeated) {
      return {
        model: escalation.model,
        reason: `blocking finding repeated in rounds ${rounds.join(' and ')}: "${repeated.title}"`,
      };
    }
  }

  return { model: defaultModel, reason: 'policy default' };
}

export function routeCli(root: string, argv: string[], io: Io): number {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const change = flag('--change');
  const round = Number(flag('--round'));
  if (!change || !Number.isInteger(round) || round < 1) {
    io.err('usage: pnpm loop:route --change <id> --round <n> [--json]');
    return 2;
  }
  let decision: RouteDecision;
  try {
    decision = routeWorker(root, change, round);
  } catch (error) {
    io.err(`loop:route: ${(error as Error).message}`);
    return 1;
  }
  if (argv.includes('--json')) io.out(JSON.stringify(decision));
  else {
    io.out(decision.model);
    io.out(`reason: ${decision.reason}`);
  }
  return 0;
}
