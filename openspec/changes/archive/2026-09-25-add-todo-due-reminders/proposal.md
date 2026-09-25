# Proposal

## Why

Todos have no notion of *when* they need to be done, so the list can't tell the user what is urgent. Users want to set a date and time a task is due and get a small in-app reminder when it is coming up or has been missed.

## What Changes

- Todos gain an optional **due date and time**, set with a date/time picker when creating a todo, and clearable afterwards.
- The list is ordered by due date (soonest first); todos without a due date follow in creation order. **BREAKING** for API consumers relying on pure creation order from `GET /api/todos`.
- Each todo with a due date shows it in the user's local time; overdue incomplete todos are visibly marked.
- A **Reminders** panel lists incomplete todos that are overdue or due within the next 60 minutes, and updates on its own as time passes (no reload needed).

## Non-goals

- Browser/OS push notifications, sounds, or email.
- Per-todo reminder lead times, snoozing, or dismissing reminders.
- Recurring todos.
- A calendar/month view.
- Editing an existing todo's due date from the UI other than clearing it (the API supports changing it).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `todos`: list ordering changes to due-date-first; adds the due date requirement and the reminders requirement.

## Impact

- `packages/shared`: `dueAt` on `Todo`, `CreateTodoInput`, `UpdateTodoInput`.
- `apps/api`: nullable `due_at` column + migration; ordering in `GET /api/todos`; create/update accept `dueAt`.
- `apps/web`: "Due" date/time input in the form, due badge + clear action on items, Reminders panel with a ticking clock.
- `e2e`: due-date and reminder journeys.
