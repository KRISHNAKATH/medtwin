"""Build a synthetic hospital-style DICOM study from a BraTS case, for testing the DICOM path.

What it simulates: a skull and scalp shell with background noise (so skull stripping is
needed), FLAIR with 3 mm slices tilted by 4 degrees and T2 on a 0.9 x 0.9 x 2 mm grid (so
co-registration is needed), realistic series descriptions and timing tags, and a fake
patient name that must never reach the app's stored files.

    .venv\\Scripts\\python scripts\\make_test_dicom.py <BraTS case folder> <output.zip>
"""
from __future__ import annotations

import sys
import tempfile
import time
import zipfile
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from scipy import ndimage

SERIES = {  # key: (file suffix, description, TR, TE, TI, contrast, spacing, tilt degrees)
    "t1": ("-t1n.nii.gz", "AX T1 SE", 500, 12, None, False, (1.0, 1.0, 1.0), 0.0),
    "t1c": ("-t1c.nii.gz", "AX T1 POST GD 3D", 8, 3, None, True, (1.0, 1.0, 1.0), 0.0),
    "t2": ("-t2w.nii.gz", "AX T2 FSE", 4000, 100, None, False, (0.9, 0.9, 2.0), 0.0),
    "flair": ("-t2f.nii.gz", "AX FLAIR", 9000, 120, 2500, False, (1.0, 1.0, 3.0), 4.0),
}


def add_skull(image: sitk.Image, brain: np.ndarray, rng: np.random.Generator) -> sitk.Image:
    arr = sitk.GetArrayFromImage(image).astype(np.float32)
    level = np.percentile(arr[brain], 75)
    inner = ndimage.binary_dilation(brain, iterations=4)
    skull = ndimage.binary_dilation(brain, iterations=9) & ~inner
    scalp = ndimage.binary_dilation(brain, iterations=13) & ~ndimage.binary_dilation(brain, iterations=10)
    arr[skull] = 0.25 * level
    arr[scalp] = 1.1 * level
    arr += rng.normal(0, 0.02 * level, arr.shape).clip(0)
    out = sitk.GetImageFromArray(arr)
    out.CopyInformation(image)
    return out


def regrid(image: sitk.Image, spacing, tilt_deg: float) -> sitk.Image:
    size = [int(round(sz * sp / ns)) for sz, sp, ns in zip(image.GetSize(), image.GetSpacing(), spacing)]
    rot = sitk.Euler3DTransform()
    centre = image.TransformContinuousIndexToPhysicalPoint([(s - 1) / 2 for s in image.GetSize()])
    rot.SetCenter(centre)
    rot.SetRotation(np.deg2rad(tilt_deg), 0, 0)
    direction = np.array(rot.GetMatrix()).reshape(3, 3) @ np.array(image.GetDirection()).reshape(3, 3)
    ref = sitk.Image(size, sitk.sitkFloat32)
    ref.SetSpacing(spacing)
    ref.SetDirection(direction.ravel().tolist())
    half = np.array(size) * np.array(spacing) / 2
    ref.SetOrigin((np.array(centre) - direction @ half).tolist())
    return sitk.Resample(image, ref, sitk.Transform(), sitk.sitkLinear, 0.0, sitk.sitkFloat32)


def write_series(image: sitk.Image, folder: Path, number: int, desc: str, tr, te, ti, contrast) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    arr = sitk.GetArrayFromImage(image)
    scale = 3000.0 / max(float(arr.max()), 1e-6)
    img = sitk.Cast(sitk.GetImageFromArray((arr * scale).clip(0, 32000)), sitk.sitkInt16)
    img.CopyInformation(image)
    writer = sitk.ImageFileWriter()
    writer.KeepOriginalImageUIDOn()
    uid = "1.2.826.0.1.3680043.2.1125." + str(int(time.time() * 1e3)) + f".{number}"
    direction = image.GetDirection()
    common = {
        "0010|0010": "SYNTHETIC^PATIENT",   # must not reach the app's stored data
        "0010|0020": "TEST-12345",
        "0010|0030": "19700101",
        "0008|0060": "MR",
        "0008|0020": "20260901",
        "0008|0008": "ORIGINAL\\PRIMARY",
        "0020|000d": "1.2.826.0.1.3680043.2.1125.99",
        "0020|000e": uid,
        "0020|0011": str(number),
        "0008|103e": desc,
        "0018|0080": str(tr),
        "0018|0081": str(te),
        "0020|0037": "\\".join(f"{v:.6f}" for v in (direction[0], direction[3], direction[6],
                                                     direction[1], direction[4], direction[7])),
    }
    if ti:
        common["0018|0082"] = str(ti)
    if contrast:
        common["0018|0010"] = "GADOBUTROL"
    for z in range(img.GetDepth()):
        sl = img[:, :, z]
        for k, v in common.items():
            sl.SetMetaData(k, v)
        pos = img.TransformIndexToPhysicalPoint((0, 0, z))
        sl.SetMetaData("0020|0032", "\\".join(f"{p:.4f}" for p in pos))
        sl.SetMetaData("0020|0013", str(z + 1))
        sl.SetMetaData("0028|0030", f"{img.GetSpacing()[1]:.4f}\\{img.GetSpacing()[0]:.4f}")
        sl.SetMetaData("0018|0050", f"{img.GetSpacing()[2]:.4f}")
        writer.SetFileName(str(folder / f"IM{z + 1:04d}.dcm"))
        writer.Execute(sl)


def main() -> int:
    case, out_zip = Path(sys.argv[1]), Path(sys.argv[2])
    rng = np.random.default_rng(0)
    pid = case.name
    brain = None
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "DICOM"
        for number, (key, (suffix, desc, tr, te, ti, contrast, spacing, tilt)) in enumerate(SERIES.items(), 1):
            image = sitk.Cast(sitk.ReadImage(str(case / f"{pid}{suffix}")), sitk.sitkFloat32)
            if brain is None:
                brain = sitk.GetArrayFromImage(image) > 0
            image = add_skull(image, brain, rng)
            if spacing != (1.0, 1.0, 1.0) or tilt:
                image = regrid(image, spacing, tilt)
            write_series(image, root / f"SE{number:03d}", number, desc, tr, te, ti, contrast)
            print(f"{key:<6} {desc:<18} size {image.GetSize()} spacing {image.GetSpacing()}")
        with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in sorted(root.rglob("*.dcm")):
                zf.write(f, f.relative_to(root.parent))
    print(f"wrote {out_zip} ({out_zip.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
