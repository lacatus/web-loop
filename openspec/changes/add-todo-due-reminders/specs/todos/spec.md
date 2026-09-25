# Spec Delta

## MODIFIED Requirements

### Requirement: List todos

The system SHALL return all todos ordered by due date (soonest first), followed by todos without a due date in creation order; completion state MUST NOT affect the order. The UI SHALL display each todo with its completion state and the number of incomplete todos.

#### Scenario: List todos

- **WHEN** the user opens the Todos page and todos exist
- **THEN** each todo is shown with a checkbox reflecting its completion state
- **AND** the page shows how many todos are left to complete

#### Scenario: Empty list

- **WHEN** the user opens the Todos page and no todos exist
- **THEN** an empty-state message invites the user to add one

#### Scenario: Sort by due date

- **WHEN** todos exist with due dates tomorrow and in one hour, and one without a due date created first
- **THEN** the list shows the one-hour todo, then the tomorrow todo, then the todo without a due date
- **AND** `GET /api/todos` returns them in that same order

## ADDED Requirements

### Requirement: Due date

The system SHALL let a user optionally give a todo a due date and time. The API MUST accept `dueAt` as an ISO-8601 datetime with a timezone offset or `null`, MUST store and return it normalized to UTC (`…Z`), and MUST return `dueAt: null` for todos without one. The UI SHALL offer a "Due (optional)" date-and-time field when creating a todo, SHALL show each todo's due date in the user's local time, and SHALL let the user clear it with a "Clear due date for <title>" button. Due dates in the past MUST be accepted.

#### Scenario: Create a todo with a due date

- **WHEN** the user enters "Pay rent" in "New todo", picks a date and time in "Due (optional)" and presses "Add"
- **THEN** the todo appears showing its due date and time in local time
- **AND** the API stored the same instant as a UTC ISO string in `dueAt`

#### Scenario: Create a todo without a due date

- **WHEN** the user creates a todo leaving "Due (optional)" empty
- **THEN** the todo is created with `dueAt: null` and no due date is shown for it

#### Scenario: Reject an invalid due date

- **WHEN** the API receives a create or update with a `dueAt` that is not an ISO-8601 datetime with an offset (for example "tomorrow" or "2026-13-01T10:00")
- **THEN** it responds 400 with error code `VALIDATION_ERROR` and nothing is created or changed

#### Scenario: Accept a past due date

- **WHEN** a todo is created with a due date in the past
- **THEN** it is created and shown as overdue

#### Scenario: Clear a due date

- **WHEN** the user activates "Clear due date for <title>" on a todo with a due date
- **THEN** the due date is no longer shown, the todo moves among the todos without a due date, and `dueAt` is `null` after reload

### Requirement: Reminders

The UI SHALL show a "Reminders" panel listing every incomplete todo that is overdue (due date at or before now) or due soon (due date within the next 60 minutes), overdue first, then by due date. Each entry MUST read "<title> — overdue" or "<title> — due in N min" (N rounded up, minimum 1). The panel MUST update as time passes without reloading the page (at least every 30 seconds) and MUST be announced politely to assistive technology. The panel MUST NOT be shown when there are no reminders. Overdue incomplete todos SHALL also be visibly marked "Overdue" in the list.

#### Scenario: Due soon reminder

- **WHEN** an incomplete todo "Call mom" is due in 10 minutes
- **THEN** the Reminders panel shows "Call mom — due in 10 min"

#### Scenario: Overdue reminder

- **WHEN** an incomplete todo "Pay rent" was due 5 minutes ago
- **THEN** the Reminders panel shows "Pay rent — overdue"
- **AND** the todo is marked "Overdue" in the list

#### Scenario: No reminder for completed or distant todos

- **WHEN** a todo is completed, has no due date, or is due more than 60 minutes from now
- **THEN** it does not appear in the Reminders panel

#### Scenario: Reminder appears as time passes

- **WHEN** a todo is due in 61 minutes and the page stays open for 2 minutes
- **THEN** it appears in the Reminders panel without a reload

#### Scenario: No reminders

- **WHEN** no todo is overdue or due within 60 minutes
- **THEN** no Reminders panel is shown

#### Scenario: Completing clears the reminder

- **WHEN** the user completes a todo that is listed in the Reminders panel
- **THEN** it disappears from the Reminders panel
