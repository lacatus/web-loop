import type { Todo } from '@web-loop/shared';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/render';
import { TodosPage } from './TodosPage';

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: 1,
  title: 'Buy milk',
  completed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
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
