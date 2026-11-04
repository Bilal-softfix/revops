---
description: End-of-milestone quality gate before human review
argument-hint: <milestone id>
---
Milestone **$ARGUMENTS** is believed complete. Run the quality gate:

1. Confirm every task in the milestone file is ticked in PROGRESS.md and every acceptance criterion is satisfied — list each with evidence (test name or file).
2. Run the full suite: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build`, plus voice-agent checks if relevant. Report results.
3. Launch the **code-reviewer** subagent on the diff since the milestone started (`git log` to find the first commit).
4. Launch the **security-auditor** subagent on the same diff.
5. Fix all blocking findings. List non-blocking findings in PROGRESS.md under "Tech debt".
6. Walk through the "Review checklist" section of the milestone file and answer each item.
7. Produce a short milestone report for me: what was built, how to demo it locally (exact steps), known limitations, decisions made, tech debt, and readiness for the next milestone.
