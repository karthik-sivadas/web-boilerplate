# Feature task: <name>

## Intent and acceptance criteria

-

## Agent profiles

Use only `openai-codex/gpt-6-astra`: high for planning/review/hard problems, medium for implementation/repairs, low for explicitly consented research. See [agent workflow](../agent-workflow.md) for legacy key mapping and approval boundaries.

## Test first

- Unit/component/browser test:

## Owned paths

- Application: `apps/web/src/...`; shared official UI/theme: `packages/ui/src/...`.
- Root tests/configs/docs/runner paths only when explicitly in scope; keep fixed Astra profiles.

## Route and data contract

- Inputs, validation, loader/query key:

## Production impact

- Authentication/authorization:
- Database or migration:
- Accessibility and error states:
- Telemetry/privacy:
- Documentation:
- Rollout, rollback, and feature flag:
