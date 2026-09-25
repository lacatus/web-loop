---
description: Run the validator alone as a PR-style review of the current work against an OpenSpec change
argument-hint: <change-id> [base-ref=origin/main]
---

Run a standalone review with the `validator` subagent (fed by `pnpm verify --summary` and the
`browser-qa` subagent, since the validator does not drive the browser itself).

1. Parse `$ARGUMENTS`: first word = change id (if missing, use the single active change from
   `openspec list --json` or ask), second word = base ref (default: `origin/main` if it exists,
   else the repository's first commit — `git rev-list --max-parents=0 HEAD`).
2. Run `pnpm verify --summary` and keep its output.
3. If the change has UI-observable scenarios, launch the `browser-qa` subagent
   (`subagent_type: "browser-qa"`) with a prompt starting `change=<change>` and
   `round=standalone`; keep its evidence table. Otherwise the evidence is
   `browser-qa: skipped — no UI-observable scenarios`.
4. Launch the `validator` subagent (`subagent_type: "validator"`) with a prompt starting
   `change=<change>`, `base=<base>`, `round=standalone`, stating that no worker report is
   available and it should review the diff directly, followed by the verify summary and the
   browser-qa evidence. If it answers `RECHECK`, run browser-qa once more with `recheck=` and its
   table and continue the validator with the new evidence (as in `/build-feature` step 1e).
5. Save its output to `openspec/changes/<change>/reviews/standalone-<YYYYMMDD-HHMM>.md`,
   followed by `## Browser QA` with the evidence.
6. Show the user the verdict, the scenario verification table, and the blocking / spec-gap
   findings. Do not fix anything unless the user asks (suggest `/build-feature <change>`).
