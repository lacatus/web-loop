import {
  CreateTodoInputSchema,
  TodoIdParamsSchema,
  UpdateTodoInputSchema,
  type Todo,
} from '@web-loop/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client';
import { todos, type TodoRow } from '../db/schema';
import { notFound } from '../lib/errors';

const toTodo = (row: TodoRow): Todo => ({
  id: row.id,
  title: row.title,
  completed: row.completed,
  createdAt: row.createdAt,
});

export const todoRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/todos', async () => {
    const rows = db.select().from(todos).orderBy(asc(todos.id)).all();
    return rows.map(toTodo);
  });

  app.post('/todos', async (req, reply) => {
    const input = CreateTodoInputSchema.parse(req.body);
    const row = db.insert(todos).values({ title: input.title }).returning().get();
    return reply.status(201).send(toTodo(row));
  });

  app.patch('/todos/:id', async (req) => {
    const { id } = TodoIdParamsSchema.parse(req.params);
    const input = UpdateTodoInputSchema.parse(req.body);
    const row = db.update(todos).set(input).where(eq(todos.id, id)).returning().get();
    if (!row) throw notFound('Todo');
    return toTodo(row);
  });

  app.delete('/todos/:id', async (req, reply) => {
    const { id } = TodoIdParamsSchema.parse(req.params);
    const row = db.delete(todos).where(eq(todos.id, id)).returning().get();
    if (!row) throw notFound('Todo');
    return reply.status(204).send();
  });
};
