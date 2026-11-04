# S1 — Voice & Telephony Spike (parallel with M1/M2)
**Depends on:** M0 · **Size:** M · **Throwaway code in `spikes/voice/` — not production**

## Questions to answer
1. Which Indian telephony provider gives us: inbound virtual numbers (with feasible KYC), ring-to-human-with-timeout, then hand-off of the live call to our AI agent? Candidates: Exotel, Plivo, Twilio (+ SIP trunk), any other with India numbers.
2. Integration mode: SIP trunk into LiveKit SIP vs provider's bidirectional media-stream WebSocket. Which is more reliable for transfer back to a human?
3. STT/TTS/LLM combination giving acceptable **Hindi, English and Hinglish** quality with end-of-caller-speech → first-audio-byte latency target < 1.2s p50 (stretch < 800ms).
4. Real ₹/minute: telephony + STT + TTS + LLM + LiveKit.

## Tasks
- **S1-T1** Provider matrix doc: numbers, KYC requirements, pricing, SIP/streaming support, transfer support, webhooks — from official docs + sales calls.
- **S1-T2** Minimal LiveKit Agents (Python) bot: greet in Hinglish, ask 3 qualification questions, call a `save_qualification` tool that prints JSON, `transfer_to_human` tool.
- **S1-T3** Connect one real number via the top-1 provider; test human-first ring (timeout 20s) → AI fallback.
- **S1-T4** Benchmark 2–3 STT/TTS combos with 10 scripted calls each (mixed language, Lucknow/Delhi accents, background noise). Record latency, WER impression, naturalness, cost.
- **S1-T5** Spike report + fill ADR-007.

## Kickoff prompt
```
Read docs/milestones/S1-voice-spike.md. This is a throwaway spike in spikes/voice — optimise for learning speed, not code quality, but measure everything. Start with S1-T2 using a LiveKit Cloud free project (no local LiveKit server — the dev machine has no Docker) and the LiveKit Agents Playground/web client so we can test without telephony. Ask me for provider credentials when needed; never write them to files except a gitignored .env.
```

## Exit criteria
- [ ] ADR-007 written with measured numbers
- [ ] Decision on provider + mode + STT/TTS/LLM
- [ ] Known limitations listed (e.g. transfer behaviour, number availability)
