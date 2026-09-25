VERDICT: REQUEST_CHANGES

## Review — tune-model-routing-tokenomics round 1

### Summary

The change adds `packages/loop-tools` (agents policy lint, `loop:route`, verify `--summary`, `pnpm tokens`, status line), `.claude/loop-policy.json`, a `browser-qa` agent, removes Playwright from the validator, and rewires `/build-feature` and `/review`. The code is careful and every scenario has a test that asserts its THEN clauses. Pricing is correct, and dedupe reproduces the $8.16 baseline from the real transcripts. Three blocking defects and one spec gap. browser-qa skip confirmed: every scenario is CLI/file-observable.

### Scenario verification

All 17 scenarios PASS: tests assert the THEN clauses, and the CLI was re-run as evidence (`check:agents`, `loop:route` on this change → opus, `tokens` reproduces $8.16, status line from `settings.json` with sample stdin). The summary-mode scenario passes in tests but fails under `pnpm -s` (F2).

### Gates

spec, agents, traceability (17/17), lint, typecheck, test (loop-tools 28/28), build and e2e all PASS. The typecheck/test/build logs were empty (F2).

### Findings

#### F1 [blocking] Change token total only covers the latest session

- Where: `packages/loop-tools/src/tokens.ts:253-255` (`sessions.slice(0, 1)`), `.claude/commands/build-feature.md:97`
- Problem: "The final report MUST total usage across all rounds". Rounds that ran in earlier sessions (resume after a spec-gap stop, `/clear`) are silently dropped.
- Repro: a fixture change split across two sessions → the report shows only `session-new`, with no warning.
- Expected: with `--change` and no `--session`, aggregate across all sessions, list them, and add a two-session test.

#### F2 [blocking] Summary-mode gate logs are empty when invoked via `pnpm -s`

- Where: `packages/loop-tools/src/verify-runner.ts:76-85`
- Problem: `pnpm -s` passes its silent reporter to nested `pnpm -r` gates, so `test.log`, `typecheck.log` and `build.log` were 0 bytes this round. That breaks "each gate's full output is in `artifacts/verify/<gate>.log`".
- Expected: remove the pnpm/npm reporter and loglevel env variables in summary mode, and add a test for it.

#### F3 [blocking] Agents gate is not run in CI; README says CI runs the same commands

- Where: `.github/workflows/ci.yml`, `README.md:75,86`
- Expected: add `pnpm check:agents` to the CI spec job (or correct the README).

#### F4 [spec-gap] Does a change's token cost include the orchestrator (main session)?

- The filters drop the `main` row (this session: main ~$28.60 vs all subagents ~$13.73). The new flow moves some work into the Opus main session, so a subagent-only metric could show the 40% saving while real cost doesn't fall.

#### F5 [nit] `NO_COLOR` and `FORCE_COLOR` both set → Node warns in every log

#### F6 [nit] Stale logs from earlier runs remain for skipped gates

#### F7 [nit] `pnpm -s check:agents` is not allowlisted in settings.json

#### F8 [nit] Stale wording in CLAUDE.md (`/review` and `review:serve` now involve browser-qa)

#### F9 [nit] The complexity marker must start a line, but the spec says "contains"; document the rule

#### F10 [nit] Resuming `/build-feature` restarts round numbering at 1

### Rulings on the worker's "Needs human decision" items

All 7 accepted as implementation details: worker cacheTtl 5m; 1h cache writes at 2× (matches Anthropic pricing); the `--change`/`--round`/`--append` flags; change-id suffixes on labels; the RECHECK protocol; the `review.md` update; skipping browser-qa when there are no UI scenarios.

### Questions for the human

- F4: should the per-change total and the ≥40% benchmark include the orchestrator's main-session tokens?

## Worker report

Round 1 built task groups 1–8 and 9.1 (9.2 was out of scope), with `pnpm verify` green and traceability 17/17. It listed 7 "needs human decision" items, and the validator accepted all of them.

## Tokens

| Agent | Model | Requests | Input | Output | Cache write | Cache read | Cache hit | list-price est. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| worker r1 (tune-model-routing-tokenomics) | claude-opus-5-5 | 59 | 118 | 80.6K | 142.7K | 5.29M | 97% | ~$4.44 |
| validator r1 (tune-model-routing-tokenomics) | claude-opus-5-5 | 40 | 80 | 33.6K | 196.7K | 5.54M | 97% | ~$4.46 |
| **Total** |  | 99 | 198 | 114.2K | 339.4K | 10.83M | 97% | ~$8.90 |

_Session `3e726538-2c8a-5682-a6ea-affc96c37dce`. list-price est. = Anthropic API list prices (Anthropic API pricing (claude-api skill cache 2026-06-24), as of 2026-09-25); an estimate only — subscription plans are not billed per token._
