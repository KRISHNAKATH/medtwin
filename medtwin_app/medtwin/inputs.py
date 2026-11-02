"""Find, unpack and validate the four MRI sequences for one case."""
from __future__ import annotations

import re
import zipfile
from pathlib import Path

import nibabel as nib
import numpy as np

from . import config

NIFTI_RE = re.compile(r"\.nii(\.gz)?$", re.IGNORECASE)

# Checked in order: specific names before generic ones (t1c before t1, flair before t2).
SEQUENCE_PATTERNS = (
    ("seg", re.compile(r"(^|[-_.])(seg|label|mask|gt)([-_.]|$)")),
    ("t1c", re.compile(r"(t1c|t1ce|t1gd|t1_?post|t1[-_]?contrast|gad)")),
    ("flair", re.compile(r"(t2f|flair)")),
    ("t2", re.compile(r"(t2w|t2)")),
    ("t1", re.compile(r"(t1n|t1w|t1)")),
)


class InputError(ValueError):
    """Raised for inputs the pipeline cannot use; the message is shown to the user."""


def classify(filename: str) -> str | None:
    name = NIFTI_RE.sub("", filename.lower())
    for key, pattern in SEQUENCE_PATTERNS:
        if pattern.search(name):
            return key
    return None


def find_sequences(folder: Path) -> tuple[dict[str, Path], Path | None]:
    """Map each NIfTI file in ``folder`` (recursively) to t1/t1c/t2/flair; the
    optional ground-truth segmentation is returned separately."""
    found: dict[str, Path] = {}
    seg = None
    for path in sorted(folder.rglob("*")):
        if not path.is_file() or not NIFTI_RE.search(path.name):
            continue
        key = classify(path.name)
        if key == "seg":
            seg = seg or path
        elif key and key not in found:
            found[key] = path
    return found, seg


def safe_extract_zip(archive: Path, dest: Path) -> None:
    dest = dest.resolve()
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            target = (dest / member.filename).resolve()
            if not str(target).startswith(str(dest)):
                raise InputError(f"Unsafe path in zip: {member.filename}")
        zf.extractall(dest)


def validate(files: dict[str, Path], required: tuple[str, ...]) -> tuple[dict, list[str]]:
    """Check presence, readability and 3D shape. Alignment and skull stripping are handled
    by medtwin.prepare. Returns (info, warnings); raises InputError."""
    missing = [config.MODALITY_LABELS[k] for k in required if k not in files]
    if missing:
        raise InputError(
            "Missing sequence(s): " + ", ".join(missing)
            + ". Upload T1, T1 contrast, T2 and FLAIR NIfTI files (names containing t1n/t1c/t2w/t2f or t1/t1ce/t2/flair)."
        )
    warnings: list[str] = []
    shapes, affines = {}, {}
    for key in required:
        try:
            img = nib.load(str(files[key]))
        except Exception as exc:
            raise InputError(f"{config.MODALITY_LABELS[key]} is not a readable NIfTI file ({exc}).") from exc
        if len(img.shape) != 3:
            raise InputError(f"{config.MODALITY_LABELS[key]} must be a 3D volume, got shape {img.shape}.")
        shapes[key], affines[key] = img.shape, img.affine
    ref = "t1c" if "t1c" in required else required[0]
    aligned = all(shapes[k] == shapes[ref] and np.allclose(affines[k], affines[ref], atol=1e-2) for k in required)
    spacing = np.sqrt((affines[ref][:3, :3] ** 2).sum(axis=0))
    if spacing.max() > 2.0:
        warnings.append(f"Coarse voxels ({', '.join(f'{s:.1f}' for s in spacing)} mm); volumes will be less precise.")
    info = {
        "shape": list(shapes[ref]),
        "spacing_mm": [round(float(s), 3) for s in spacing],
        "orientation": "".join(nib.aff2axcodes(affines[ref])),
        "sequences_aligned": aligned,
    }
    return info, warnings
