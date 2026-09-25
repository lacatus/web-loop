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

  const create = async (title: string, dueAt?: string | null) => {
    const res = await app.inject({ method: 'POST', url: '/api/todos', payload: { title, dueAt } });
    expect(res.statusCode).toBe(201);
    return res.json<Todo>();
  };

  const list = async () => (await app.inject({ method: 'GET', url: '/api/todos' })).json<Todo[]>();

  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

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
    expect(todo).toMatchObject({ title: 'Buy milk', completed: false, dueAt: null });
    expect(new Date(todo.createdAt).toISOString()).toBe(todo.createdAt);

    const list = await app.inject({ method: 'GET', url: '/api/todos' });
    expect(list.json()).toEqual([todo]);
  });

  it('Scenario: List todos — returns todos without due dates in creation order', async () => {
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

  it('Scenario: Create a todo with a due date — stores and returns the instant as a UTC ISO string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/todos',
      payload: { title: 'Pay rent', dueAt: '2026-10-01T09:30:00+02:00' },
    });
    expect(res.statusCode).toBe(201);
    const todo = res.json<Todo>();
    expect(todo).toMatchObject({ title: 'Pay rent', dueAt: '2026-10-01T07:30:00.000Z' });
    expect(await list()).toEqual([todo]);
  });

  it('Scenario: Create a todo with a due date — a PATCH can set or change dueAt, normalized to UTC', async () => {
    const todo = await create('Pay rent');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/todos/${todo.id}`,
      payload: { dueAt: '2026-10-01T23:15:00-05:00' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Todo>().dueAt).toBe('2026-10-02T04:15:00.000Z');
  });

  it('Scenario: Create a todo without a due date — returns and stores dueAt: null', async () => {
    const omitted = await create('No due');
    const explicitNull = await create('Null due', null);
    expect(omitted.dueAt).toBeNull();
    expect(explicitNull.dueAt).toBeNull();
    expect((await list()).map((t) => t.dueAt)).toEqual([null, null]);
  });

  it('Scenario: Reject an invalid due date — create and update respond 400 VALIDATION_ERROR and change nothing', async () => {
    for (const dueAt of ['tomorrow', '2026-13-01T10:00', '2026-10-01T10:00:00', 12345]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/todos',
        payload: { title: 'Bad due', dueAt },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect(await list()).toEqual([]);

    const todo = await create('Keep', '2026-10-01T07:30:00Z');
    for (const dueAt of ['tomorrow', '2026-13-01T10:00']) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/todos/${todo.id}`,
        payload: { dueAt, completed: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect(await list()).toEqual([todo]);
  });

  it('Scenario: Accept a past due date — creates a todo due in the past', async () => {
    const dueAt = inMinutes(-5);
    const todo = await create('Pay rent', dueAt);
    expect(todo.dueAt).toBe(dueAt);
    expect(new Date(todo.dueAt ?? '').getTime()).toBeLessThan(Date.now());
    expect(await list()).toEqual([todo]);
  });

  it('Scenario: Clear a due date — PATCH dueAt: null clears it and the todo moves among undated todos', async () => {
    const undatedFirst = await create('Undated first');
    const dated = await create('Dated', inMinutes(30));
    const undatedLast = await create('Undated last');
    expect((await list()).map((t) => t.id)).toEqual([dated.id, undatedFirst.id, undatedLast.id]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/todos/${dated.id}`,
      payload: { dueAt: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Todo>()).toMatchObject({ id: dated.id, title: 'Dated', dueAt: null });

    const after = await list();
    expect(after.map((t) => t.id)).toEqual([undatedFirst.id, dated.id, undatedLast.id]);
    expect(after.find((t) => t.id === dated.id)?.dueAt).toBeNull();
  });

  it('Scenario: Sort by due date — soonest first, then undated todos in creation order', async () => {
    const undated = await create('No due date');
    const tomorrow = await create('Tomorrow', inMinutes(24 * 60));
    const inOneHour = await create('In one hour', inMinutes(60));
    const undatedLater = await create('Also no due date');
    expect((await list()).map((t) => t.title)).toEqual([
      inOneHour.title,
      tomorrow.title,
      undated.title,
      undatedLater.title,
    ]);
  });

  it('Scenario: Sort by due date — completion does not affect order; offsets compare as instants', async () => {
    // 10:00+02:00 (08:00Z) is earlier than 09:00Z even though its local wall time is later.
    const later = await create('Later', '2026-10-01T09:00:00Z');
    const earlier = await create('Earlier', '2026-10-01T10:00:00+02:00');
    await app.inject({
      method: 'PATCH',
      url: `/api/todos/${earlier.id}`,
      payload: { completed: true },
    });
    expect((await list()).map((t) => t.id)).toEqual([earlier.id, later.id]);
  });

  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
