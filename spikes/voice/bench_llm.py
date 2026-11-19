"""S1-T4 (part): LLM comparison in text mode — no microphone needed.

A scripted Hinglish caller talks to the real QualificationAgent (same prompt and tools) once per
candidate model via LiveKit Inference. Per model we record: time to first token per turn, whether
`save_qualification` was called with the right values, and the replies (to judge Hinglish quality).

    uv run python bench_llm.py            # writes results/bench-llm.json and prints a table
"""

from __future__ import annotations

import asyncio
import json
import statistics
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from livekit.agents import AgentSession, MetricsCollectedEvent, inference
from livekit.agents.metrics import LLMMetrics
from livekit.agents.utils import http_context

from agent import QualificationAgent

load_dotenv(".env.local")
RESULTS = Path(__file__).parent / "results"

MODELS = [
    "google/gemma-4-31b-it",
    "google/gemini-3.5-flash-lite",
    "openai/gpt-5.4-mini",
]

# A typical Hinglish caller: answers spread over turns, one in English, numbers in words.
CALLER = [
    "Haan hello, mujhe ek flat chahiye tha.",
    "2 BHK chahiye, Gomti Nagar ya Indira Nagar side mein.",
    "Budget around pachas lakh hai, thoda upar ja sakte hain.",
    "Within three months, ideally Diwali se pehle.",
]
EXPECTED = {"budget": ["50", "pachas", "fifty"], "timeline": ["3", "three", "teen"]}


async def run_model(model: str) -> dict[str, Any]:
    ttfts: list[float] = []
    replies: list[str] = []
    calls: list[dict[str, Any]] = []
    started = time.perf_counter()
    async with (
        inference.LLM(model=model) as llm,
        AgentSession(llm=llm) as session,
    ):

        @session.on("metrics_collected")
        def _m(ev: MetricsCollectedEvent) -> None:
            if isinstance(ev.metrics, LLMMetrics):
                ttfts.append(ev.metrics.ttft)

        await session.start(QualificationAgent(f"bench-{model.split('/')[-1]}"))
        for line in CALLER:
            result = await session.run(user_input=line)
            for event in result.events:
                item = getattr(event, "item", None)
                if event.type == "message" and getattr(item, "role", "") == "assistant":
                    replies.append(item.text_content or "")
                elif event.type == "function_call":
                    calls.append({"name": item.name, "arguments": json.loads(item.arguments)})
    saved = next((c["arguments"] for c in calls if c["name"] == "save_qualification"), None)
    checks = {
        key: bool(saved) and any(v in str(saved.get(key, "")).lower() for v in options)
        for key, options in EXPECTED.items()
    }
    return {
        "model": model,
        "ttft_p50": statistics.median(ttfts) if ttfts else None,
        "ttft_max": max(ttfts) if ttfts else None,
        "llm_calls": len(ttfts),
        "saved": saved,
        "checks": checks,
        "transferred": any(c["name"] == "transfer_to_human" for c in calls),
        "replies": replies,
        "wall_s": round(time.perf_counter() - started, 2),
    }


async def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    out = []
    async with http_context.open():  # inference clients need an HTTP session outside a job
        for model in MODELS:
            try:
                out.append(await run_model(model))
            except Exception as error:  # noqa: BLE001 (spike: record and continue)
                out.append({"model": model, "error": repr(error)})
    (RESULTS / "bench-llm.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"{'model':<32}{'ttft p50':>9}{'max':>7}{'saved':>7}{'budget':>8}{'timeline':>9}")
    for row in out:
        if "error" in row:
            print(f"{row['model']:<32} ERROR {row['error'][:80]}")
            continue
        p50 = row["ttft_p50"] or 0
        mx = row["ttft_max"] or 0
        print(
            f"{row['model']:<32}{p50:>9.2f}{mx:>7.2f}{bool(row['saved'])!s:>7}"
            f"{row['checks']['budget']!s:>8}{row['checks']['timeline']!s:>9}"
        )


if __name__ == "__main__":
    asyncio.run(main())
