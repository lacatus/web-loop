/**
 * `pnpm tokens` — token usage per agent and model from Claude Code session transcripts.
 *
 * Transcripts: ~/.claude/projects/<mangled cwd>/<session>.jsonl (main conversation) and
 * <session>/subagents/agent-<id>.jsonl (+ agent-<id>.meta.json with the agent type).
 * Streaming writes the same `message.id` several times; the last record wins.
 * Dollars are list-price estimates only (subscription plans are not billed per token).
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { type Io, markdownTable, textTable } from './io';
import pricingJson from '../pricing.json' with { type: 'json' };

// ---------- pricing ----------

export const pricingSchema = z.object({
  source: z.string().min(1),
  asOf: z.string().min(1),
  cacheWriteMultiplier: z.number().positive(),
  cacheWrite1hMultiplier: z.number().positive(),
  cacheReadMultiplier: z.number().positive(),
  models: z.record(z.string(), z.object({ input: z.number(), output: z.number() })),
});
export type Pricing = z.infer<typeof pricingSchema>;
export const DEFAULT_PRICING: Pricing = pricingSchema.parse(pricingJson);

// ---------- usage ----------

export interface Usage {
  requests: number;
  input: number;
  output: number;
  /** All cache-creation tokens (5m + 1h). */
  cacheWrite: number;
  /** The part of cacheWrite written with a 1h TTL (priced higher). */
  cacheWrite1h: number;
  cacheRead: number;
}

const emptyUsage = (): Usage => ({
  requests: 0,
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
});

function addUsage(a: Usage, b: Usage): Usage {
  return {
    requests: a.requests + b.requests,
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

/** Cache reads as a share of all prompt tokens (input + cache write + cache read). */
export function cacheHitPercent(u: Usage): number | undefined {
  const prompt = u.input + u.cacheWrite + u.cacheRead;
  return prompt > 0 ? (u.cacheRead / prompt) * 100 : undefined;
}

/** Resolves a model id to its pricing entry: exact id, or the id without a `-YYYYMMDD` suffix. */
export function priceFor(model: string, pricing: Pricing) {
  return pricing.models[model] ?? pricing.models[model.replace(/-\d{8}$/, '')];
}

/** List-price estimate in USD, or undefined when the model is not in the pricing table. */
export function estimateUsd(model: string, u: Usage, pricing: Pricing): number | undefined {
  const p = priceFor(model, pricing);
  if (!p) return undefined;
  const cacheWrite5m = u.cacheWrite - u.cacheWrite1h;
  return (
    (u.input * p.input +
      u.output * p.output +
      cacheWrite5m * p.input * pricing.cacheWriteMultiplier +
      u.cacheWrite1h * p.input * pricing.cacheWrite1hMultiplier +
      u.cacheRead * p.input * pricing.cacheReadMultiplier) /
    1_000_000
  );
}

// ---------- transcripts ----------

/** Claude Code's project directory name for a cwd: every non-alphanumeric character becomes `-`. */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function defaultProjectsDir(home = homedir(), env = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'projects');
}

interface Response {
  agentKey: string;
  model: string;
  usage: Usage;
}

interface AgentInfo {
  key: string;
  label: string;
  agentType?: string;
  change?: string;
  round?: string;
  firstSeen: string;
  isMain: boolean;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function usageFrom(raw: Record<string, unknown>): Usage {
  const creation = obj(raw.cache_creation);
  return {
    requests: 1,
    input: num(raw.input_tokens),
    output: num(raw.output_tokens),
    cacheWrite: num(raw.cache_creation_input_tokens),
    cacheWrite1h: num(creation?.ephemeral_1h_input_tokens),
    cacheRead: num(raw.cache_read_input_tokens),
  };
}

function promptText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof obj(c)?.text === 'string' ? String(obj(c)?.text) : ''))
      .join('\n');
  }
  return '';
}

interface ParsedFile {
  responses: Map<string, Response>;
  firstPrompt?: string;
  attributionAgent?: string;
  firstSeen: string;
}

