"""End-to-end analysis of one case, and rebuilding results after a clinician's correction.

run():      inputs -> check -> align + skull-strip -> preprocess -> segment -> brain surfaces
            -> finalize()
finalize(): measurements, confidence, lesion meshes, report and results.json from a label map.
            Called by run() for the AI result and by rebuild() after each correction.

Files in ``job_dir``:
    volumes.npz       uint8 display volumes + current labels, AI labels, confidence, brain mask, affine
    results.json      everything the web page shows
    review.json       review status and sign-off
    audit.jsonl       append-only log of analysis, corrections and sign-offs
    meshes/*.glb      brain surfaces + one mesh per region (viewer frame)
    report.html       printable report
"""
from __future__ import annotations

import datetime as dt
import json
import time
from pathlib import Path
from typing import Callable

import numpy as np
import trimesh
from scipy import ndimage

from . import analysis, anatomy, config, fileio, meshing, measurements, model, report, review, slices
from . import prepare as prep
from .inputs import validate

STEPS = (
    ("validate", "Checking the scan"),
    ("prepare", "Aligning sequences, removing the skull"),
    ("preprocess", "Preparing the images"),
    ("segment", "Finding disease regions"),
    ("brain", "Building the 3D brain"),
    ("measure", "Measuring volumes and diameters"),
    ("meshes", "Building lesion meshes"),
    ("report", "Writing the report"),
)

BRAIN_MAX_FACES = 260_000
REGION_MAX_FACES = 60_000
UNSURE = int(0.6 * 255)   # voxels below 60% model confidence count as uncertain

ProgressFn = Callable[[str, str], None]


def _noop(step: str, state: str) -> None:
    pass


class _Clock:
    def __init__(self, progress: ProgressFn):
        self.progress, self.timings, self.t = progress, {}, time.perf_counter()

    def start(self, name: str) -> None:
        self.t = time.perf_counter()
        self.progress(name, "running")

    def done(self, name: str) -> None:
        self.timings[name] = round(time.perf_counter() - self.t, 2)
        self.progress(name, "done")


