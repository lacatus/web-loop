import { expect, test, type Page } from '@playwright/test';
import type { Todo } from '@web-loop/shared';

// Unique titles keep tests independent on the shared e2e database.
const unique = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * A due time `offsetMs` from now, computed in the browser: `value` is the `datetime-local`
 * string in the browser's local time zone, `iso` the same instant in UTC, and `display` how
 * the app should render it (the browser's locale + time zone, medium date / short time).
 */
function dueIn(page: Page, offsetMs: number) {
  return page.evaluate((offset) => {
    const d = new Date(Date.now() + offset);
    d.setMilliseconds(0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const value =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const iso = new Date(value).toISOString();
    const display = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
    return { value, iso, display };
  }, offsetMs);
}

const MINUTE = 60_000;

async function addTodo(page: Page, title: string, due?: string) {
  await page.getByLabel('New todo').fill(title);
  if (due) await page.getByLabel('Due (optional)').fill(due);
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/todos') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add' }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  await expect(page.getByLabel(title, { exact: true })).toBeVisible();
  return (await res.json()) as Todo;
}

const itemFor = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByLabel(title, { exact: true }) });

/** Titles in the order the Todo list shows them (each item has exactly one <label>). */
const listTitles = (page: Page) =>
  page
    .getByRole('list', { name: 'Todo list' })
    .getByRole('listitem')
    .locator('label')
    .allTextContents();

const reminders = (page: Page) => page.getByRole('region', { name: 'Reminders' });

test.describe('due dates and reminders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Todos' })).toBeVisible();
  });

  test('Scenario: Create a todo with a due date / Scenario: Due soon reminder', async ({
    page,
  }) => {
    const title = unique('Call mom');
    // Just under 10 minutes away, so "due in N min" (rounded up) reads 10.
    const due = await dueIn(page, 10 * MINUTE - 20_000);
    const todo = await addTodo(page, title, due.value);

    // Stored as the same instant in UTC.
    expect(todo.dueAt).toBe(due.iso);
    expect(todo.dueAt).toMatch(/Z$/);

    // Shown in local time on the item.
    const time = itemFor(page, title).locator('time');
    await expect(time).toHaveAttribute('datetime', due.iso);
    await expect(time).toHaveText(due.display);
    await expect(page.getByLabel('Due (optional)')).toHaveValue('');

    // Reminders panel lists it, announced politely.
    const panel = reminders(page);
    await expect(panel.getByRole('status')).toBeAttached();
    await expect(panel.getByText(`${title} — due in 10 min`, { exact: true })).toBeVisible();

    // Survives a reload with the same due date.
    await page.reload();
    await expect(itemFor(page, title).locator('time')).toHaveAttribute('datetime', due.iso);
  });

  test('Scenario: Accept a past due date / Scenario: Overdue reminder', async ({ page }) => {
    const title = unique('Pay rent');
    const due = await dueIn(page, -5 * MINUTE);
    const todo = await addTodo(page, title, due.value);
    expect(todo.dueAt).toBe(due.iso);

    await expect(itemFor(page, title).getByText('Overdue', { exact: true })).toBeVisible();
    await expect(reminders(page).getByText(`${title} — overdue`, { exact: true })).toBeVisible();
  });

  test('Scenario: Completing clears the reminder', async ({ page }) => {
    const title = unique('Water plants');
    await addTodo(page, title, (await dueIn(page, 15 * MINUTE)).value);
    const entry = reminders(page).getByText(new RegExp(`^${title} — due in \\d+ min$`));
    await expect(entry).toBeVisible();

    const checkbox = page.getByLabel(title, { exact: true });
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect(entry).toHaveCount(0);
  });

  test('Scenario: Clear a due date', async ({ page }) => {
    const title = unique('Renew passport');
    const due = await dueIn(page, 2 * 24 * 60 * MINUTE);
    const todo = await addTodo(page, title, due.value);
    const item = itemFor(page, title);
    await expect(item.locator('time')).toHaveText(due.display);

    await page.getByRole('button', { name: `Clear due date for ${title}` }).click();

    await expect(item.locator('time')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Clear due date for ${title}` })).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel(title, { exact: true })).toBeVisible();
    await expect(itemFor(page, title).locator('time')).toHaveCount(0);

    const list = (await (await page.request.get('/api/todos')).json()) as Todo[];
    const index = list.findIndex((t) => t.id === todo.id);
    expect(list[index]?.dueAt).toBeNull();
    // It now sits among the undated todos, in creation order.
    const undated = list.filter((t) => t.dueAt === null).map((t) => t.id);
    expect(list.slice(list.length - undated.length).map((t) => t.id)).toEqual(undated);
    expect(undated).toEqual([...undated].sort((a, b) => a - b));
    expect(undated).toContain(todo.id);

    // The UI shows the same order as the API.
    const uiTitles = await listTitles(page);
    expect(uiTitles).toEqual(list.map((t) => t.title));
  });

  test('Scenario: Sort by due date', async ({ page }) => {
    const none = unique('No due date');
    const tomorrow = unique('Tomorrow');
    const inOneHour = unique('In one hour');
    await addTodo(page, none);
    await addTodo(page, tomorrow, (await dueIn(page, 24 * 60 * MINUTE)).value);
    await addTodo(page, inOneHour, (await dueIn(page, 60 * MINUTE)).value);

    const titles = await listTitles(page);
    const order = [inOneHour, tomorrow, none].map((t) => titles.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const api = ((await (await page.request.get('/api/todos')).json()) as Todo[]).map(
      (t) => t.title,
    );
    expect(api).toEqual(titles);
  });
});
