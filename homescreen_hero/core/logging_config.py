import os
import re
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Environment variable for log directory override
LOG_DIR_ENV_VAR = "HOMESCREEN_HERO_LOG_DIR"

# Default for local dev
DEFAULT_LOG_DIR = Path("logs")


def get_log_dir() -> Path:
    raw = os.environ.get(LOG_DIR_ENV_VAR)
    if raw:
        return Path(raw)
    return DEFAULT_LOG_DIR


LOG_DIR = get_log_dir()
LOG_DIR.mkdir(parents=True, exist_ok=True)

LOG_FILE = LOG_DIR / "homescreen_hero.log"


# Plex tokens appear in URLs (X-Plex-Token=…, or %3D-encoded inside another
# URL) and in header dicts ('X-Plex-Token': '…'). Never write them to logs.
_TOKEN_PATTERN = re.compile(
    r"""(?i)(x-plex-token(?:=|%3D|['"]?\s*:\s*['"]))[^&\s'"%,}]+"""
)


def redact_secrets(text: str) -> str:
    return _TOKEN_PATTERN.sub(r"\1REDACTED", text)


class RedactingFormatter(logging.Formatter):
    # Formats as usual, then masks Plex tokens anywhere in the line,
    # including exception tracebacks.
    def format(self, record: logging.LogRecord) -> str:
        return redact_secrets(super().format(record))


def level_from_name(name: str) -> int:
    return getattr(logging, name.upper(), logging.INFO)


def _formatter() -> logging.Formatter:
    return RedactingFormatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _configure_handlers(root: logging.Logger, level: int) -> None:
    existing_handler_types = {type(handler) for handler in root.handlers}

    formatter = _formatter()

    if RotatingFileHandler not in existing_handler_types:
        file_handler = RotatingFileHandler(
            LOG_FILE, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(level)
        root.addHandler(file_handler)

    if logging.StreamHandler not in existing_handler_types:
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        console_handler.setLevel(level)
        root.addHandler(console_handler)


def setup_logging(level: int | str = logging.INFO, reconfigure: bool = False) -> None:
    if isinstance(level, str):
        level = level_from_name(level)

    root = logging.getLogger()
    root.setLevel(level)

    if reconfigure:
        root.handlers.clear()

    _configure_handlers(root, level)

    for handler in root.handlers:
        handler.setLevel(level)
        handler.setFormatter(_formatter())

    # Keep noisy third-party loggers at WARNING even when log level is set to DEBUG
    for noisy in ("urllib3", "httpcore", "httpx"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    logging.captureWarnings(True)
    root.debug(
        "Logging configured (level=%s, handlers=%d, log_file=%s)",
        logging.getLevelName(level),
        len(root.handlers),
        LOG_FILE,
    )
