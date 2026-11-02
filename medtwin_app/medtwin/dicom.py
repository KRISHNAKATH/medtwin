"""DICOM study import: find series, suggest which is T1 / T1c / T2 / FLAIR, convert to NIfTI.

Privacy: only technical tags are read (series description, timing, contrast agent, study
date). Patient name, ID, birth date and other identifying tags are never read or stored, and
the DICOM files are deleted as soon as the series are converted to NIfTI.
"""
from __future__ import annotations

import base64
import io
import re
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from PIL import Image

TAGS = {
    "modality": "0008|0060",
    "series_description": "0008|103e",
    "protocol_name": "0018|1030",
    "sequence_name": "0018|0024",
    "image_type": "0008|0008",
    "repetition_time": "0018|0080",
    "echo_time": "0018|0081",
    "inversion_time": "0018|0082",
    "contrast_agent": "0018|0010",
    "acquisition_type": "0018|0023",
    "study_date": "0008|0020",
}

EXCLUDE = re.compile(r"(dwi|diff|adc|trace|swi|swan|perf|dsc|dce|\basl\b|\bloc|scout|survey|tof|\bmra\b|cbf|cbv|"
                     r"\bmap\b|\bfa\b|spectro|\bmrs\b|calibration|\bcal\b|\bb0\b|t2\*|susc|bold|fmri|dti)")
CONTRAST = re.compile(r"(\+c\b|\bpost\b|post[-_ ]?(gd|contrast)|\bgd\b|gad|contrast|\bce\b|t1ce|t1c\b|_c\b|mdc|\+gd|kmplus|km\b)")
T1_WORDS = re.compile(r"(t1|mprage|mp-rage|bravo|spgr|fspgr|tfe|vibe|ffe|t1w)")
MIN_SLICES = 20

ROLES = ("t1", "t1c", "t2", "flair")


@dataclass
class SeriesInfo:
    index: int
    description: str
    slices: int
    size: list[int]
    spacing_mm: list[float]
    tr_ms: float | None
    te_ms: float | None
    ti_ms: float | None
    contrast: bool
    acquisition: str
    study_date: str | None
    suggested_role: str | None
    reason: str
    file: str | None = None
    thumbnail: str | None = None
    scores: dict = field(default_factory=dict)


def _float(text: str | None) -> float | None:
    try:
        return float(str(text).split("\\")[0])
    except (TypeError, ValueError):
        return None


def _meta(reader: sitk.ImageFileReader, key: str) -> str | None:
    tag = TAGS[key]
    return reader.GetMetaData(tag).strip() if reader.HasMetaDataKey(tag) else None


def classify(desc: str, tr: float | None, te: float | None, ti: float | None, contrast_agent: bool) -> tuple[dict, str]:
    """Score each role from the series text and timing. Returns (scores, reason)."""
    d = desc.lower()
    scores = {r: 0.0 for r in ROLES}
    if EXCLUDE.search(d):
        return scores, "excluded (diffusion, perfusion, localiser or similar)"
    contrast = contrast_agent or bool(CONTRAST.search(d))
    if "flair" in d or "dark fluid" in d or "darkfluid" in d or "tirm" in d:
        scores["flair"] += 3
    if re.search(r"t2", d) and "flair" not in d:
        scores["t2"] += 2
    if T1_WORDS.search(d):
        scores["t1c" if contrast else "t1"] += 2
    if contrast:
        scores["t1c"] += 1
    # Timing fallbacks (ms): FLAIR long TI and TR; T2 long TR and TE; T1 short TR and TE.
    if ti and ti > 1500 and tr and tr > 4000:
        scores["flair"] += 2
    elif tr and te and tr > 2000 and te > 60 and not ti:
        scores["t2"] += 1.5
    elif tr and te and te < 30 and (tr < 1000 or (ti and 600 < ti < 1300)):
        scores["t1c" if contrast else "t1"] += 1.5
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return scores, "not recognised"
    return scores, f"matched {best} from description and timing"


