"""2D slice images with the segmentation overlaid, rendered on demand as PNG.

Display convention is radiological: patient's right on the image left, anterior
at the top of axial slices, superior at the top of coronal and sagittal slices.
Volumes are stored once per job as uint8 in volumes.npz (RAS voxel grid).
"""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image

from . import fileio

PLANES = {"axial": 2, "coronal": 1, "sagittal": 0}
UPSCALE = 3


def to_uint8(channel: np.ndarray, mask: np.ndarray) -> np.ndarray:
    vals = channel[mask]
    if vals.size == 0:
        return np.zeros(channel.shape, np.uint8)
    lo, hi = np.percentile(vals, [0.5, 99.5])
    scaled = np.clip((channel - lo) / max(hi - lo, 1e-6), 0, 1) * 255
    scaled[~mask] = 0
    return scaled.astype(np.uint8)


def save_volumes(path: Path, image: np.ndarray, modality_order: tuple[str, ...], brain_mask: np.ndarray,
                 labels: np.ndarray, ground_truth: np.ndarray | None, labels_ai: np.ndarray,
                 confidence: np.ndarray, affine: np.ndarray) -> None:
    arrays = {f"img_{name}": to_uint8(image[i], brain_mask) for i, name in enumerate(modality_order)}
    arrays["labels"] = labels.astype(np.uint8)
    arrays["labels_ai"] = labels_ai.astype(np.uint8)
    arrays["confidence"] = confidence.astype(np.uint8)
    arrays["brain_mask"] = brain_mask.astype(np.uint8)
    arrays["affine"] = np.asarray(affine, np.float64)
    if ground_truth is not None:
        arrays["ground_truth"] = ground_truth.astype(np.uint8)
    np.savez_compressed(path, **arrays)


def load_volumes(path: Path) -> dict[str, np.ndarray]:
    with np.load(path) as data:
        return {k: data[k] for k in data.files}


def update_labels(path: Path, labels: np.ndarray) -> None:
    arrays = load_volumes(path)
    arrays["labels"] = labels.astype(np.uint8)
    tmp = path.with_name(path.stem + ".tmp.npz")
    np.savez_compressed(tmp, **arrays)
    fileio.replace(tmp, path)


def take_slice(volume: np.ndarray, plane: str, index: int) -> np.ndarray:
    axis = PLANES[plane]
    index = int(np.clip(index, 0, volume.shape[axis] - 1))
    sl = np.take(volume, index, axis=axis)
    # sl is (first remaining axis, second remaining axis); flip both and transpose so
    # rows run high->low on the second axis and columns high->low on the first.
    return sl[::-1, ::-1].T


OVERLAYS = ("prediction", "ai", "ground_truth", "confidence", "none")


def render_png(volumes: dict[str, np.ndarray], plane: str, index: int, channel: str,
               colours: dict[int, str], overlay: str = "prediction", alpha: float = 0.5) -> bytes:
    """overlay: prediction (current, incl. corrections) | ai (original AI) | ground_truth |
    confidence (where the model is unsure, magenta) | none."""
    base = take_slice(volumes[f"img_{channel}"], plane, index).astype(np.float32)
    rgb = np.repeat(base[..., None], 3, axis=2)
    if overlay == "confidence" and "confidence" in volumes:
        conf = take_slice(volumes["confidence"], plane, index).astype(np.float32) / 255.0
        brain = take_slice(volumes["brain_mask"], plane, index) > 0 if "brain_mask" in volumes else base > 0
        weight = np.clip((0.9 - conf) / 0.4, 0, 1) * brain * 0.75
        rgb = rgb * (1 - weight[..., None]) + np.array([255.0, 0.0, 255.0]) * weight[..., None]
        overlay = "outline"
    label_key = {"ground_truth": "ground_truth", "ai": "labels_ai"}.get(overlay, "labels")
    if label_key not in volumes:
        label_key = "labels"
    if overlay == "outline":
        labels = take_slice(volumes["labels"], plane, index)
        edge = labels > 0
        edge = edge & ~(np.roll(edge, 1, 0) & np.roll(edge, -1, 0) & np.roll(edge, 1, 1) & np.roll(edge, -1, 1))
        rgb[edge] = [255, 255, 255]
    elif overlay != "none":
        labels = take_slice(volumes[label_key], plane, index)
        for value, color in colours.items():
            hit = labels == value
            if hit.any():
                c = np.array([int(color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)], np.float32)
                rgb[hit] = rgb[hit] * (1 - alpha) + c * alpha
    img = Image.fromarray(rgb.clip(0, 255).astype(np.uint8))
    img = img.resize((img.width * UPSCALE, img.height * UPSCALE), Image.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue()
