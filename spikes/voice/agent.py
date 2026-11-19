"""S1 voice spike (THROWAWAY — not production; see docs/milestones/S1-voice-spike.md).

A Hinglish lead-qualification bot on LiveKit Agents 1.8:
  - greets the caller, asks 3 qualification questions (need, budget, timeline),
  - calls `save_qualification` (prints/stores JSON) and `transfer_to_human` (logs the request),
  - logs per-turn latency metrics to results/metrics-<combo>.jsonl for the S1-T4 benchmark.

Pipelines ("combos") are picked with VOICE_COMBO=A|B|C — see COMBOS below.

Run (after filling .env.local from .env.example):
    uv run python agent.py dev        # registers the worker; talk to it from the Agents Playground
    uv run python agent.py console    # talk to it from this terminal (local mic/speaker)
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    MetricsCollectedEvent,
    RunContext,
    TurnHandlingOptions,
    function_tool,
    inference,
)
from livekit.plugins import sarvam

load_dotenv(".env.local")
log = logging.getLogger("voice-spike")
RESULTS = Path(__file__).parent / "results"

LLM_MODEL = os.getenv("LLM_MODEL", "google/gemma-4-31b-it")

# Each combo: (stt, llm, tts) factories. Model ids are LiveKit Inference ids unless noted.
COMBOS: dict[str, Callable[[], dict[str, Any]]] = {
    # A — Inference only: Deepgram Nova-3 multilingual (Hindi/English code-switching) + Cartesia.
    "A": lambda: {
        "stt": inference.STT(model="deepgram/nova-3", language="multi"),
        "llm": inference.LLM(model=LLM_MODEL),
        "tts": inference.TTS(
            model="cartesia/sonic-3",
            voice=os.getenv("CARTESIA_VOICE", ""),
            language="hi",
        ),
    },
    # B — Sarvam (Indian stack, own API key): Saaras v4 in codemix mode + Bulbul v4 flash.
    "B": lambda: {
        "stt": sarvam.STT(language="hi-IN", model="saaras:v4", mode="codemix"),
        "llm": inference.LLM(model=LLM_MODEL),
        "tts": sarvam.TTS(
            target_language_code="hi-IN",
            model="bulbul:v4-flash",
            speaker=os.getenv("SARVAM_SPEAKER", "priya"),
        ),
    },
    # C — Inference only: OpenAI GPT-Live Transcribe (multi) + Gemini flash-lite + Gemini TTS.
    "C": lambda: {
        "stt": inference.STT(model="openai/gpt-live-transcribe", language="multi"),
        "llm": inference.LLM(model=os.getenv("LLM_MODEL", "google/gemini-3.5-flash-lite")),
        "tts": inference.TTS(model="google/gemini-3.8-flash-tts", language="hi"),
    },
}

INSTRUCTIONS = """
Aap "Riya" hain, ek property consultancy ki friendly phone assistant. Caller ne abhi call kiya hai
aur team ka koi member free nahi tha, isliye aap baat kar rahi hain.

Bolne ka tareeka:
- Natural Hinglish mein baat karein — jis bhasha mein caller bole (Hindi, English ya mix), usi mein.
- Chhote, simple sentences. Ek baar mein ek hi sawaal. Koi emoji, list, ya symbols nahi.
- Numbers bolkar kahein ("pachas lakh", "fifty lakh"), digits nahi.

Kaam (in teen sawaalon ka jawaab lena hai):
1. Unhe kya chahiye — kaunsi property (flat, plot, villa) aur kis area mein.
2. Budget kitna hai.
3. Kab tak lena chahte hain (timeline).

Teeno jawaab milte hi `save_qualification` tool call karein, phir bataayein ki team jaldi call back
karegi aur shukriya kahein. Agar caller kisi insaan se baat karna chahe, gussa ho, ya sawaal aapke
bas ka na ho, to `transfer_to_human` call karein. Kabhi bhi price, availability ya legal baaton ka
vaada na karein.
""".strip()


class QualificationAgent(Agent):
    def __init__(self, combo: str) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self.combo = combo

    @function_tool
    async def save_qualification(
        self,
        context: RunContext,
        requirement: str,
        budget: str,
        timeline: str,
        language: str,
    ) -> str:
        """Save the caller's answers once all three are known.

        Args:
            requirement: What they want (property type and area), in the caller's words.
            budget: Their budget, as said (e.g. "50 lakh").
            timeline: When they want to buy (e.g. "3 mahine mein").
            language: The language the caller mostly used: hindi, english or hinglish.
        """
        record = {
            "at": time.time(),
            "combo": self.combo,
            "requirement": requirement,
            "budget": budget,
            "timeline": timeline,
            "language": language,
        }
        print("QUALIFICATION", json.dumps(record, ensure_ascii=False))
        _append(f"qualifications-{self.combo}.jsonl", record)
        return "saved"

    @function_tool
    async def transfer_to_human(self, context: RunContext, reason: str) -> str:
        """Hand the call to a human agent.

        Args:
            reason: Why the caller needs a person (asked for one, upset, out of scope).
        """
        print("TRANSFER", json.dumps({"combo": self.combo, "reason": reason}))
        _append(f"transfers-{self.combo}.jsonl", {"at": time.time(), "reason": reason})
        # S1-T3 replaces this with a real SIP transfer; in the playground we only log it.
        return "Transfer requested. Tell the caller you are connecting them to a team member now."


def _append(name: str, record: dict[str, Any]) -> None:
    RESULTS.mkdir(exist_ok=True)
    with (RESULTS / name).open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")


server = AgentServer()


@server.rtc_session(agent_name="voice-spike")
async def entrypoint(ctx: agents.JobContext) -> None:
    combo = os.getenv("VOICE_COMBO", "A").upper()
    if combo not in COMBOS:
        raise SystemExit(f"VOICE_COMBO must be one of {sorted(COMBOS)}, got {combo!r}")
    parts = COMBOS[combo]()
    session: AgentSession = AgentSession(
        **parts,
        turn_handling=TurnHandlingOptions(turn_detection=inference.TurnDetector()),
    )

    @session.on("metrics_collected")
    def _on_metrics(ev: MetricsCollectedEvent) -> None:
        # EOU delay (end of caller speech → turn committed), LLM TTFT, TTS TTFB: their sum is the
        # "end of caller speech → first audio byte" latency we benchmark (target < 1.2 s p50).
        metrics = ev.metrics
        data = metrics.model_dump() if hasattr(metrics, "model_dump") else vars(metrics)
        _append(f"metrics-{combo}.jsonl", {"type": type(metrics).__name__, **data})

    await session.start(room=ctx.room, agent=QualificationAgent(combo))
    await session.generate_reply(
        instructions="Caller ko Hinglish mein namaste karke greet karein, apna naam Riya bataayein "
        "aur poochhein ki aap unki kya madad kar sakti hain."
    )


if __name__ == "__main__":
    agents.cli.run_app(server)
