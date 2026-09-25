import { reminderFor, type Todo } from '@web-loop/shared';
import { useDeleteTodo, useUpdateTodo } from '../api/todos';
import { formatDue } from '../lib/due';

export function TodoItem({ todo, now }: { todo: Todo; now: number }) {
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const checkboxId = `todo-${todo.id}`;
  const overdue = reminderFor(todo, now) === 'overdue';

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <input
        id={checkboxId}
        type="checkbox"
        checked={todo.completed}
        onChange={(e) => updateTodo.mutate({ id: todo.id, completed: e.target.checked })}
        className="size-4 accent-indigo-600"
      />
      <label
        htmlFor={checkboxId}
        className={`flex-1 ${todo.completed ? 'text-slate-400 line-through' : ''}`}
      >
        {todo.title}
      </label>
      {todo.dueAt && (
        <span className="flex items-center gap-2 text-sm">
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
            onClick={() => updateTodo.mutate({ id: todo.id, dueAt: null })}
            aria-label={`Clear due date for ${todo.title}`}
            className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            Clear
          </button>
        </span>
      )}
      <button
        type="button"
        onClick={() => deleteTodo.mutate(todo.id)}
        disabled={deleteTodo.isPending}
        aria-label={`Delete ${todo.title}`}
        className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600"
      >
        Delete
      </button>
    </li>
  );
}
