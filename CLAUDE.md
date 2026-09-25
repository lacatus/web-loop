# CLAUDE.md

This repo is a **spec-driven worker ⇄ validator loop** for building full-stack web features in TypeScript.
The OpenSpec change is the contract, the worker implements it, browser-qa drives the real UI with Playwright MCP,
the validator reviews it all like a strict PR reviewer, and `pnpm verify` is the gate everyone shares.

## The loop

```
/opsx:propose <idea>        → openspec/changes/<id>/{proposal,design,tasks}.md + specs/**/spec.md
   (human reviews the spec — this is where "what I asked for" gets pinned down)
/build-feature <id>         → worker → verify --summary → browser-qa → validator → … until APPROVE (max 3 rounds)
   (reviews saved to openspec/changes/<id>/reviews/round-N.md; spec gaps stop the loop and ask you)
/opsx:archive <id>          → delta specs merged into openspec/specs/, change moved to archive/
```

Other commands: `/review <id> [base]` (validator only, as a PR review), `/verify [--fast]`, `/opsx:explore`,
`/opsx:update <id>`.

Agents (`.claude/agents/`): `worker` (writes code, no browser), `browser-qa` (drives the app with Playwright MCP,
returns an evidence table) and `validator` (read-only, judges spec, diff, gates and evidence, no browser; returns
`VERDICT: APPROVE | REQUEST_CHANGES`).

## Definition of done

1. `pnpm verify` is green: spec validate → agents policy → scenario traceability → lint → typecheck → unit/integration → build → e2e.
2. The validator's latest review for the change is `APPROVE`.
3. The change is archived so `openspec/specs/` reflects the shipped behavior.

## Layout

| Path                  | What                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `packages/shared`     | zod schemas + types: **the API contract** used by both apps                           |
| `packages/loop-tools` | loop tooling: verify runner, agents policy check, `loop:route`, `tokens`, status line |
| `apps/api`            | Fastify 5 + Drizzle ORM + SQLite (better-sqlite3); migrations in `drizzle/`           |
| `apps/web`            | React 19 + Vite + Tailwind 4 + React Router 7 + TanStack Query 5                      |
| `e2e`                 | Playwright tests against the **built** stack (api :3101, web :4173)                   |
| `openspec/specs`      | Source of truth: current behavior, one folder per capability                          |
| `openspec/changes`    | In-flight changes (+ `archive/`)                                                      |
| `scripts/`            | `check-traceability.mjs`, Playwright MCP launcher, review server, etc.                |

## Conventions (the validator enforces these)

- **Contract first.** New request/response shapes go in `packages/shared/src/*.ts` as zod schemas. The API
  parses requests with them; the web client (`apps/web/src/api/client.ts`) parses responses with them.
- **Errors.** Every non-2xx response is `{ error: { code, message, details? } }` (see `packages/shared/src/errors.ts`).
  Throw `HttpError`/`notFound()` from `apps/api/src/lib/errors.ts`; zod errors become 400 automatically.
- **DB.** Change `apps/api/src/db/schema.ts`, then `pnpm db:generate`. Never hand-edit generated migrations.
  Migrations run at startup; tests use `createDb(':memory:')`.
- **Scenario traceability.** Every `#### Scenario: <name>` in OpenSpec must be referenced by at least one test
  title containing `Scenario: <name>` (checked by `pnpm traceability`). Tests must assert the THEN clauses.
- **Test layers.** API behavior → `apps/api/test/*.test.ts` using `app.inject()`. UI behavior →
  `apps/web/src/**/*.test.tsx` with Testing Library + `mockFetch`/`renderWithProviders` from
  `apps/web/src/test/render.tsx`. User journeys → `e2e/tests/*.spec.ts`.
- **Accessibility.** Every control has an accessible name; query by role/label in tests, not CSS or test ids.
  Errors use `role="alert"`. Async-controlled inputs in Playwright: `click()` + `expect(...).toBeChecked()`,
  not `check()`.
- **TypeScript.** Strict, no `any`, `import type` for types. TS 6.0 (typescript-eslint doesn't support 7 yet).
- Never `.skip`/`.only` a test or weaken an assertion to make a gate pass.

## Commands

```bash
pnpm install
pnpm dev              # api :3001 + web :5173 (proxy /api), dev DB at apps/api/data/app.db
pnpm review:serve     # same stack in the background on a fresh throwaway DB (validator); pnpm review:stop
pnpm verify           # full gate;  pnpm verify:fast skips build + e2e;  --summary = compact output (agents)
pnpm traceability     # scenario → test map
pnpm db:generate      # generate a migration after editing schema.ts
openspec list | openspec show <id> | openspec validate --all --strict
```

## Tokenomics

Routing lives in `.claude/loop-policy.json`; agent frontmatter must match it (`pnpm check:agents`, verify gate `agents`).

| Agent                    | Model                                 | Effort | maxTurns | Cache TTL | Playwright MCP |
| ------------------------ | ------------------------------------- | ------ | -------- | --------- | -------------- |
| worker                   | sonnet (opus via `pnpm loop:route`)   | high   | 80       | 5m        | no             |
| validator                | opus                                  | high   | 40       | 1h        | no             |
| browser-qa               | sonnet                                | medium | 40       | 1h        | yes            |
| other subagents (ad hoc) | sonnet (`CLAUDE_CODE_SUBAGENT_MODEL`) | –      | –        | –         | –              |

- `pnpm loop:route --change <id> --round <n>` → `opus` when design.md says `complexity: high` or the same blocking
  finding survived two rounds, else `sonnet`. `/build-feature` passes it as the worker's model.
- `pnpm tokens [--session <id> | --latest] [--change <id>] [--round <n>] [--format md|json] [--dir <dir>]` reports
  requests, input/output, cache write/read and cache-hit % per agent and model from Claude Code transcripts.
  Dollars are a **list-price estimate** (`packages/loop-tools/pricing.json`); this account is on a subscription.
  Each round's review record ends with its `## Tokens` section.
- Status line: `model · effort · ctx % · cache % · ~$ list` (`packages/loop-tools/src/statusline.ts`).
- Habits: `/clear` between features; agents use `pnpm verify --summary` (full logs in `artifacts/verify/`) instead of
  streaming gate output into their context.

## Environment notes

- Chromium: e2e and Playwright MCP use `$PLAYWRIGHT_CHROMIUM_EXECUTABLE` or `/opt/pw-browsers/chromium` when
  present (`scripts/chromium-path.mjs`); otherwise Playwright's own browser (CI runs `playwright install`).
  Don't run `playwright install` in the cloud container.
- Playwright MCP is configured in `.mcp.json` via `scripts/playwright-mcp.mjs` (headless, isolated profile,
  output in `artifacts/playwright-mcp/`). Set `PLAYWRIGHT_MCP_HEADED=1` to watch it locally.
- `artifacts/` is git-ignored scratch space for test output, screenshots and throwaway DBs.
