"""Run the full MedTwin pipeline on one case folder, without the web server.

Examples (from the medtwin_app folder):
    .venv\\Scripts\\python scripts\\run_case.py ..\\Dataset\\ASNR-MICCAI-BraTS2023-GLI-Challenge-TrainingData\\BraTS-GLI-00449-000 --ground-truth
    .venv\\Scripts\\python scripts\\run_case.py D:\\scans\\patient01 --age 54 --sex female
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medtwin import config, pipeline  # noqa: E402
from medtwin.inputs import find_sequences  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", type=Path, help="folder with the T1, T1c, T2 and FLAIR NIfTI files")
    parser.add_argument("--out", type=Path, help="output folder (default: data/jobs/cli-<folder name>)")
    parser.add_argument("--age", type=int)
    parser.add_argument("--sex", choices=["female", "male"])
    parser.add_argument("--ground-truth", action="store_true", help="compare with a *seg* file in the folder")
    args = parser.parse_args()

    files, seg = find_sequences(args.folder)
    out = args.out or config.JOBS_DIR / f"cli-{args.folder.name}"
    started = time.perf_counter()
    results = pipeline.run(
        out, files, details={"age": args.age, "sex": args.sex}, case_label=args.folder.name,
        ground_truth=seg if args.ground_truth else None,
        progress=lambda step, state: print(f"  {step:<10} {state}", flush=True),
    )
    print(f"\nDone in {time.perf_counter() - started:.1f} s -> {out}")
    for disease in results["diseases"]:
        print(f"\n{disease['name']}: {'detected' if disease['detected'] else 'not detected'}, "
              f"{disease['total_volume_cm3']:.2f} cm3, {len(disease['lesions'])} lesion(s)")
        for r in disease["regions"]:
            loc = r.get("location", {}).get("description", "-")
            gt = r.get("ground_truth")
            gt_txt = f"  | GT {gt['volume_cm3']:.2f} cm3, Dice {gt['dice']}" if gt else ""
            print(f"  {r['name']:<18} {r['volume_cm3']:8.2f} cm3  {loc}{gt_txt}")
    print("\nWarnings:", json.dumps(results["warnings"], indent=2) if results["warnings"] else "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
