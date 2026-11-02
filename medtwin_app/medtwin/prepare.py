"""Turn raw hospital sequences into model-ready inputs (BraTS-style).

1. Reference = T1 contrast, resampled to 1 mm isotropic.
2. T1, T2 and FLAIR are rigidly registered to it (mutual information, multi-resolution)
   and resampled onto the same 1 mm grid. Sequences from one session start aligned in
   scanner space, so registration only corrects patient motion.
3. If the scan still contains the skull, HD-BET (separate process) computes a brain mask
   on the reference, which is applied to all four sequences.

Inputs that are already aligned and skull-stripped (BraTS-like) pass through unchanged.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import SimpleITK as sitk

from .inputs import InputError

TARGET_SPACING = (1.0, 1.0, 1.0)
SKULL_STRIPPED_ZERO_FRACTION = 0.3


def _read(path: Path) -> sitk.Image:
    return sitk.Cast(sitk.ReadImage(str(path)), sitk.sitkFloat32)


def same_grid(images: dict[str, sitk.Image]) -> bool:
    ref = next(iter(images.values()))
    return all(
        im.GetSize() == ref.GetSize()
        and np.allclose(im.GetSpacing(), ref.GetSpacing(), atol=1e-3)
        and np.allclose(im.GetOrigin(), ref.GetOrigin(), atol=1e-2)
        and np.allclose(im.GetDirection(), ref.GetDirection(), atol=1e-3)
        for im in images.values()
    )


MAX_BRAIN_ONLY_CM3 = 2100.0


def foreground_cm3(image: sitk.Image) -> float:
    """Volume of everything clearly above background (largest piece, holes filled)."""
    from scipy import ndimage
    arr = sitk.GetArrayFromImage(image)
    nonzero = arr[arr > 0]
    if nonzero.size == 0:
        return 0.0
    fg = arr > 0.1 * float(np.percentile(nonzero, 99))
    # fill first: a scalp shell around the brain then encloses the whole head
    fg = ndimage.binary_fill_holes(ndimage.binary_closing(fg, iterations=2))
    labeled, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, labeled, index=np.arange(1, n + 1))
        fg = labeled == (1 + int(np.argmax(sizes)))
    return float(fg.sum()) * float(np.prod(image.GetSpacing())) / 1000.0


def looks_skull_stripped(image: sitk.Image) -> bool:
    """Stripped = mostly empty background AND the visible tissue is brain-sized.
    A whole head (scalp, skull, face) is well over 2,100 cm³; an adult brain is not."""
    arr = sitk.GetArrayViewFromImage(image)
    if float((arr == 0).mean()) < SKULL_STRIPPED_ZERO_FRACTION:
        return False
    return foreground_cm3(image) <= MAX_BRAIN_ONLY_CM3


def resample_isotropic(image: sitk.Image, spacing=TARGET_SPACING) -> sitk.Image:
    old_size, old_spacing = np.array(image.GetSize()), np.array(image.GetSpacing())
    new_size = [int(round(s)) for s in old_size * old_spacing / np.array(spacing)]
    return sitk.Resample(image, new_size, sitk.Transform(), sitk.sitkLinear, image.GetOrigin(), spacing,
                         image.GetDirection(), 0.0, sitk.sitkFloat32)


def register_rigid(fixed: sitk.Image, moving: sitk.Image) -> tuple[sitk.Transform, float]:
    """Rigid registration, Mattes mutual information, 3 resolution levels."""
    initial = sitk.Euler3DTransform()
    centre = fixed.TransformContinuousIndexToPhysicalPoint([(s - 1) / 2 for s in fixed.GetSize()])
    initial.SetCenter(centre)
    reg = sitk.ImageRegistrationMethod()
    reg.SetMetricAsMattesMutualInformation(numberOfHistogramBins=50)
    reg.SetMetricSamplingStrategy(reg.RANDOM)
    reg.SetMetricSamplingPercentage(0.05, seed=7)
    reg.SetInterpolator(sitk.sitkLinear)
    reg.SetOptimizerAsRegularStepGradientDescent(learningRate=1.0, minStep=1e-4, numberOfIterations=200,
                                                 relaxationFactor=0.6)
    reg.SetOptimizerScalesFromPhysicalShift()
    reg.SetShrinkFactorsPerLevel([4, 2, 1])
    reg.SetSmoothingSigmasPerLevel([2, 1, 0])
    reg.SmoothingSigmasAreSpecifiedInPhysicalUnitsOn()
    reg.SetInitialTransform(initial, inPlace=False)
    transform = reg.Execute(fixed, moving)
    return transform, float(reg.GetMetricValue())


def hd_bet_executable() -> Path | None:
    scripts = Path(sys.executable).parent
    for name in ("hd-bet.exe", "hd-bet"):
        if (scripts / name).is_file():
            return scripts / name
    found = shutil.which("hd-bet")
    return Path(found) if found else None


HD_BET_MIN_GPU_GB = 4.0


def hd_bet_devices() -> tuple[str, ...]:
    """GPU only when it has enough memory; on small GPUs (e.g. 2 GB) HD-BET spills into system
    memory and takes over 10 minutes, while the CPU needs about 2."""
    try:
        import torch
        if torch.cuda.is_available():
            gb = torch.cuda.get_device_properties(0).total_memory / 1024 ** 3
            if gb >= HD_BET_MIN_GPU_GB:
                return ("cuda", "cpu")
    except Exception:
        pass
    return ("cpu",)


def run_hd_bet(reference: Path, work: Path) -> Path:
    """Brain mask for ``reference`` via HD-BET in its own process (frees GPU memory after).
    Tries the GPU first, then the CPU."""
    exe = hd_bet_executable()
    if exe is None:
        raise InputError("This scan still contains the skull and HD-BET is not installed, so it cannot be "
                         "skull-stripped. Install it with: pip install hd-bet")
    out = work / "hdbet.nii.gz"
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "TF_CPP_MIN_LOG_LEVEL": "2"}
    for device in hd_bet_devices():
        cmd = [str(exe), "-i", str(reference), "-o", str(out), "-device", device, "--disable_tta",
               "--save_bet_mask", "--no_bet_image"]
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=1800)
        mask = work / "hdbet_bet.nii.gz"
        if proc.returncode == 0 and mask.is_file():
            return mask
    raise RuntimeError(f"HD-BET failed: {proc.stderr[-800:]}")


def prepare(files: dict[str, Path], work: Path, reference_key: str = "t1c") -> tuple[dict[str, Path], dict, list[str]]:
    """Return model-ready files, a QC summary and warnings."""
    images = {k: _read(p) for k, p in files.items()}
    aligned = same_grid(images)
    stripped = all(looks_skull_stripped(im) for im in images.values())
    qc: dict = {"already_aligned": aligned, "already_skull_stripped": stripped, "registration": {}}
    warnings: list[str] = []
    if aligned and stripped:
        return files, qc, warnings

    work.mkdir(parents=True, exist_ok=True)
    spacing = images[reference_key].GetSpacing()
    if max(spacing) > 3.0:
        warnings.append(f"The reference scan has thick slices ({max(spacing):.1f} mm); small lesions may be missed "
                        "and volumes are less precise. A 3D T1 contrast scan (about 1 mm) is best.")
    reference = resample_isotropic(images[reference_key])
    out: dict[str, sitk.Image] = {reference_key: reference}
    for key, image in images.items():
        if key == reference_key:
            continue
        if aligned:
            transform, metric = sitk.Transform(), None
        else:
            transform, metric = register_rigid(reference, image)
        out[key] = sitk.Resample(image, reference, transform, sitk.sitkLinear, 0.0, sitk.sitkFloat32)
        qc["registration"][key] = None if metric is None else round(metric, 4)

    if not stripped:
        ref_path = work / "reference.nii.gz"
        sitk.WriteImage(reference, str(ref_path))
        mask = sitk.ReadImage(str(run_hd_bet(ref_path, work)), sitk.sitkUInt8)
        mask_arr = sitk.GetArrayFromImage(mask) > 0
        brain_cm3 = float(mask_arr.sum()) * float(np.prod(reference.GetSpacing())) / 1000.0
        qc["brain_mask_cm3"] = round(brain_cm3, 1)
        if not 700 <= brain_cm3 <= 2200:
            warnings.append(f"Skull stripping found {brain_cm3:.0f} cm³ of brain, outside the usual adult range; "
                            "check the brain outline on the slices.")
        for key, image in out.items():
            arr = sitk.GetArrayFromImage(image)
            arr[~mask_arr] = 0
            clean = sitk.GetImageFromArray(arr)
            clean.CopyInformation(image)
            out[key] = clean

    ready = {}
    for key, image in out.items():
        path = work / f"{key}.nii.gz"
        sitk.WriteImage(image, str(path))
        ready[key] = path
    return ready, qc, warnings
