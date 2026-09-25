import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

/** Renders UI with the same providers as main.tsx (fresh QueryClient, no retries). */
export function renderWithProviders(ui: ReactElement, { route = '/' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

type Handler = (req: { method: string; path: string; body: unknown }) => {
  status: number;
  body?: unknown;
};

/** Stubs global fetch with a tiny in-test router. */
export function mockFetch(handler: Handler) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const { status, body: resBody } = handler({ method, path: url.pathname, body });
    return new Response(resBody === undefined ? null : JSON.stringify(resBody), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}
