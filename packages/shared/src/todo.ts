import { z } from 'zod';

export const TODO_TITLE_MAX = 200;

const title = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(TODO_TITLE_MAX, `Title must be at most ${TODO_TITLE_MAX} characters`);

export const TodoSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  completed: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Todo = z.infer<typeof TodoSchema>;

export const TodoListSchema = z.array(TodoSchema);

export const CreateTodoInputSchema = z.object({ title });
export type CreateTodoInput = z.infer<typeof CreateTodoInputSchema>;

export const UpdateTodoInputSchema = z
  .object({ title: title.optional(), completed: z.boolean().optional() })
  .refine((v) => v.title !== undefined || v.completed !== undefined, {
    message: 'At least one of title or completed is required',
  });
export type UpdateTodoInput = z.infer<typeof UpdateTodoInputSchema>;

export const TodoIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
