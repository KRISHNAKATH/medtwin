"""Clinician review: corrections painted on the slices, sign-off, and an append-only audit log.

Strokes arrive in slice-image pixel coordinates (one pixel = one voxel, radiological
display, see medtwin.slices.take_slice). They are converted back to voxel indices and
painted as discs in the slice plane, limited to the brain mask.
"""
from __future__ import annotations

import datetime as dt
import json
import threading
from pathlib import Path

import numpy as np

from .slices import PLANES

_audit_lock = threading.Lock()


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def audit(job_dir: Path, action: str, actor: dict | None = None, **details) -> dict:
    entry = {"time": now(), "action": action, "actor": actor or {"name": "system", "role": "MedTwin"}, **details}
    with _audit_lock, open(job_dir / "audit.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


def read_audit(job_dir: Path) -> list[dict]:
    path = job_dir / "audit.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _plane_axes(plane: str) -> tuple[int, int, int]:
    """(slice axis, image-column axis, image-row axis) for a plane."""
    axis = PLANES[plane]
    rest = [a for a in range(3) if a != axis]
    return axis, rest[0], rest[1]


def apply_strokes(labels: np.ndarray, brain_mask: np.ndarray, strokes: list[dict],
                  allowed_labels: set[int]) -> tuple[np.ndarray, dict]:
    """Paint strokes into a copy of ``labels``. Each stroke: plane, index, label (0 erases),
    radius (voxels), points [[col, row], ...]. Returns (new labels, voxel changes per label)."""
    out = labels.copy()
    for stroke in strokes:
        plane = stroke["plane"]
        if plane not in PLANES:
            raise ValueError(f"Unknown plane {plane!r}")
        label = int(stroke["label"])
        if label != 0 and label not in allowed_labels:
            raise ValueError(f"Unknown label {label}")
        radius = float(np.clip(stroke.get("radius", 2), 0.5, 25))
        axis, col_axis, row_axis = _plane_axes(plane)
        index = int(stroke["index"])
        if not 0 <= index < labels.shape[axis]:
            raise ValueError("Slice index out of range")
        n_col, n_row = labels.shape[col_axis], labels.shape[row_axis]
        pts = np.asarray(stroke["points"], dtype=np.float64).reshape(-1, 2)
        if len(pts) == 0:
            continue
        # densify the polyline so fast strokes leave no gaps
        dense = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            steps = max(1, int(np.ceil(np.linalg.norm(b - a) / max(radius / 2, 0.5))))
            dense.extend(a + (b - a) * t for t in np.linspace(0, 1, steps + 1)[1:])
        dense = np.asarray(dense)
        # image (col, row) -> voxel (u along col_axis, v along row_axis); display flips both
        u = (n_col - 1) - dense[:, 0]
        v = (n_row - 1) - dense[:, 1]
        uu, vv = np.meshgrid(np.arange(n_col), np.arange(n_row), indexing="ij")
        hit = np.zeros((n_col, n_row), bool)
        r2 = radius ** 2
        for cu, cv in zip(u, v):
            lo_u, hi_u = int(max(0, cu - radius - 1)), int(min(n_col, cu + radius + 2))
            lo_v, hi_v = int(max(0, cv - radius - 1)), int(min(n_row, cv + radius + 2))
            sub = (uu[lo_u:hi_u, lo_v:hi_v] - cu) ** 2 + (vv[lo_u:hi_u, lo_v:hi_v] - cv) ** 2 <= r2
            hit[lo_u:hi_u, lo_v:hi_v] |= sub
        index_tuple = [slice(None)] * 3
        index_tuple[axis] = index
        plane_view = out[tuple(index_tuple)]          # 2D view (col_axis, row_axis)
        brain_plane = brain_mask[tuple(index_tuple)]
        paint = hit & (brain_plane if label != 0 else np.ones_like(hit))
        plane_view[paint] = label
    changes = {}
    for value in sorted(allowed_labels | {0}):
        before, after = int((labels == value).sum()), int((out == value).sum())
        if before != after:
            changes[str(value)] = after - before
    return out, changes
