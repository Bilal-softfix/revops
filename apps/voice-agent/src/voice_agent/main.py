"""Hello-world entrypoint. The LiveKit worker replaces this once S1 picks the voice stack."""

import logging
import sys

logger = logging.getLogger("voice_agent")


def greeting() -> str:
    return "voice-agent ready (stack decided by S1 spike)"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logger.info(greeting())
    return 0


if __name__ == "__main__":
    sys.exit(main())
