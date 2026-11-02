"""Self-contained, printable HTML report (use the browser's Print -> Save as PDF)."""
from __future__ import annotations

import base64
import html

from . import config
from .slices import render_png

e = html.escape


def _img(png: bytes) -> str:
    return f'<img src="data:image/png;base64,{base64.b64encode(png).decode()}" alt="">'


def _fmt(value, suffix="", digits=None) -> str:
    if value is None:
        return "–"
    if digits is not None:
        value = f"{value:.{digits}f}"
    return f"{value}{suffix}"


def _review_block(rv: dict) -> str:
    status = rv.get("status", "pending")
    if status == "approved":
        head = (f"<strong>Reviewed and approved</strong> by {e(rv.get('signed_by') or '')}"
                f" ({e(rv.get('signed_role') or '')}) on {e((rv.get('signed_at') or '').replace('T', ' '))}")
        cls = "ok"
    elif status == "rejected":
        head = (f"<strong>Rejected by the reviewer</strong>: {e(rv.get('signed_by') or '')} on "
                f"{e((rv.get('signed_at') or '').replace('T', ' '))}. Do not use these results.")
        cls = "bad"
    else:
        head = "<strong>Not yet reviewed.</strong> AI output only; a radiologist must review and sign off."
        cls = "pend"
    edited = ("Outline corrected by the clinician (revision "
              f"{rv.get('revision', 0)})." if rv.get("edited") else "Outline as produced by the AI (no corrections).")
    comment = f"<br>Comment: {e(rv['comment'])}" if rv.get("comment") else ""
    return f'<div class="rv {cls}">{head}<br>{edited}{comment}</div>'


def build_report(results: dict, volumes: dict) -> str:
    details = results.get("details", {})
    brain = results["brain"]
    rv = results.get("review", {})
    rows, lesion_rows, gt_rows, rano_rows, snapshots = [], [], [], [], []
    for disease in results["diseases"]:
        colours = {r["label"]: r["color"] for r in disease["regions"]}
        for r in disease["regions"]:
            loc = r.get("location", {})
            ai = ""
            if rv.get("edited") and r.get("ai_volume_cm3") is not None and abs(r["ai_volume_cm3"] - r["volume_cm3"]) > 1e-3:
                ai = f" <span class='m'>(AI {r['ai_volume_cm3']:.2f})</span>"
            rows.append(
                f"<tr><td>{e(disease['name'])}</td>"
                f"<td><span class='sw' style='background:{r['color']}'></span>{e(r['name'])}</td>"
                f"<td class='n'>{r['volume_cm3']:.2f}{ai}</td><td class='n'>{_fmt(r['percent_of_brain'], '%')}</td>"
                f"<td class='n'>{_fmt(r.get('confidence_pct'), '%')}</td>"
                f"<td>{e(loc.get('description', 'not detected'))}</td></tr>"
            )
            if "ground_truth" in r:
                g = r["ground_truth"]
                gt_rows.append(
                    f"<tr><td>{e(r['name'])}</td><td class='n'>{r['volume_cm3']:.2f}</td>"
                    f"<td class='n'>{g['volume_cm3']:.2f}</td><td class='n'>{_fmt(g['volume_difference_pct'], '%')}</td>"
                    f"<td class='n'>{_fmt(g['dice'])}</td></tr>"
                )
        for les in disease["lesions"]:
            lesion_rows.append(
                f"<tr><td>{e(disease['name'])} #{les['index']}</td><td class='n'>{les['volume_cm3']:.2f}</td>"
                f"<td class='n'>{les['extent_mm'][0]:.0f} × {les['extent_mm'][1]:.0f} × {les['extent_mm'][2]:.0f}</td>"
                f"<td>{e(les['description'])}</td></tr>"
            )
        rano = disease.get("rano")
        if rano:
            for l in rano["lesions"][:6]:
                rano_rows.append(
                    f"<tr><td>{l['index']}{' (target)' if l['target'] else ''}</td><td class='n'>{l['longest_mm']:.1f}</td>"
                    f"<td class='n'>{l['perpendicular_mm']:.1f}</td><td class='n'>{l['product_mm2']:.0f}</td>"
                    f"<td>{'yes' if l['measurable'] else 'no (under 10 mm)'}</td><td class='n'>{l['axial_slice']}</td></tr>"
                )
        if disease["detected"]:
            cx, cy, cz = (int(round(v)) for v in disease["location"]["centroid_voxel"])
            for plane, idx in (("axial", cz), ("coronal", cy), ("sagittal", cx)):
                png = render_png(volumes, plane, idx, "flair", colours)
                snapshots.append(f"<figure>{_img(png)}<figcaption>{plane.title()} · FLAIR · slice {idx}</figcaption></figure>")

    rano_block = ""
    rano = next((d.get("rano") for d in results["diseases"] if d.get("rano")), None)
    if rano is not None:
        rano_block = (
            "<h2>Bidimensional measurements (enhancing tumour, RANO method)</h2>"
            + (f"<p>Sum of products of perpendicular diameters (SPD) of {rano['target_count']} target lesion(s): "
               f"<strong>{rano['sum_of_products_mm2']:.0f} mm²</strong>.</p>" if rano["measurable_disease"]
               else "<p>No measurable enhancing lesion (both diameters ≥ 10 mm).</p>")
            + ("<table><tr><th>Lesion</th><th>Longest mm</th><th>Perpendicular mm</th><th>Product mm²</th>"
               "<th>Measurable</th><th>Axial slice</th></tr>" + "".join(rano_rows) + "</table>" if rano_rows else "")
        )
    gt_block = ""
    if gt_rows:
        gt_block = (
            "<h2>Check against expert ground truth</h2>"
            "<table><tr><th>Region</th><th>Result cm³</th><th>Ground truth cm³</th><th>Difference</th><th>Dice</th></tr>"
            + "".join(gt_rows) + "</table>"
        )
    warnings = "".join(f"<li>{e(w)}</li>" for w in results.get("warnings", []))
    prep = results.get("input_info", {}).get("preparation", {})
    prep_text = []
    if prep:
        prep_text.append("sequences already aligned" if prep.get("already_aligned") else "sequences rigidly co-registered to T1 contrast")
        prep_text.append("already skull-stripped" if prep.get("already_skull_stripped") else "skull removed with HD-BET")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MedTwin report · {e(results['case_label'])}</title>
