"""Tests for the clinical features: corrections, RANO measurements, follow-up categories,
DICOM series recognition and skull-strip detection."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
import SimpleITK as sitk

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medtwin import dicom, measurements, prepare, review, slices  # noqa: E402


# ------------------------------------------------------------------ corrections

@pytest.mark.parametrize("plane", ["axial", "coronal", "sagittal"])
def test_stroke_lands_where_it_was_drawn(plane):
    labels = np.zeros((20, 24, 28), np.uint8)
    brain = np.ones_like(labels, bool)
    labels[3, 4, 5] = 7                                   # marker voxel
    image = slices.take_slice(labels, plane, {"axial": 5, "coronal": 4, "sagittal": 3}[plane])
    row, col = np.argwhere(image == 7)[0]                 # where the marker shows on screen
    stroke = {"plane": plane, "index": {"axial": 5, "coronal": 4, "sagittal": 3}[plane],
              "label": 2, "radius": 0.5, "points": [[float(col), float(row)]]}
    new, changes = review.apply_strokes(labels, brain, [stroke], {2, 7})
    assert new[3, 4, 5] == 2                              # painted exactly the voxel under the brush
    assert changes == {"2": 1, "7": -1}


def test_paint_stays_inside_brain_and_erase_works():
    labels = np.zeros((10, 10, 10), np.uint8)
    brain = np.zeros_like(labels, bool)
    brain[:, :5, :] = True
    stroke = {"plane": "axial", "index": 5, "label": 3, "radius": 20, "points": [[5, 5]]}
    painted, _ = review.apply_strokes(labels, brain, [stroke], {3})
    assert painted[:, :, 5][brain[:, :, 5]].all() and not painted[:, :, 5][~brain[:, :, 5]].any()
    erased, _ = review.apply_strokes(painted, brain, [{**stroke, "label": 0}], {3})
    assert not erased.any()


def test_bad_strokes_are_rejected():
    labels = np.zeros((5, 5, 5), np.uint8)
    with pytest.raises(ValueError):
        review.apply_strokes(labels, labels > -1, [{"plane": "oblique", "index": 0, "label": 1, "points": [[0, 0]]}], {1})
    with pytest.raises(ValueError):
        review.apply_strokes(labels, labels > -1, [{"plane": "axial", "index": 0, "label": 9, "points": [[0, 0]]}], {1})


# ------------------------------------------------------------------ RANO

def test_bidimensional_ellipse():
    vol = np.zeros((80, 80, 10), bool)
    yy, xx = np.mgrid[:80, :80]
    ellipse = ((xx - 40) / 15.0) ** 2 + ((yy - 40) / 6.0) ** 2 <= 1   # 30 x 12 voxels
    vol[:, :, 4] = ellipse.T
    vol[:, :, 5] = ellipse.T
    out = measurements.bidimensional(vol, np.eye(4))
    les = out["lesions"][0]
    assert les["longest_mm"] == pytest.approx(31, abs=1.5)
    assert les["perpendicular_mm"] == pytest.approx(13, abs=1.5)
    assert les["measurable"] and out["target_count"] == 1


def test_small_lesion_is_not_measurable():
    vol = np.zeros((30, 30, 5), bool)
    vol[10:15, 10:15, 2] = True
    out = measurements.bidimensional(vol, np.eye(4))
    assert not out["measurable_disease"] and out["sum_of_products_mm2"] == 0


def _scan(enh, spd, total=None):
    return {"enhancing_cm3": enh, "spd_mm2": spd, "total_cm3": total if total is not None else enh * 3}


@pytest.mark.parametrize("follow_up, expected", [
    (_scan(12, 1100), "Stable"),               # +20% volume, +10% SPD: under both thresholds
    (_scan(14.5, 1300), "Progression"),        # SPD +30% vs nadir
    (_scan(3, 400), "Partial response"),       # volume -70%
    (_scan(0, 0), "Complete response"),
])
def test_follow_up_categories(follow_up, expected):
    out = measurements.assess([_scan(10, 1000), follow_up])
    assert out[0]["category"] == "Baseline"
    assert out[1]["category"].startswith(expected)


def test_progression_is_measured_against_nadir():
    out = measurements.assess([_scan(10, 1000), _scan(4, 400), _scan(6, 520)])
    assert out[2]["category"].startswith("Progression")   # +50% volume vs the smallest scan


# ------------------------------------------------------------------ DICOM and preparation

@pytest.mark.parametrize("desc, tr, te, ti, agent, role", [
    ("AX FLAIR", 9000, 120, 2500, False, "flair"),
    ("T2 TSE TRA", 4000, 100, None, False, "t2"),
    ("SAG T1 MPRAGE", 2000, 3, 900, False, "t1"),
    ("AX T1 POST GD", 500, 10, None, False, "t1c"),
    ("T1 3D", 8, 3, None, True, "t1c"),
    ("unknown", 9500, 130, 2400, False, "flair"),
])
def test_dicom_series_roles(desc, tr, te, ti, agent, role):
    scores, _ = dicom.classify(desc, tr, te, ti, agent)
    assert max(scores, key=scores.get) == role


@pytest.mark.parametrize("desc", ["DWI b1000", "ADC", "3-plane loc", "SWI", "Perfusion DSC"])
def test_dicom_series_excluded(desc):
    scores, reason = dicom.classify(desc, 3000, 80, None, False)
    assert max(scores.values()) == 0 and "excluded" in reason


def _sphere(radius_mm: float) -> sitk.Image:
    n = int(radius_mm * 2 + 20)
    zz, yy, xx = np.mgrid[:n, :n, :n]
    c = n / 2
    arr = (((xx - c) ** 2 + (yy - c) ** 2 + (zz - c) ** 2) <= radius_mm ** 2).astype(np.float32) * 100
    return sitk.GetImageFromArray(arr)


def test_skull_detection_by_size():
    assert prepare.looks_skull_stripped(_sphere(60))       # about 900 cm³: brain-sized
    assert not prepare.looks_skull_stripped(_sphere(85))   # about 2,600 cm³: a whole head
