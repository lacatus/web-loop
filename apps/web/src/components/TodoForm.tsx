import { CreateTodoInputSchema, TODO_TITLE_MAX } from '@web-loop/shared';
import { useState, type FormEvent } from 'react';
import { useCreateTodo } from '../api/todos';
import { localInputToIso } from '../lib/due';

type FieldError = { field: 'title' | 'dueAt'; message: string };

const inputClass =
  'rounded-md border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-indigo-500';

export function TodoForm() {
  const [title, setTitle] = useState('');
  // `datetime-local` value: local wall-clock time without an offset, or '' when not set.
  const [due, setDue] = useState('');
  const [error, setError] = useState<FieldError | null>(null);
  const createTodo = useCreateTodo();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = CreateTodoInputSchema.safeParse(
      due ? { title, dueAt: localInputToIso(due) } : { title },
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path[0] === 'dueAt'
          ? { field: 'dueAt', message: 'Enter a valid due date' }
          : { field: 'title', message: issue?.message ?? 'Invalid title' },
      );
      return;
    }
    setError(null);
    createTodo.mutate(parsed.data, {
      onSuccess: () => {
        setTitle('');
        setDue('');
      },
      onError: (err) => setError({ field: 'title', message: err.message }),
    });
  };

  const titleError = error?.field === 'title';
  const dueError = error?.field === 'dueAt';

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="new-todo" className="text-sm font-medium">
            New todo
          </label>
          <input
            id="new-todo"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TODO_TITLE_MAX}
            placeholder="What needs doing?"
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? 'new-todo-error' : undefined}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-todo-due" className="text-sm font-medium">
            Due (optional)
          </label>
          <input
            id="new-todo-due"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-invalid={dueError ? true : undefined}
            aria-describedby={dueError ? 'new-todo-error' : undefined}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={createTodo.isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && (
        <p id="new-todo-error" role="alert" className="text-sm text-red-600">
          {error.message}
        </p>
      )}
    </form>
  );
}
