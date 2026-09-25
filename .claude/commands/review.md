---
description: Run the validator alone as a PR-style review of the current work against an OpenSpec change
argument-hint: <change-id> [base-ref=origin/main]
---

Run a standalone review with the `validator` subagent.

1. Parse `$ARGUMENTS`: first word = change id (if missing, use the single active change from
   `openspec list --json` or ask), second word = base ref (default: `origin/main` if it exists,
   else the repository's first commit — `git rev-list --max-parents=0 HEAD`).
2. Launch the `validator` subagent (`subagent_type: "validator"`) with `change`, `base`, and
   `round=standalone`, stating that no worker report is available and it should review the diff
   directly.
3. Save its output to `openspec/changes/<change>/reviews/standalone-<YYYYMMDD-HHMM>.md`.
4. Show the user the verdict, the scenario verification table, and the blocking / spec-gap
   findings. Do not fix anything unless the user asks (suggest `/build-feature <change>`).
