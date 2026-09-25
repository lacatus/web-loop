import { expect, test, type Page } from '@playwright/test';

// Each test uses unique titles, so tests stay independent on the shared e2e database.
const unique = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function addTodo(page: Page, title: string) {
  await page.getByLabel('New todo').fill(title);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByLabel(title, { exact: true })).toBeVisible();
}

test.describe('todos', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Todos' })).toBeVisible();
  });

  test('Scenario: Create a todo', async ({ page }) => {
    const title = unique('Buy milk');
    await addTodo(page, title);
    await expect(page.getByLabel('New todo')).toHaveValue('');

    // Persisted: survives a reload.
    await page.reload();
    await expect(page.getByLabel(title, { exact: true })).toBeVisible();
  });

  test('Scenario: Reject an empty title', async ({ page }) => {
    await page.getByLabel('New todo').fill('   ');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('alert')).toHaveText('Title is required');
  });

  test('Scenario: Complete a todo', async ({ page }) => {
    const title = unique('Walk dog');
    await addTodo(page, title);
    const checkbox = page.getByLabel(title, { exact: true });
    // click + web-first assertion: the checkbox is controlled by async (optimistic) state,
    // so `locator.check()` would assert before React re-renders.
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect(page.getByText(/items? left/)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(title, { exact: true })).toBeChecked();
  });

  test('Scenario: Delete a todo', async ({ page }) => {
    const title = unique('Temp');
    await addTodo(page, title);
    await page.getByRole('button', { name: `Delete ${title}` }).click();
    await expect(page.getByLabel(title, { exact: true })).toHaveCount(0);
  });

  test('has no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Todos' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
