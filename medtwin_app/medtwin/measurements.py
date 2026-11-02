"""RANO-style measurements and follow-up comparison.

Bidimensional measurement (per enhancing lesion): on the axial slice where the lesion is
largest, the longest diameter and the longest diameter perpendicular to it. A lesion is
measurable when both are at least 10 mm. Up to three of the largest measurable lesions are
targets; their products are summed (SPD).

Follow-up categories use the published RANO thresholds on enhancing tumour:
    2D:      partial response >= 50% SPD decrease vs baseline; progression >= 25% SPD increase vs nadir
    volume:  partial response >= 65% decrease vs baseline;     progression >= 40% increase vs nadir
These are radiographic measurements only. Full RANO also needs non-enhancing disease,
new lesions, steroid dose, clinical status and confirmation scans; the treating team decides.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage
from scipy.spatial import ConvexHull

MEASURABLE_MM = 10.0
MAX_TARGETS = 3


def _diameters(points_mm: np.ndarray, pixel_mm: float) -> tuple[float, float]:
    """Longest diameter and longest perpendicular chord of a 2D point set (mm)."""
    if len(points_mm) < 3:
        return pixel_mm, pixel_mm
    try:
        hull = points_mm[ConvexHull(points_mm).vertices]
    except Exception:  # degenerate (a line of pixels)
        hull = points_mm
    diff = hull[:, None, :] - hull[None, :, :]
    dist = np.sqrt((diff ** 2).sum(-1))
    i, j = np.unravel_index(np.argmax(dist), dist.shape)
    longest = float(dist[i, j]) + pixel_mm
    axis = (hull[j] - hull[i]) / max(dist[i, j], 1e-9)
    perp = np.array([-axis[1], axis[0]])
    along = points_mm @ axis
    across = points_mm @ perp
    bins = np.round(along / pixel_mm).astype(int)
    widest = 0.0
    for b in np.unique(bins):
        sel = across[bins == b]
        widest = max(widest, float(sel.max() - sel.min()))
    return longest, widest + pixel_mm


def bidimensional(enhancing: np.ndarray, affine: np.ndarray) -> dict:
    """Measure each enhancing lesion on its largest axial slice (RAS grid: axis 2 = axial)."""
    spacing = np.sqrt((affine[:3, :3] ** 2).sum(axis=0))
    pixel = float(spacing[:2].mean())
    labeled, n = ndimage.label(enhancing, structure=np.ones((3, 3, 3), bool))
    lesions = []
    for idx in range(1, n + 1):
        comp = labeled == idx
        areas = comp.sum(axis=(0, 1))
        z = int(np.argmax(areas))
        if areas[z] < 4:
            continue
        pts = np.argwhere(comp[:, :, z]).astype(np.float64) * spacing[:2]
        d1, d2 = _diameters(pts, pixel)
        lesions.append({
            "axial_slice": z,
            "longest_mm": round(d1, 1),
            "perpendicular_mm": round(d2, 1),
            "product_mm2": round(d1 * d2, 1),
            "measurable": bool(d1 >= MEASURABLE_MM and d2 >= MEASURABLE_MM),
        })
    lesions.sort(key=lambda l: l["product_mm2"], reverse=True)
    targets = [l for l in lesions if l["measurable"]][:MAX_TARGETS]
    for i, l in enumerate(lesions, 1):
        l["index"] = i
        l["target"] = l in targets
    return {
        "lesions": lesions,
        "target_count": len(targets),
        "sum_of_products_mm2": round(sum(l["product_mm2"] for l in targets), 1),
        "measurable_disease": bool(targets),
    }


def _pct(new: float, old: float) -> float | None:
    return None if not old else round(100.0 * (new - old) / old, 1)


def assess(timeline: list[dict]) -> list[dict]:
    """Add change vs baseline, previous scan and nadir, plus a radiographic category, to each
    timeline entry (sorted by date). Entries need 'enhancing_cm3' and 'spd_mm2'."""
    out = []
    for i, scan in enumerate(timeline):
        entry = dict(scan)
        if i == 0:
            entry.update(category="Baseline", reason="First scan for this patient", changes={})
            out.append(entry)
            continue
        base, prev = timeline[0], timeline[i - 1]
        nadir_vol = min(s["enhancing_cm3"] for s in timeline[:i])
        nadir_spd = min(s["spd_mm2"] for s in timeline[:i])
        ch = {
            "enhancing_vs_baseline_pct": _pct(scan["enhancing_cm3"], base["enhancing_cm3"]),
            "enhancing_vs_previous_pct": _pct(scan["enhancing_cm3"], prev["enhancing_cm3"]),
            "enhancing_vs_nadir_pct": _pct(scan["enhancing_cm3"], nadir_vol),
            "spd_vs_baseline_pct": _pct(scan["spd_mm2"], base["spd_mm2"]),
            "spd_vs_nadir_pct": _pct(scan["spd_mm2"], nadir_spd),
            "total_vs_previous_pct": _pct(scan["total_cm3"], prev["total_cm3"]),
        }
        vol_up = ch["enhancing_vs_nadir_pct"] is not None and ch["enhancing_vs_nadir_pct"] >= 40
        spd_up = ch["spd_vs_nadir_pct"] is not None and ch["spd_vs_nadir_pct"] >= 25
        vol_down = ch["enhancing_vs_baseline_pct"] is not None and ch["enhancing_vs_baseline_pct"] <= -65
        spd_down = ch["spd_vs_baseline_pct"] is not None and ch["spd_vs_baseline_pct"] <= -50
        new_measurable = nadir_spd == 0 and scan["spd_mm2"] > 0
        if scan["enhancing_cm3"] < 0.05 and base["enhancing_cm3"] >= 0.05:
            category, reason = "Complete response (radiographic)", "No enhancing tumour remains"
        elif vol_up or spd_up or new_measurable:
            category = "Progression (radiographic)"
            reason = ("New measurable enhancing disease" if new_measurable else
                      f"Enhancing tumour up {ch['enhancing_vs_nadir_pct']}% in volume / "
                      f"{ch['spd_vs_nadir_pct']}% in SPD versus the smallest earlier scan")
        elif vol_down or spd_down:
            category = "Partial response (radiographic)"
            reason = (f"Enhancing tumour down {ch['enhancing_vs_baseline_pct']}% in volume / "
                      f"{ch['spd_vs_baseline_pct']}% in SPD versus baseline")
        else:
            category, reason = "Stable disease (radiographic)", "Change below the RANO response and progression thresholds"
        entry.update(category=category, reason=reason, changes=ch)
        out.append(entry)
    return out
