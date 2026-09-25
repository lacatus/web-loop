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
});
