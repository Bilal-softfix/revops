import logging

import pytest

from voice_agent.main import greeting, main


def test_greeting_mentions_ready() -> None:
    assert "ready" in greeting()


def test_main_logs_greeting_and_exits_zero(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="voice_agent"):
        assert main() == 0
    assert greeting() in caplog.text
