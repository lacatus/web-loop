VERDICT: REQUEST_CHANGES

## Review — add-todo-due-reminders round 1

### Summary

The change adds an optional `dueAt` field to the shared contract, a generated nullable `due_at` column, API ordering by due date, and in the UI a "Due (optional)" field, a due-date line with an "Overdue" marker and a "Clear due date for <title>" button, and a Reminders panel that updates every 30 s. The code is clean and follows the repo's patterns. The tests are strong: they assert the THEN clauses, and the fake timers only replace `Date` and `setInterval`. All 7 gates are green, and every scenario behaved correctly in the browser. It can't be approved yet for two reasons. First, a due date the user has only half entered is silently dropped when the todo is created, which is a bug found in the browser. Second, the spec and the design conflict on how the panel is announced, and a human needs to decide that.

### Scenario verification

| Scenario | Test(s) | Test asserts THEN? | Browser-verified | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| List todos | api todos.test.ts, TodosPage.test.tsx | Yes | Yes (checkboxes, "N items left") | r1-due-soon-overdue-reminders.png | Pass |
| Empty list | api, TodosPage.test.tsx | Yes | Yes (empty-state message, no panel) | r1-empty-list.png | Pass |
| Sort by due date | api (2), TodosPage.test.tsx, e2e | Yes (UI order and API order) | Yes (soonest first, then undated by id; completing a todo didn't move it) | r1-due-soon-overdue-reminders.png, r1-clear-due-date.png | Pass |
| Create a todo with a due date | shared, api, TodosPage.test.tsx, e2e | Yes (UTC stored value, `<time>` shows local time) | Yes via the UI: `2026-10-01T09:30` → shown as "Oct 1, 2026, 9:30 AM", stored as `…09:30:00.000Z`. The browser time zone was UTC, so conversion to another zone is covered only by the tests. | r1-create-with-due-date.png | Pass |
| Create a todo without a due date | api, TodosPage.test.tsx | Yes (no `dueAt` key sent, nothing shown) | Yes (`<b>x</b> no due` → `dueAt:null`, no `<time>`) | r1-clear-due-date.png | Pass (see F1 for the partial-input case) |
| Reject an invalid due date | shared, api (create + PATCH, nothing changed) | Yes | Yes (curl: `2026-02-30…`, `24:00`, an out-of-range year → 400 `VALIDATION_ERROR`; no 5xx) | server.log: 5×400, 0×5xx | Pass |
| Accept a past due date | api, TodosPage.test.tsx, e2e | Yes | Yes via the UI (`2026-09-01T08:00` → "Overdue" marker plus a panel entry) | r1-accept-past-due-date.png | Pass |
| Clear a due date | shared, api, TodosPage.test.tsx, e2e | Yes (moves among the undated todos, `dueAt` null after reload) | Yes, keyboard only (Enter); order kept after reload; API `dueAt:null` | r1-clear-due-date.png | Pass |
| Due soon reminder | shared, TodosPage.test.tsx, e2e | Yes (exact text) | Yes ("Call mom — due in 10 min") | r1-due-soon-overdue-reminders.png | Pass |
| Overdue reminder | shared, TodosPage.test.tsx, e2e | Yes | Yes ("Pay bills — overdue" plus the "Overdue" marker) | same | Pass |
| No reminder for completed or distant todos | shared, TodosPage.test.tsx | Yes | Yes ("Done late" was completed while overdue; "Distant" is +120 min; neither is listed) | same | Pass |
| Reminder appears as time passes | TodosPage.test.tsx (2 tests) | Yes (no refetch; 30 s tick) | Yes (entered the window at 11:23:49 and appeared at 11:23:54 without a reload or a new `/api/todos` request) | r1-reminder-appears-as-time-passes.png | Pass |
| No reminders | TodosPage.test.tsx | Yes (no region, heading or status) | Yes (empty list: no panel) | r1-empty-list.png | Pass |
| Completing clears the reminder | TodosPage.test.tsx, e2e | Yes | Yes, keyboard only (Space → removed from the panel) | r1-completing-clears-reminder.png | Pass |

Other checks: the HTML-like title renders as text. A long unicode title works. At 375x800 there is no horizontal scroll. There were 0 console errors or warnings, and the server log has no 5xx.

### Gates

| Gate | Result |
| --- | --- |
| spec | pass |
| traceability | pass (14/14) |
| lint | pass |
| typecheck | pass |
| test | pass |
| build | pass |
| e2e | pass (10/10) |

### Findings

#### F1 [blocking] A half-entered due date is silently dropped and the todo is created without one

- Where: `apps/web/src/components/TodoForm.tsx:21-23`
- Problem: when a `datetime-local` field holds an incomplete entry, the browser reports `value === ''` and sets `validity.badInput === true`. The form treats that as "no due date": it creates the todo with `dueAt: null`, shows no error, and the partial date stays visible in the field. The user believes a reminder is set when it isn't. The "Enter a valid due date" error branch can't be reached from the UI, so it is effectively dead code.
- Repro: type "Partial due", press Tab, type `10012026` with no time, press Enter. The API returns `dueAt: null` and there is no alert. See r1-partial-due-input-silently-dropped.png.
- Expected: if the field has `validity.badInput` set, block the submit and show a `role="alert"` error on the field, with `aria-invalid` set, and add a component test for it.

#### F2 [spec-gap] "MUST be announced politely" conflicts with "render the panel only when a reminder exists"

- Where: spec, Requirement "Reminders"; design; `apps/web/src/components/RemindersPanel.tsx:7`
- Problem: the live region is added to the page together with its content, so the first reminder may not be announced by screen readers.
- Human decision: either keep a live region that is always present, or relax the spec.

#### F3 [nit] Keyboard focus falls back to `<body>` after "Clear due date for …" (`TodoItem.tsx:36-43`)

#### F4 [nit] The API rejects valid ISO-8601 datetimes that omit seconds (`"2026-10-01T10:00Z"` → 400)

#### F5 [nit] Uneven wrapping at 375px (Delete sometimes drops onto its own line)

### Questions for the human (spec gaps)

- F2: should the announcement come from a live region that is always present, or should the spec be relaxed?
- F4 (optional): should `dueAt` without seconds be accepted, or should the spec require seconds?

## Worker report

Round 1 implemented all 14 scenarios, and `pnpm verify` passed (full report in the session log). It flagged two items needing a human decision: the live-region announcement (same issue as F2) and the due-date display format (implemented as `Intl.DateTimeFormat` medium date + short time).
