"""Paths, disease registry and colours shared by the pipeline and the web server.

Every path is derived from the project folder so the app keeps working when the
project is moved. Override with environment variables when needed:

    MEDTWIN_PROJECT_ROOT  folder that holds outputs/ and Dataset/ (default: parent of medtwin_app)
    MEDTWIN_DATASET_DIR   BraTS training data folder (used for demo cases)
    MEDTWIN_DATA_DIR      where uploads and job results are written
    MEDTWIN_DEVICE        "cuda" or "cpu" (default: cuda when available)
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(os.environ.get("MEDTWIN_PROJECT_ROOT", APP_ROOT.parent)).resolve()
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
DATASET_DIR = Path(
    os.environ.get(
        "MEDTWIN_DATASET_DIR",
        PROJECT_ROOT / "Dataset" / "ASNR-MICCAI-BraTS2023-GLI-Challenge-TrainingData",
    )
).resolve()
DATA_DIR = Path(os.environ.get("MEDTWIN_DATA_DIR", APP_ROOT / "data")).resolve()
JOBS_DIR = DATA_DIR / "jobs"
TEMPLATES_DIR = APP_ROOT / "assets" / "templates"
WEB_DIR = APP_ROOT / "web"

# Canonical modality keys (same order and names as the Phase 2 model bundle).
MODALITY_KEYS = ("t1", "t1c", "t2", "flair")
MODALITY_LABELS = {"t1": "T1 (native)", "t1c": "T1 contrast", "t2": "T2", "flair": "T2-FLAIR"}
BRATS_SUFFIXES = {"t1": "-t1n.nii.gz", "t1c": "-t1c.nii.gz", "t2": "-t2w.nii.gz", "flair": "-t2f.nii.gz"}
BRATS_LABEL_SUFFIX = "-seg.nii.gz"

INFERENCE_ROI = (96, 96, 96)
INFERENCE_OVERLAP = 0.5

# Lesions smaller than this are treated as noise when counting separate lesions.
MIN_LESION_VOXELS = 30
# Offsets from the brain centre smaller than this are reported as "midline" / "central".
MIDLINE_TOLERANCE_MM = 5.0

BRAIN_COLOR = "#e9b8a6"


@dataclass(frozen=True)
class Region:
    label: int          # value in the model's output label map
    key: str            # machine name, must match the bundle's label_mapping
    name: str           # display name
    color: str          # hex colour used in 3D, slices and the report


@dataclass(frozen=True)
class DiseaseModel:
    key: str
    name: str
    bundle_path: Path
    regions: tuple[Region, ...]
    required_modalities: tuple[str, ...]
    description: str


# One entry per trained disease model. Add meningioma, metastases, stroke, ... here
# once their bundles exist; the pipeline, API and viewer pick them up automatically.
DISEASE_MODELS: dict[str, DiseaseModel] = {
    "glioma": DiseaseModel(
        key="glioma",
        name="Glioma",
        bundle_path=OUTPUTS_DIR / "model_bundle" / "model_bundle.json",
        regions=(
            Region(3, "enhancing_tumor", "Enhancing tumour", "#e0234e"),
            Region(1, "necrotic_core", "Necrotic core", "#7a0b16"),
            Region(2, "edema", "Edema", "#ffd23f"),
        ),
        required_modalities=MODALITY_KEYS,
        description="Adult glioma, MONAI 3D U-Net trained on BraTS 2023 GLI (test Dice 0.78).",
    ),
}

DISCLAIMER = (
    "AI decision support for qualified clinicians. Measurements must be verified on the source "
    "images by a radiologist. Not yet validated or approved for clinical decisions."
)


def device_preference() -> str:
    return os.environ.get("MEDTWIN_DEVICE", "auto").lower()
