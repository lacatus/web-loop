import { remindersFor, type Todo } from '@web-loop/shared';
import { reminderText } from '../lib/due';

/** Incomplete todos that are overdue or due soon at `now`; renders nothing when there are none. */
export function RemindersPanel({ todos, now }: { todos: Todo[]; now: number }) {
  const reminders = remindersFor(todos, now);
  if (reminders.length === 0) return null;

  return (
    <section
      aria-labelledby="reminders-heading"
      className="rounded-md border border-amber-300 bg-amber-50 p-4"
    >
      <h2 id="reminders-heading" className="text-lg font-semibold text-amber-900">
        Reminders
      </h2>
      <div role="status" aria-live="polite">
        <ul className="mt-2 space-y-1 text-sm">
          {reminders.map(({ todo, kind }) => (
            <li
              key={todo.id}
              className={kind === 'overdue' ? 'font-medium text-red-700' : 'text-amber-900'}
            >
              {reminderText(todo, kind, now)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
