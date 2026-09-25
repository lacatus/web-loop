import {
  ApiErrorSchema,
  TodoListSchema,
  TodoSchema,
  type CreateTodoInput,
  type Todo,
  type UpdateTodoInput,
} from '@web-loop/shared';
import type { z } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Sends a request to the API and throws ApiRequestError on non-2xx responses. */
async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(await res.json().catch(() => null));
    throw new ApiRequestError(
      res.status,
      parsed.success ? parsed.data.error.message : `Request failed (${res.status})`,
    );
  }
  return res;
}

/** Validates responses against the shared contract so API drift fails loudly. */
async function json<S extends z.ZodType>(res: Promise<Response>, schema: S): Promise<z.infer<S>> {
  return schema.parse(await (await res).json());
}

const body = (method: string, data: unknown): RequestInit => ({
  method,
  body: JSON.stringify(data),
});

export const api = {
  listTodos: (): Promise<Todo[]> => json(send('/todos'), TodoListSchema),
  createTodo: (input: CreateTodoInput): Promise<Todo> =>
    json(send('/todos', body('POST', input)), TodoSchema),
  updateTodo: (id: number, input: UpdateTodoInput): Promise<Todo> =>
    json(send(`/todos/${id}`, body('PATCH', input)), TodoSchema),
  deleteTodo: async (id: number): Promise<void> => {
    await send(`/todos/${id}`, { method: 'DELETE' });
  },
};
