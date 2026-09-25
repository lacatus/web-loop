import { reminderFor, type Todo } from '@web-loop/shared';
import { useLayoutEffect, useRef } from 'react';
import { useDeleteTodo, useUpdateTodo } from '../api/todos';
import { formatDue } from '../lib/due';

export function TodoItem({ todo, now }: { todo: Todo; now: number }) {
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const checkboxId = `todo-${todo.id}`;
  const checkboxRef = useRef<HTMLInputElement>(null);
  const overdue = reminderFor(todo, now) === 'overdue';

  // After "Clear due date for …" the button disappears, so keep focus on this todo's checkbox
  // until the clear has settled (the row may be moved in the DOM when the list is re-sorted).
  const focusCheckboxAfterClear = useRef(false);
  const clearSettled =
    updateTodo.variables?.dueAt === null && (updateTodo.isSuccess || updateTodo.isError);
  useLayoutEffect(() => {
    if (!focusCheckboxAfterClear.current) return;
    const checkbox = checkboxRef.current;
    if (checkbox && document.activeElement !== checkbox) checkbox.focus();
    if (clearSettled) focusCheckboxAfterClear.current = false;
  });

  const clearDueDate = () => {
    focusCheckboxAfterClear.current = true;
    updateTodo.mutate({ id: todo.id, dueAt: null });
  };

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <input
        ref={checkboxRef}
        id={checkboxId}
        type="checkbox"
        checked={todo.completed}
        onChange={(e) => updateTodo.mutate({ id: todo.id, completed: e.target.checked })}
        className="mt-1.5 size-4 shrink-0 accent-indigo-600"
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <label
          htmlFor={checkboxId}
          className={`min-w-0 grow basis-40 py-0.5 break-words ${todo.completed ? 'text-slate-400 line-through' : ''}`}
        >
          {todo.title}
        </label>
        {todo.dueAt && (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            {overdue && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                Overdue
              </span>
            )}
            <span className={overdue ? 'text-red-700' : 'text-slate-500'}>
              Due <time dateTime={todo.dueAt}>{formatDue(todo.dueAt)}</time>
            </span>
            <button
              type="button"
              onClick={clearDueDate}
              aria-label={`Clear due date for ${todo.title}`}
              className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Clear
            </button>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => deleteTodo.mutate(todo.id)}
        disabled={deleteTodo.isPending}
        aria-label={`Delete ${todo.title}`}
        className="shrink-0 rounded px-2 py-1 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600"
      >
        Delete
      </button>
    </li>
  );
}
