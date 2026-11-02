"""evaluate_test_set.py - Recalculate Dice on subject-independent test scans.

Methodological improvement over the original Phase-3 evaluation:
  - Deduplicates multi-session patients (e.g. -000 and -001 from the same
    subject) so each physical person appears EXACTLY ONCE -> truly
    subject-independent test set (~160 unique subjects from 188 in the bundle).
  - Reports per-class Dice + IoU for all three tumour regions, plus the two
    BraTS composite regions (whole-tumour, tumour-core).
  - Skips cases where the ground-truth has no foreground (fully zero mask).
  - Saves a per-patient CSV and a summary JSON.

Usage (from the medtwin_app folder):
    .venv\Scripts\python scripts\evaluate_test_set.py
    .venv\Scripts\python scripts\evaluate_test_set.py --all-test
    .venv\Scripts\python scripts\evaluate_test_set.py --limit 5
    .venv\Scripts\python scripts\evaluate_test_set.py --out results\eval_160.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

_HERE = Path(__file__).resolve()
_APP_ROOT = _HERE.parents[1]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

import numpy as np

from medtwin import config
from medtwin.model import load_model, preprocess, predict

LABEL_NECROTIC  = 1
LABEL_EDEMA     = 2
LABEL_ENHANCING = 3

REGIONS = {
    "necrotic_core":   [LABEL_NECROTIC],
    "edema":           [LABEL_EDEMA],
    "enhancing_tumor": [LABEL_ENHANCING],
    "whole_tumor":     [LABEL_NECROTIC, LABEL_EDEMA, LABEL_ENHANCING],
    "tumor_core":      [LABEL_NECROTIC, LABEL_ENHANCING],
}


def dice_coeff(pred_bin: np.ndarray, gt_bin: np.ndarray) -> float:
    tp = int((pred_bin & gt_bin).sum())
    denom = int(pred_bin.sum()) + int(gt_bin.sum())
    if denom == 0:
        return float("nan")
    return 2.0 * tp / denom


def iou_coeff(pred_bin: np.ndarray, gt_bin: np.ndarray) -> float:
    tp = int((pred_bin & gt_bin).sum())
    union = int((pred_bin | gt_bin).sum())
    if union == 0:
        return float("nan")
    return tp / union


def region_metrics(pred: np.ndarray, gt: np.ndarray, labels: list) -> dict:
    pred_bin = np.isin(pred, labels)
    gt_bin   = np.isin(gt,   labels)
    return {"dice": dice_coeff(pred_bin, gt_bin), "iou": iou_coeff(pred_bin, gt_bin)}


def base_subject(patient_id: str) -> str:
    parts = patient_id.rsplit("-", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return parts[0]
    return patient_id


def deduplicate_subjects(patient_ids: list) -> list:
    seen = set()
    result = []
    for pid in patient_ids:
        subj = base_subject(pid)
        if subj not in seen:
            seen.add(subj)
            result.append(pid)
    return result


def find_files(patient_id: str, dataset_dir: Path):
    d = dataset_dir / patient_id
    if not d.is_dir():
        return None
    files = {}
    for key, suf in config.BRATS_SUFFIXES.items():
        p = d / f"{patient_id}{suf}"
        if not p.is_file():
            return None
        files[key] = p
    seg = d / f"{patient_id}{config.BRATS_LABEL_SUFFIX}"
    if not seg.is_file():
        return None
    return files, seg


def _safe_round(val, ndigits=4):
    if isinstance(val, float) and val != val:
        return None
    if val is None:
        return None
    return round(float(val), ndigits)


def evaluate(patient_ids: list, dataset_dir: Path, loaded) -> list:
    rows = []
    n = len(patient_ids)
    for i, pid in enumerate(patient_ids, 1):
        t0 = time.time()
        result = find_files(pid, dataset_dir)
        if result is None:
            print(f"  [{i}/{n}] SKIP {pid}  (files missing)")
            continue
        files, seg_path = result
        try:
            pre = preprocess(loaded, files, ground_truth=seg_path)
        except Exception as exc:
            print(f"  [{i}/{n}] SKIP {pid}  (preprocess error: {exc})")
            continue
        gt = pre.ground_truth
        if gt is None or int(gt.sum()) == 0:
            print(f"  [{i}/{n}] SKIP {pid}  (ground-truth all-zero)")
            continue
        try:
            pred, _conf = predict(loaded, pre)
        except Exception as exc:
            print(f"  [{i}/{n}] SKIP {pid}  (inference error: {exc})")
            continue
        row = {"patient_id": pid, "subject": base_subject(pid)}
        for region, labels in REGIONS.items():
            m = region_metrics(pred, gt, labels)
            row[f"{region}_dice"] = _safe_round(m["dice"])
            row[f"{region}_iou"]  = _safe_round(m["iou"])
        elapsed = time.time() - t0
        wt = row.get("whole_tumor_dice") or 0.0
        print(f"  [{i}/{n}] {pid}  whole-tumor Dice={wt:.3f}  ({elapsed:.0f}s)")
        rows.append(row)
    return rows


def aggregate(rows: list) -> dict:
    agg = {"n_evaluated": len(rows)}
    for region in REGIONS:
        for metric in ("dice", "iou"):
            key = f"{region}_{metric}"
            vals = [r[key] for r in rows if r.get(key) is not None]
            if vals:
                arr = np.array(vals, dtype=float)
                agg[f"{key}_mean"]   = round(float(np.mean(arr)),   4)
                agg[f"{key}_std"]    = round(float(np.std(arr)),    4)
                agg[f"{key}_median"] = round(float(np.median(arr)), 4)
                agg[f"{key}_n"]      = len(vals)
            else:
                agg[f"{key}_mean"] = None
    return agg


def main():
    parser = argparse.ArgumentParser(description="Evaluate Dice on subject-independent test scans.")
    parser.add_argument("--all-test",  action="store_true",
                        help="Use all 188 test patients (no deduplication).")
    parser.add_argument("--out",       default=None,
                        help="Path for per-patient CSV (default: outputs/phase3_reports/eval_<N>subjects.csv).")
    parser.add_argument("--limit",     type=int, default=0,
                        help="Evaluate only first N patients (smoke-test).")
    args = parser.parse_args()

    print("Loading model ...")
    loaded = load_model("glioma")
    bundle = loaded.bundle
    all_test = bundle["split_info"]["test_patients"]
    print(f"  Bundle test_patients: {len(all_test)}")

    if args.all_test:
        patient_ids = all_test
        label = f"{len(patient_ids)}test"
    else:
        patient_ids = deduplicate_subjects(all_test)
        removed = len(all_test) - len(patient_ids)
        label = f"{len(patient_ids)}subjects"
        print(f"  Deduplicated to {len(patient_ids)} unique subjects "
              f"(removed {removed} repeat-session scans).")

    if args.limit > 0:
        patient_ids = patient_ids[: args.limit]
        label = f"limit{args.limit}"
        print(f"  --limit {args.limit}: evaluating only the first {args.limit} patients.")

    dataset_dir = config.DATASET_DIR
    print(f"  Dataset dir : {dataset_dir}")
    print(f"  Checkpoint  : {loaded.checkpoint_path}")
    print(f"  Device      : {loaded.device}")
    print(f"  Subjects    : {len(patient_ids)}")
    print()

    t_start = time.time()
    rows = evaluate(patient_ids, dataset_dir, loaded)
    elapsed_total = time.time() - t_start

    if not rows:
        print("No patients evaluated. Check dataset path and file names.")
        sys.exit(1)

    agg = aggregate(rows)
    agg["elapsed_seconds"]  = round(elapsed_total, 1)
    agg["device"]           = str(loaded.device)
    agg["checkpoint"]       = str(loaded.checkpoint_path)
    agg["deduplicated"]     = not args.all_test

    print()
    print("=" * 62)
    print(f"  Evaluation summary  ({agg['n_evaluated']} patients, {elapsed_total/60:.1f} min)")
    print("=" * 62)
    print(f"  {'Region':<22} {'Dice mean':>10} {'Dice std':>9} {'IoU mean':>10}")
    print("  " + "-" * 54)
    for region in REGIONS:
        dm = agg.get(f"{region}_dice_mean")
        ds = agg.get(f"{region}_dice_std")
        im = agg.get(f"{region}_iou_mean")
        s_dm = f"{dm:.4f}" if dm is not None else "   N/A"
        s_ds = f"{ds:.4f}" if ds is not None else "   N/A"
        s_im = f"{im:.4f}" if im is not None else "   N/A"
        print(f"  {region:<22} {s_dm:>10} {s_ds:>9} {s_im:>10}")
    print("=" * 62)

    reports_dir = config.OUTPUTS_DIR / "phase3_reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    csv_path = Path(args.out) if args.out else reports_dir / f"eval_{label}.csv"
    fieldnames = ["patient_id", "subject"] + [
        f"{r}_{m}" for r in REGIONS for m in ("dice", "iou")
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"\n  Per-patient CSV -> {csv_path}")

    json_path = csv_path.with_suffix(".summary.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(agg, f, indent=2)
    print(f"  Summary JSON  -> {json_path}")


if __name__ == "__main__":
    main()
