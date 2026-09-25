import { z } from 'zod';

export const TODO_TITLE_MAX = 200;

const title = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(TODO_TITLE_MAX, `Title must be at most ${TODO_TITLE_MAX} characters`);

/**
 * A due date as sent by clients: any ISO-8601 datetime with a timezone offset (`Z` or `±hh:mm`),
 * normalized to a UTC ISO string (`YYYY-MM-DDTHH:mm:ss.sssZ`). The final pipe rejects instants
 * whose UTC form falls outside 4-digit years (e.g. `0000-01-01T00:00:00+01:00`).
 */
const dueAtInput = z.iso
  .datetime({ offset: true, message: 'Due date must be an ISO-8601 datetime with an offset' })
  .transform((v) => new Date(v).toISOString())
  .pipe(z.iso.datetime({ message: 'Due date is out of range' }))
  .nullable()
  .optional();

export const TodoSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  completed: z.boolean(),
  createdAt: z.iso.datetime(),
  /** UTC ISO string, or null when the todo has no due date. */
  dueAt: z.iso.datetime().nullable(),
});
export type Todo = z.infer<typeof TodoSchema>;

export const TodoListSchema = z.array(TodoSchema);

export const CreateTodoInputSchema = z.object({ title, dueAt: dueAtInput });
export type CreateTodoInput = z.infer<typeof CreateTodoInputSchema>;

export const UpdateTodoInputSchema = z
  .object({ title: title.optional(), completed: z.boolean().optional(), dueAt: dueAtInput })
  .refine((v) => v.title !== undefined || v.completed !== undefined || v.dueAt !== undefined, {
    message: 'At least one of title, completed or dueAt is required',
  });
export type UpdateTodoInput = z.infer<typeof UpdateTodoInputSchema>;

export const TodoIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
