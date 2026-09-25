import type { Todo, UpdateTodoInput } from '@web-loop/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

const todosKey = ['todos'] as const;

export function useTodos() {
  return useQuery({ queryKey: todosKey, queryFn: api.listTodos });
}

function useInvalidateTodos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: todosKey });
}

export function useCreateTodo() {
  const onSuccess = useInvalidateTodos();
  return useMutation({ mutationFn: api.createTodo, onSuccess });
}

/** Optimistic: the UI reflects the change immediately and rolls back if the API rejects it. */
export function useUpdateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTodoInput & { id: number }) => api.updateTodo(id, input),
    onMutate: async ({ id, ...input }) => {
      await qc.cancelQueries({ queryKey: todosKey });
      const previous = qc.getQueryData<Todo[]>(todosKey);
      qc.setQueryData<Todo[]>(todosKey, (todos) =>
        todos?.map((t) => (t.id === id ? { ...t, ...input } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(todosKey, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: todosKey }),
  });
}

export function useDeleteTodo() {
  const onSuccess = useInvalidateTodos();
  return useMutation({ mutationFn: api.deleteTodo, onSuccess });
}
