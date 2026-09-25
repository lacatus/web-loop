/**
 * `pnpm tokens` — token usage per agent and model from Claude Code session transcripts.
 *
 * Transcripts: ~/.claude/projects/<mangled cwd>/<session>.jsonl (main conversation) and
 * <session>/subagents/agent-<id>.jsonl (+ agent-<id>.meta.json with the agent type).
 * Streaming writes the same `message.id` several times; the last record wins.
 * Dollars are list-price estimates only (subscription plans are not billed per token).
 *
 * Orchestrator attribution: `/build-feature` records each round's start/end time with
 * `pnpm tokens --mark <change> <round> start|end` (openspec/changes/<id>/reviews/.marks.json).
 * With `--change`, main-session responses whose `timestamp` falls in a round's window are
 * reported as `orchestrator r<n>`; without `--session` every session in the project is read.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  /** Unique across sessions: `<session>:main` or `<session>:<agent id>`. */
  agentKey: string;
  /** Raw agent id (fallback label), or `main`. */
  agentId: string;
  sessionId: string;
  model: string;
  usage: Usage;
  /** ISO timestamp of the record that won the dedupe (the last one). */
  timestamp?: string;
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

export interface TranscriptSource {
  sessionId: string;
  /** Agent id of a subagent file, or `main` for the session's main conversation. */
  agentId: string;
}

export const agentKeyOf = (sessionId: string, agentId: string) => `${sessionId}:${agentId}`;