def run(job_dir: Path, files: dict[str, Path], details: dict | None = None, case_label: str | None = None,
        ground_truth: Path | None = None, progress: ProgressFn = _noop) -> dict:
    details = details or {}
    disease_keys = tuple(config.DISEASE_MODELS)
    job_dir.mkdir(parents=True, exist_ok=True)
    clock = _Clock(progress)

    clock.start("validate")
    required = tuple(sorted({m for k in disease_keys for m in config.DISEASE_MODELS[k].required_modalities},
                            key=config.MODALITY_KEYS.index))
    input_info, warnings = validate(files, required)
    clock.done("validate")

    clock.start("prepare")
    ready, prep_qc, prep_warnings = prep.prepare({k: files[k] for k in required}, job_dir / "prepared")
    warnings += prep_warnings
    input_info["preparation"] = prep_qc
    if ground_truth is not None and ready != {k: files[k] for k in required}:
        ground_truth = None   # expert labels no longer match the re-gridded images
        warnings.append("Expert labels were dropped because the images had to be re-aligned.")
    clock.done("prepare")

    clock.start("preprocess")
    primary = model.load_model(disease_keys[0])
    pre = model.preprocess(primary, ready, ground_truth)
    brain_mask = analysis.brain_mask_from_image(pre.image)
    if not brain_mask.any():
        raise ValueError("The images are empty after preprocessing.")
    clock.done("preprocess")

    clock.start("segment")
    labels = np.zeros(brain_mask.shape, np.uint8)
    confidence = np.full(brain_mask.shape, 255, np.uint8)
    for key in disease_keys:  # one disease today; more diseases need distinct label values
        pred, conf = model.predict(model.load_model(key), pre)
        labels = np.where(pred > 0, pred, labels)
        confidence = np.minimum(confidence, conf)
    slices.save_volumes(job_dir / "volumes.npz", pre.image, pre.modality_order, brain_mask, labels,
                        pre.ground_truth, labels_ai=labels, confidence=confidence, affine=pre.affine)
    clock.done("segment")

    clock.start("brain")
    brain = analysis.brain_summary(brain_mask, pre.affine)
    centre = np.array(brain["centroid_mm"])
    mesh_dir = job_dir / "meshes"
    exact = anatomy.patient_brain_surface(pre.image, pre.modality_order, brain_mask, labels > 0, pre.affine)
    exact = meshing.decimate(exact, BRAIN_MAX_FACES)
    anatomy.paint(exact)
    brain["mesh"] = meshing.export_glb(meshing.to_viewer_frame(exact, centre), mesh_dir / "brain.glb")["file"]
    brain["surface_source_label"] = "exact outline reconstructed from this patient's scan"
    template_path = anatomy.select_template(details)
    if template_path is not None:
        try:
            template = anatomy.load_template(template_path)
            fitted, fit_info = anatomy.fit_template(template, exact)
            parts = [fitted]
            if template.cerebrum_only:
                lower = anatomy.lower_brain_patch(exact, fitted)
                if lower is not None:
                    parts.append(lower)
            meshing.export_glb(meshing.to_viewer_frame(trimesh.util.concatenate(parts), centre),
                               mesh_dir / "brain_template.glb")
            brain["template"] = {"file": template_path.name, "mesh": "brain_template.glb", **fit_info}
            brain["surface_source_label"] = (
                f"{template.name} warped to this patient's brain outline"
                + (" (cerebellum and brainstem from the scan)" if template.cerebrum_only else "")
            )
        except Exception as exc:  # a bad template must not fail the analysis
            warnings.append(f"Template {template_path.name} could not be fitted: {exc}")
    clock.done("brain")

    base = {
        "case_label": case_label or job_dir.name,
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
        "details": details,
        "patient_code": details.get("patient_code"),
        "scan_date": details.get("scan_date") or dt.date.today().isoformat(),
        "inputs": {k: Path(v).name for k, v in files.items()},
        "input_info": input_info,
        "volume_shape": list(brain_mask.shape),
        "voxel_mm": [round(float(s), 3) for s in np.sqrt((pre.affine[:3, :3] ** 2).sum(axis=0))],
        "brain": brain,
        "has_ground_truth": pre.ground_truth is not None,
        "base_warnings": warnings,
        "slice_channels": list(pre.modality_order),
        "model": {"description": primary.disease.description, "device": str(primary.device),
                  "checkpoint": primary.checkpoint_path.name, "version": primary.checkpoint_path.stat().st_mtime_ns},
    }
    review.audit(job_dir, "analysis", model=base["model"]["checkpoint"], device=base["model"]["device"])
    return finalize(job_dir, base, labels, clock, rebuild_gt_meshes=True)


