# Feature task: add a project tag

## Intent and acceptance criteria

- A user can assign a short tag to an active project and see it on project pages.
- Invalid or duplicate tags show linked validation feedback.

## Test first

- Add domain validation and a keyboard-accessible form test.

## Route and data contract

- Extend the versioned workspace schema and provide a migration/recovery decision for stored data.

## Production impact

- No authentication or server writes in this demo. A future API needs tenant authorization and a migration.
- Check color contrast; tags must not be the only status signal.
- Document migration and rollback before shipping.
