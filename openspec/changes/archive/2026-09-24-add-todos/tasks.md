# Tasks

## 1. Contract

- [x] 1.1 Add `Todo`, `CreateTodoInput`, `UpdateTodoInput` zod schemas in `packages/shared/src/todo.ts`
- [x] 1.2 Add the `ApiError` envelope schema in `packages/shared/src/errors.ts`

## 2. API

- [x] 2.1 Add the `todos` table and generate the initial migration
- [x] 2.2 Implement `GET/POST /api/todos` and `PATCH/DELETE /api/todos/:id`
- [x] 2.3 Map validation, not-found and unexpected errors to the error envelope
- [x] 2.4 Integration tests with `app.inject()` for every API scenario

## 3. Web

- [x] 3.1 API client that validates responses against the shared schemas
- [x] 3.2 Todos page with form, list, remaining count, empty and error states
- [x] 3.3 Optimistic completion toggle with rollback
- [x] 3.4 Component tests for every UI scenario

## 4. End-to-end

- [x] 4.1 Playwright tests for create, reject-empty, complete and delete against the built stack
