import { describe, expect, it } from 'vitest';
import { CreateTodoInputSchema, TODO_TITLE_MAX, UpdateTodoInputSchema } from './todo';

describe('todos contract', () => {
  it('Scenario: Reject an empty title — whitespace-only titles are invalid', () => {
    expect(CreateTodoInputSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('Scenario: Reject an overlong title — titles above the max length are invalid', () => {
    const tooLong = 'a'.repeat(TODO_TITLE_MAX + 1);
    expect(CreateTodoInputSchema.safeParse({ title: tooLong }).success).toBe(false);
  });

  it('Scenario: Create a todo — titles are trimmed', () => {
    expect(CreateTodoInputSchema.parse({ title: '  Buy milk  ' })).toEqual({ title: 'Buy milk' });
  });

  it('rejects an update with no fields', () => {
    expect(UpdateTodoInputSchema.safeParse({}).success).toBe(false);
  });

  it('Scenario: Reject an invalid due date — non-ISO or offset-less due dates are invalid', () => {
    for (const dueAt of ['tomorrow', '2026-13-01T10:00', '2026-09-25T10:00', '', 42]) {
      expect(CreateTodoInputSchema.safeParse({ title: 'x', dueAt }).success).toBe(false);
      expect(UpdateTodoInputSchema.safeParse({ dueAt }).success).toBe(false);
    }
    // Normalizing to UTC must stay within 4-digit years.
    expect(
      CreateTodoInputSchema.safeParse({ title: 'x', dueAt: '0000-01-01T00:00:00+01:00' }).success,
    ).toBe(false);
  });

  it('Scenario: Create a todo with a due date — normalizes an offset datetime to UTC', () => {
    expect(
      CreateTodoInputSchema.parse({ title: 'Pay rent', dueAt: '2026-10-01T09:30:00+02:00' }),
    ).toEqual({ title: 'Pay rent', dueAt: '2026-10-01T07:30:00.000Z' });
  });

  it('Scenario: Clear a due date — an update may set dueAt to null', () => {
    expect(UpdateTodoInputSchema.parse({ dueAt: null })).toEqual({ dueAt: null });
  });
});
