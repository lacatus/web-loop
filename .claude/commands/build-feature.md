---
description: Run the worker ⇄ validator loop on an OpenSpec change until the validator approves
argument-hint: <change-id> [max-rounds=3]
---

You are the **orchestrator** of the worker ⇄ validator loop for the OpenSpec change in
`$ARGUMENTS` (first word = change id, optional second word = max rounds, default 3).
You coordinate; you do not write feature code or reviews yourself.

## 0. Preflight

1. If no change id was given, run `openspec list --json`; if exactly one active change exists
   use it, otherwise ask the user which one.
2. `openspec validate <change> --strict --no-interactive` and
   `openspec status --change <change> --json`. If proposal, specs, or tasks are missing or
   invalid, STOP and tell the user to finish the proposal (`/opsx:propose` or `/opsx:update`).
   Never start building from an invalid spec.
3. Record the base for the review diff: `BASE=$(git rev-parse HEAD)`. Mention it in your
   first message.
4. `mkdir -p openspec/changes/<change>/reviews`.

## 1. Loop — for round = 1 … max-rounds

**a. Worker.** Launch the `worker` subagent (Agent tool, `subagent_type: "worker"`) with:
`change=<change>`, `round=<n>`, and for n > 1 `review=openspec/changes/<change>/reviews/round-<n-1>.md`.
Keep its final report.

**b. Validator.** Launch the `validator` subagent (`subagent_type: "validator"`) with:
`change=<change>`, `base=<BASE>`, `round=<n>`, and the worker's report pasted verbatim.
The validator must be a fresh agent every round (independent review, no shared context).

**c. Record.** Write the validator's full output to
`openspec/changes/<change>/reviews/round-<n>.md`, followed by a `## Worker report` section
containing the worker's report. This file is the PR thread for the round.

**d. Decide** from the first line (`VERDICT: …`):
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
- rounds taken and a one-line summary per round (from the review files)
- the final scenario verification table from the approving review
- `git diff --stat <BASE>`
- next steps: review the diff, then `/opsx:archive <change>` to merge the delta into
  `openspec/specs/`, then commit.

Do not commit, push, or archive unless the user asks.
