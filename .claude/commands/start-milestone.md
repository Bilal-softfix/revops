---
description: Kick off a milestone — read specs, produce a task plan, wait for approval
argument-hint: <milestone id, e.g. M1>
---
We are starting milestone **$ARGUMENTS**.

1. Read `CLAUDE.md`, `docs/00-execution-plan.md`, `docs/milestones/PROGRESS.md`, and the file in `docs/milestones/` whose name starts with `$ARGUMENTS`.
2. Read `docs/01-architecture.md` and `docs/02-data-model.md` sections relevant to this milestone. Inspect the current codebase state.
3. Check that every dependency milestone listed in the file is marked done in PROGRESS.md. If not, stop and tell me.
4. Enter Plan Mode. Output:
   - Your understanding of the goal in 3 lines
   - The ordered task list (use the task IDs from the milestone file), each with files you expect to touch and the tests you will write
   - Schema/migration changes, new env vars, new dependencies (with justification)
   - Open questions or ambiguities — ask them now, do not assume
5. Wait for my approval. After approval, add the milestone's tasks to PROGRESS.md as unchecked items and begin with the first task using the `/implement-task` workflow.
