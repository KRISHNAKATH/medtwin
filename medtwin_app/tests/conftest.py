"""Test isolation: every test run uses its own temporary data folder, so tests can never read or
change the real accounts, cases or security log in medtwin_app/data. Runs before any test module
imports medtwin.config."""
from __future__ import annotations

import os
import tempfile

os.environ["MEDTWIN_DATA_DIR"] = tempfile.mkdtemp(prefix="medtwin-test-data-")
