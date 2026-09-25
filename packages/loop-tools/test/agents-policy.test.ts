import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ROUTING_HEADER, canReachMcpServer, checkAgentsCli } from '../src/agents-policy';
import { REPO_ROOT, memoryIo } from '../src/io';

/** A throwaway repo root holding a copy of this repo's real agents, policy and settings. */
function copyOfRepoConfig(): string {
  const root = mkdtempSync(join(tmpdir(), 'loop-agents-'));
  mkdirSync(join(root, '.claude'), { recursive: true });
  cpSync(join(REPO_ROOT, '.claude/agents'), join(root, '.claude/agents'), { recursive: true });
  for (const f of ['.claude/loop-policy.json', '.claude/settings.json', '.mcp.json']) {
    cpSync(join(REPO_ROOT, f), join(root, f));
  }
  return root;
}

function editAgent(root: string, name: string, edit: (text: string) => string) {
  const path = join(root, '.claude/agents', `${name}.md`);
  const before = readFileSync(path, 'utf8');
  const after = edit(before);
  expect(after).not.toBe(before); // the edit must actually apply
  writeFileSync(path, after);
}

function check(root: string) {
  const io = memoryIo();
  const code = checkAgentsCli(root, io);
  return { code, out: io.stdout.join('\n'), err: io.stderr.join('\n') };
}

