# Design

## Context

See proposal.md for motivation. Current state: `todos` table (`id`, `title`, `completed`, `created_at`), shared zod contract in `packages/shared/src/todo.ts`, list ordered by `id` in `apps/api/src/routes/todos.ts`, UI in `apps/web/src/pages/TodosPage.tsx` + `components/TodoForm.tsx` / `TodoItem.tsx`.

Layers changing: **shared** (contract gains `dueAt`), **db** (new nullable column, generated migration), **api** (accept/return `dueAt`, new ordering), **web** (input, badge, clear action, reminders panel).

## Goals / Non-Goals

**Goals:**

- One definition of "due soon" / "overdue" shared by UI and tests.
- Reminders driven by the client clock so they update without polling the server.

**Non-Goals:**

- Server-side scheduling or push delivery of reminders.
- Timezone preferences — the browser's timezone is used for input and display.

## Decisions

- **Storage: UTC ISO-8601 string (`due_at TEXT NULL`)**, same format as `created_at`. The API accepts any ISO datetime with an offset (`z.iso.datetime({ offset: true })`) and normalizes to UTC `…Z`. Alternative: unix epoch integer — rejected for consistency with `createdAt` and readability.
- **Input: native `<input type="datetime-local">`** labelled "Due (optional)". Its value is local wall-clock time without an offset; the client converts it with `new Date(value).toISOString()`. Native control gives an accessible, mobile-friendly calendar picker for free. Alternative: a JS date-picker library — rejected (weight, a11y risk).
- **Past due dates are accepted.** A user may log something they're already late on; it simply shows as overdue.
- **Ordering in the API** (`ORDER BY due_at IS NULL, due_at, id`), so every client gets the same order. Completion does not affect order (avoids rows jumping when toggled).
- **Reminder classification is a pure function** `reminderFor(todo, now)` in `packages/shared/src/reminders.ts` returning `'overdue' | 'due-soon' | null` (window constant `DUE_SOON_MINUTES = 60`; overdue = `dueAt <= now`; due-soon = `now < dueAt <= now + 60min`; completed or no `dueAt` → `null`). Shared so the web app and tests use one definition.
- **Clock: `useNow(intervalMs = 30_000)` hook** re-renders the panel periodically; tests use fake timers.
- **Reminders panel** is a `<section aria-labelledby>` headed "Reminders" containing a `role="status"` list, rendered only when at least one reminder exists.
- **Clearing** uses `PATCH { dueAt: null }` from a "Clear due date for <title>" button on the item.

## Risks / Trade-offs

- [Client clock skew makes reminders slightly early/late] → Acceptable for in-app reminders; server time is not authoritative for display.
- [Reminders only appear while the page is open] → Explicit non-goal (no push notifications).
- [Order change is breaking for API consumers] → Only consumer is our web app; called out in the proposal.
