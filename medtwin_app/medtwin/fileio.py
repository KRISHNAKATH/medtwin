"""Atomic file writes that survive Windows file locking.

On Windows, replacing a file fails with "Access is denied" while any other process (antivirus,
search indexer, a reader thread) briefly has it open. Retry for up to about two seconds.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

RETRIES = 40
WAIT_S = 0.05


def replace(src: Path, dst: Path) -> None:
    for attempt in range(RETRIES):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == RETRIES - 1:
                raise
            time.sleep(WAIT_S)


def write_text(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    replace(tmp, path)
