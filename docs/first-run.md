# Guided first run: add due dates to todos

A 10-minute-to-set-up, 30-ish-minute walkthrough of the whole loop on one small feature:
**due dates and reminders for todos**. It is the same feature that
[PR #2](https://github.com/lacatus/web-loop/pull/2) built with this repo's own loop, so you can
run it yourself and compare your result with that reference run (spec, two review rounds, a
human decision in the middle, archive).

You do not need to reproduce the reference exactly. Models are not deterministic; the point is
to see each stage of the loop and what you do at each one.

## 0. Prerequisites

| You need                                                   | Why                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Node 22+ (`.nvmrc`) and pnpm 10 (`corepack enable`)        | everything                                                                                     |
| [Claude Code](https://claude.com/claude-code) (CLI or IDE) | `/opsx:*`, `/build-feature`, `/review` and the subagents                                       |
| Chromium                                                   | `pnpm e2e` and Playwright MCP (`pnpm --filter @web-loop/e2e exec playwright install chromium`) |
| A Claude plan or API access that can run Sonnet and Opus   | worker/browser-qa use Sonnet, the validator uses Opus                                          |

Expect a full run (2 rounds) to use a meaningful amount of tokens. `pnpm tokens` reports exactly
how much afterwards (step 6).

## 1. Check the starting point (2 min)

```bash
git clone https://github.com/lacatus/web-loop.git && cd web-loop
pnpm install
pnpm verify:fast        # spec, agents, traceability, lint, typecheck, tests: all green
pnpm dev                # web http://localhost:5173 (API on :3001)
```

Open http://localhost:5173, add a todo, tick it, delete it. This is the app you are about to
extend. Stop the dev server (Ctrl+C), then start Claude Code in the repo:

```bash
claude
```

Claude Code asks whether to trust the project. The repo ships hooks (`.claude/settings.json`)
that install dependencies on session start and run Prettier/ESLint after edits. Read them first
if you want to know what you are approving.

Work on a branch so you can throw the result away:

```bash
git switch -c try/due-dates
```

## 2. Propose: pin down what you want (5 min)

```text
/opsx:propose add an optional due date/time to todos, shown in local time, with a reminders panel for todos that are overdue or due within 60 minutes
```

Claude creates `openspec/changes/<change-id>/` with `proposal.md`, `design.md`, `tasks.md` and
`specs/todos/spec.md`.

**This is the step that matters most. Read the spec and edit it until it says what you mean.**
Look for:

- `#### Scenario:` blocks with `WHEN` / `THEN`: these become the tests. Are they what you want?
- Empty, loading, validation-error and server-error states. Is any missing?
- Explicit non-goals in `proposal.md` (the validator uses them to reject scope creep).

Things the reference run's spec had to decide, and yours should too: how the reminders panel is
announced to screen readers, what happens with a half-entered date, whether completing a todo
reorders the list. Settle them now, in the spec, not later in code.

Validate it:

```bash
pnpm spec:validate
```

## 3. Build: let the loop run (10-20 min)

```text
/build-feature <change-id>
```

The orchestrator runs rounds (max 3). Each round is:

1. **worker** (Sonnet by default) implements the change across contract, API, DB, UI, with a test
   per scenario;
2. **`pnpm verify --summary`**, the gate: spec, agents policy, traceability, lint, typecheck,
   tests, build, e2e;
3. **browser-qa** drives the running app in Chromium through every scenario with Playwright MCP;
4. **validator** (Opus, read-only) reviews the spec, diff, tests, gate and browser evidence and
   answers `VERDICT: APPROVE` or `VERDICT: REQUEST_CHANGES`.

Each review is saved to `openspec/changes/<change-id>/reviews/round-N.md`. Read round 1 while
the next round runs: it is the clearest demonstration of what the validator catches that the
worker's own tests did not.

### If the loop stops and asks you something

That is the loop working, not failing. When the validator finds a **spec gap** (behaviour the
spec does not define), the loop stops rather than letting the worker guess a product decision.
In the reference run, round 1 stopped on how the reminders panel should be announced. You:

1. answer the question in the spec: `/opsx:update <change-id>` (it keeps proposal, design,
   specs and tasks coherent; it never edits code);
2. resume: `/build-feature <change-id>`. It continues at the next round number.

## 4. Look at the result

```bash
pnpm dev
```

- Add a todo with a due date a few minutes from now; check the Reminders panel.
- Try a half-entered date, and keyboard-only use.
- Compare with the reference: `git fetch origin pull/2/head:ref-due-reminders` then
  `git diff main ref-due-reminders --stat`.

Run the full gate yourself; do not rely on the agents' word:

```bash
pnpm verify
```

## 5. Archive

```text
/opsx:archive <change-id>
```

The change's delta specs are merged into `openspec/specs/todos/spec.md` and the change moves to
`openspec/changes/archive/`. The spec now describes the shipped behaviour. Commit when you are
happy.

## 6. See what it cost

```bash
pnpm tokens --change <change-id> --format md
```

Requests, input/output tokens, cache write/read and cache-hit % per agent and round, plus a
list-price dollar estimate (an estimate only; on a subscription, tokens and cache-hit % are what
matter).

## Variations once you have done it once

- `/review <change-id>`: run browser-qa and the validator on work **you** wrote, without the
  worker.
- Add `complexity: high` on its own line in a change's `design.md` and the worker is routed to
  Opus (`pnpm loop:route --change <id> --round 1`).
- Try your own idea. Small, UI-observable features work best: tags on todos, a filter, an
  "undo delete".

## If something goes wrong

| Symptom                                | Fix                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm verify` fails at e2e: no browser | `pnpm --filter @web-loop/e2e exec playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` |
| Port 3001 / 5173 already in use        | stop `pnpm dev` before `/build-feature` (browser-qa starts its own `review:serve`)                      |
| A stray review server keeps running    | `pnpm review:stop`                                                                                      |
| Playwright MCP not available           | check `.mcp.json` is approved in Claude Code (`/mcp`)                                                   |
| Loop hit 3 rounds without APPROVE      | read the last review; the open findings are listed. Fix the spec or take over by hand                   |
