# web-loop

A TypeScript full-stack template for building web interfaces with **Claude Code** through a
spec-driven **worker ⇄ validator** loop, gated by a full SDLC pipeline that runs identically on
your machine, in Claude Code sessions, and in GitHub Actions.

- **Spec** — [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes describe _what_ to build
  as requirements + `WHEN/THEN` scenarios. They are the contract.
- **Worker** — a Claude Code subagent that implements the change across contract, API, DB and UI,
  with a test per scenario.
- **Validator** — a separate, read-only subagent that reviews like a skeptical PR reviewer: it
  challenges the spec, reads the diff, audits the tests, runs every gate, and drives the real app
  in Chromium via **Playwright MCP** before it will `APPROVE`.
- **Gate** — `pnpm verify`: spec validation → scenario traceability → lint → typecheck →
  unit/integration → build → Playwright e2e.

```
            ┌──────────────────────────── /build-feature <change> ─────────────────────────────┐
            │                                                                                  │
 /opsx:propose ──► spec ──► worker ──► pnpm verify ──► validator ──► APPROVE ──► /opsx:archive
   (you review       ▲      (code +                    (spec review, diff review,    │
    the spec)        │       tests)                     test audit, gates,           │
                     │                                  Playwright MCP walkthrough)  │
                     │                                          │                    ▼
                     │                             REQUEST_CHANGES (findings)    specs updated,
                     │                                          │                ready to commit
                     └──────────── spec-gap? ask you ◄──────────┴──► next round (max 3)
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
| traceability | `pnpm traceability`  | every `Scenario:` has at least one test named after it         |
| lint         | `pnpm lint`          | ESLint (no `any`, hooks rules, type imports) + Prettier        |
| typecheck    | `pnpm typecheck`     | strict TS across all packages                                  |
| test         | `pnpm test`          | shared/unit, API integration (in-memory SQLite), UI components |
| build        | `pnpm build`         | production bundles for API and web                             |
| e2e          | `pnpm e2e`           | Playwright against the built stack on a fresh database         |

`pnpm verify` runs them in order (`--fast` skips build + e2e, `--keep-going` doesn't stop at the
first failure). CI (`.github/workflows/ci.yml`) runs the same commands.

## Repo map

```
apps/api            Fastify API, Drizzle schema + migrations, integration tests
apps/web            React app, component tests
packages/shared     zod contract
e2e                 Playwright tests + config
openspec            specs (source of truth), changes, archive, config.yaml (project context + rules)
.claude/agents      worker.md, validator.md
.claude/commands    build-feature, review, verify, opsx/*
.claude/hooks       session-start (install deps), format-file (prettier + eslint after edits)
.mcp.json           Playwright MCP server
scripts             verify, traceability, Playwright MCP launcher, review server
```
