"""S1-T4 (part): TTS and STT comparison without a microphone.

TTS: each Hindi-capable voice speaks the same Hinglish lines (Roman script, as the LLM writes
them, and the first line also in Devanagari). We record time to first audio byte and save WAVs
in results/audio/ to listen to.
STT: the audio of one TTS is transcribed by each STT model and printed next to the source text.
(Clean synthetic speech — real-caller accuracy needs S1-T4's recorded calls.)

    uv run python bench_speech.py
"""

from __future__ import annotations

import asyncio
import json
import statistics
import time
import wave
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import inference, stt
from livekit.agents.utils import http_context

load_dotenv(".env.local")
RESULTS = Path(__file__).parent / "results"
AUDIO = RESULTS / "audio"

LINES = [
    "Namaste, main Riya bol rahi hoon. Aapko kaunse area mein flat chahiye?",
    "नमस्ते, मैं रिया बोल रही हूँ। आपको कौनसे एरिया में फ्लैट चाहिए?",
    "Samajh gayi, pachas lakh ke aas paas. Aap ye property kab tak lena chahte hain?",
    "Theek hai, maine saari details note kar li hain. Hamari team jaldi call back karegi.",
]

TTS_MODELS: dict[str, dict[str, Any]] = {
    "cartesia/sonic-3": {"language": "hi"},
    "google/gemini-3.8-flash-tts": {"language": "hi"},
    "inworld/inworld-tts-2-flash": {"language": "hi"},
}
STT_MODELS: dict[str, str] = {
    "deepgram/nova-3": "multi",
    "openai/gpt-live-transcribe": "multi",
    "speechmatics/oak-1": "multi",
}


def save_wav(path: Path, frames: list[rtc.AudioFrame]) -> None:
    if not frames:
        return
    merged = rtc.combine_audio_frames(frames)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(merged.num_channels)
        out.setsampwidth(2)
        out.setframerate(merged.sample_rate)
        out.writeframes(merged.data.tobytes())


async def synth(model: str, opts: dict[str, Any], text: str) -> tuple[float, list[rtc.AudioFrame]]:
    tts = inference.TTS(model=model, **opts)
    started = time.perf_counter()
    first: float | None = None
    frames: list[rtc.AudioFrame] = []
    async with tts.synthesize(text) as stream:
        async for chunk in stream:
            if first is None:
                first = time.perf_counter() - started
            frames.append(chunk.frame)
    return first or 0.0, frames


async def transcribe(model: str, language: str, frames: list[rtc.AudioFrame]) -> str:
    engine = inference.STT(model=model, language=language)
    stream = engine.stream()
    for frame in frames:
        stream.push_frame(frame)
    # Trailing silence so endpointing finalises the last words.
    silence = rtc.AudioFrame.create(
        frames[0].sample_rate, frames[0].num_channels, frames[0].sample_rate
    )
    for _ in range(2):
        stream.push_frame(silence)
    stream.end_input()
    finals: list[str] = []
    async for event in stream:
        if event.type == stt.SpeechEventType.FINAL_TRANSCRIPT and event.alternatives:
            finals.append(event.alternatives[0].text)
    return " ".join(t.strip() for t in finals if t.strip())


async def main() -> None:
    AUDIO.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {"tts": [], "stt": []}
    keep: dict[str, list[list[rtc.AudioFrame]]] = {}
    async with http_context.open():
        for model, opts in TTS_MODELS.items():
            ttfbs: list[float] = []
            error = None
            keep[model] = []
            for i, line in enumerate(LINES):
                try:
                    ttfb, frames = await synth(model, opts, line)
                except Exception as exc:  # noqa: BLE001 (spike)
                    error = repr(exc)[:200]
                    break
                ttfbs.append(ttfb)
                keep[model].append(frames)
                save_wav(AUDIO / f"{model.replace('/', '_')}-{i}.wav", frames)
            report["tts"].append(
                {
                    "model": model,
                    "ttfb_p50": statistics.median(ttfbs) if ttfbs else None,
                    "ttfb_all": [round(t, 3) for t in ttfbs],
                    "error": error,
                }
            )
        source = next((m for m in TTS_MODELS if keep.get(m) and len(keep[m]) == len(LINES)), None)
        if source:
            for model, language in STT_MODELS.items():
                rows = []
                for line, frames in zip(LINES, keep[source], strict=True):
                    try:
                        text = await transcribe(model, language, frames)
                    except Exception as exc:  # noqa: BLE001 (spike)
                        text = f"ERROR {exc!r}"[:200]
                    rows.append({"source": line, "heard": text})
                report["stt"].append({"model": model, "audio_from": source, "rows": rows})
    (RESULTS / "bench-speech.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("TTS  (time to first audio, seconds)")
    for row in report["tts"]:
        if row["error"]:
            print(f"  {row['model']:<30} ERROR {row['error']}")
        else:
            print(f"  {row['model']:<30} p50 {row['ttfb_p50']:.2f}  all {row['ttfb_all']}")
    for row in report["stt"]:
        print(f"STT {row['model']}  (audio: {row['audio_from']})")
        for r in row["rows"]:
            print(f"   said : {r['source']}")
            print(f"   heard: {r['heard']}")


if __name__ == "__main__":
    asyncio.run(main())
