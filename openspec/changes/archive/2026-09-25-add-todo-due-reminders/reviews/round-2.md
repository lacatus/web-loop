VERDICT: APPROVE

## Review — add-todo-due-reminders round 2

### Summary

Round 2 fixes all four findings the human sent back. F1: a half-entered due date now blocks the submit, shows an error with `role="alert"` and marks the field `aria-invalid`. F4: the API accepts due datetimes without seconds. F3: focus moves to the todo's checkbox after "Clear due date for …". F5: "Delete" stays at the top right of every row at 375px. All of these were checked in real Chromium, and every gate is green. One new layout nit at 375px (N1): a Reminders entry whose title is a long word with no spaces runs past the panel.

### Scenario verification

| Scenario | Test(s) | Asserts THEN? | Browser-verified | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| List todos | api, TodosPage.test.tsx | Yes | Yes (checkboxes, "10 items left") | r2-due-soon-overdue-sort.png | Pass |
| Empty list | api, TodosPage.test.tsx | Yes | Yes (empty state, no panel) | r2-no-reminders.png | Pass |
| Sort by due date | api, TodosPage.test.tsx, e2e | Yes | Yes (soonest first, undated last by id; completing a todo didn't move it) | r2-due-soon-overdue-sort.png | Pass |
| Create a todo with a due date | shared, api, TodosPage.test.tsx, e2e | Yes | Yes (UI → "Oct 1, 2026, 9:30 AM", stored as UTC; seconds-less values accepted on create and PATCH) | r2-due-soon-overdue-sort.png | Pass |
| Create a todo without a due date | api, TodosPage.test.tsx | Yes | Yes (`dueAt:null`; a double-click on "Add" created only one todo) | r2-create-without-due-date.png | Pass |
| Reject an invalid due date | shared, api | Yes | Yes (4 invalid values → 400 `VALIDATION_ERROR`, nothing created) | server.log | Pass |
| Reject an incomplete due date | TodosPage.test.tsx, e2e | Yes | Yes (`badInput:true` → alert, `aria-invalid`, no POST) | r2-reject-an-incomplete-due-date.png | Pass |
| Accept a past due date | api, TodosPage.test.tsx, e2e | Yes | Yes (Overdue marker plus a panel entry) | r2-due-soon-overdue-sort.png | Pass |
| Clear a due date | shared, api, TodosPage.test.tsx, e2e | Yes (including focus) | Yes, keyboard only at 375px (focus on the checkbox, re-sorted, `dueAt:null`) | r2-clear-a-due-date.png | Pass |
| Due soon reminder | shared, TodosPage.test.tsx, e2e | Yes | Yes ("Call mom — due in 10 min") | r2-due-soon-overdue-sort.png | Pass |
| Overdue reminder | shared, TodosPage.test.tsx, e2e | Yes | Yes ("Pay rent — overdue") | same | Pass |
| No reminder for completed or distant todos | shared, TodosPage.test.tsx | Yes | Yes | r2-completing-clears-reminder.png | Pass |
| Reminder appears as time passes | TodosPage.test.tsx | Yes | Yes (appeared at 12:20 with no reload and a single GET) | r2-narrow-375-long-titles.png | Pass |
| No reminders | TodosPage.test.tsx | Yes | Yes | r2-no-reminders.png | Pass |
| Completing clears the reminder | TodosPage.test.tsx, e2e | Yes | Yes, keyboard only | r2-completing-clears-reminder.png | Pass |

Browser console: 0 errors and 0 warnings. Server log: no 5xx.

### Gates

All green: spec, traceability (15/15), lint, typecheck, test, build, e2e (11/11).

### Findings

#### N1 [nit] A long title with no spaces overflows the Reminders panel at 375px

- Where: `apps/web/src/components/RemindersPanel.tsx:18-24` (the `<li>` lacks `break-words`). At 375px the page becomes 604px wide. Fix: add `min-w-0 break-words`.

#### N2 [nit] The out-of-range-year test is filed under the wrong scenario

- Where: `apps/web/src/pages/TodosPage.test.tsx`. `10000-01-01T00:00` is a complete value, not a partly entered one. Reword the test title.

### Previous findings

| Finding | Status |
| --- | --- |
| F1 [blocking] | Resolved (checked in real Chromium, plus unit and e2e tests) |
| F2 [spec-gap] | Settled by the human's spec change |
| F3 [nit] | Resolved (keyboard check: focus survives the re-sort) |
| F4 [nit] | Resolved |
| F5 [nit] | Resolved for the list rows (measured at 375px); the panel's overflow is reported as N1 |
| Worker kept the out-of-range-year check | Dispute accepted: the check is reachable in Chromium (`10000-01-01T12:00`) |

### Questions for the human

- None.

## Worker report

Round 2 fixed F1, F3, F4 and F5, and added the "Reject an incomplete due date" tests (unit, plus e2e with a real `badInput`). The new tests failed against the round-1 components and pass with the fixes. `pnpm verify` passed: e2e 11/11, traceability 15/15.