def thumbnail(image: sitk.Image, size: int = 96) -> str:
    arr = sitk.GetArrayFromImage(image).astype(np.float32)   # (z, y, x)
    sl = arr[arr.shape[0] // 2]
    lo, hi = np.percentile(sl, [1, 99])
    sl = np.clip((sl - lo) / max(hi - lo, 1e-6), 0, 1) * 255
    img = Image.fromarray(sl.astype(np.uint8))
    img.thumbnail((size, size))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def scan_and_convert(dicom_root: Path, out_dir: Path) -> list[SeriesInfo]:
    """Find every DICOM series under ``dicom_root``, convert usable MR series to NIfTI in
    ``out_dir`` and suggest roles. Directories are searched recursively."""
    out_dir.mkdir(parents=True, exist_ok=True)
    series: list[SeriesInfo] = []
    dirs = {p.parent for p in dicom_root.rglob("*") if p.is_file()}
    for directory in sorted(dirs):
        try:
            ids = sitk.ImageSeriesReader.GetGDCMSeriesIDs(str(directory))
        except RuntimeError:
            continue
        for sid in ids or ():
            files = sitk.ImageSeriesReader.GetGDCMSeriesFileNames(str(directory), sid)
            if len(files) < MIN_SLICES:
                continue
            head = sitk.ImageFileReader()
            head.SetFileName(files[0])
            try:
                head.ReadImageInformation()
            except RuntimeError:
                continue
            if (_meta(head, "modality") or "MR").upper() != "MR":
                continue
            desc = " ".join(filter(None, (_meta(head, "series_description"), _meta(head, "protocol_name"),
                                          _meta(head, "sequence_name"))))
            image_type = (_meta(head, "image_type") or "").upper()
            tr, te, ti = (_float(_meta(head, k)) for k in ("repetition_time", "echo_time", "inversion_time"))
            agent = bool(_meta(head, "contrast_agent"))
            scores, reason = classify(desc, tr, te, ti, agent)
            if "DERIVED" in image_type or "LOCALIZER" in image_type:
                scores, reason = {r: 0.0 for r in ROLES}, "derived or localiser image"
            reader = sitk.ImageSeriesReader()
            reader.SetFileNames(files)
            try:
                image = reader.Execute()
            except RuntimeError:
                continue
            if image.GetDimension() != 3:
                continue
            index = len(series) + 1
            nifti = out_dir / f"series_{index:02d}.nii.gz"
            sitk.WriteImage(sitk.Cast(image, sitk.sitkFloat32), str(nifti))
            date = _meta(head, "study_date")
            series.append(SeriesInfo(
                index=index,
                description=desc or "(no description)",
                slices=len(files),
                size=list(image.GetSize()),
                spacing_mm=[round(s, 2) for s in image.GetSpacing()],
                tr_ms=tr, te_ms=te, ti_ms=ti,
                contrast=agent or bool(CONTRAST.search(desc.lower())),
                acquisition=_meta(head, "acquisition_type") or "",
                study_date=f"{date[:4]}-{date[4:6]}-{date[6:8]}" if date and len(date) >= 8 else None,
                suggested_role=None,
                reason=reason,
                file=nifti.name,
                thumbnail=thumbnail(image),
                scores=scores,
            ))
    _assign(series)
    return series


def _assign(series: list[SeriesInfo]) -> None:
    """Give each role to the best-scoring series; ties go to the finer, more complete scan."""
    taken: set[int] = set()
    for role in ("flair", "t1c", "t2", "t1"):
        candidates = [s for s in series if s.scores.get(role, 0) > 0 and s.index not in taken
                      and max(s.scores, key=s.scores.get) == role]
        if not candidates:
            continue
        best = max(candidates, key=lambda s: (s.scores[role], -float(np.prod(s.spacing_mm)), s.slices))
        best.suggested_role = role
        taken.add(best.index)


def summary(series: list[SeriesInfo]) -> list[dict]:
    out = []
    for s in series:
        d = asdict(s)
        d.pop("scores")
        out.append(d)
    return out


def delete_dicom(folder: Path) -> None:
    shutil.rmtree(folder, ignore_errors=True)
