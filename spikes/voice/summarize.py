"""S1-T4 helper: per-combo latency from results/metrics-<combo>.jsonl.

Per caller turn (joined on speech_id):
    response latency = EOU end_of_utterance_delay + LLM ttft + TTS ttfb
i.e. end of caller speech → first audio byte of the reply. Target: p50 < 1.2 s (stretch < 0.8 s).

    uv run python summarize.py            # all combos found in results/
"""

from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

RESULTS = Path(__file__).parent / "results"


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1))))
    return ordered[k]


def turns(path: Path) -> list[dict[str, float]]:
    by_speech: dict[str, dict[str, float]] = defaultdict(dict)
    for line in path.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        speech = row.get("speech_id")
        if not speech:
            continue
        kind = row.get("type")
        turn = by_speech[speech]
        if kind in ("eou_metrics", "EOUMetrics"):
            turn["eou"] = row["end_of_utterance_delay"]
        elif kind in ("llm_metrics", "LLMMetrics") and "llm" not in turn:  # first LLM call of the turn
            turn["llm"] = row["ttft"]
        elif kind in ("tts_metrics", "TTSMetrics") and "tts" not in turn:
            turn["tts"] = row["ttfb"]
    complete = [t for t in by_speech.values() if {"eou", "llm", "tts"} <= t.keys()]
    for t in complete:
        t["total"] = t["eou"] + t["llm"] + t["tts"]
    return complete


def main() -> int:
    files = sorted(RESULTS.glob("metrics-*.jsonl"))
    if not files:
        print("No results/metrics-*.jsonl yet — run some calls first.")
        return 1
    print(f"{'combo':<6}{'turns':>6}{'p50':>8}{'p90':>8}{'eou p50':>9}{'llm p50':>9}{'tts p50':>9}")
    for path in files:
        combo = path.stem.removeprefix("metrics-")
        rows = turns(path)
        if not rows:
            print(f"{combo:<6}{0:>6}  (no complete turns)")
            continue

        def col(key: str, rows: list[dict[str, float]] = rows) -> list[float]:
            return [r[key] for r in rows]

        print(
            f"{combo:<6}{len(rows):>6}"
            f"{percentile(col('total'), 50):>8.2f}{percentile(col('total'), 90):>8.2f}"
            f"{statistics.median(col('eou')):>9.2f}{statistics.median(col('llm')):>9.2f}"
            f"{statistics.median(col('tts')):>9.2f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
