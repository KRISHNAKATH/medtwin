"""Load a trained disease model from its Phase 2 bundle and run inference.

Rebuilds exactly the preprocessing and 3D U-Net the bundle describes, so results
match the notebooks. Models are cached per disease after the first load.
"""
from __future__ import annotations

import json
import os
import threading
import warnings
from dataclasses import dataclass
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
import torch
from monai.inferers import SlidingWindowInferer
from monai.networks.layers import Norm
from monai.networks.nets import UNet
from monai.transforms import (
    Compose,
    ConcatItemsd,
    CropForegroundd,
    DeleteItemsd,
    DivisiblePadd,
    EnsureChannelFirstd,
    EnsureTyped,
    LoadImaged,
    NormalizeIntensityd,
    Orientationd,
    Spacingd,
)

from . import config
from .config import DiseaseModel

warnings.filterwarnings("ignore", category=FutureWarning, module="monai")

LABEL_KEY = "seg"


@dataclass
class LoadedModel:
    disease: DiseaseModel
    bundle: dict
    network: torch.nn.Module
    device: torch.device
    checkpoint_path: Path
    modality_order: tuple[str, ...]


_cache: dict[str, LoadedModel] = {}
_lock = threading.Lock()


def select_device() -> torch.device:
    pref = config.device_preference()
    if pref == "cpu":
        return torch.device("cpu")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def load_bundle(bundle_path: Path) -> dict:
    if not bundle_path.exists():
        raise FileNotFoundError(f"Model bundle not found: {bundle_path}")
    with open(bundle_path, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_checkpoint(bundle: dict, bundle_path: Path) -> Path:
    """Use the bundle's saved checkpoint path if it exists; otherwise the standard
    outputs/checkpoints/best_model.pth next to the bundle (the saved path is absolute
    and points at the machine the model was trained on)."""
    saved = Path(bundle.get("checkpoint_path", ""))
    if saved.is_file():
        return saved
    fallback = bundle_path.parent.parent / "checkpoints" / "best_model.pth"
    if fallback.is_file():
        return fallback
    raise FileNotFoundError(f"Checkpoint not found at {saved} or {fallback}")


def check_label_mapping(disease: DiseaseModel, bundle: dict) -> None:
    mapping = {int(k): v for k, v in bundle["label_mapping"].items()}
    for region in disease.regions:
        if mapping.get(region.label) != region.key:
            raise ValueError(
                f"{disease.key}: region {region.key!r} expects label {region.label}, "
                f"bundle maps it to {mapping.get(region.label)!r}"
            )


def build_network(model_config: dict) -> torch.nn.Module:
    return UNet(
        spatial_dims=model_config["spatial_dims"],
        in_channels=model_config["in_channels"],
        out_channels=model_config["out_channels"],
        channels=tuple(model_config["channels"]),
        strides=tuple(model_config["strides"]),
        num_res_units=model_config["num_res_units"],
        norm=Norm.BATCH,
    )


def load_model(disease_key: str) -> LoadedModel:
    with _lock:
        if disease_key in _cache:
            return _cache[disease_key]
        disease = config.DISEASE_MODELS[disease_key]
        bundle = load_bundle(disease.bundle_path)
        check_label_mapping(disease, bundle)
        checkpoint = resolve_checkpoint(bundle, disease.bundle_path)
        device = select_device()
        network = build_network(bundle["model_config"]).to(device)
        state = torch.load(checkpoint, map_location=device, weights_only=True)
        network.load_state_dict(state, strict=True)
        network.eval()
        loaded = LoadedModel(
            disease=disease,
            bundle=bundle,
            network=network,
            device=device,
            checkpoint_path=checkpoint,
            modality_order=tuple(bundle["model_config"]["modality_order"]),
        )
        _cache[disease_key] = loaded
        return loaded


def divisible_pad_factor(bundle: dict) -> int:
    cfg = bundle["preprocessing_config"]
    if "divisible_pad_factor" in cfg:
        return int(cfg["divisible_pad_factor"])
    factor = 1
    for s in bundle["model_config"].get("strides", [2, 2, 2]):
        factor *= int(s)
    return factor


def build_transforms(bundle: dict) -> Compose:
    """Full-volume inference preprocessing, identical to Phases 3-4.
    The optional ground-truth label goes through the same spatial steps."""
    cfg = bundle["preprocessing_config"]
    modalities = list(bundle["model_config"]["modality_order"])
    all_keys = modalities + [LABEL_KEY]
    return Compose([
        LoadImaged(keys=all_keys, image_only=True, allow_missing_keys=True),
        EnsureChannelFirstd(keys=all_keys, allow_missing_keys=True),
        Orientationd(keys=all_keys, axcodes=cfg.get("target_orientation", "RAS"), allow_missing_keys=True),
        Spacingd(
            keys=all_keys,
            pixdim=tuple(cfg.get("target_spacing_mm", [1.0, 1.0, 1.0])),
            mode=["bilinear"] * len(modalities) + ["nearest"],
            allow_missing_keys=True,
        ),
        NormalizeIntensityd(keys=modalities, nonzero=True, channel_wise=True),
        ConcatItemsd(keys=modalities, name="image"),
        DeleteItemsd(keys=modalities),
        CropForegroundd(keys=["image", LABEL_KEY], source_key="image", allow_missing_keys=True),
        DivisiblePadd(keys=["image", LABEL_KEY], k=divisible_pad_factor(bundle), allow_missing_keys=True),
        EnsureTyped(keys=["image", LABEL_KEY], allow_missing_keys=True, track_meta=True),
    ])


@dataclass
class Preprocessed:
    image: np.ndarray            # (C, X, Y, Z) float32, z-scored, background 0
    affine: np.ndarray           # 4x4 voxel -> RAS mm
    ground_truth: np.ndarray | None  # (X, Y, Z) int, same grid as image
    modality_order: tuple[str, ...]


def preprocess(loaded: LoadedModel, files: dict[str, Path], ground_truth: Path | None = None) -> Preprocessed:
    data = {k: str(files[k]) for k in loaded.modality_order}
    if ground_truth is not None:
        data[LABEL_KEY] = str(ground_truth)
    sample = build_transforms(loaded.bundle)(data)
    image = sample["image"]
    affine = image.affine.numpy() if hasattr(image, "affine") else np.eye(4)
    gt = None
    if LABEL_KEY in sample:
        gt = np.asarray(sample[LABEL_KEY][0]).astype(np.int16)
    return Preprocessed(
        image=np.asarray(image).astype(np.float32),
        affine=np.asarray(affine, dtype=np.float64),
        ground_truth=gt,
        modality_order=loaded.modality_order,
    )


def predict(loaded: LoadedModel, pre: Preprocessed) -> tuple[np.ndarray, np.ndarray]:
    """Return the predicted label map (X, Y, Z) and the model's confidence in it
    (winning class probability, 0-255), both uint8."""
    roi = tuple(loaded.bundle["preprocessing_config"].get("train_patch_size", config.INFERENCE_ROI))
    inferer = SlidingWindowInferer(roi_size=roi, sw_batch_size=1, overlap=config.INFERENCE_OVERLAP, mode="gaussian")
    batch = torch.from_numpy(pre.image).unsqueeze(0).to(loaded.device)
    with torch.no_grad():
        probs = torch.softmax(inferer(batch, loaded.network), dim=1)
        confidence, labels = probs.max(dim=1)
    labels = labels.squeeze(0).cpu().numpy().astype(np.uint8)
    confidence = (confidence.squeeze(0).cpu().numpy() * 255).round().astype(np.uint8)
    return labels, confidence
