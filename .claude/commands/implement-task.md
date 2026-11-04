---
description: Implement one task end-to-end with tests and Definition of Done
argument-hint: <task id, e.g. M1-T3>
---
Implement task **$ARGUMENTS** from the active milestone file.

Workflow:
1. Re-read the task's acceptance criteria. If anything is ambiguous, ask before coding.
2. Write/adjust the Zod schemas and types in `packages/shared` first (contract first).
3. Implement as a vertical slice: migration → repository → service → controller/worker → UI (if in scope).
4. Write tests alongside: unit tests for service logic, integration tests against the test database (DATABASE_URL_TEST) for repository/API, tenant-leak test for any tenant table, Playwright test if the task has a user-facing flow listed.
5. Use the **test-writer** subagent if test coverage of edge cases feels thin.
6. Run `pnpm typecheck && pnpm lint && pnpm test` (and voice-agent checks if touched). Fix everything until green. Do not skip or `.skip` tests to get green.
7. Walk through the Definition of Done in CLAUDE.md and confirm each item explicitly.
8. Update `docs/milestones/PROGRESS.md` (tick the task, note assumptions, note anything "Blocked on external").
9. Make one conventional commit. Then show me: summary of changes, how to manually verify, and the next task ID.