/** Parses one transcript. Unknown records and malformed lines are ignored. */
export function parseTranscript(text: string, source: TranscriptSource): ParsedFile {
  const { sessionId, agentId } = source;
  const isMain = agentId === 'main';
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
    const owner =
      record.isSidechain === true && typeof record.agentId === 'string' && isMain
        ? record.agentId
        : agentId;
    const id =
      (typeof message.id === 'string' && message.id) ||
      (typeof record.requestId === 'string' && record.requestId) ||
      `anon-${agentKeyOf(sessionId, agentId)}-${anon++}`;
    // last record wins
    responses.set(id, {
      agentKey: agentKeyOf(sessionId, owner),
      agentId: owner,
      sessionId,
      model,
      usage: usageFrom(usage),
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
    });
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

// ---------- round marks (orchestrator windows) ----------

export const MARK_KINDS = ['start', 'end'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

const isoTimestamp = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'not an ISO timestamp');
export const roundMarksSchema = z.object({
  rounds: z.record(z.string(), z.object({ start: isoTimestamp, end: isoTimestamp.optional() })),
});
export type RoundMarks = z.infer<typeof roundMarksSchema>['rounds'];

/** `openspec/changes/<change>/reviews/.marks.json` under the repository root. */
export function marksPath(root: string, change: string): string {
  return join(root, 'openspec/changes', change, 'reviews/.marks.json');
}

/** Reads a change's round marks; a missing file means no marks. Throws on a malformed file. */
export function readMarks(path: string): RoundMarks {
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = roundMarksSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  return parsed.data.rounds;
}

/**
 * Records the start or end of a round. `start` (re)opens the window and drops any old end;
 * `end` needs an earlier start. Returns the written timestamp.
 */
export function writeMark(
  root: string,
  change: string,
  round: string,
  kind: MarkKind,
  now: Date,
): { path: string; timestamp: string } {
  const changeDir = join(root, 'openspec/changes', change);
  if (!existsSync(changeDir)) throw new Error(`no such change: ${changeDir}`);
  const path = marksPath(root, change);
  const rounds = readMarks(path);
  const timestamp = now.toISOString();
  if (kind === 'start') {
    rounds[round] = { start: timestamp };
  } else {
    const window = rounds[round];
    if (!window) throw new Error(`round ${round} of ${change} has no start mark`);
    if (Date.parse(timestamp) < Date.parse(window.start)) {
      throw new Error(`end ${timestamp} is before the start ${window.start} of round ${round}`);
    }
    rounds[round] = { start: window.start, end: timestamp };
  }
  mkdirSync(join(changeDir, 'reviews'), { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(rounds).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
  );
  writeFileSync(path, `${JSON.stringify({ rounds: sorted }, null, 2)}\n`);
  return { path, timestamp };
}

/** The round whose [start, end] window (inclusive; open-ended while there is no end) holds `timestamp`. */
export function roundAt(marks: RoundMarks, timestamp: string | undefined): string | undefined {
  const t = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  if (Number.isNaN(t)) return undefined;
  for (const [round, w] of Object.entries(marks)) {
    const end = w.end === undefined ? Number.POSITIVE_INFINITY : Date.parse(w.end);
    if (t >= Date.parse(w.start) && t <= end) return round;
  }
  return undefined;
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
  /** Sessions that contributed usage to the report, oldest first. */
  sessions: string[];
  rows: ReportRow[];
  total: Usage & { cacheHitPercent?: number; listPriceUsd: number; unpricedModels: string[] };
  pricing: { source: string; asOf: string };
}

export interface ReportOptions {
  dir: string;
  session?: string;
  /** Only the most recent session, even with `change` (default with `change`: every session). */
  latest?: boolean;
  /** Only subagents whose prompt says `change=<id>`, plus orchestrator usage inside `marks`. */
  change?: string;
  /** Only subagents whose prompt says `round=<n>` (and that round's orchestrator window). */
  round?: string;
  /** The change's round windows; main-session usage inside one becomes `orchestrator r<n>`. */
  marks?: RoundMarks;
  pricing?: Pricing;
}

/** Which sessions a report reads: `--session`, else every session for `--change`, else the latest. */
export function selectSessions(sessions: SessionFile[], options: ReportOptions): SessionFile[] {
  if (options.session) return sessions.filter((s) => s.sessionId === options.session);
  if (options.change !== undefined && !options.latest) return sessions;
  return sessions.slice(0, 1);
}

function readAgentType(metaPath: string): string | undefined {
  if (!existsSync(metaPath)) return undefined;
  try {
    const meta = obj(JSON.parse(readFileSync(metaPath, 'utf8')));
    return typeof meta?.agentType === 'string' ? meta.agentType : undefined;
  } catch {
    return undefined; // tolerate malformed metadata
  }
}

/** Builds the report, or returns undefined when no usage is found. */
export function buildReport(options: ReportOptions): TokenReport | undefined {
  const pricing = options.pricing ?? DEFAULT_PRICING;
  const selected = selectSessions(listSessions(options.dir), options);
  if (selected.length === 0) return undefined;

  const agents = new Map<string, AgentInfo>();
  // Keyed by response id across all sessions: a resumed session that repeats earlier
  // responses still counts each of them once.
  const responses = new Map<string, Response>();
  // Oldest session first, so that for a repeated id the newest record wins.
  for (const session of [...selected].reverse()) {
    const main = parseTranscript(readFileSync(session.path, 'utf8'), {
      sessionId: session.sessionId,
      agentId: 'main',
    });
    const mainKey = agentKeyOf(session.sessionId, 'main');
    agents.set(mainKey, { key: mainKey, label: 'main', firstSeen: '', isMain: true });
    for (const [id, r] of main.responses) responses.set(id, r);

    const subDir = join(options.dir, session.sessionId, 'subagents');
    const subFiles = existsSync(subDir)
      ? readdirSync(subDir).filter((f) => /^agent-.+\.jsonl$/.test(f))
      : [];
    for (const f of subFiles) {
      const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
      const parsed = parseTranscript(readFileSync(join(subDir, f), 'utf8'), {
        sessionId: session.sessionId,
        agentId: id,
      });
      const agentType =
        readAgentType(join(subDir, `agent-${id}.meta.json`)) ?? parsed.attributionAgent;
      const { change, round } = parseRoundPrompt(parsed.firstPrompt);
      const base = agentType ?? `agent-${id}`;
      const key = agentKeyOf(session.sessionId, id);
      agents.set(key, {
        key,
        label: round ? `${base} r${round}` : base,
        agentType,
        change,
        round,
        firstSeen: parsed.firstSeen,
        isMain: false,
      });
      for (const [rid, r] of parsed.responses) responses.set(rid, r);
    }
  }

  const filtered = options.change !== undefined || options.round !== undefined;
  const marks = options.change !== undefined ? (options.marks ?? {}) : {};

  /** The row a response belongs to, or undefined when the filters exclude it. */
  const attribute = (r: Response): AgentInfo | undefined => {
    const info = agents.get(r.agentKey) ?? {
      key: r.agentKey,
      label: `agent-${r.agentId}`,
      firstSeen: '',
      isMain: false,
    };
    if (!filtered) return info;
    if (info.isMain) {
      const round = roundAt(marks, r.timestamp);
      if (round === undefined || (options.round !== undefined && round !== options.round)) {
        return undefined;
      }
      return {
        key: `orchestrator:${round}`,
        label: `orchestrator r${round}`,
        change: options.change,
        round,
        firstSeen: marks[round]?.start ?? '',
        isMain: false,
      };
    }
    const keep =
      (options.change === undefined || info.change === options.change) &&
      (options.round === undefined || info.round === options.round);
    return keep ? info : undefined;
  };

  const included: { r: Response; info: AgentInfo }[] = [];
  for (const r of responses.values()) {
    const info = attribute(r);
    if (info) included.push({ r, info });
  }
  if (included.length === 0) return undefined;

  // A report that spans several changes would merge e.g. two "worker r1" rows: qualify them.
  const changes = new Set(included.map((x) => x.info.change).filter(Boolean));
  const labelOf = (a: AgentInfo) =>
    changes.size > 1 && a.change && a.round ? `${a.label} (${a.change})` : a.label;

  // Aggregate per (label, model); keep main first, then agents in the order they started.
  const groups = new Map<string, { info: AgentInfo; label: string; model: string; usage: Usage }>();
  for (const { r, info } of included) {
    const label = labelOf(info);
    const k = `${label}\u0000${r.model}`;
    const g = groups.get(k) ?? { info, label, model: r.model, usage: emptyUsage() };
    g.usage = addUsage(g.usage, r.usage);
    if (info.firstSeen && (!g.info.firstSeen || info.firstSeen < g.info.firstSeen)) g.info = info;
    groups.set(k, g);
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.info.isMain !== b.info.isMain) return a.info.isMain ? -1 : 1;
    const at = Date.parse(a.info.firstSeen);
    const bt = Date.parse(b.info.firstSeen);
    const byTime = (Number.isNaN(at) ? 0 : at) - (Number.isNaN(bt) ? 0 : bt);
    return byTime || a.label.localeCompare(b.label) || a.model.localeCompare(b.model);
  });
  const rows: ReportRow[] = ordered.map((g) => ({
    agent: g.label,
    model: g.model,
    usage: g.usage,
    cacheHitPercent: cacheHitPercent(g.usage),
    listPriceUsd: estimateUsd(g.model, g.usage, pricing),
  }));
  const totalUsage = rows.reduce((acc, r) => addUsage(acc, r.usage), emptyUsage());
  const unpricedModels = [
    ...new Set(rows.filter((r) => r.listPriceUsd === undefined).map((r) => r.model)),
  ];
  const contributing = new Set(included.map((x) => x.r.sessionId));
  return {
    dir: options.dir,
    sessions: [...selected]
      .reverse()
      .map((s) => s.sessionId)
      .filter((id) => contributing.has(id)),
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

/** `session a` or `sessions a, b` (a change total may span several sessions). */
function sessionsLabel(report: TokenReport, quote: (s: string) => string): string {
  const noun = report.sessions.length === 1 ? 'session' : 'sessions';
  return `${noun} ${report.sessions.map(quote).join(', ')}`;
}

export function renderText(report: TokenReport): string {
  return [
    `Token usage — ${sessionsLabel(report, (s) => s)}`,
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
    `_${capitalize(sessionsLabel(report, (s) => `\`${s}\``))}. ${footnote(report)}_`,
  ].join('\n');
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  /** Repository root: names the transcript directory and holds openspec/changes. */
  cwd: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Clock for `--mark` (tests). */
  now?: () => Date;
}

export const TOKENS_USAGE =
  'usage: pnpm tokens [--latest | --session <id>] [--dir <transcripts dir>] ' +
  '[--change <id>] [--round <n>] [--format text|md|json] [--append <file>]\n' +
  '       pnpm tokens --mark <change> <round> start|end';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function markCli(positionals: string[], ctx: TokensCliEnv, io: Io): number {
  const [change = '', round = '', kind = ''] = positionals;
  if (
    positionals.length !== 3 ||
    !SAFE_ID.test(change) ||
    !SAFE_ID.test(round) ||
    !(MARK_KINDS as readonly string[]).includes(kind)
  ) {
    io.err(TOKENS_USAGE);
    return 2;
  }
  try {
    const { path, timestamp } = writeMark(
      ctx.cwd,
      change,
      round,
      kind as MarkKind,
      (ctx.now ?? (() => new Date()))(),
    );
    io.out(`Marked ${change} round ${round} ${kind} at ${timestamp} (${path})`);
    return 0;
  } catch (error) {
    io.err(`pnpm tokens --mark: ${(error as Error).message}`);
    return 2;
  }
}

export function tokensCli(argv: string[], ctx: TokensCliEnv, io: Io): number {
  let values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        latest: { type: 'boolean' },
        session: { type: 'string' },
        dir: { type: 'string' },
        change: { type: 'string' },
        round: { type: 'string' },
        format: { type: 'string', default: 'text' },
        append: { type: 'string' },
        mark: { type: 'boolean' },
        help: { type: 'boolean' },
      },
      allowPositionals: true,
    }));
  } catch (error) {
    io.err(`${(error as Error).message}\n${TOKENS_USAGE}`);
    return 2;
  }
  if (values.help) {
    io.out(TOKENS_USAGE);
    return 0;
  }
  if (values.mark) return markCli(positionals, ctx, io);
  const format = values.format ?? 'text';
  if (
    positionals.length > 0 ||
    !['text', 'md', 'json'].includes(format) ||
    (values.latest && values.session)
  ) {
    io.err(TOKENS_USAGE);
    return 2;
  }
  const dir = values.dir ?? join(defaultProjectsDir(ctx.home, ctx.env), projectDirName(ctx.cwd));
  let marks: RoundMarks = {};
  if (values.change !== undefined) {
    if (!SAFE_ID.test(values.change)) {
      io.err(TOKENS_USAGE);
      return 2;
    }
    try {
      marks = readMarks(marksPath(ctx.cwd, values.change));
    } catch (error) {
      io.err(`pnpm tokens: ${(error as Error).message}`);
      return 2;
    }
  }
  const options: ReportOptions = {
    dir,
    session: values.session,
    latest: values.latest,
    change: values.change,
    round: values.round,
    marks,
  };
  const report = buildReport(options);
  if (!report) {
    const scope = [
      values.session
        ? `session ${values.session}`
        : values.change !== undefined && !values.latest
          ? 'all sessions'
          : 'latest session',
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
