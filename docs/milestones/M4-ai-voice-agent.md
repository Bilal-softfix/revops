# M4 — AI Voice Agent
**Depends on:** M3 · **Size:** XL

## Goal
When no human answers, an AI agent greets in the caller's language (Hindi/English/Hinglish), answers FAQs from the tenant's knowledge base, qualifies using the tenant's playbook, books a callback or transfers to a human, and writes a summary + structured qualification into the CRM.

## Tasks
**M4-T1 Playbooks** — CRUD in api + web: greeting, persona, language preference, qualification questions (key, prompt, type, required), escalation rules (keywords, "asks for human", angry sentiment, high-value), closing, voice selection; versioned; seeded from industry templates. Disclosure line mandatory.

**M4-T2 Knowledge base** — upload text/PDF/URL, chunk, embed (pgvector), retrieval endpoint for agent; per-tenant isolation.

**M4-T3 Voice agent service (Python)** — production structure (config, providers per ADR-007, pipeline, tools, telemetry); on room join fetch context from api via internal service token: tenant, playbook, lead history summary; tools: `lookup_kb`, `save_qualification`, `book_callback`, `transfer_to_human`, `end_call`; tool calls go to api internal endpoints (validated, audited as actor=ai). Barge-in/interruptions, silence timeout, max call duration, graceful failure ("I'll have someone call you back") on any provider error.
- AC: pytest with mocked providers covers each tool path; agent never ends call silently on error.

**M4-T4 Post-call processing** — transcript stored with speaker segments; LLM summary + structured extraction validated against playbook schema (retry once, else mark needs_review); `qualification.saved.v1`; timeline entry; lead fields updated per mapping; lead stage optionally auto-moved per playbook rule.

**M4-T5 Transfer to human** — warm transfer attempt via ring group; if nobody answers, return to AI with "nobody available" path → callback task.

**M4-T6 Evaluation harness** — scripted simulated callers (text-mode run of the same agent logic) with 30+ scenarios: Hindi only, Hinglish, wrong number, abusive caller, asks if bot, asks for price not in KB (must not invent), wants human, silence, background noise transcript. Assertions on tool calls + no hallucinated facts. Runs in CI (text mode).
- AC: ≥ 90% scenarios pass; "price not in KB" never invents a number.

**M4-T7 Review UI + metrics** — conversation viewer (audio + transcript + extracted data), human correction of extracted fields (logged as correction rate), metrics: AI calls, completion, transfers, avg latency, cost/call. Usage events for STT/TTS/LLM/agent minutes.

## Kickoff prompt
```
/start-milestone M4
Hard rules for the agent: never claim to be human, never invent prices/availability/facts not in the KB or playbook, always offer human callback when unsure. Build the evaluation harness (M4-T6) early so every later prompt change is tested against it.
```

## Review checklist (human — Dev)
- [ ] Listen to 20 real test calls: Hindi, English, Hinglish, noisy line
- [ ] Latency acceptable per ADR-007 targets
- [ ] Extraction accuracy spot-check on 20 calls
- [ ] Cost per AI minute measured and recorded