/** Parses one transcript. Unknown records and malformed lines are ignored. */
export function parseTranscript(text: string, agentKey: string): ParsedFile {
  const responses = new Map<string, Response>();
  let firstPrompt: string | undefined;
  let attributionAgent: string | undefined;
  let firstSeen = '';
  let anon = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record: Record<string, unknown> | undefined;
    try {
      record = obj(JSON.parse(line));
    } catch {
      continue;
    }
    if (!record) continue;
    if (!firstSeen && typeof record.timestamp === 'string') firstSeen = record.timestamp;
    const message = obj(record.message);
    if (record.type === 'user' && firstPrompt === undefined && message && !record.isMeta) {
      const t = promptText(message.content);
      if (t.trim()) firstPrompt = t;
    }
    if (record.type !== 'assistant' || !message) continue;
    if (typeof record.attributionAgent === 'string') attributionAgent ??= record.attributionAgent;
    const usage = obj(message.usage);
    const model = typeof message.model === 'string' ? message.model : undefined;
    if (!usage || !model || model === '<synthetic>') continue;
    // Old transcripts kept subagent records in the main file as sidechains.
    const key =
      record.isSidechain === true && typeof record.agentId === 'string' && agentKey === 'main'
        ? record.agentId
        : agentKey;
    const id =
      (typeof message.id === 'string' && message.id) ||
      (typeof record.requestId === 'string' && record.requestId) ||
      `anon-${agentKey}-${anon++}`;
    responses.set(id, { agentKey: key, model, usage: usageFrom(usage) }); // last record wins
  }
  return { responses, firstPrompt, attributionAgent, firstSeen };
}

export function parseRoundPrompt(prompt: string | undefined): { change?: string; round?: string } {
  if (!prompt) return {};
  const change = /(?:^|\s)change=([^\s,]+)/m.exec(prompt)?.[1];
  const round = /(?:^|\s)round=([^\s,]+)/m.exec(prompt)?.[1];
  return { change, round };
}

export interface SessionFile {
  sessionId: string;
  path: string;
  mtimeMs: number;
}

