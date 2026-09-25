# Design

## Context

Greenfield monorepo: `apps/web` (React + Vite), `apps/api` (Fastify + Drizzle/SQLite), `packages/shared` (zod contract). See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**

- A single source of truth for request/response shapes, used by both apps.
- Every spec scenario covered by at least one automated test.

**Non-Goals:**

- Authentication, multi-user data, pagination, editing a todo's title from the UI.

## Decisions

- **Contract-first with zod in `packages/shared`.** The API parses requests with the shared schemas; the web client parses responses with them. Drift fails loudly in tests instead of silently in production. Alternative considered: OpenAPI codegen — heavier and needs a build step.
- **Uniform error envelope** `{ error: { code, message, details? } }` for every non-2xx, produced by one Fastify error handler. Clients branch on `code`, never on message text.
- **Optimistic toggle.** Completing a todo updates the cache immediately and rolls back on failure, so the checkbox feels instant. Create/delete wait for the server (simpler; failures are rarer and more visible).
- **SQLite via better-sqlite3 + Drizzle migrations**, applied at startup. Zero infra for dev, CI, and cloud sessions. Tests use `:memory:` for isolation.

## Risks / Trade-offs

- [SQLite is single-writer] → Acceptable for the template; the Drizzle layer keeps a move to Postgres contained to `apps/api/src/db`.
- [Optimistic UI can briefly show a state the server rejects] → Rolled back in `onError` and covered by a unit test.
