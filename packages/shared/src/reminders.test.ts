import { describe, expect, it } from 'vitest';
import { DUE_SOON_MINUTES, minutesUntilDue, reminderFor, remindersFor } from './reminders';

const NOW = Date.parse('2026-09-25T12:00:00.000Z');
const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString();
const todo = (dueAt: string | null, completed = false, title = 't') => ({
  title,
  dueAt,
  completed,
});

describe('reminders', () => {
  it('Scenario: Due soon reminder — due within the window is due-soon, with minutes rounded up', () => {
    expect(reminderFor(todo(inMinutes(10)), NOW)).toBe('due-soon');
    expect(minutesUntilDue(inMinutes(10), NOW)).toBe(10);
    expect(reminderFor(todo(inMinutes(DUE_SOON_MINUTES)), new Date(NOW))).toBe('due-soon');
    expect(minutesUntilDue(inMinutes(9.1), NOW)).toBe(10);
    expect(minutesUntilDue(inMinutes(0.01), NOW)).toBe(1);
  });

  it('Scenario: Overdue reminder — due at or before now is overdue', () => {
    expect(reminderFor(todo(inMinutes(-5)), NOW)).toBe('overdue');
    expect(reminderFor(todo(inMinutes(0)), NOW)).toBe('overdue');
  });

  it('Scenario: No reminder for completed or distant todos — completed, undated and distant todos have none', () => {
    expect(reminderFor(todo(inMinutes(-5), true), NOW)).toBeNull();
    expect(reminderFor(todo(inMinutes(10), true), NOW)).toBeNull();
    expect(reminderFor(todo(null), NOW)).toBeNull();
    expect(reminderFor(todo(inMinutes(DUE_SOON_MINUTES + 0.01)), NOW)).toBeNull();
    expect(reminderFor(todo(inMinutes(61)), NOW)).toBeNull();
  });

  it('lists overdue reminders first, then by due date', () => {
    const list = [
      todo(inMinutes(30), false, 'later'),
      todo(null, false, 'none'),
      todo(inMinutes(-1), false, 'recently overdue'),
      todo(inMinutes(5), false, 'soon'),
      todo(inMinutes(-60), false, 'long overdue'),
      todo(inMinutes(2), true, 'done'),
    ];
    expect(remindersFor(list, NOW).map((r) => [r.todo.title, r.kind])).toEqual([
      ['long overdue', 'overdue'],
      ['recently overdue', 'overdue'],
      ['soon', 'due-soon'],
      ['later', 'due-soon'],
    ]);
  });
});
