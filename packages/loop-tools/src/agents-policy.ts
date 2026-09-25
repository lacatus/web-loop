/**
 * `pnpm check:agents` — verifies every agent in `.claude/agents/` matches `.claude/loop-policy.json`
 * (model, effort, maxTurns, cache TTL, MCP access) and that ad-hoc subagents default to the policy model.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { type Io, textTable } from './io';
import {
  type LoopPolicy,
  POLICY_PATH,
  isValidCacheTtl,
  isValidEffort,
  isValidModel,
  loadPolicy,
} from './policy';

export const AGENTS_DIR = '.claude/agents';
export const SETTINGS_PATH = '.claude/settings.json';
export const MCP_CONFIG_PATH = '.mcp.json';

export interface AgentDefinition {
  name: string;
  file: string;
  frontmatter: Record<string, unknown>;
}

export interface AgentsCheckResult {
  rows: string[][];
  violations: string[];
}

export const ROUTING_HEADER = ['Agent', 'Model', 'Effort', 'maxTurns', 'Cache TTL', 'MCP servers'];

/** Parses the YAML frontmatter block at the top of an agent markdown file. */
export function parseFrontmatter(text: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return {};
  const parsed: unknown = parseYaml(match[1] ?? '');
  return isRecord(parsed) ? parsed : {};
}

export function readAgents(root: string): AgentDefinition[] {
  const dir = join(root, AGENTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const frontmatter = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
      const name = typeof frontmatter.name === 'string' ? frontmatter.name : basename(f, '.md');
      return { name, file: join(AGENTS_DIR, f), frontmatter };
    });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Tool lists may be a comma-separated string or a YAML list. */
function toolList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim());
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Server names from `mcpServers`, which may list names or inline `{ name: config }` entries. */
function mcpServerNames(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap((e) => (isRecord(e) ? Object.keys(e) : [String(e)]));
  if (isRecord(v)) return Object.keys(v);
  return [];
}

/** Whether an agent definition can call tools of the given MCP server. */
export function canReachMcpServer(fm: Record<string, unknown>, server: string): boolean {
  const prefix = `mcp__${server}`;
  const wholeServer = (t: string) => t === prefix || t === `${prefix}__*` || t === `${prefix}*`;
  if ((toolList(fm.disallowedTools) ?? []).some(wholeServer)) return false;
  if (mcpServerNames(fm.mcpServers).includes(server)) return true;
  const tools = toolList(fm.tools);
  if (tools === undefined) return true; // no allowlist → inherits every tool, MCP included
  return tools.some((t) => t === '*' || t === prefix || t.startsWith(`${prefix}__`));
}

function knownMcpServers(root: string, policy: LoopPolicy): string[] {
  const servers = new Set(Object.values(policy.agents).flatMap((a) => a.mcpServers));
  const mcpPath = join(root, MCP_CONFIG_PATH);
  if (existsSync(mcpPath)) {
    const cfg: unknown = JSON.parse(readFileSync(mcpPath, 'utf8'));
    if (isRecord(cfg) && isRecord(cfg.mcpServers)) {
      for (const name of Object.keys(cfg.mcpServers)) servers.add(name);
    }
  }
  return [...servers].sort();
}

const show = (v: unknown) => (v === undefined ? '<missing>' : JSON.stringify(v));