export function listSessions(dir: string): SessionFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const path = join(dir, f);
      return { sessionId: basename(f, '.jsonl'), path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// ---------- report ----------

export interface ReportRow {
  agent: string;
  model: string;
  usage: Usage;
  cacheHitPercent?: number;
  /** undefined = unpriced */
  listPriceUsd?: number;
}

export interface TokenReport {
  dir: string;
  sessions: string[];
  rows: ReportRow[];
  total: Usage & { cacheHitPercent?: number; listPriceUsd: number; unpricedModels: string[] };
  pricing: { source: string; asOf: string };
}

export interface ReportOptions {
  dir: string;
  session?: string;
  /** Only subagents whose prompt says `change=<id>`. */
  change?: string;
  /** Only subagents whose prompt says `round=<n>`. */
  round?: string;
  pricing?: Pricing;
}

/** Builds the report, or returns undefined when no usage is found. */
export function buildReport(options: ReportOptions): TokenReport | undefined {
  const pricing = options.pricing ?? DEFAULT_PRICING;
  const sessions = listSessions(options.dir);
  const selected = options.session
    ? sessions.filter((s) => s.sessionId === options.session)
    : sessions.slice(0, 1);
  const session = selected[0];
  if (!session) return undefined;

  const agents = new Map<string, AgentInfo>();
  const responses = new Map<string, Response>();
  const main = parseTranscript(readFileSync(session.path, 'utf8'), 'main');
  agents.set('main', { key: 'main', label: 'main', firstSeen: '', isMain: true });
  for (const [id, r] of main.responses) responses.set(id, r);

  const subDir = join(options.dir, session.sessionId, 'subagents');
  const subFiles = existsSync(subDir)
    ? readdirSync(subDir).filter((f) => /^agent-.+\.jsonl$/.test(f))
    : [];
  for (const f of subFiles) {
    const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const parsed = parseTranscript(readFileSync(join(subDir, f), 'utf8'), id);
    const metaPath = join(subDir, `agent-${id}.meta.json`);
    let agentType: string | undefined;
    if (existsSync(metaPath)) {
      try {
        const meta = obj(JSON.parse(readFileSync(metaPath, 'utf8')));
        if (typeof meta?.agentType === 'string') agentType = meta.agentType;
      } catch {
        // tolerate malformed metadata
      }
    }
    agentType ??= parsed.attributionAgent;
    const { change, round } = parseRoundPrompt(parsed.firstPrompt);
    const base = agentType ?? `agent-${id}`;
    agents.set(id, {
      key: id,
      label: round ? `${base} r${round}` : base,
      agentType,
      change,
      round,
      firstSeen: parsed.firstSeen,
      isMain: false,
    });
    for (const [rid, r] of parsed.responses) responses.set(rid, r);
  }

  // A session that built several changes would merge e.g. two "worker r1" rows: qualify them.
  const changes = new Set([...agents.values()].map((a) => a.change).filter(Boolean));
  if (changes.size > 1) {
    for (const a of agents.values()) {
      if (a.change && a.round) a.label = `${a.label} (${a.change})`;
    }
  }

  const filtered = options.change !== undefined || options.round !== undefined;
  const include = (a: AgentInfo | undefined): a is AgentInfo =>
    !!a &&
    (!filtered ||
      (!a.isMain &&
        (options.change === undefined || a.change === options.change) &&
        (options.round === undefined || a.round === options.round)));

  // Aggregate per (label, model); keep main first, then agents in the order they started.
  const groups = new Map<string, { info: AgentInfo; model: string; usage: Usage }>();
  for (const r of responses.values()) {
    const info = agents.get(r.agentKey) ?? {
      key: r.agentKey,
      label: `agent-${r.agentKey}`,
      firstSeen: '',
      isMain: false,
    };
    if (!include(info)) continue;
    const k = `${info.label}\u0000${r.model}`;
    const g = groups.get(k) ?? { info, model: r.model, usage: emptyUsage() };
    g.usage = addUsage(g.usage, r.usage);
    if (info.firstSeen && (!g.info.firstSeen || info.firstSeen < g.info.firstSeen)) g.info = info;
    groups.set(k, g);
  }
  if (groups.size === 0) return undefined;

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.info.isMain !== b.info.isMain) return a.info.isMain ? -1 : 1;
    return (
      a.info.firstSeen.localeCompare(b.info.firstSeen) ||
      a.info.label.localeCompare(b.info.label) ||
      a.model.localeCompare(b.model)
    );
  });
  const rows: ReportRow[] = ordered.map((g) => ({
    agent: g.info.label,
    model: g.model,
    usage: g.usage,
    cacheHitPercent: cacheHitPercent(g.usage),
    listPriceUsd: estimateUsd(g.model, g.usage, pricing),
  }));
  const totalUsage = rows.reduce((acc, r) => addUsage(acc, r.usage), emptyUsage());
  const unpricedModels = [
    ...new Set(rows.filter((r) => r.listPriceUsd === undefined).map((r) => r.model)),
  ];
  return {
    dir: options.dir,
    sessions: selected.map((s) => s.sessionId),
    rows,
    total: {
      ...totalUsage,
      cacheHitPercent: cacheHitPercent(totalUsage),
      listPriceUsd: rows.reduce((acc, r) => acc + (r.listPriceUsd ?? 0), 0),
      unpricedModels,
    },
    pricing: { source: pricing.source, asOf: pricing.asOf },
  };
}

// ---------- rendering ----------

export const REPORT_HEADER = [
  'Agent',
  'Model',
  'Requests',
  'Input',
  'Output',
  'Cache write',
  'Cache read',
  'Cache hit',
  'list-price est.',
];

export function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

const pct = (p: number | undefined) => (p === undefined ? '-' : `${Math.round(p)}%`);
const usd = (v: number | undefined) => (v === undefined ? 'unpriced' : `~$${v.toFixed(2)}`);

