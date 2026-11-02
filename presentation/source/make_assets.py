"""Images for the ML walkthrough deck, made from MedTwin's stored outputs (read-only).

Source: medtwin_app/data/jobs/d43e76abdfac/volumes.npz  (BraTS-GLI-00449-000, test scan, AI result unedited)
Writes PNGs to presentation/assets/.

Run from the project root:
    medtwin_app\\.venv\\Scripts\\python -B presentation\\source\\make_assets.py
"""
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import to_rgb

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "presentation" / "assets"
OUT.mkdir(parents=True, exist_ok=True)
z = np.load(ROOT / "medtwin_app" / "data" / "jobs" / "d43e76abdfac" / "volumes.npz")
SL = int(np.argmax((z["ground_truth"] > 0).sum(axis=(0, 1))))   # axial slice with most tumour
COL = {1: "#0072B2", 2: "#F0E442", 3: "#D55E00"}                 # necrotic, oedema, enhancing (Okabe-Ito)


def axial(v):
    return v[::-1, :, SL].T                                       # radiological orientation


def crop_box(mask, pad=4):
    ys, xs = np.where(mask)
    return max(ys.min() - pad, 0), ys.max() + pad, max(xs.min() - pad, 0), xs.max() + pad


BRAIN = axial(z["brain_mask"] > 0)
Y0, Y1, X0, X1 = crop_box(BRAIN)


def save(img, name, overlay=None, box=None):
    fig = plt.figure(figsize=(3, 3 * (Y1 - Y0) / (X1 - X0)), dpi=200)
    ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off")
    ax.imshow(img[Y0:Y1, X0:X1], cmap="gray", origin="lower", interpolation="lanczos")
    if overlay is not None:
        rgba = np.zeros(overlay.shape + (4,))
        for k, c in COL.items():
            rgba[overlay == k] = (*to_rgb(c), 0.65)
        ax.imshow(rgba[Y0:Y1, X0:X1], origin="lower", interpolation="nearest")
    if box is not None:
        y0, y1, x0, x1 = max(box[0], Y0 + 2), min(box[1], Y1 - 3), max(box[2], X0 + 2), min(box[3], X1 - 3)
        ax.add_patch(plt.Rectangle((x0 - X0, y0 - Y0), x1 - x0, y1 - y0, fill=False, ec="#D55E00", lw=3))
    fig.patch.set_facecolor("black")
    fig.savefig(OUT / f"{name}.png", facecolor="black")
    plt.close(fig)
    print("saved", name)


for key, name in (("img_t1", "seq_t1"), ("img_t1c", "seq_t1c"), ("img_t2", "seq_t2"), ("img_flair", "seq_flair")):
    save(axial(z[key]), name)
t1c = axial(z["img_t1c"])
gt = axial(z["ground_truth"])
save(t1c, "label_expert", overlay=gt)
save(t1c, "task_detect", box=crop_box(gt > 0, pad=3))
save(t1c, "label_ai", overlay=axial(z["labels_ai"]))
print("slice", SL)

# share of each label in the whole 3D scan and inside the brain (used on the loss slide)
import json
gt3 = z["ground_truth"]; brain3 = z["brain_mask"] > 0
names = {0: "background", 1: "necrotic core", 2: "oedema", 3: "enhancing"}
stats = {"scan": "BraTS-GLI-00449-000", "voxels_total": int(gt3.size), "voxels_brain": int(brain3.sum()),
         "percent_of_scan": {names[k]: round(100 * float((gt3 == k).mean()), 2) for k in names},
         "percent_of_brain": {names[k]: round(100 * float(((gt3 == k) & brain3).sum() / brain3.sum()), 2) for k in names}}
(OUT / "label_share.json").write_text(json.dumps(stats, indent=1))
print(json.dumps(stats, indent=1))

# failure case (test scan 00012, expert vs AI) cut from the paper's colour Fig. 4, row c
from PIL import Image
fig4 = Image.open(ROOT / "research_paper" / "manuscript" / "figures" / "Fig4_qualitative.png").convert("RGB")
fig4.crop((894, 910, 1206, 1312)).save(OUT / "failure_expert.png")
fig4.crop((1260, 910, 1572, 1312)).save(OUT / "failure_ai.png")
print("saved failure_expert, failure_ai")
