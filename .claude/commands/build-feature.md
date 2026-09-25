---
description: Run the worker ⇄ validator loop on an OpenSpec change until the validator approves
argument-hint: <change-id> [max-rounds=3]
---

You are the **orchestrator** of the worker ⇄ validator loop for the OpenSpec change in
`$ARGUMENTS` (first word = change id, optional second word = max rounds, default 3).
You coordinate; you do not write feature code or reviews yourself.

Routing (model, effort, turn budget, cache TTL, MCP access per agent) lives in
`.claude/loop-policy.json` and the agent files; never override it except with the worker model
returned by `pnpm loop:route`. Every subagent prompt MUST start with `key=value` lines
(`change=…`, `round=…`, …) — the token report uses them to attribute usage to a round.

## 0. Preflight

1. If no change id was given, run `openspec list --json`; if exactly one active change exists
   use it, otherwise ask the user which one.
2. `openspec validate <change> --strict --no-interactive` and
   `openspec status --change <change> --json`. If proposal, specs, or tasks are missing or
   invalid, STOP and tell the user to finish the proposal (`/opsx:propose` or `/opsx:update`).
   Never start building from an invalid spec.
3. `pnpm -s check:agents` must pass (agents match the routing policy). If it fails, STOP and
   show the violations.
4. Record the base for the review diff: `BASE=$(git rev-parse HEAD)`. Mention it in your
   first message.
5. `mkdir -p openspec/changes/<change>/reviews`.
6. Decide whether the change has UI-observable scenarios (read its `specs/**/spec.md`: a
   scenario is UI-observable when its WHEN/THEN happen in the web app). If none are, browser QA
   is skipped for every round; say so in your first message.

## 1. Loop — for round = 1 … max-rounds

**a. Route.** `pnpm -s loop:route --change <change> --round <n>`. The first line is the worker
model (`sonnet` or `opus`), the second its reason. Keep both for the record.

**b. Worker.** Launch the `worker` subagent (Agent tool, `subagent_type: "worker"`,
`model: <routed model>`) with a prompt starting:
```
change=<change>
round=<n>
review=openspec/changes/<change>/reviews/round-<n-1>.md   (only for n > 1)
```
Keep its final report.

**c. Gate.** Run `pnpm verify --summary` yourself (no subagent). Keep its output (summary table
plus the tail of failing gates) for the validator; do not open the full logs in
`artifacts/verify/` unless you need to explain a failure to the user.

**d. Browser QA.** Unless browser QA is skipped for this change, launch the `browser-qa`
subagent (`subagent_type: "browser-qa"`) with a prompt starting `change=<change>` and
`round=<n>`. Keep its evidence table (it is capped at about 60 lines). If skipped, the evidence is
the single line `browser-qa: skipped — no UI-observable scenarios`.

**e. Validator.** Launch the `validator` subagent (`subagent_type: "validator"`) with a prompt
starting `change=<change>`, `base=<BASE>`, `round=<n>`, followed by the worker's report, the
verify summary and the browser-qa evidence, each pasted verbatim under its own heading.
The validator must be a fresh agent every round (independent review, no shared context).

- If its final message starts with `RECHECK` (at most once per round): launch `browser-qa`
  again with `change=<change>`, `round=<n>` and `recheck=` followed by the validator's table,
  then continue the **same** validator with the new evidence (SendMessage to its agent id; if
  continuing an agent is not available, launch a fresh validator with the original inputs plus
  its `RECHECK` request and the new evidence). A second `RECHECK` in the same round: reply that
  no further re-checks are available and it must decide.

**f. Record.** Write `openspec/changes/<change>/reviews/round-<n>.md`: the validator's full
final output, then `## Browser QA` (the evidence, incl. any re-check), then `## Worker report`
(the first line `Routing: worker on <model> — <reason>`, then the worker's report). Then append
the round's token usage so the file **ends** with a `## Tokens` section:
```
pnpm -s tokens --change <change> --round <n> --format md --append openspec/changes/<change>/reviews/round-<n>.md
```
It has one row per agent that ran in the round (worker, browser-qa, validator) with requests,
input, output, cache write, cache read, cache-hit % and the list-price estimate. This file is
the PR thread for the round.

**g. Decide** from the first line (`VERDICT: …`):
- `APPROVE` → go to **2. Done**.
- `REQUEST_CHANGES` with any `spec-gap` finding → STOP the loop. Show the user the
  "Questions for the human" section and ask them to decide. Offer to update the spec with
  `/opsx:update <change>` and then resume with `/build-feature <change>`. Do not let the worker
  guess product decisions.
- `REQUEST_CHANGES` otherwise → next round.
- Worker reported "Needs human decision" items → treat as spec gaps (stop and ask).

If max rounds are exhausted without approval, STOP and escalate: list the still-open
blocking findings and where the worker and validator disagree.

## 2. Done

Report to the user:
- rounds taken and a one-line summary per round (from the review files), including the worker
  model and routing reason per round
- the final scenario verification table from the approving review
- token usage totalled across all rounds of this change:
  `pnpm -s tokens --change <change> --format md` (one row per agent and round plus a total;
  dollars are a list-price estimate — the account is on a subscription plan)
- `git diff --stat <BASE>`
- next steps: review the diff, then `/opsx:archive <change>` to merge the delta into
  `openspec/specs/`, then commit.

Do not commit, push, or archive unless the user asks.
