"""Unit tests for localisation, volumes, file detection, slice orientation and the 3D frame,
plus one regression test on a real BraTS case (skipped when the dataset is absent)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medtwin import analysis, config, meshing, slices  # noqa: E402
from medtwin.inputs import classify  # noqa: E402


def make_case(shape=(40, 40, 40), lesion_at=(30, 20, 20), affine=None):
    brain = np.zeros(shape, bool)
    brain[5:35, 5:35, 5:35] = True
    lesion = np.zeros(shape, bool)
    x, y, z = lesion_at
    lesion[x - 2:x + 3, y - 2:y + 3, z - 2:z + 3] = True
    return brain, lesion, np.eye(4) if affine is None else affine


@pytest.mark.parametrize("offset, expected", [
    ((10, 0, 0), ("right", "central", "central")),
    ((-10, 0, 0), ("left", "central", "central")),
    ((0, 10, -10), ("midline", "anterior", "inferior")),
    ((2, -10, 10), ("midline", "posterior", "superior")),
])
def test_describe_offset_uses_ras_signs(offset, expected):
    d = analysis.describe_offset(np.array(offset, float))
    assert (d["left_right"], d["anterior_posterior"], d["superior_inferior"]) == expected


def test_localise_right_lesion_in_ras_grid():
    brain, lesion, affine = make_case(lesion_at=(30, 20, 20))
    centre = analysis.voxel_to_mm(np.argwhere(brain).mean(axis=0), affine)[0]
    assert analysis.localise(lesion, centre, affine)["left_right"] == "right"


def test_localise_follows_mm_not_array_index():
    # LPS-stored array (x index grows to the patient's left): high index must read as left.
    affine = np.diag([-1.0, -1.0, 1.0, 1.0])
    brain, lesion, _ = make_case(lesion_at=(30, 20, 20))
    centre = analysis.voxel_to_mm(np.argwhere(brain).mean(axis=0), affine)[0]
    assert analysis.localise(lesion, centre, affine)["left_right"] == "left"


def test_volumes_use_voxel_spacing():
    affine = np.diag([2.0, 2.0, 2.0, 1.0])
    assert analysis.voxel_volume_mm3(affine) == pytest.approx(8.0)
    brain, lesion, _ = make_case()
    prediction = np.where(lesion, 3, 0).astype(np.uint8)
    result = analysis.analyse_disease(config.DISEASE_MODELS["glioma"], prediction, affine, brain)
    enhancing = next(r for r in result["regions"] if r["key"] == "enhancing_tumor")
    assert enhancing["volume_cm3"] == pytest.approx(125 * 8 / 1000)
    assert result["detected"] and len(result["lesions"]) == 1


def test_separate_lesions_are_counted_and_noise_dropped():
    brain, lesion, affine = make_case(lesion_at=(12, 12, 12))
    lesion[25:30, 25:30, 25:30] = True       # second lesion, 125 voxels
    lesion[33, 33, 33] = True                # single-voxel speck below MIN_LESION_VOXELS
    centre = analysis.voxel_to_mm(np.argwhere(brain).mean(axis=0), affine)[0]
    found = analysis.find_lesions(lesion, affine, centre, brain_cm3=27.0)
    assert len(found) == 2


@pytest.mark.parametrize("name, key", [
    ("BraTS-GLI-00449-000-t1n.nii.gz", "t1"),
    ("BraTS-GLI-00449-000-t1c.nii.gz", "t1c"),
    ("BraTS-GLI-00449-000-t2w.nii.gz", "t2"),
    ("BraTS-GLI-00449-000-t2f.nii.gz", "flair"),
    ("BraTS-GLI-00449-000-seg.nii.gz", "seg"),
    ("patient01_T1ce.nii", "t1c"),
    ("patient01_FLAIR.nii.gz", "flair"),
    ("patient01_T2.nii.gz", "t2"),
    ("patient01_t1.nii.gz", "t1"),
])
def test_sequence_names_are_recognised(name, key):
    assert classify(name) == key


def test_slices_are_radiological():
    vol = np.zeros((4, 5, 6), np.uint8)
    vol[3, 4, 2] = 255                       # patient's far right (max x), most anterior (max y)
    axial = slices.take_slice(vol, "axial", 2)
    assert axial.shape == (5, 4)
    assert axial[0, 0] == 255                # top-left: anterior, patient's right


def test_viewer_frame_is_a_rotation_not_a_mirror():
    assert np.linalg.det(meshing.RAS_TO_VIEWER) == pytest.approx(1.0)
    left, superior, anterior = meshing.RAS_TO_VIEWER @ np.array([-1.0, 0, 0]), \
        meshing.RAS_TO_VIEWER @ np.array([0, 0, 1.0]), meshing.RAS_TO_VIEWER @ np.array([0, 1.0, 0])
    assert left[0] > 0 and superior[1] > 0 and anterior[2] > 0


CASE = config.DATASET_DIR / "BraTS-GLI-00449-000"


@pytest.mark.skipif(not CASE.is_dir() or not config.DISEASE_MODELS["glioma"].bundle_path.is_file(),
                    reason="BraTS dataset or model bundle not available")
def test_regression_patient_00449(tmp_path):
    from medtwin import pipeline
    from medtwin.inputs import find_sequences

    files, seg = find_sequences(CASE)
    results = pipeline.run(tmp_path / "job", files, ground_truth=seg)
    glioma = results["diseases"][0]
    volumes = {r["key"]: r["volume_cm3"] for r in glioma["regions"]}
    # Same numbers as the Phase 3 notebook for this patient.
    assert volumes["necrotic_core"] == pytest.approx(23.619, abs=0.05)
    assert volumes["edema"] == pytest.approx(152.501, abs=0.05)
    assert volumes["enhancing_tumor"] == pytest.approx(50.817, abs=0.05)
    # Verified on the raw scan: the tumour lies left and anterior of the brain centre.
    assert glioma["location"]["left_right"] == "left"
    assert glioma["location"]["anterior_posterior"] == "anterior"
    assert glioma["ground_truth"]["whole_lesion_dice"] > 0.85
    assert (tmp_path / "job" / "meshes" / "brain.glb").is_file()
    assert (tmp_path / "job" / "report.html").is_file()
