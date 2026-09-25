# web-loop

A TypeScript full-stack template for building web interfaces with **Claude Code** through a
spec-driven **worker ⇄ validator** loop, gated by a full SDLC pipeline that runs identically on
your machine, in Claude Code sessions, and in GitHub Actions.

- **Spec** — [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes describe _what_ to build
  as requirements + `WHEN/THEN` scenarios. They are the contract.
- **Worker** — a Claude Code subagent that implements the change across contract, API, DB and UI,
  with a test per scenario.
- **Browser QA** — a subagent that drives the real app in Chromium via **Playwright MCP** through
  every scenario and returns a compact evidence table.
- **Validator** — a separate, read-only subagent that reviews like a skeptical PR reviewer: it
  challenges the spec, reads the diff, audits the tests, judges the gate summary and the browser
  evidence (asking for targeted re-checks), and only then will `APPROVE`.
- **Gate** — `pnpm verify`: spec validation → agents policy → scenario traceability → lint →
  typecheck → unit/integration → build → Playwright e2e.

```
/opsx:propose ──► spec (you review it)
                    │
/build-feature ─────▼──────────────────────────────────────────────────────────────────────
   worker ──► pnpm verify --summary ──► browser-qa ──────────► validator ──► APPROVE ──► /opsx:archive
   (code + tests)  (gate table,          (Playwright MCP        (spec, diff,              (specs updated,
     ▲              failing tails)        evidence table)        tests, gates,             ready to commit)
     │                                                           evidence)
     │                                                              │
     └──────── next round (max 3) ◄──── REQUEST_CHANGES ◄───────────┤
                                        spec-gap? ask you ◄─────────┘
```

## Stack

| Layer    | Tech                                                               |
| -------- | ------------------------------------------------------------------ |
| Web      | React 19, Vite 8, Tailwind CSS 4, React Router 7, TanStack Query 5 |
| API      | Fastify 5, zod 4, Drizzle ORM, SQLite (better-sqlite3)             |
| Contract | `packages/shared` — zod schemas shared by API and web              |
| Tests    | Vitest 5 + Testing Library, Fastify `inject`, Playwright           |
| Specs    | OpenSpec 1.x (`openspec/`)                                         |
| Tooling  | pnpm workspaces, TypeScript 6, ESLint 10, Prettier, GitHub Actions |

## Quick start

```bash
pnpm install
pnpm dev          # web http://localhost:5173  ·  api http://localhost:3001/api/health
pnpm verify       # the full gate (needs Chromium: see CLAUDE.md → Environment notes)
```

The sample **Todos** feature (spec: `openspec/specs/todos/spec.md`) shows the whole path —
shared schema → Fastify route + Drizzle table → React page → tests at every layer, each named
after its scenario.

## Building a feature with Claude Code

```text
/opsx:propose add due dates to todos, overdue ones highlighted
   → review openspec/changes/add-due-dates/ (proposal, specs, design, tasks) and edit until it says exactly what you want
/build-feature add-due-dates
   → worker ⇄ validator rounds; each review is saved in openspec/changes/add-due-dates/reviews/
   → if the validator finds a spec gap, the loop stops and asks you
/opsx:archive add-due-dates
   → the change's delta specs are merged into openspec/specs/
```

Also available: `/review <change>` (validator only, e.g. on work you wrote yourself),
`/verify`, `/opsx:explore`, `/opsx:update`.

## Quality gates

| Gate         | Command              | What it proves                                                 |
| ------------ | -------------------- | -------------------------------------------------------------- |
| spec         | `pnpm spec:validate` | OpenSpec specs and changes are well-formed (`--strict`)        |
| agents       | `pnpm check:agents`  | agent model/effort/turns/cache/MCP match the routing policy    |
| traceability | `pnpm traceability`  | every `Scenario:` has at least one test named after it         |
| lint         | `pnpm lint`          | ESLint (no `any`, hooks rules, type imports) + Prettier        |
| typecheck    | `pnpm typecheck`     | strict TS across all packages                                  |
| test         | `pnpm test`          | shared/unit, API integration (in-memory SQLite), UI components |
| build        | `pnpm build`         | production bundles for API and web                             |
| e2e          | `pnpm e2e`           | Playwright against the built stack on a fresh database         |

`pnpm verify` runs them in order (`--fast` skips build + e2e, `--keep-going` doesn't stop at the
first failure, `--summary` writes each gate's output to `artifacts/verify/<gate>.log` and prints only
the summary plus the last 40 lines of failing gates — the mode agents use). CI
(`.github/workflows/ci.yml`) runs the same commands.

## Tokenomics

Each agent runs on the cheapest model that does its job well. The routing policy is
`.claude/loop-policy.json`; `pnpm check:agents` fails when an agent file drifts from it.

| Agent           | Model                                         | Effort | maxTurns | Cache TTL | Playwright MCP |
| --------------- | --------------------------------------------- | ------ | -------- | --------- | -------------- |
| worker          | Sonnet; Opus when `pnpm loop:route` escalates | high   | 80       | 5m        | no             |
| validator       | Opus (the quality gate)                       | high   | 40       | 1h        | no             |
| browser-qa      | Sonnet                                        | medium | 40       | 1h        | yes            |
| other subagents | Sonnet via `CLAUDE_CODE_SUBAGENT_MODEL`       | –      | –        | –         | –              |

- **Escalation** — `pnpm loop:route --change <id> --round <n>` prints `opus` when the change's
  `design.md` declares `complexity: high` or the same blocking finding appears in both previous
  reviews, otherwise `sonnet`, plus the reason.
- **Token report** — `pnpm tokens` reads Claude Code transcripts
  (`~/.claude/projects/<project>/<session>.jsonl` + `subagents/`) and prints requests, input,
  output, cache write, cache read and cache-hit % per agent and model, then a list-price estimate.
  Flags: `--latest` (default) / `--session <id>`, `--change <id>`, `--round <n>`,
  `--format text|md|json`, `--dir <transcripts dir>`, `--append <file>`. Prices are in
  `packages/loop-tools/pricing.json` (with source and date); unknown models show as `unpriced`.
  Dollars are estimates only — on a subscription plan, tokens and cache-hit % are what matter.
  `/build-feature` appends a `## Tokens` section to every round's review and totals the change.
- **Status line** — `model · effort · ctx % · cache % · ~$ list`, wired in `.claude/settings.json`.
- **Habits** — `/clear` between features; agents use `pnpm verify --summary` rather than streaming
  full gate logs into their context.

## Repo map

```
apps/api            Fastify API, Drizzle schema + migrations, integration tests
apps/web            React app, component tests
packages/shared     zod contract
packages/loop-tools verify runner, agents policy check, loop:route, tokens report, status line
e2e                 Playwright tests + config
openspec            specs (source of truth), changes, archive, config.yaml (project context + rules)
.claude/agents      worker.md, browser-qa.md, validator.md (+ loop-policy.json routing)
.claude/commands    build-feature, review, verify, opsx/*
.claude/hooks       session-start (install deps), format-file (prettier + eslint after edits)
.mcp.json           Playwright MCP server
scripts             traceability, Playwright MCP launcher, review server
```
