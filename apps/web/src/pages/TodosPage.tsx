import { useTodos } from '../api/todos';
import { RemindersPanel } from '../components/RemindersPanel';
import { TodoForm } from '../components/TodoForm';
import { TodoItem } from '../components/TodoItem';
import { useNow } from '../hooks/useNow';

export function TodosPage() {
  const { data: todos, isPending, isError, refetch } = useTodos();
  const remaining = todos?.filter((t) => !t.completed).length ?? 0;
  const now = useNow();

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Todos</h1>
      <TodoForm />

      {todos && <RemindersPanel todos={todos} now={now} />}

      {isPending && <p className="text-slate-500">Loading…</p>}

      {isError && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Could not load todos.{' '}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      )}

      {todos && todos.length === 0 && (
        <p className="text-slate-500">No todos yet. Add one above.</p>
      )}

      {todos && todos.length > 0 && (
        <>
          <ul
            aria-label="Todo list"
            className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white"
          >
            {todos.map((todo) => (
              <TodoItem key={todo.id} todo={todo} now={now} />
            ))}
          </ul>
          <p aria-live="polite" className="text-sm text-slate-500">
            {remaining} {remaining === 1 ? 'item' : 'items'} left
          </p>
        </>
      )}
    </section>
  );
}
