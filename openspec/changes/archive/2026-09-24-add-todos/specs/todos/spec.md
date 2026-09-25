# Spec Delta

## Purpose

Lets a user keep a simple personal list of todos: add items, mark them done, and remove them, through the web UI and a JSON REST API.

## ADDED Requirements

### Requirement: List todos

The system SHALL return all todos in creation order and the UI SHALL display each todo with its completion state and the number of incomplete todos.

#### Scenario: List todos

- **WHEN** the user opens the Todos page and todos exist
- **THEN** each todo is shown with a checkbox reflecting its completion state
- **AND** the page shows how many todos are left to complete

#### Scenario: Empty list

- **WHEN** the user opens the Todos page and no todos exist
- **THEN** an empty-state message invites the user to add one

### Requirement: Create a todo

The system SHALL let a user create a todo with a title of 1–200 characters after trimming surrounding whitespace. New todos MUST start incomplete and MUST persist across reloads.

#### Scenario: Create a todo

- **WHEN** the user enters "  Buy milk  " in the "New todo" field and submits
- **THEN** a todo titled "Buy milk" appears in the list, unchecked
- **AND** the input is cleared
- **AND** the todo is still present after reloading the page

#### Scenario: Reject an empty title

- **WHEN** the user submits a title that is empty or only whitespace
- **THEN** no todo is created
- **AND** an inline error "Title is required" is announced and the field is marked invalid
- **AND** the API responds 400 with error code `VALIDATION_ERROR` if called directly

#### Scenario: Reject an overlong title

- **WHEN** a title longer than 200 characters is submitted
- **THEN** no todo is created and the API responds 400 with error code `VALIDATION_ERROR`

### Requirement: Complete a todo

The system SHALL let a user mark a todo complete or incomplete. The UI MUST reflect the change immediately and MUST revert it if the server rejects the update.

#### Scenario: Complete a todo

- **WHEN** the user checks an incomplete todo
- **THEN** it is shown as completed and the remaining count decreases
- **AND** it is still completed after reloading the page

### Requirement: Delete a todo

The system SHALL let a user delete a todo via a button labelled "Delete <title>".

#### Scenario: Delete a todo

- **WHEN** the user activates "Delete <title>" for a todo
- **THEN** the todo is removed from the list and from storage

#### Scenario: Unknown todo

- **WHEN** an update or delete targets a todo id that does not exist
- **THEN** the API responds 404 with error code `NOT_FOUND`

### Requirement: Error handling

The UI SHALL surface failures to load todos with a message and a retry action instead of an empty or broken page.

#### Scenario: API unavailable

- **WHEN** the todos request fails
- **THEN** an alert "Could not load todos." is shown with a "Retry" button
