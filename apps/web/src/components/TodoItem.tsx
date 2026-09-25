import type { Todo } from '@web-loop/shared';
import { useDeleteTodo, useUpdateTodo } from '../api/todos';

export function TodoItem({ todo }: { todo: Todo }) {
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const checkboxId = `todo-${todo.id}`;

  return (
    <li className="flex items-center gap-3 px-4 py-3">
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
