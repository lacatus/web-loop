# Proposal

## Why

Every agent in the loop inherits the main session's model, so the worker, the validator and every browser walkthrough run on Opus. Nothing measures what a change costs. The one measured run (`add-todo-due-reminders`, 2 rounds, 4 subagents) cost about **$8.16 at list price**. Most of that was context being re-read, not work being done:

| Agent | Requests | Output | Cache read | Cache write | ~List price |
| --- | --- | --- | --- | --- | --- |
| worker r1 | 24 | 33K | 1.15M | 76K | $1.50 |
| validator r1 | 40 | 12K | 3.87M | 120K | $2.39 |
| worker r2 | 22 | 18K | 0.76M | 59K | $0.95 |
| validator r2 | 40 | 18K | 3.48M | 315K | $3.32 |

The validators cost about twice as much as the workers while writing less. They keep raw Playwright snapshots and full `pnpm verify` logs in an Opus context and re-read them on every turn. Round 2 also rewrote 315K tokens of cache during a 33-minute run. We want each agent on the cheapest model that does its job well, a way to see token usage for every round, and cost cuts that are measured without lowering the validator's bar.

## What Changes

- **Per-agent model routing.** A checked-in policy sets each agent's model, effort and turn budget.
  - `worker` runs on Sonnet at effort `high`.
  - `validator` stays on Opus at effort `high`, as the quality gate.
  - New `browser-qa` agent runs on Sonnet at effort `medium`.
  - A lint gate fails when an agent omits or breaks the policy.
- **Worker escalation.** The orchestrator runs the worker on Opus when the same blocking finding survives two consecutive rounds, or when the change's `design.md` declares `complexity: high`. The decision is made by a script, not by the prompt.
- **Browser QA split from the validator.** `browser-qa` owns the Playwright MCP walkthrough and returns a compact evidence table. The validator judges the spec, the diff and that evidence, and no longer holds raw page snapshots.
- **Compact gate output.** `pnpm verify` gains a summary mode that writes full logs to `artifacts/verify/` and prints only the summary table plus the tail of each failing gate. Agents use this mode.
- **Token report.** `pnpm tokens` reads Claude Code transcripts and reports, per agent and per model: requests, input, output, cache write, cache read and cache-hit %. List-price dollars appear only as a labelled estimate, because the account is on a subscription plan. `/build-feature` adds this to every round's review record and totals it in the final report.
- **Status line.** A project status line shows model, effort, context %, cache-hit % and the session's list-price estimate.
- **Longer cache lifetime** for the long-running agents (`validator`, `browser-qa`).

## Non-goals

- Changing the model of the user's main session, or pinning a default model.
- Fast mode, Batch API, OpenTelemetry export, dashboards.
- Automatic spend caps or blocking a run on cost. Reports inform; people decide.
- Changing product features (todos) or the spec/review format beyond the new token section.
- Tuning `CLAUDE.md` or the OpenSpec prompts for other purposes.

## Capabilities

### New Capabilities

- `agent-loop`: how the worker ⇄ validator loop routes models, budgets and reports token usage. Its observable surface is CLI output and the files the loop writes, not the web UI.

### Modified Capabilities

_None._

## Impact

- `.claude/agents/`: `worker.md` and `validator.md` gain `model`, `effort`, `maxTurns` and cache settings. New `browser-qa.md`. The validator loses Playwright MCP tools.
- `.claude/commands/build-feature.md`: new step order (worker → verify summary → browser-qa → validator), escalation through the route script, token section per round.
- `.claude/settings.json`: `statusLine`, default model for other subagents (`CLAUDE_CODE_SUBAGENT_MODEL`).
- New `packages/loop-tools` (TypeScript + Vitest): policy lint, route, token report, verify runner, status line. Root `scripts/verify.mjs` moves here, keeping the same `pnpm verify` entry point.
- New root scripts: `pnpm tokens`, `pnpm check:agents`, `pnpm loop:route`. `pnpm verify` gains an agents-policy gate.
- `CLAUDE.md` and `README.md`: a tokenomics section.