<style>
body{{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2430;margin:32px auto;max-width:900px;padding:0 16px}}
h1{{font-size:22px;margin:0 0 4px}}h2{{font-size:16px;margin:28px 0 8px}}
.meta,.m{{color:#5b6576}}table{{border-collapse:collapse;width:100%}}
th,td{{border-bottom:1px solid #e3e6ec;padding:6px 8px;text-align:left;vertical-align:top}}
th{{font-weight:600;background:#f5f6f9}}td.n{{text-align:right;font-variant-numeric:tabular-nums}}
.sw{{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}}
.disc{{border:1px solid #f0c36d;background:#fff8e6;padding:10px 12px;border-radius:6px;margin:16px 0}}
.rv{{padding:10px 12px;border-radius:6px;margin:12px 0;border:1px solid}}
.rv.ok{{background:#eafaf1;border-color:#7fd1a4}}.rv.bad{{background:#fdecee;border-color:#f08b97}}.rv.pend{{background:#eef2fb;border-color:#a9bbe6}}
.shots{{display:flex;gap:12px;flex-wrap:wrap}}figure{{margin:0}}figure img{{width:270px;border-radius:6px;background:#000}}
figcaption{{font-size:12px;color:#5b6576}}@media print{{.noprint{{display:none}}}}
</style></head><body>
<button class="noprint" onclick="window.print()" style="float:right">Print / Save as PDF</button>
<h1>Brain MRI analysis report</h1>
<div class="meta">Case {e(results['case_label'])} · patient code {e(results.get('patient_code') or '–')} ·
scan date {e(results.get('scan_date') or '–')} · age {e(str(details.get('age') or '–'))} · sex {e(details.get('sex') or '–')}<br>
Generated {e((results.get('updated_at') or results['created_at']).replace('T', ' '))}</div>
<div class="disc"><strong>AI decision support.</strong> {e(config.DISCLAIMER)}</div>
{_review_block(rv)}
<h2>Findings</h2>
<table><tr><th>Disease</th><th>Region</th><th>Volume cm³</th><th>% of brain</th><th>Model confidence</th><th>Location</th></tr>{''.join(rows)}</table>
<p class="meta">Brain volume {brain['volume_cm3']:.0f} cm³ (non-zero scan region). Locations compare each region's centre with the brain's centre.
Model confidence is the model's average certainty inside the region.</p>
{rano_block}
<h2>Separate lesions</h2>
<table><tr><th>Lesion</th><th>Volume cm³</th><th>Size R–L × A–P × S–I (mm)</th><th>Location</th></tr>{''.join(lesion_rows) or '<tr><td colspan=4>None detected</td></tr>'}</table>
{gt_block}
<h2>Slices through the main lesion</h2><div class="shots">{''.join(snapshots) or '<p>No lesion detected.</p>'}</div>
<h2>Inputs and method</h2>
<ul>{''.join(f"<li>{e(config.MODALITY_LABELS.get(k, k))}: {e(v)}</li>" for k, v in results['inputs'].items())}</ul>
<p class="meta">Preparation: {e(', '.join(prep_text) or '–')}. Model: {e(results['model']['description'])}
Device: {e(results['model']['device'])}. 3D brain: {e(results['brain']['surface_source_label'])}.</p>
{f'<h2>Warnings</h2><ul>{warnings}</ul>' if warnings else ''}
</body></html>"""
