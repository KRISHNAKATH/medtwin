"""Brain mask, localisation, volumes, separate lesions and ground-truth scores.

Localisation compares a region's centroid with the brain's centroid in RAS
millimetres (+x = patient right, +y = anterior, +z = superior). This replaces the
notebook's half-of-array rule, which reported every direction inverted.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from . import config
from .config import DiseaseModel


def voxel_volume_mm3(affine: np.ndarray) -> float:
    return float(abs(np.linalg.det(affine[:3, :3])))


def voxel_to_mm(points_ijk: np.ndarray, affine: np.ndarray) -> np.ndarray:
    pts = np.atleast_2d(points_ijk).astype(np.float64)
    homo = np.hstack([pts, np.ones((pts.shape[0], 1))])
    return (affine @ homo.T).T[:, :3]


def largest_component(mask: np.ndarray) -> np.ndarray:
    labeled, n = ndimage.label(mask)
    if n <= 1:
        return mask.astype(bool)
    sizes = ndimage.sum(mask, labeled, index=np.arange(1, n + 1))
    return labeled == (1 + int(np.argmax(sizes)))


def brain_mask_from_image(image: np.ndarray) -> np.ndarray:
    """Brain = voxels non-zero in any sequence (inputs are skull-stripped), largest
    connected piece, internal holes filled."""
    mask = np.any(image != 0, axis=0)
    if not mask.any():
        return mask
    return ndimage.binary_fill_holes(largest_component(mask))


def describe_offset(offset_mm: np.ndarray, tol: float = config.MIDLINE_TOLERANCE_MM) -> dict:
    dx, dy, dz = (float(v) for v in offset_mm)
    lr = "midline" if abs(dx) < tol else ("right" if dx > 0 else "left")
    ap = "central" if abs(dy) < tol else ("anterior" if dy > 0 else "posterior")
    si = "central" if abs(dz) < tol else ("superior" if dz > 0 else "inferior")
    hemisphere = {"left": "left hemisphere", "right": "right hemisphere", "midline": "near the midline"}[lr]
    parts = [p for p in (ap, si) if p != "central"]
    text = hemisphere + (", " + " and ".join(parts) if parts else "")
    return {"left_right": lr, "anterior_posterior": ap, "superior_inferior": si, "description": text}


def localise(mask: np.ndarray, brain_centroid_mm: np.ndarray, affine: np.ndarray) -> dict:
    coords = np.argwhere(mask)
    centroid_ijk = coords.mean(axis=0)
    centroid_mm = voxel_to_mm(centroid_ijk, affine)[0]
    lo = voxel_to_mm(coords.min(axis=0), affine)[0]
    hi = voxel_to_mm(coords.max(axis=0), affine)[0]
    spacing = np.sqrt((affine[:3, :3] ** 2).sum(axis=0))
    extent_mm = np.abs(hi - lo) + spacing
    offset = centroid_mm - brain_centroid_mm
    return {
        "centroid_voxel": [round(float(v), 1) for v in centroid_ijk],
        "centroid_mm": [round(float(v), 1) for v in centroid_mm],
        "offset_from_brain_centre_mm": [round(float(v), 1) for v in offset],
        "extent_mm": [round(float(v), 1) for v in extent_mm],
        **describe_offset(offset),
    }


def find_lesions(mask: np.ndarray, affine: np.ndarray, brain_centroid_mm: np.ndarray, brain_cm3: float) -> list[dict]:
    """Separate lesions = 26-connected components of the disease mask, largest first."""
    structure = np.ones((3, 3, 3), dtype=bool)
    labeled, n = ndimage.label(mask, structure=structure)
    if n == 0:
        return []
    vox_cm3 = voxel_volume_mm3(affine) / 1000.0
    sizes = ndimage.sum(mask, labeled, index=np.arange(1, n + 1)).astype(int)
    lesions = []
    for idx in np.argsort(-sizes):
        if sizes[idx] < config.MIN_LESION_VOXELS:
            continue
        comp = labeled == (idx + 1)
        volume = sizes[idx] * vox_cm3
        lesions.append({
            "index": len(lesions) + 1,
            "voxel_count": int(sizes[idx]),
            "volume_cm3": round(volume, 3),
            "percent_of_brain": round(100.0 * volume / brain_cm3, 2) if brain_cm3 else None,
            **localise(comp, brain_centroid_mm, affine),
        })
    return lesions


def dice(a: np.ndarray, b: np.ndarray) -> float | None:
    total = a.sum() + b.sum()
    if total == 0:
        return None
    return float(2.0 * np.logical_and(a, b).sum() / total)


def analyse_disease(
    disease: DiseaseModel,
    prediction: np.ndarray,
    affine: np.ndarray,
    brain_mask: np.ndarray,
    ground_truth: np.ndarray | None = None,
) -> dict:
    vox_cm3 = voxel_volume_mm3(affine) / 1000.0
    brain_cm3 = float(brain_mask.sum()) * vox_cm3
    brain_centroid_mm = voxel_to_mm(np.argwhere(brain_mask).mean(axis=0), affine)[0]

    regions = []
    for region in disease.regions:
        mask = prediction == region.label
        count = int(mask.sum())
        entry = {
            "key": region.key,
            "name": region.name,
            "label": region.label,
            "color": region.color,
            "present": count > 0,
            "voxel_count": count,
            "volume_cm3": round(count * vox_cm3, 3),
            "percent_of_brain": round(100.0 * count * vox_cm3 / brain_cm3, 2) if brain_cm3 else None,
            "mesh": f"{disease.key}_{region.key}.glb" if count > 0 else None,
        }
        if count:
            entry["location"] = localise(mask, brain_centroid_mm, affine)
        if ground_truth is not None:
            gt_mask = ground_truth == region.label
            gt_cm3 = float(gt_mask.sum()) * vox_cm3
            entry["ground_truth"] = {
                "volume_cm3": round(gt_cm3, 3),
                "volume_difference_pct": round(100.0 * (entry["volume_cm3"] - gt_cm3) / gt_cm3, 1) if gt_cm3 else None,
                "dice": None if dice(mask, gt_mask) is None else round(dice(mask, gt_mask), 4),
            }
        regions.append(entry)

    union = np.isin(prediction, [r.label for r in disease.regions])
    total_cm3 = float(union.sum()) * vox_cm3
    result = {
        "key": disease.key,
        "name": disease.name,
        "description": disease.description,
        "detected": bool(union.any()),
        "total_volume_cm3": round(total_cm3, 3),
        "total_percent_of_brain": round(100.0 * total_cm3 / brain_cm3, 2) if brain_cm3 else None,
        "regions": regions,
        "lesions": find_lesions(union, affine, brain_centroid_mm, brain_cm3) if union.any() else [],
    }
    if union.any():
        result["location"] = localise(union, brain_centroid_mm, affine)
    if ground_truth is not None:
        gt_union = np.isin(ground_truth, [r.label for r in disease.regions])
        region_dice = [r["ground_truth"]["dice"] for r in regions if r["ground_truth"]["dice"] is not None]
        result["ground_truth"] = {
            "whole_lesion_dice": None if dice(union, gt_union) is None else round(dice(union, gt_union), 4),
            "mean_region_dice": round(float(np.mean(region_dice)), 4) if region_dice else None,
            "volume_cm3": round(float(gt_union.sum()) * vox_cm3, 3),
        }
    return result


def brain_summary(brain_mask: np.ndarray, affine: np.ndarray) -> dict:
    vox_cm3 = voxel_volume_mm3(affine) / 1000.0
    centroid = voxel_to_mm(np.argwhere(brain_mask).mean(axis=0), affine)[0]
    return {
        "volume_cm3": round(float(brain_mask.sum()) * vox_cm3, 1),
        "centroid_mm": [round(float(v), 1) for v in centroid],
    }
