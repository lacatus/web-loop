# Tasks

## 1. loop-tools package

- [ ] 1.1 Create `packages/loop-tools` (TypeScript, Vitest; binaries run with `tsx`) and add it to lint and typecheck
- [ ] 1.2 Add `pricing.json` (Opus 5.5, Sonnet 5, Haiku 4.5 list prices, plus cache write/read multipliers; `source`, `asOf`)

## 2. Policy and lint gate

- [ ] 2.1 Add `.claude/loop-policy.json` with the routing table from design.md
- [ ] 2.2 `src/agents-policy.ts` + `pnpm check:agents`, reading agent frontmatter and comparing it with the policy — tests: `agents-policy.test.ts` (Scenario: Policy-compliant agents pass, Scenario: Agent without a model is rejected, Scenario: Agent drifts from the policy, Scenario: Browser tools are limited to browser QA)
- [ ] 2.3 Add the `agents` gate to `pnpm verify` (after `spec`)

## 3. Agents

- [ ] 3.1 `worker.md`: `model: sonnet`, `effort: high`, `maxTurns: 80`
- [ ] 3.2 `validator.md`: `model: opus`, `effort: high`, `maxTurns: 40`, `experimental.cacheTtl: 1h`, Playwright MCP disallowed. Rewrite step 5 as "judge the browser-qa evidence; request targeted re-checks"
- [ ] 3.3 New `browser-qa.md`: `model: sonnet`, `effort: medium`, `maxTurns: 40`, `cacheTtl: 1h`, Playwright MCP only via `review:serve`; outputs the compact evidence table
- [ ] 3.4 `settings.json`: `env.CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, `statusLine` command

## 4. Escalation

- [ ] 4.1 `src/route.ts` + `pnpm loop:route` — tests: `route.test.ts` (Scenario: No escalation by default, Scenario: Escalate a complex change, Scenario: Escalate on a repeated blocking finding, Scenario: Resolved finding does not escalate)

## 5. Compact gate output

- [ ] 5.1 Move `scripts/verify.mjs` into `src/verify-runner.ts` with injectable gates, and add `--summary` — tests: `verify-runner.test.ts` (Scenario: Passing gates print only the summary, Scenario: A failing gate prints its tail and log path)

## 6. Token report

- [ ] 6.1 `src/tokens.ts` + `pnpm tokens` (`--session`, `--latest`, `--dir`, `--format md|json`) — tests: `tokens.test.ts` with fixture transcripts (Scenario: Report per agent, Scenario: Streaming duplicates counted once, Scenario: Unknown model is unpriced, Scenario: No transcripts found)
- [ ] 6.2 Markdown renderer for the round "Tokens" section — test: `tokens.test.ts` (Scenario: Round record includes token usage)

## 7. Status line

- [ ] 7.1 `src/statusline.ts` — tests: `statusline.test.ts` (Scenario: Status line renders session data, Scenario: Missing fields are omitted)

## 8. Orchestration and docs

- [ ] 8.1 `build-feature.md`: new step order, `loop:route` per worker call, `verify --summary`, browser-qa step, re-check requests, Tokens section per round, total in the final report
- [ ] 8.2 `CLAUDE.md` and `README.md`: tokenomics section (routing table, `pnpm tokens`, habits: `/clear` between features, summary mode for agents)

## 9. Verify

- [ ] 9.1 `pnpm verify` green; `node scripts/check-traceability.mjs --change tune-model-routing-tokenomics` covers every scenario
- [ ] 9.2 Post-build benchmark and seeded-defect check from design.md (results recorded in `reviews/benchmark.md`)
