# RevOps Platform — Claude Code Execution Kit

Ye kit ek empty repo mein drop karke Claude Code se poora MVP build karwane ke liye hai.
Launch market: **India**. Stack: **lean modular monolith**. Segment: **abhi decide nahi** (isliye sab kuch tenant-configurable banega).

## Kit mein kya hai

| Path | Kaam |
|---|---|
| `CLAUDE.md` | Claude Code ka permanent context — rules, commands, conventions |
| `docs/00-execution-plan.md` | Master plan: phases, session workflow, parallel non-code tracks |
| `docs/01-architecture.md` | Stack, modules, tenancy, events, provider adapters |
| `docs/02-data-model.md` | Core entities aur relationships |
| `docs/03-india-compliance.md` | DPDP, TRAI/DLT, call recording, WhatsApp opt-in, data residency |
| `docs/04-decisions.md` | ADRs — kyun ye choice, kab revisit karni hai |
| `docs/milestones/M0..M8` | Har milestone: scope, tasks, acceptance criteria, kickoff prompt, review checklist |
| `docs/milestones/S1-voice-spike.md` | Highest-risk spike — M1 ke saath parallel |
| `.claude/commands/` | `/start-milestone`, `/implement-task`, `/review-milestone`, `/adr` |
| `.claude/agents/` | Subagents: code-reviewer, test-writer, security-auditor |
| `.claude/settings.json` + `hooks/` | Auto format/lint after edits (Node hook, cross-platform), secrets ko read hone se roko |
| `docs/05-local-dev-setup.md` | Bina Docker ke local setup — cloud Postgres/Redis |

## Kaise use karein (pehli baar)

1. Naya repo banao, ye poora kit uske root mein copy karo, `git init && git add . && git commit -m "chore: execution kit"`.
2. `docs/05-local-dev-setup.md` follow karke Neon Postgres + Redis Cloud setup karo (Docker ki zaroorat nahi). Hook Node.js mein hai — koi extra tool nahi chahiye.
3. `claude` start karo aur run karo: `/start-milestone M0`
4. Claude plan dikhayega → tum approve karo → woh task-by-task implement karega.
5. Milestone khatam hone par: `/review-milestone M0` → tum review karo → merge → next milestone.

**Golden rule:** ek session = ek milestone (ya uska ek bada hissa). Milestone ke beech `/clear` mat karo jab tak `docs/milestones/PROGRESS.md` update na ho.
