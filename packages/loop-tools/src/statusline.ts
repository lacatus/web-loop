/**
 * Project status line: `Opus · high · ctx 42% · cache 91% · ~$1.23 list`.
 * Reads Claude Code's status-line JSON; any value it does not supply is dropped.
 */

function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function modelName(session: Record<string, unknown>): string | undefined {
  const model = session.model;
  if (typeof model === 'string') return nonEmpty(model);
  const m = obj(model);
  return nonEmpty(m?.display_name) ?? nonEmpty(m?.id);
}

/** `effort` has been seen as a plain string and as an object; accept both. */
function effortLevel(session: Record<string, unknown>): string | undefined {
  const e = session.effort;
  if (typeof e === 'string') return nonEmpty(e);
  const o = obj(e);
  return nonEmpty(o?.level) ?? nonEmpty(o?.value) ?? nonEmpty(o?.name);
}

function contextPercent(session: Record<string, unknown>): number | undefined {
  return finite(obj(session.context_window)?.used_percentage);
}

/** Cache-hit % of the current context: from `current_usage`, else a numeric `prompt_cache` rate. */
function cachePercent(session: Record<string, unknown>): number | undefined {
  const usage = obj(obj(session.context_window)?.current_usage);
  if (usage) {
    const read = finite(usage.cache_read_input_tokens) ?? 0;
    const total =
      (finite(usage.input_tokens) ?? 0) + read + (finite(usage.cache_creation_input_tokens) ?? 0);
    if (total > 0) return (read / total) * 100;
  }
  const pc = session.prompt_cache;
  const rate =
    finite(pc) ??
    finite(obj(pc)?.hit_rate) ??
    finite(obj(pc)?.hit_ratio) ??
    finite(obj(pc)?.hit_percentage);
  if (rate === undefined) return undefined;
  return rate <= 1 ? rate * 100 : rate;
}

function costUsd(session: Record<string, unknown>): number | undefined {
  return finite(obj(session.cost)?.total_cost_usd);
}

export function renderStatusLine(input: unknown): string {
  const session = obj(input) ?? {};
  const ctx = contextPercent(session);
  const cache = cachePercent(session);
  const cost = costUsd(session);
  return [
    modelName(session),
    effortLevel(session),
    ctx === undefined ? undefined : `ctx ${Math.round(ctx)}%`,
    cache === undefined ? undefined : `cache ${Math.round(cache)}%`,
    cost === undefined ? undefined : `~$${cost.toFixed(2)} list`,
  ]
    .filter((p): p is string => p !== undefined)
    .join(' · ');
}

/** Parses raw stdin; invalid JSON yields an empty line rather than an error in the UI. */
export function statusLineFromStdin(raw: string): string {
  try {
    return renderStatusLine(JSON.parse(raw));
  } catch {
    return '';
  }
}
