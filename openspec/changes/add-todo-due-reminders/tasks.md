# Tasks

## 1. Contract

- [x] 1.1 Add `dueAt` (UTC ISO string | null) to `TodoSchema`, optional nullable `dueAt` (ISO with offset) to `CreateTodoInputSchema` and `UpdateTodoInputSchema` in `packages/shared/src/todo.ts` — tests: `packages/shared/src/todo.test.ts` (Scenario: Reject an invalid due date)
- [x] 1.2 Add `packages/shared/src/reminders.ts` with `DUE_SOON_MINUTES` and `reminderFor(todo, now)` — tests: `packages/shared/src/reminders.test.ts` (Scenario: Due soon reminder, Scenario: Overdue reminder, Scenario: No reminder for completed or distant todos)

## 2. API + migration

- [x] 2.1 Add nullable `due_at` to `apps/api/src/db/schema.ts` and run `pnpm db:generate`
- [x] 2.2 Accept/normalize/return `dueAt` in create and update; order `GET /api/todos` by due date then id — tests: `apps/api/test/todos.test.ts` (Scenario: Create a todo with a due date, Scenario: Create a todo without a due date, Scenario: Reject an invalid due date, Scenario: Accept a past due date, Scenario: Clear a due date, Scenario: Sort by due date)

## 3. Web

- [x] 3.1 "Due (optional)" `datetime-local` field in `TodoForm`, converted to UTC ISO on submit
- [x] 3.2 Due date `<time>` badge, "Overdue" marker and "Clear due date for <title>" button in `TodoItem`
- [x] 3.3 `useNow` clock hook and `RemindersPanel` rendered on the Todos page
- [x] 3.4 Component tests: `apps/web/src/pages/TodosPage.test.tsx` and/or `apps/web/src/components/RemindersPanel.test.tsx` (Scenario: Create a todo with a due date, Scenario: Sort by due date, Scenario: Due soon reminder, Scenario: Overdue reminder, Scenario: No reminder for completed or distant todos, Scenario: Reminder appears as time passes, Scenario: No reminders, Scenario: Completing clears the reminder, Scenario: Clear a due date)

## 4. End-to-end

- [x] 4.1 `e2e/tests/reminders.spec.ts`: create a todo due in ~10 minutes and see the reminder; create an overdue todo and see it marked; clear a due date (Scenario: Create a todo with a due date, Scenario: Due soon reminder, Scenario: Accept a past due date, Scenario: Clear a due date)

## 5. Verify

- [x] 5.1 `pnpm verify` green and `node scripts/check-traceability.mjs --change add-todo-due-reminders` shows every scenario covered

## 6. Round 2 (review findings, see reviews/round-1.md)

- [x] 6.1 F1: block submit when "Due (optional)" has `validity.badInput`; show "Enter a valid due date" — test: TodosPage.test.tsx (Scenario: Reject an incomplete due date)
- [x] 6.2 F4: accept ISO datetimes without seconds — tests: packages/shared/src/todo.test.ts, apps/api/test/todos.test.ts
- [x] 6.3 F3: after "Clear due date for <title>", move focus to that todo's checkbox — test: TodosPage.test.tsx
- [x] 6.4 F5: keep "Delete" aligned right at 375px
- [x] 6.5 `pnpm verify` green
