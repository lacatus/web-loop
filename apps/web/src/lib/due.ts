import { minutesUntilDue, type ReminderKind, type Todo } from '@web-loop/shared';

const dueFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Formats a UTC ISO due date in the user's local time zone and locale. */
export const formatDue = (dueAt: string): string => dueFormat.format(new Date(dueAt));

/**
 * Converts a `datetime-local` value (local wall-clock time, no offset) to a UTC ISO string.
 * An unparseable value is returned unchanged so the shared schema rejects it.
 */
export function localInputToIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** Text of a reminder entry, e.g. "Call mom — due in 10 min" or "Pay rent — overdue". */
export function reminderText(todo: Todo, kind: ReminderKind, now: number): string {
  if (kind === 'overdue') return `${todo.title} — overdue`;
  return `${todo.title} — due in ${minutesUntilDue(todo.dueAt ?? '', now)} min`;
}
