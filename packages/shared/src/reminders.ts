import type { Todo } from './todo';

/** A todo is "due soon" when its due date is within this many minutes from now. */
export const DUE_SOON_MINUTES = 60;

const MINUTE_MS = 60_000;

export type ReminderKind = 'overdue' | 'due-soon';

type Remindable = Pick<Todo, 'completed' | 'dueAt'>;

const toMs = (now: Date | number) => (typeof now === 'number' ? now : now.getTime());

/**
 * Classifies a todo at instant `now`:
 * - `'overdue'`  when incomplete and `dueAt <= now`
 * - `'due-soon'` when incomplete and `now < dueAt <= now + DUE_SOON_MINUTES`
 * - `null`       when completed, without a due date, or due later than that.
 */
export function reminderFor(todo: Remindable, now: Date | number): ReminderKind | null {
  if (todo.completed || todo.dueAt === null) return null;
  const due = Date.parse(todo.dueAt);
  const nowMs = toMs(now);
  if (due <= nowMs) return 'overdue';
  if (due <= nowMs + DUE_SOON_MINUTES * MINUTE_MS) return 'due-soon';
  return null;
}

/** Whole minutes until `dueAt`, rounded up, never less than 1 (for "due in N min"). */
export function minutesUntilDue(dueAt: string, now: Date | number): number {
  return Math.max(1, Math.ceil((Date.parse(dueAt) - toMs(now)) / MINUTE_MS));
}

export interface Reminder<T extends Remindable = Todo> {
  todo: T;
  kind: ReminderKind;
}

/** Every todo that has a reminder at `now`: overdue first, then by due date (then list order). */
export function remindersFor<T extends Remindable>(todos: readonly T[], now: Date | number) {
  const reminders: Reminder<T>[] = [];
  for (const todo of todos) {
    const kind = reminderFor(todo, now);
    if (kind) reminders.push({ todo, kind });
  }
  // Overdue items are by definition due earlier than due-soon ones, so ordering by due date
  // alone yields "overdue first, then by due date". Array.sort is stable for ties.
  return reminders.sort((a, b) => Date.parse(a.todo.dueAt ?? '') - Date.parse(b.todo.dueAt ?? ''));
}
