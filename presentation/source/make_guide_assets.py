"""Images for the project-review deck (for the guide), made from MedTwin's stored outputs (read-only).

- twin_hero.png, twin_ai.png, twin_expert.png: 3D renders of BraTS-GLI-00449-000 on a transparent background
  (meshes from medtwin_app/data/jobs/d43e76abdfac/meshes; renderer reused from the paper's make_color_figures.py)
- report_top.png: the top of that case's printed report, cut from report_page.png

report_page.png is a headless-Edge screenshot of medtwin_app/data/jobs/d43e76abdfac/report.html:
    msedge --headless=new --force-device-scale-factor=2 --window-size=1100,1500 --screenshot=report_page.png file:///.../report.html

Run from the project root:
    medtwin_app\\.venv\\Scripts\\python -B presentation\\source\\make_guide_assets.py
"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "presentation" / "assets"
sys.path.insert(0, str(ROOT / "research_paper" / "manuscript" / "figures"))
import make_color_figures as mcf  # noqa: E402
from PIL import Image  # noqa: E402

job = ROOT / "medtwin_app" / "data" / "jobs" / "d43e76abdfac" / "meshes"
names = ("edema", "necrotic_core", "enhancing_tumor")
col = {"edema": mcf.ED, "necrotic_core": mcf.NCR, "enhancing_tumor": mcf.ET}
VIEW = (-1.0, 0.55, 0.35)      # patient's left, anterior, above (the tumour is left frontal)


def nested(m, extra=()):
    return list(extra) + [([(*m["edema"], mcf.ED)], 0.40), ([(*m["enhancing_tumor"], mcf.ET)], 0.60),
                          ([(*m["necrotic_core"], mcf.NCR)], 1.0)]


def render_rgba(layers, name, lim=None, px=1000):
    """Like mcf.composite, but alpha-composites the layers onto a transparent canvas and saves RGBA."""
    pts = np.vstack([p.reshape(-1, 2) for parts, _ in layers for p, _, _ in mcf._project(parts, VIEW)])
    if lim is None:
        lo, hi = pts.min(0), pts.max(0)
        c, r = (lo + hi) / 2, (hi - lo).max() / 2 * 1.03
        lim = (c[0] - r, c[0] + r, c[1] - r, c[1] + r)
    acc_c = np.zeros((px, px, 3)); acc_a = np.zeros((px, px, 1))
    for parts, alpha in layers:
        img = mcf.render_layer(parts, VIEW, lim, px=px)
        a = img[..., 3:4] * alpha
        acc_c = acc_c * (1 - a) + img[..., :3] * a
        acc_a = acc_a * (1 - a) + a
    rgb = np.where(acc_a > 0, acc_c / np.maximum(acc_a, 1e-6), 0)
    rgba = (np.concatenate([rgb, acc_a], axis=-1) * 255).round().astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA")
    im.crop(im.getbbox()).save(OUT / f"{name}.png")
    print("saved", name)
    return lim


cortex = mcf.load_mesh(job / "brain_template.glb", 80000)
ai = {n: mcf.load_mesh(job / f"glioma_{n}.glb", 30000) for n in names}
ref = {n: mcf.load_mesh(job / f"glioma_{n}_ground_truth.glb", 30000) for n in names}
render_rgba(nested(ai, [([(*cortex, "#C9D3DD")], 0.42)]), "twin_hero", px=1400)
# AI and expert on the same scale so they can sit side by side
pts = np.vstack([p.reshape(-1, 2) for m in (ai, ref) for parts, _ in nested(m) for p, _, _ in mcf._project(parts, VIEW)])
lo, hi = pts.min(0), pts.max(0)
c, r = (lo + hi) / 2, (hi - lo).max() / 2 * 1.03
shared = (c[0] - r, c[0] + r, c[1] - r, c[1] + r)
render_rgba(nested(ai), "twin_ai", lim=shared)
render_rgba(nested(ref), "twin_expert", lim=shared)

page = Image.open(OUT / "report_page.png").convert("RGB")
page.crop((120, 30, 2080, 1440)).save(OUT / "report_top.png")
print("saved report_top", page.size)
