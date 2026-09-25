VERDICT: REQUEST_CHANGES

## Review — tune-model-routing-tokenomics round 2

### Summary

Round 2 closes every round-1 finding: F1 (cross-session totals), F2/F5 (complete, clean logs under `pnpm -s`), F3 (CI runs `check:agents`), F4 (orchestrator round marks, as the human decided), and all nits. The new orchestrator attribution has two reproduced defects, both small to fix. Tests assert the THEN clauses, all gates are green, traceability 19/19. browser-qa skip confirmed.

### Scenario verification

18/19 PASS. **Orchestrator usage is attributed to its round** FAILS in two reachable states (F11, F12); its test passes, but the "exactly" clause does not hold.

### Gates

spec, agents, traceability (19/19), lint, typecheck, test (loop-tools 34/34), build and e2e all PASS.

### Findings

#### F11 [blocking] Orchestrator rows count main-session usage from unrelated concurrent sessions

- Where: `packages/loop-tools/src/tokens.ts` `buildReport` → `attribute()`
- Problem: every main session with calls inside a round window is billed to the change and named as contributing. The requirement means the session that ran the round.
- Repro: an `unrelated` session with 99,999 output tokens inside the window → `orchestrator r3` = 100,009.
- Expected: only main sessions that spawned a subagent with `change=<id>` count. Add a test.

#### F12 [blocking] A round left without an end mark takes over every later round's orchestrator usage

- Where: `packages/loop-tools/src/tokens.ts` `roundAt` (the first window in key order wins; an open window has no end)
- Repro: an open round 2 and a closed round 3 → a timestamp inside round 3 is attributed to round 2.
- Expected: an open window ends at the next round's start, or `--mark N start` closes other open rounds. Add a test.

### Previous findings

F1, F2, F3, F5, F6, F7, F8, F9, F10: resolved. F4: resolved by the human's decision and implemented; F11 and F12 are defects in that implementation.

### Rulings on the worker's judgment calls

- (a) max-rounds is a fresh budget per `/build-feature` call: accepted.
- (b) an open round counts as ongoing: accepted for the latest round only; rejected where it overlaps later rounds (F12) and for counting other sessions (F11).

### Process note

`reviews/.marks.json` was untracked; commit it with the reviews (done by the orchestrator in 19c138d).

## Worker report

Round 2 fixed F1–F10 with regression tests (the F2 test fails without the fix). loop-tools 34/34, traceability 19/19, `pnpm verify` PASS in both modes.

## Tokens

| Agent | Model | Requests | Input | Output | Cache write | Cache read | Cache hit | list-price est. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| worker r2 | claude-opus-5-5 | 47 | 94 | 49.5K | 131.3K | 4.23M | 97% | ~$3.34 |
| orchestrator r2 | claude-opus-5-5 | 5 | 14 | 3.4K | 7.4K | 2.84M | 100% | ~$1.26 |
| validator r2 | claude-opus-5-5 | 13 | 26 | 13.9K | 63.3K | 955.2K | 94% | ~$1.17 |
| **Total** |  | 65 | 134 | 66.7K | 202.0K | 8.03M | 98% | ~$5.77 |

_Session `3e726538-2c8a-5682-a6ea-affc96c37dce`. list-price est. = Anthropic API list prices (Anthropic API pricing (claude-api skill cache 2026-06-24), as of 2026-09-25); an estimate only — subscription plans are not billed per token._