describe('pnpm check:agents', () => {
  let root: string;
  beforeEach(() => {
    root = copyOfRepoConfig();
  });

  it('Scenario: Policy-compliant agents pass — exits 0 and prints a routing table with one row per agent', () => {
    for (const r of [REPO_ROOT, root]) {
      const { code, out, err } = check(r);
      expect(err).toBe('');
      expect(code).toBe(0);
      const lines = out.split('\n');
      const header = lines.findIndex((l) => /^Agent\s{2,}Model/.test(l));
      expect(lines[header]?.trim().split(/\s{2,}/)).toEqual(ROUTING_HEADER);
      const rows = lines
        .slice(header + 2)
        .filter((l) => l.trim() && !l.startsWith('✓'))
        .map((l) => l.trim().split(/\s{2,}/));
      expect(rows).toEqual([
        ['browser-qa', 'sonnet', 'medium', '40', '1h', 'playwright'],
        ['validator', 'opus', 'high', '40', '1h', 'none'],
        ['worker', 'sonnet', 'high', '80', '5m', 'none'],
      ]);
    }
  });

  it('Scenario: Agent without a model is rejected — exits non-zero naming the agent and the missing setting', () => {
    editAgent(root, 'worker', (t) => t.replace(/^model: .*\n/m, ''));
    const { code, err } = check(root);
    expect(code).not.toBe(0);
    expect(err).toContain('worker: missing setting "model"');
  });

  it('rejects other missing settings and values outside the allowed set', () => {
    editAgent(root, 'browser-qa', (t) => t.replace(/^experimental:\n\s+cacheTtl: 1h\n/m, ''));
    editAgent(root, 'worker', (t) => t.replace('effort: high', 'effort: turbo'));
    editAgent(root, 'validator', (t) => t.replace('model: opus', 'model: gpt-9'));
    const { code, err } = check(root);
    expect(code).not.toBe(0);
    expect(err).toContain('browser-qa: missing setting "experimental.cacheTtl"');
    expect(err).toContain('worker: invalid effort "turbo"');
    expect(err).toContain('validator: invalid model "gpt-9"');
  });

  it('Scenario: Agent drifts from the policy — exits non-zero showing the expected and actual values', () => {
    editAgent(root, 'validator', (t) => t.replace('model: opus', 'model: sonnet'));
    editAgent(root, 'worker', (t) => t.replace('effort: high', 'effort: low'));
    editAgent(root, 'browser-qa', (t) => t.replace('maxTurns: 40', 'maxTurns: 400'));
    const { code, err } = check(root);
    expect(code).not.toBe(0);
    expect(err).toContain('validator: model expected "opus", actual "sonnet"');
    expect(err).toContain('worker: effort expected "high", actual "low"');
    expect(err).toContain('browser-qa: maxTurns expected 40, actual 400');
  });

  it('flags agents missing from the policy, policy agents without a file, and the subagent default', () => {
    writeFileSync(
      join(root, '.claude/agents/rogue.md'),
      '---\nname: rogue\nmodel: inherit\ntools: Read\n---\nHi',
    );
    const policyPath = join(root, '.claude/loop-policy.json');
    const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
      agents: Record<string, unknown>;
    };
    policy.agents.planner = { ...(policy.agents.worker as object) };
    writeFileSync(policyPath, JSON.stringify(policy));
    const settingsPath = join(root, '.claude/settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    delete settings.env.CLAUDE_CODE_SUBAGENT_MODEL;
    writeFileSync(settingsPath, JSON.stringify(settings));

    const { code, err } = check(root);
    expect(code).not.toBe(0);
    expect(err).toContain('rogue: not declared in .claude/loop-policy.json');
    expect(err).toContain(
      'planner: declared in .claude/loop-policy.json but .claude/agents/planner.md is missing',
    );
    expect(err).toContain('env.CLAUDE_CODE_SUBAGENT_MODEL expected "sonnet", actual <missing>');
  });

  it('Scenario: Browser tools are limited to browser QA — only browser-qa may reach Playwright MCP; others that can are violations', () => {
    // As shipped: only browser-qa can reach the playwright server.
    const { out } = check(root);
    const mcpColumn = (agent: string) =>
      out
        .split('\n')
        .find((l) => l.startsWith(`${agent} `))
        ?.trim()
        .split(/\s{2,}/)
        .at(-1);
    expect(mcpColumn('browser-qa')).toBe('playwright');
    expect(mcpColumn('validator')).toBe('none');
    expect(mcpColumn('worker')).toBe('none');

    // The validator without the explicit deny inherits every tool, Playwright included.
    editAgent(root, 'validator', (t) => t.replace(', mcp__playwright', ''));
    // The worker's tool allowlist gains a Playwright tool.
    editAgent(root, 'worker', (t) =>
      t.replace('tools: Read,', 'tools: mcp__playwright__browser_click, Read,'),
    );
    const { code, err } = check(root);
    expect(code).not.toBe(0);
    expect(err).toContain('validator: can reach MCP server "playwright" but the policy denies it');
    expect(err).toContain('worker: can reach MCP server "playwright" but the policy denies it');
    expect(err).not.toContain('browser-qa:');
  });

  it('reports browser-qa when it is cut off from the MCP server the policy gives it', () => {
    editAgent(root, 'browser-qa', (t) =>
      t.replace('disallowedTools: Edit,', 'disallowedTools: mcp__playwright, Edit,'),
    );
    const { code, err } = check(root);
    expect(code).not.toBe(0);
    expect(err).toContain(
      'browser-qa: policy allows MCP server "playwright" but the agent cannot reach it',
    );
  });

  it('resolves MCP reachability from tools / disallowedTools / mcpServers', () => {
    expect(canReachMcpServer({}, 'playwright')).toBe(true);
    expect(canReachMcpServer({ tools: 'Read, Bash' }, 'playwright')).toBe(false);
    expect(canReachMcpServer({ tools: ['Read', 'mcp__playwright'] }, 'playwright')).toBe(true);
    expect(canReachMcpServer({ disallowedTools: 'mcp__playwright__*' }, 'playwright')).toBe(false);
    // Denying a single tool still leaves the rest of the server reachable.
    expect(
      canReachMcpServer({ disallowedTools: 'mcp__playwright__browser_click' }, 'playwright'),
    ).toBe(true);
    expect(canReachMcpServer({ tools: 'Read', mcpServers: ['playwright'] }, 'playwright')).toBe(
      true,
    );
  });
});