export function checkAgents(root: string): AgentsCheckResult {
  const policy = loadPolicy(root);
  const agents = readAgents(root);
  const servers = knownMcpServers(root, policy);
  const violations: string[] = [];
  const rows: string[][] = [];

  for (const agent of agents) {
    const fm = agent.frontmatter;
    const expected = policy.agents[agent.name];
    const experimental = isRecord(fm.experimental) ? fm.experimental : {};
    const actual = {
      model: fm.model,
      effort: fm.effort,
      maxTurns: fm.maxTurns,
      cacheTtl: experimental.cacheTtl,
    };
    const reachable = servers.filter((s) => canReachMcpServer(fm, s));
    rows.push([
      agent.name,
      String(actual.model ?? '-'),
      String(actual.effort ?? '-'),
      String(actual.maxTurns ?? '-'),
      String(actual.cacheTtl ?? '-'),
      reachable.join(', ') || 'none',
    ]);

    if (!expected) {
      violations.push(`${agent.name}: not declared in ${POLICY_PATH} (${agent.file})`);
      continue;
    }

    const settings: {
      key: keyof typeof actual;
      label: string;
      valid: (v: unknown) => boolean;
      allowed: string;
    }[] = [
      {
        key: 'model',
        label: 'model',
        valid: (v) => typeof v === 'string' && isValidModel(v),
        allowed: 'opus|sonnet|haiku|fable|inherit|claude-<id>',
      },
      {
        key: 'effort',
        label: 'effort',
        valid: (v) => typeof v === 'string' && isValidEffort(v),
        allowed: 'low|medium|high|xhigh|max',
      },
      {
        key: 'maxTurns',
        label: 'maxTurns',
        valid: (v) => typeof v === 'number' && Number.isInteger(v) && v > 0,
        allowed: 'a positive integer',
      },
      {
        key: 'cacheTtl',
        label: 'experimental.cacheTtl',
        valid: (v) => typeof v === 'string' && isValidCacheTtl(v),
        allowed: '5m|1h',
      },
    ];
    for (const s of settings) {
      const value = actual[s.key];
      if (value === undefined || value === null) {
        violations.push(
          `${agent.name}: missing setting "${s.label}" (policy: ${show(expected[s.key])})`,
        );
      } else if (!s.valid(value)) {
        violations.push(`${agent.name}: invalid ${s.label} ${show(value)} (allowed: ${s.allowed})`);
      } else if (value !== expected[s.key]) {
        violations.push(
          `${agent.name}: ${s.label} expected ${show(expected[s.key])}, actual ${show(value)}`,
        );
      }
    }

    for (const server of servers) {
      const allowed = expected.mcpServers.includes(server);
      const canReach = reachable.includes(server);
      if (canReach && !allowed) {
        violations.push(
          `${agent.name}: can reach MCP server "${server}" but the policy denies it ` +
            `(add "mcp__${server}" to disallowedTools or restrict tools)`,
        );
      } else if (!canReach && allowed) {
        violations.push(
          `${agent.name}: policy allows MCP server "${server}" but the agent cannot reach it`,
        );
      }
    }
  }

  for (const name of Object.keys(policy.agents)) {
    if (!agents.some((a) => a.name === name)) {
      violations.push(
        `${name}: declared in ${POLICY_PATH} but ${AGENTS_DIR}/${name}.md is missing`,
      );
    }
  }

  const settingsPath = join(root, SETTINGS_PATH);
  const settings: unknown = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, 'utf8'))
    : {};
  const env = isRecord(settings) && isRecord(settings.env) ? settings.env : {};
  if (env.CLAUDE_CODE_SUBAGENT_MODEL !== policy.subagentDefaultModel) {
    violations.push(
      `${SETTINGS_PATH}: env.CLAUDE_CODE_SUBAGENT_MODEL expected ` +
        `${show(policy.subagentDefaultModel)}, actual ${show(env.CLAUDE_CODE_SUBAGENT_MODEL)}`,
    );
  }

  return { rows, violations };
}

export function checkAgentsCli(root: string, io: Io): number {
  let result: AgentsCheckResult;
  try {
    result = checkAgents(root);
  } catch (error) {
    io.err(`check:agents: cannot read the policy: ${(error as Error).message}`);
    return 1;
  }
  io.out(`Agent routing (${POLICY_PATH})`);
  for (const line of textTable(ROUTING_HEADER, result.rows)) io.out(line);
  if (result.violations.length) {
    io.err(`\n${result.violations.length} agent policy violation(s):`);
    for (const v of result.violations) io.err(`  ✗ ${v}`);
    return 1;
  }
  io.out(`\n✓ ${result.rows.length} agents match the policy`);
  return 0;
}
