# Design

complexity: high

## Context

See proposal.md for why. Relevant facts, checked against the current Claude Code and Claude API docs on 2026-09-25:

- Subagent frontmatter supports `model` (`opus` | `sonnet` | `haiku` | `fable` | `inherit` | full ID), `effort` (`low`…`max`), `maxTurns`, `mcpServers`, `disallowedTools`, `omitClaudeMd` and `experimental.cacheTtl` (`5m` | `1h`).
- Model resolution order: per-invocation `model` parameter → frontmatter `model` → `CLAUDE_CODE_SUBAGENT_MODEL` → main session model. Escalation can therefore be done per invocation without editing the agent file.
- List prices ($/MTok, input/output): Opus 5.5 4/20, Sonnet 5 2/10, Haiku 4.5 1/5. Cache writes cost about 1.25× input and cache reads about 0.1×. Caches are model-scoped, so switching the worker's model starts a cold cache.
- Hook payloads carry no token usage. Transcripts do: `~/.claude/projects/<project>/<session>.jsonl` and `<session>/subagents/agent-<id>.jsonl`, with `message.model` and `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_{5m,1h}_input_tokens`). Streaming writes the same `message.id` several times.
- The status line gets JSON on stdin with `model`, `cost.total_cost_usd`, `context_window.{used_percentage,current_usage.*}`, `prompt_cache` and `effort`.
- The account is on a subscription plan. Dollars are list-price estimates only, and plan usage is what the user actually feels.

## Goals / Non-Goals

**Goals:**

- Cut list-price cost per **completed change** by at least 40% against the baseline, while keeping the validator's detection power (see Verification).
- Make every round's token use visible in the review record, so future tuning is driven by data.
- Keep all routing decisions in versioned files and scripts that tests can cover.

**Non-Goals:**

- Choosing models dynamically from task text (no LLM router).
- Exact billing. All estimates use list prices and are labelled that way.

## Decisions

1. **Policy file `.claude/loop-policy.json` is the single source of routing truth.** It holds per-agent `model`, `effort`, `maxTurns`, `cacheTtl`, the allowed MCP servers, and the escalation rules. The agent frontmatter must match it, and `pnpm check:agents` (a verify gate) enforces that. Alternative: frontmatter only. Rejected, because nothing would stop an agent silently falling back to `inherit`.
2. **Routing:**

   | Agent | Model | Effort | maxTurns | Playwright MCP | Why |
   | --- | --- | --- | --- | --- | --- |
   | worker | sonnet | high | 80 | no | Code writing against a precise spec; Sonnet 5 is half Opus's price. |
   | validator | opus | high | 40 | no | Adversarial judgment is the quality bar; don't trade it. |
   | browser-qa | sonnet | medium | 40 | yes | Mechanical UI driving plus evidence capture; keeps snapshots out of the Opus context. |
   | other subagents (Explore, ad-hoc) | sonnet via `CLAUDE_CODE_SUBAGENT_MODEL` | – | – | – | Stops ad-hoc subagents from running on Opus by default. |

   Haiku is not used for any loop role for now. Its lower price does not pay for a missed bug that costs another Opus validator round. It can be revisited with the token data once this lands.
3. **Escalation lives in `pnpm loop:route --change <id> --round <n>`.** It prints `sonnet` or `opus` with a reason. The rule is `opus` when `design.md` contains `complexity: high`, or when the same finding title is `blocking` in both of the two previous reviews; `sonnet` otherwise. The orchestrator passes the result as the per-invocation `model`. Finding titles are matched after normalization (case, whitespace, F-number stripped).
4. **Step order per round:** worker → `pnpm verify --summary` (run by the orchestrator, no model tokens) → browser-qa (driven by the change's scenarios; returns a table with scenario, steps, result, console/network errors and screenshot path, capped at about 60 lines) → validator. The validator gets the worker report, the verify summary and the browser-qa evidence. It may ask for a targeted re-check, which the orchestrator runs as one extra browser-qa call; it cannot drive the browser itself.
5. **Verify summary mode:** the gate runner moves into `packages/loop-tools` with injectable gates for testing. `--summary` sends each gate's output to `artifacts/verify/<gate>.log`. It prints the summary table, plus the last 40 lines and the log path for failing gates only. Plain `pnpm verify` keeps streaming output for humans.
6. **Token report (`pnpm tokens`):**
   - It finds the project's transcript directory from the cwd using Claude Code's path mangling, with an override flag `--dir`.
   - It dedupes by `message.id` (last record wins) and labels each subagent file with its agent type. The agent type is read from the transcript's own metadata when present, else parsed from the first prompt (`change=… round=…`), else shown as the raw agent id.
   - Output order is subscription-first: tokens and cache-hit % come before dollars, and the dollar column is headed "list-price est.".
   - Pricing lives in `packages/loop-tools/pricing.json` with `source` and `asOf`. A model missing from it shows as `unpriced`, never `$0`.
   - Formats: `--format md` (used by `/build-feature` for the Tokens section) and `--format json`.
7. **Cache TTL:** `experimental.cacheTtl: 1h` on validator and browser-qa. Both run long, with multi-minute gaps while gates run. Subscriptions may already get a 1h TTL; setting it explicitly makes the behavior deterministic. This relies on an experimental field, so the token report's cache-write column is the check that it helps.
8. **Status line** (`packages/loop-tools/src/statusline.ts`, wired through `settings.json` → `statusLine`): prints `model · effort · ctx NN% · cache NN% · ~$X.XX list`. Missing fields are dropped rather than printed as `undefined`.

## Risks / Trade-offs

- [Sonnet worker makes more mistakes and adds rounds] → The escalation rule plus a completed-change metric (not per-request cost). If the benchmark adds a round, revisit the decision.
- [The validator loses first-hand browser access and could accept weak evidence] → The validator prompt requires it to reject evidence that doesn't show each THEN clause, and it can request re-checks. The seeded-defect benchmark must still catch the known bug.
- [Model switch on escalation starts a cold cache] → Accepted. Escalation is rare by design.
- [Transcript format is internal to Claude Code and may change] → The parser tolerates unknown fields and records, and tests use fixture files. A format break shows as "no usage found", not wrong numbers.
- [`experimental.cacheTtl` may change or be removed] → It is isolated in the policy file, and its effect is measured.

## Verification plan (post-build, not part of `pnpm verify`)

1. **Benchmark replay.** On a scratch branch at `c071d54` (the add-todo-due-reminders proposal), run `/build-feature add-todo-due-reminders` with the new policy. Compare total tokens, cache-hit % and list-price estimate per completed change against the baseline ($8.16, 2 rounds).
2. **Seeded-defect check.** Reintroduce the round-1 bug (a half-entered due date silently dropped). The new browser-qa + validator pair must still return `REQUEST_CHANGES` on it.
3. Success: at least 40% lower list-price estimate, no more rounds than the baseline, and the seeded defect is caught.

## Open Questions

- Whether browser-qa should also run on the approval round only, or every round. Defaulting to every round; the token data will show whether it's worth skipping.
