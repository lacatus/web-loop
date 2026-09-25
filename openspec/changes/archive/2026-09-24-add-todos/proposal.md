# Proposal

## Why

The template needs one real, end-to-end feature so the worker agent has a working pattern to copy (contract → API → persistence → UI → tests at every layer) and the validator has something concrete to exercise with Playwright.

## What Changes

- Add a Todos capability: list, create, complete/uncomplete and delete todos.
- Expose a JSON REST API under `/api/todos` with a uniform error shape.
- Persist todos in SQLite so they survive reloads and restarts.
- Add a Todos page at `/` with an accessible form, list, empty state and error state.

## Capabilities

### New Capabilities

- `todos`: Managing a personal list of todos through the web UI and the REST API.

### Modified Capabilities

_None._

## Impact

- `packages/shared`: new `todo` and `errors` contract modules.
- `apps/api`: `todos` table + migration, `/api/todos` routes, global error handler.
- `apps/web`: Todos page, form and item components, API client with response validation.
- `e2e`: first Playwright suite.
