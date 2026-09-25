import { TODO_TITLE_MAX, type Todo } from '@web-loop/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDb } from '../src/db/client';

type App = Awaited<ReturnType<typeof buildApp>>;

describe('todos API', () => {
  let app: App;

  beforeEach(async () => {
    app = await buildApp({ db: createDb(':memory:') });
  });

  afterEach(async () => {
    await app.close();
  });

  const create = async (title: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/todos', payload: { title } });
    return res.json<Todo>();
  };

  it('Scenario: Empty list — returns an empty array when there are no todos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/todos' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('Scenario: Create a todo — persists a trimmed, incomplete todo and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/todos',
      payload: { title: '  Buy milk  ' },
    });
    expect(res.statusCode).toBe(201);
    const todo = res.json<Todo>();
    expect(todo).toMatchObject({ title: 'Buy milk', completed: false });
    expect(new Date(todo.createdAt).toISOString()).toBe(todo.createdAt);

    const list = await app.inject({ method: 'GET', url: '/api/todos' });
    expect(list.json()).toEqual([todo]);
  });

  it('Scenario: List todos — returns todos in creation order', async () => {
    const a = await create('first');
    const b = await create('second');
    const res = await app.inject({ method: 'GET', url: '/api/todos' });
    expect(res.json<Todo[]>().map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('Scenario: Reject an empty title — returns 400 VALIDATION_ERROR and stores nothing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/todos', payload: { title: '  ' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    const list = await app.inject({ method: 'GET', url: '/api/todos' });
    expect(list.json()).toEqual([]);
  });

  it('Scenario: Reject an overlong title — returns 400 VALIDATION_ERROR for > max chars', async () => {
    const title = 'a'.repeat(TODO_TITLE_MAX + 1);
    const res = await app.inject({ method: 'POST', url: '/api/todos', payload: { title } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('Scenario: Complete a todo — toggles completed via PATCH', async () => {
    const todo = await create('Walk dog');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/todos/${todo.id}`,
      payload: { completed: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Todo>()).toMatchObject({ id: todo.id, completed: true, title: 'Walk dog' });
  });

  it('Scenario: Delete a todo — returns 204 and removes it', async () => {
    const todo = await create('Temp');
    const res = await app.inject({ method: 'DELETE', url: `/api/todos/${todo.id}` });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/todos' });
    expect(list.json()).toEqual([]);
  });

  it('Scenario: Unknown todo — PATCH and DELETE return 404 NOT_FOUND', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/todos/999',
      payload: { completed: true },
    });
    expect(patch.statusCode).toBe(404);
    expect(patch.json().error.code).toBe('NOT_FOUND');

    const del = await app.inject({ method: 'DELETE', url: '/api/todos/999' });
    expect(del.statusCode).toBe(404);
  });

  it('rejects a non-numeric id with 400', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/todos/abc' });
    expect(res.statusCode).toBe(400);
  });

  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