function usageCells(u: Usage, hit: number | undefined): string[] {
  return [
    String(u.requests),
    formatTokens(u.input),
    formatTokens(u.output),
    formatTokens(u.cacheWrite),
    formatTokens(u.cacheRead),
    pct(hit),
  ];
}

function reportRows(report: TokenReport, boldTotal: boolean): string[][] {
  const rows = report.rows.map((r) => [
    r.agent,
    r.model,
    ...usageCells(r.usage, r.cacheHitPercent),
    usd(r.listPriceUsd),
  ]);
  const t = report.total;
  const totalPrice = usd(t.listPriceUsd) + (t.unpricedModels.length ? ' (excl. unpriced)' : '');
  const label = boldTotal ? '**Total**' : 'Total';
  rows.push([label, '', ...usageCells(t, t.cacheHitPercent), totalPrice]);
  return rows;
}

function footnote(report: TokenReport): string {
  return (
    `list-price est. = Anthropic API list prices (${report.pricing.source}, as of ` +
    `${report.pricing.asOf}); an estimate only — subscription plans are not billed per token.`
  );
}

export function renderText(report: TokenReport): string {
  return [
    `Token usage — session ${report.sessions.join(', ')}`,
    '',
    ...textTable(REPORT_HEADER, reportRows(report, false)),
    '',
    footnote(report),
  ].join('\n');
}

/** The "Tokens" section appended to each round's review record and to the final report. */
export function renderMarkdown(report: TokenReport, heading = '## Tokens'): string {
  return [
    heading,
    '',
    ...markdownTable(REPORT_HEADER, reportRows(report, true)),
    '',
    `_Session \`${report.sessions.join(', ')}\`. ${footnote(report)}_`,
  ].join('\n');
}

export function renderJson(report: TokenReport): string {
  return JSON.stringify(report, null, 2);
}

/** Appends a markdown section to a file so that the file ends with it. */
export function appendSection(path: string, section: string): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const sep =
    existing === '' ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(path, `${sep}${section}\n`);
}

// ---------- CLI ----------

export interface TokensCliEnv {
  cwd: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export const TOKENS_USAGE =
  'usage: pnpm tokens [--latest | --session <id>] [--dir <transcripts dir>] ' +
  '[--change <id>] [--round <n>] [--format text|md|json] [--append <file>]';

export function tokensCli(argv: string[], ctx: TokensCliEnv, io: Io): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        latest: { type: 'boolean' },
        session: { type: 'string' },
        dir: { type: 'string' },
        change: { type: 'string' },
        round: { type: 'string' },
        format: { type: 'string', default: 'text' },
        append: { type: 'string' },
        help: { type: 'boolean' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    io.err(`${(error as Error).message}\n${TOKENS_USAGE}`);
    return 2;
  }
  if (values.help) {
    io.out(TOKENS_USAGE);
    return 0;
  }
  const format = values.format ?? 'text';
  if (!['text', 'md', 'json'].includes(format) || (values.latest && values.session)) {
    io.err(TOKENS_USAGE);
    return 2;
  }
  const dir = values.dir ?? join(defaultProjectsDir(ctx.home, ctx.env), projectDirName(ctx.cwd));
  const report = buildReport({
    dir,
    session: values.session,
    change: values.change,
    round: values.round,
  });
  if (!report) {
    const scope = [
      values.session ? `session ${values.session}` : 'latest session',
      values.change ? `change ${values.change}` : '',
      values.round ? `round ${values.round}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const msg = `No usage found (${scope}) in ${dir}`;
    if (values.append) appendSection(values.append, `## Tokens\n\n_${msg}._`);
    io.out(msg);
    return 0;
  }
  const rendered =
    format === 'json'
      ? renderJson(report)
      : format === 'md'
        ? renderMarkdown(report)
        : renderText(report);
  // --append always writes the markdown section (the round record); stdout gets --format.
  if (values.append) appendSection(values.append, renderMarkdown(report));
  io.out(rendered);
  return 0;
}
