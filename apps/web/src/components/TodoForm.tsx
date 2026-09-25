import { CreateTodoInputSchema, TODO_TITLE_MAX } from '@web-loop/shared';
import { useState, type FormEvent } from 'react';
import { useCreateTodo } from '../api/todos';

export function TodoForm() {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createTodo = useCreateTodo();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = CreateTodoInputSchema.safeParse({ title });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid title');
      return;
    }
    setError(null);
    createTodo.mutate(parsed.data, {
      onSuccess: () => setTitle(''),
      onError: (err) => setError(err.message),
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <label htmlFor="new-todo" className="block text-sm font-medium">
        New todo
      </label>
      <div className="flex gap-2">
        <input
          id="new-todo"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TODO_TITLE_MAX}
          placeholder="What needs doing?"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'new-todo-error' : undefined}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-indigo-500"
        />
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
          {error}
        </p>
      )}
    </form>
  );
}