def finalize(job_dir: Path, base: dict, labels: np.ndarray, clock: _Clock | None = None,
             rebuild_gt_meshes: bool = False) -> dict:
    clock = clock or _Clock(_noop)
    vols = slices.load_volumes(job_dir / "volumes.npz")
    affine = vols["affine"]
    brain_mask = vols["brain_mask"].astype(bool)
    labels_ai = vols["labels_ai"]
    confidence = vols["confidence"]
    ground_truth = vols.get("ground_truth")
    centre = np.array(base["brain"]["centroid_mm"])
    mesh_dir = job_dir / "meshes"
    edited = bool((labels != labels_ai).any())
    warnings = list(base.get("base_warnings", []))

    clock.start("measure")
    diseases = []
    vox_cm3 = analysis.voxel_volume_mm3(affine) / 1000.0
    for key, disease_cfg in config.DISEASE_MODELS.items():
        region_labels = [r.label for r in disease_cfg.regions]
        pred = np.where(np.isin(labels, region_labels), labels, 0)
        result = analysis.analyse_disease(disease_cfg, pred, affine, brain_mask, ground_truth)
        lesion = pred > 0
        for region_cfg, region in zip(disease_cfg.regions, result["regions"]):
            mask = labels == region_cfg.label
            region["confidence_pct"] = round(float(confidence[mask].mean()) / 2.55, 1) if mask.any() else None
            region["ai_volume_cm3"] = round(float((labels_ai == region_cfg.label).sum()) * vox_cm3, 3)
        near = ndimage.binary_dilation(lesion, iterations=2) & brain_mask if lesion.any() else lesion
        unsure = near & (confidence < UNSURE)
        result["uncertain_cm3"] = round(float(unsure.sum()) * vox_cm3, 2)
        if lesion.any() and unsure.sum() > 0.25 * lesion.sum():
            warnings.append(f"{disease_cfg.name}: the model is unsure about {result['uncertain_cm3']:.1f} cm³ "
                            "around the lesion; review the outline on the slices (Confidence overlay).")
        brain_cm3 = float(brain_mask.sum()) * vox_cm3
        if brain_cm3 and result["total_volume_cm3"] > 0.4 * brain_cm3:
            warnings.append(f"{disease_cfg.name}: the outlined region is {result['total_volume_cm3']:.0f} cm³, "
                            f"{100 * result['total_volume_cm3'] / brain_cm3:.0f}% of the brain. This is implausible and "
                            "usually means the scan was not prepared correctly (skull present, wrong sequences). "
                            "Do not use this result.")
        enhancing = next((r for r in disease_cfg.regions if r.key == "enhancing_tumor"), None)
        if enhancing is not None:
            result["rano"] = measurements.bidimensional(labels == enhancing.label, affine)
        diseases.append(result)
    clock.done("measure")

    clock.start("meshes")
    for old in mesh_dir.glob("*.glb"):
        if not old.name.startswith("brain") and (rebuild_gt_meshes or "_ground_truth" not in old.name):
            old.unlink()
    for disease in diseases:
        disease_cfg = config.DISEASE_MODELS[disease["key"]]
        for region_cfg, region in zip(disease_cfg.regions, disease["regions"]):
            if region["present"]:
                mesh = meshing.mask_to_mesh(labels == region_cfg.label, affine, sigma=0.6)
                if mesh is None:
                    region["mesh"] = None
                else:
                    meshing.smooth(mesh, iterations=6)
                    mesh = meshing.decimate(mesh, REGION_MAX_FACES)
                    meshing.export_glb(meshing.to_viewer_frame(mesh, centre), mesh_dir / region["mesh"], region_cfg.color)
            if ground_truth is not None and "ground_truth" in region:
                gt_name = f"{disease['key']}_{region_cfg.key}_ground_truth.glb"
                if rebuild_gt_meshes:
                    gt_mesh = meshing.mask_to_mesh(ground_truth == region_cfg.label, affine, sigma=0.6)
                    if gt_mesh is not None:
                        meshing.smooth(gt_mesh, iterations=6)
                        gt_mesh = meshing.decimate(gt_mesh, REGION_MAX_FACES)
                        meshing.export_glb(meshing.to_viewer_frame(gt_mesh, centre), mesh_dir / gt_name, region_cfg.color)
                if (mesh_dir / gt_name).is_file():
                    region["ground_truth"]["mesh"] = gt_name
    clock.done("meshes")

    clock.start("report")
    review_state = read_review(job_dir)
    review_state["edited"] = edited
    results = {
        **{k: v for k, v in base.items() if k != "base_warnings"},
        "base_warnings": base.get("base_warnings", []),
        "diseases": diseases,
        "warnings": warnings,
        "disclaimer": config.DISCLAIMER,
        "review": review_state,
        "updated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "timings_s": {**base.get("timings_s", {}), **clock.timings},
    }
    write_review(job_dir, review_state)
    fileio.write_text(job_dir / "report.html", report.build_report(results, vols | {"labels": labels}))
    clock.done("report")
    results["timings_s"] = {**base.get("timings_s", {}), **clock.timings}
    fileio.write_text(job_dir / "results.json", json.dumps(results, indent=2))
    return results


def read_review(job_dir: Path) -> dict:
    path = job_dir / "review.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"status": "pending", "revision": 0, "edited": False, "signed_by": None, "signed_at": None,
            "comment": None}


def write_review(job_dir: Path, state: dict) -> None:
    fileio.write_text(job_dir / "review.json", json.dumps(state, indent=2))


def rebuild(job_dir: Path, labels: np.ndarray) -> dict:
    """Recompute everything that depends on the label map (after a correction)."""
    base = json.loads((job_dir / "results.json").read_text(encoding="utf-8"))
    slices.update_labels(job_dir / "volumes.npz", labels)
    return finalize(job_dir, base, labels)
