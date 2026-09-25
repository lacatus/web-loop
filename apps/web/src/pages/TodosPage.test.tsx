import type { Todo } from '@web-loop/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDue } from '../lib/due';
import { mockFetch, renderWithProviders } from '../test/render';
import { TodosPage } from './TodosPage';

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: 1,
  title: 'Buy milk',
  completed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  dueAt: null,
  ...over,
});

describe('TodosPage', () => {
  it('Scenario: Empty list — shows an empty state', async () => {
    mockFetch(() => ({ status: 200, body: [] }));
    renderWithProviders(<TodosPage />);
    expect(await screen.findByText(/no todos yet/i)).toBeInTheDocument();
  });

  it('Scenario: List todos — renders each todo and the remaining count', async () => {
    mockFetch(() => ({
      status: 200,
      body: [todo(), todo({ id: 2, title: 'Walk dog', completed: true })],
    }));
    renderWithProviders(<TodosPage />);
    expect(await screen.findByLabelText('Buy milk')).not.toBeChecked();
    expect(screen.getByLabelText('Walk dog')).toBeChecked();
    expect(screen.getByText('1 item left')).toBeInTheDocument();
  });

  it('Scenario: Create a todo — submits the trimmed title and clears the input', async () => {
    const todos: Todo[] = [];
    const fetchMock = mockFetch(({ method, body }) => {
      if (method === 'POST') {
        const created = todo({ title: (body as { title: string }).title });
        todos.push(created);
        return { status: 201, body: created };
      }
      return { status: 200, body: todos };
    });
    const { user } = renderWithProviders(<TodosPage />);

    const input = await screen.findByLabelText('New todo');
    await user.type(input, '  Buy milk  ');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByLabelText('Buy milk')).toBeInTheDocument();
    expect(input).toHaveValue('');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ title: 'Buy milk' });
  });

  it('Scenario: Create a todo without a due date — sends no dueAt and shows no due date', async () => {
    const todos: Todo[] = [];
    const fetchMock = mockFetch(({ method, body }) => {
      if (method === 'POST') {
        const created = todo({ title: (body as { title: string }).title, dueAt: null });
        todos.push(created);
        return { status: 201, body: created };
      }
      return { status: 200, body: todos };
    });
    const { user } = renderWithProviders(<TodosPage />);

    await user.type(await screen.findByLabelText('New todo'), 'Buy milk');
    expect(screen.getByLabelText('Due (optional)')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const item = (await screen.findByLabelText('Buy milk')).closest('li') as HTMLElement;
    expect(within(item).queryByText(/due/i)).not.toBeInTheDocument();
    expect(item.querySelector('time')).toBeNull();
    expect(screen.queryByRole('button', { name: /clear due date/i })).not.toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).not.toHaveProperty('dueAt');
  });

  it('Scenario: Reject an empty title — shows an inline error and sends no request', async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: [] }));
    const { user } = renderWithProviders(<TodosPage />);

    await screen.findByText(/no todos yet/i);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Title is required');
    expect(screen.getByLabelText('New todo')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('Scenario: Complete a todo — toggles immediately and persists via PATCH', async () => {
    let current = todo();
    const fetchMock = mockFetch(({ method, body }) => {
      if (method === 'PATCH') {
        current = { ...current, ...(body as Partial<Todo>) };
        return { status: 200, body: current };
      }
      return { status: 200, body: [current] };
    });
    const { user } = renderWithProviders(<TodosPage />);

    await user.click(await screen.findByLabelText('Buy milk'));

    expect(screen.getByLabelText('Buy milk')).toBeChecked();
    expect(await screen.findByText('0 items left')).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[0])).toBe('/api/todos/1');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ completed: true });
  });

  it('rolls back an optimistic toggle when the API rejects it', async () => {
    mockFetch(({ method }) =>
      method === 'PATCH'
        ? { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'boom' } } }
        : { status: 200, body: [todo()] },
    );
    const { user } = renderWithProviders(<TodosPage />);

    await user.click(await screen.findByLabelText('Buy milk'));

    await waitFor(() => expect(screen.getByLabelText('Buy milk')).not.toBeChecked());
  });

  it('Scenario: Delete a todo — removes it from the list', async () => {
    let todos = [todo()];
    mockFetch(({ method }) => {
      if (method === 'DELETE') {
        todos = [];
        return { status: 204 };
      }
      return { status: 200, body: todos };
    });
    const { user } = renderWithProviders(<TodosPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete Buy milk' }));

    expect(await screen.findByText(/no todos yet/i)).toBeInTheDocument();
  });

  it('Scenario: API unavailable — shows an error with a retry action', async () => {
    mockFetch(() => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }));
    renderWithProviders(<TodosPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('TodosPage — due dates and reminders', () => {
  const NOW = new Date('2026-09-25T12:00:00.000Z').getTime();
  const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString();

  beforeEach(() => {
    // Fake only the clock and intervals (useNow); Testing Library and TanStack Query keep real
    // timeouts so async queries behave normally.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const remindersPanel = () => screen.queryByRole('region', { name: 'Reminders' });
  const listTitles = () =>
    within(screen.getByRole('list', { name: 'Todo list' }))
      .getAllByRole('checkbox')
      .map((cb) => cb.closest('li')?.querySelector('label')?.textContent);

  /** Serves `todos` like the API: soonest due first, then undated in id order. */
  const serve = (initial: Todo[]) => {
    let todos = initial;
    const sorted = () =>
      [...todos].sort((a, b) =>
        a.dueAt === b.dueAt
          ? a.id - b.id
          : a.dueAt === null
            ? 1
            : b.dueAt === null
              ? -1
              : Date.parse(a.dueAt) - Date.parse(b.dueAt),
      );
    const fetchMock = mockFetch(({ method, path, body }) => {
      if (method === 'POST') {
        const input = body as { title: string; dueAt?: string | null };
        const created = todo({
          id: todos.length + 1,
          title: input.title,
          dueAt: input.dueAt ?? null,
        });
        todos = [...todos, created];
        return { status: 201, body: created };
      }
      if (method === 'PATCH') {
        const id = Number(path.split('/').pop());
        todos = todos.map((t) => (t.id === id ? { ...t, ...(body as Partial<Todo>) } : t));
        return { status: 200, body: todos.find((t) => t.id === id) };
      }
      return { status: 200, body: sorted() };
    });
    return { fetchMock, current: () => todos };
  };

  it('Scenario: Create a todo with a due date — sends the picked local time as UTC and shows it in local time', async () => {
    const { fetchMock } = serve([]);
    const { user } = renderWithProviders(<TodosPage />);

    await user.type(await screen.findByLabelText('New todo'), 'Pay rent');
    const dueInput = screen.getByLabelText('Due (optional)');
    expect(dueInput).toHaveAttribute('type', 'datetime-local');
    fireEvent.change(dueInput, { target: { value: '2026-10-01T09:30' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const expectedIso = new Date('2026-10-01T09:30').toISOString();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ title: 'Pay rent', dueAt: expectedIso });

    const item = (await screen.findByLabelText('Pay rent')).closest('li') as HTMLElement;
    const time = item.querySelector('time');
    expect(time).toHaveAttribute('dateTime', expectedIso);
    expect(time).toHaveTextContent(formatDue(expectedIso));
    // Local wall-clock time as picked, regardless of the test runner's time zone.
    expect(formatDue(expectedIso)).toMatch(/9:30|09:30/);
    expect(dueInput).toHaveValue('');
  });

  it('Scenario: Reject an incomplete due date — a partially entered due date blocks the submit with an error', async () => {
    const { fetchMock } = serve([]);
    const { user } = renderWithProviders(<TodosPage />);
    await screen.findByText(/no todos yet/i);

    await user.type(screen.getByLabelText('New todo'), 'Partial due');
    const dueInput = screen.getByLabelText('Due (optional)');
    expect(dueInput).not.toHaveAttribute('aria-invalid');
    // What a browser reports for e.g. a date without a time: an empty value plus badInput.
    Object.defineProperty(dueInput, 'validity', {
      configurable: true,
      value: { ...(dueInput as HTMLInputElement).validity, badInput: true, valid: false },
    });
    expect(dueInput).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a valid due date');
    expect(dueInput).toHaveAttribute('aria-invalid', 'true');
    expect(dueInput).toHaveAttribute('aria-describedby', alert.id);
    expect(screen.getByLabelText('New todo')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('New todo')).toHaveValue('Partial due');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(screen.getByText(/no todos yet/i)).toBeInTheDocument();

    // Once the date is completed, the todo is created and the error goes away.
    Object.defineProperty(dueInput, 'validity', {
      configurable: true,
      value: { ...(dueInput as HTMLInputElement).validity, badInput: false, valid: true },
    });
    fireEvent.change(dueInput, { target: { value: '2026-10-01T09:30' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByLabelText('Partial due');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(dueInput).not.toHaveAttribute('aria-invalid');
  });

  it('a complete due date the contract cannot represent (year 10000) shows the due date error', async () => {
    const { fetchMock } = serve([]);
    const { user } = renderWithProviders(<TodosPage />);
    await screen.findByText(/no todos yet/i);

    await user.type(screen.getByLabelText('New todo'), 'Far future');
    const dueInput = screen.getByLabelText('Due (optional)');
    // A complete datetime-local value whose year is outside the API's 4-digit range.
    fireEvent.change(dueInput, { target: { value: '10000-01-01T00:00' } });
    expect(dueInput).toHaveValue('10000-01-01T00:00');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid due date');
    expect(dueInput).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('Scenario: Sort by due date — shows todos in the order returned by the API', async () => {
    serve([
      todo({ id: 1, title: 'No due date' }),
      todo({ id: 2, title: 'Tomorrow', dueAt: inMinutes(24 * 60) }),
      todo({ id: 3, title: 'In one hour', dueAt: inMinutes(60) }),
    ]);
    renderWithProviders(<TodosPage />);
    await screen.findByLabelText('In one hour');
    expect(listTitles()).toEqual(['In one hour', 'Tomorrow', 'No due date']);
  });

  it('Scenario: Due soon reminder — lists "Call mom — due in 10 min"', async () => {
    serve([todo({ title: 'Call mom', dueAt: inMinutes(10) })]);
    renderWithProviders(<TodosPage />);
    await screen.findByLabelText('Call mom');

    const panel = remindersPanel() as HTMLElement;
    expect(panel).toBeInTheDocument();
    const status = within(panel).getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(
      within(status)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Call mom — due in 10 min']);
    // Due soon is not overdue.
    expect(screen.queryByText('Overdue', { exact: true })).not.toBeInTheDocument();
  });

  it('Scenario: Overdue reminder — lists "Pay rent — overdue" and marks it "Overdue" in the list', async () => {
    serve([todo({ title: 'Pay rent', dueAt: inMinutes(-5) })]);
    renderWithProviders(<TodosPage />);
    const checkbox = await screen.findByLabelText('Pay rent');

    expect(within(remindersPanel() as HTMLElement).getByText('Pay rent — overdue')).toBeVisible();
    const item = checkbox.closest('li') as HTMLElement;
    expect(within(item).getByText('Overdue', { exact: true })).toBeVisible();
  });

  it('Scenario: Accept a past due date — a todo created with a past due date is shown as overdue', async () => {
    serve([]);
    const { user } = renderWithProviders(<TodosPage />);
    await user.type(await screen.findByLabelText('New todo'), 'Late already');
    fireEvent.change(screen.getByLabelText('Due (optional)'), {
      target: { value: '2026-09-01T08:00' },
    });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const item = (await screen.findByLabelText('Late already')).closest('li') as HTMLElement;
    expect(within(item).getByText('Overdue', { exact: true })).toBeVisible();
    expect(
      within(remindersPanel() as HTMLElement).getByText('Late already — overdue'),
    ).toBeVisible();
  });

  it('Scenario: No reminder for completed or distant todos — only overdue/due-soon incomplete todos are listed, overdue first', async () => {
    serve([
      todo({ id: 1, title: 'Soon', dueAt: inMinutes(30) }),
      todo({ id: 2, title: 'Done late', dueAt: inMinutes(-10), completed: true }),
      todo({ id: 3, title: 'Done soon', dueAt: inMinutes(5), completed: true }),
      todo({ id: 4, title: 'No date' }),
      todo({ id: 5, title: 'Distant', dueAt: inMinutes(61) }),
      todo({ id: 6, title: 'Late', dueAt: inMinutes(-1) }),
    ]);
    renderWithProviders(<TodosPage />);
    await screen.findByLabelText('Soon');

    const items = within(remindersPanel() as HTMLElement).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Late — overdue', 'Soon — due in 30 min']);
    // Completed overdue todos are not marked overdue in the list either.
    const doneLate = screen.getByLabelText('Done late').closest('li') as HTMLElement;
    expect(within(doneLate).queryByText('Overdue', { exact: true })).not.toBeInTheDocument();
  });

  it('Scenario: Reminder appears as time passes — shows up without a reload once within 60 minutes', async () => {
    const { fetchMock } = serve([todo({ title: 'Stand-up', dueAt: inMinutes(61) })]);
    renderWithProviders(<TodosPage />);
    await screen.findByLabelText('Stand-up');
    expect(remindersPanel()).not.toBeInTheDocument();
    const requestsBefore = fetchMock.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });

    expect(
      within(remindersPanel() as HTMLElement).getByText('Stand-up — due in 59 min'),
    ).toBeVisible();
    expect(fetchMock.mock.calls.length).toBe(requestsBefore);
  });

  it('Scenario: Reminder appears as time passes — refreshes at least every 30 seconds', async () => {
    serve([todo({ title: 'Stand-up', dueAt: inMinutes(60.4) })]);
    renderWithProviders(<TodosPage />);
    await screen.findByLabelText('Stand-up');
    expect(remindersPanel()).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(
      within(remindersPanel() as HTMLElement).getByText('Stand-up — due in 60 min'),
    ).toBeVisible();
  });

  it('Scenario: No reminders — no Reminders panel when nothing is overdue or due within 60 minutes', async () => {
    serve([
      todo({ id: 1, title: 'Distant', dueAt: inMinutes(120) }),
      todo({ id: 2, title: 'No date' }),
      todo({ id: 3, title: 'Done', dueAt: inMinutes(-30), completed: true }),
    ]);
    renderWithProviders(<TodosPage />);
    await screen.findByLabelText('Distant');
    expect(remindersPanel()).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reminders' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('Scenario: Completing clears the reminder — completing a listed todo removes it from the panel', async () => {
    serve([
      todo({ id: 1, title: 'Call mom', dueAt: inMinutes(10) }),
      todo({ id: 2, title: 'Pay rent', dueAt: inMinutes(-5) }),
    ]);
    const { user } = renderWithProviders(<TodosPage />);
    await screen.findByLabelText('Call mom');
    expect(within(remindersPanel() as HTMLElement).getAllByRole('listitem')).toHaveLength(2);

    await user.click(screen.getByLabelText('Call mom'));

    await waitFor(() =>
      expect(
        within(remindersPanel() as HTMLElement)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual(['Pay rent — overdue']),
    );

    await user.click(screen.getByLabelText('Pay rent'));
    await waitFor(() => expect(remindersPanel()).not.toBeInTheDocument());
  });

  it('Scenario: Clear a due date — removes the due date, moves the todo among undated todos, sends dueAt: null', async () => {
    const { fetchMock, current } = serve([
      todo({ id: 1, title: 'Undated first' }),
      todo({ id: 2, title: 'Call mom', dueAt: inMinutes(10) }),
      todo({ id: 3, title: 'Undated last' }),
    ]);
    const { user } = renderWithProviders(<TodosPage />);
    await screen.findByLabelText('Call mom');
    expect(listTitles()).toEqual(['Call mom', 'Undated first', 'Undated last']);

    await user.click(screen.getByRole('button', { name: 'Clear due date for Call mom' }));

    await waitFor(() =>
      expect(listTitles()).toEqual(['Undated first', 'Call mom', 'Undated last']),
    );
    const item = screen.getByLabelText('Call mom').closest('li') as HTMLElement;
    expect(item.querySelector('time')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Clear due date for Call mom' }),
    ).not.toBeInTheDocument();
    expect(remindersPanel()).not.toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[0])).toBe('/api/todos/2');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ dueAt: null });
    expect(current().find((t) => t.id === 2)?.dueAt).toBeNull();
  });

  it('Scenario: Clear a due date — keyboard focus moves to the todo checkbox, even after the list re-sorts', async () => {
    serve([
      todo({ id: 1, title: 'Undated first' }),
      todo({ id: 2, title: 'Call mom', dueAt: inMinutes(10) }),
    ]);
    const { user } = renderWithProviders(<TodosPage />);
    await screen.findByLabelText('Call mom');

    screen.getByRole('button', { name: 'Clear due date for Call mom' }).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(listTitles()).toEqual(['Undated first', 'Call mom']));
    const checkbox = screen.getByRole('checkbox', { name: 'Call mom' });
    await waitFor(() => expect(checkbox).toHaveFocus());
    // Focus stays put once the clear has settled (no later render steals it back or drops it).
    await new Promise((r) => setTimeout(r, 50));
    expect(checkbox).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Delete Call mom' })).toHaveFocus();
  });
});
