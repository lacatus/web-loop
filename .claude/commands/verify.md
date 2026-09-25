---
description: Run the full SDLC quality gate (spec, traceability, lint, typecheck, tests, build, e2e)
argument-hint: [--fast]
---

Run `pnpm verify $ARGUMENTS` from the repo root.

Then report the summary table printed at the end. For each failing gate, show the relevant
error lines (not the whole log), the most likely root cause, and the file:line to look at.
Do not change any code unless the user asks you to fix the failures.
