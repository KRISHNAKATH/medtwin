"""Brain surfaces for the 3D view.

Two surfaces are built per patient, both in the patient's own RAS millimetres:

1. Exact (from the scan). Brain tissue = brain mask minus CSF-like voxels. This
   follows the patient's true outline, but clinical and BraTS scans are too coarse
   to show cortical folds, so it looks smooth.

2. Realistic (fitted template). A standard folded cortex (FreeSurfer fsaverage
   pial surface, or your own brain STL/OBJ in assets/templates/) is warped onto the
   patient's brain:
     a. scale and place it on the patient's brain bounding box,
     b. ICP (rigid + uniform scale) on the template's outer envelope,
     c. non-rigid warp: displacements measured only at gyral crowns are spread
        over the whole mesh, so the folds survive while the outline follows
        the patient.
   fsaverage has no cerebellum or brainstem; those come from the exact surface.
   Age and sex choose the template file when several are provided.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.filters import threshold_multiotsu

from . import config
from .analysis import largest_component
from .meshing import mask_to_mesh, smooth

TEMPLATE_EXTENSIONS = (".stl", ".obj", ".ply", ".glb")
FSAVERAGE_DIR = config.TEMPLATES_DIR / "fsaverage"
FSAVERAGE_FILES = ("tpl-fsaverage_hemi-L_den-41k_pial.surf.gii", "tpl-fsaverage_hemi-R_den-41k_pial.surf.gii")

# Colour ramp from gyral crown (light) to sulcal fundus (dark), sRGB.
CROWN_RGB = np.array([240, 200, 186], dtype=np.float64)
FUNDUS_RGB = np.array([156, 92, 88], dtype=np.float64)


# ------------------------------------------------------------ exact surface

def tissue_mask(image: np.ndarray, modality_order: tuple[str, ...], brain_mask: np.ndarray,
                lesion_mask: np.ndarray) -> np.ndarray:
    order = list(modality_order)
    t1 = image[order.index("t1")]
    t2 = image[order.index("t2")]
    t1_thr = threshold_multiotsu(t1[brain_mask], classes=3)
    t2_thr = threshold_multiotsu(t2[brain_mask], classes=3)
    csf = brain_mask & (t2 > t2_thr[1]) & (t1 <= t1_thr[1])
    tissue = (brain_mask & ~csf) | lesion_mask   # never carve the lesion out of the brain
    tissue = largest_component(tissue)
    return ndimage.binary_fill_holes(tissue)


def patient_brain_surface(image: np.ndarray, modality_order: tuple[str, ...], brain_mask: np.ndarray,
                          lesion_mask: np.ndarray, affine: np.ndarray) -> trimesh.Trimesh:
    tissue = tissue_mask(image, modality_order, brain_mask, lesion_mask)
    mesh = mask_to_mesh(tissue, affine, sigma=0.5)
    smooth(mesh, iterations=8)
    return mesh


# ------------------------------------------------------------ shading

def convexity(mesh: trimesh.Trimesh, iterations: int = 40) -> np.ndarray:
    """Signed distance (mm) of each vertex from a heavily smoothed copy along its normal:
    positive on gyral crowns, negative in sulci (like FreeSurfer's 'sulc')."""
    smoothed = mesh.copy()
    trimesh.smoothing.filter_laplacian(smoothed, lamb=0.6, iterations=iterations, volume_constraint=True)
    offset = np.asarray(mesh.vertices) - np.asarray(smoothed.vertices)
    return np.einsum("ij,ij->i", offset, np.asarray(mesh.vertex_normals))


def convexity_colours(values: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(values, [4, 96])
    t = np.clip((hi - values) / max(hi - lo, 1e-6), 0.0, 1.0) ** 1.1
    rgb = CROWN_RGB * (1 - t[:, None]) + FUNDUS_RGB * t[:, None]
    return np.c_[rgb, np.full(len(rgb), 255.0)].astype(np.uint8)


def paint(mesh: trimesh.Trimesh, values: np.ndarray | None = None) -> trimesh.Trimesh:
    values = convexity(mesh) if values is None else values
    mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=convexity_colours(values))
    return mesh


# ------------------------------------------------------------ templates

@dataclass
class Template:
    name: str
    mesh: trimesh.Trimesh
    outer_weight: np.ndarray   # 1 on the lateral surface, 0 on the medial wall
    convexity: np.ndarray      # per-vertex fold shading, computed on the original template
    cerebrum_only: bool


def age_group(age: int | None) -> str | None:
    if age is None:
        return None
    if age < 18:
        return "child"
    return "adult" if age < 65 else "older"


def select_template(details: dict, templates_dir: Path = config.TEMPLATES_DIR) -> Path | None:
    """Your own files win, most specific first: brain_<agegroup>_<sex>, brain_<agegroup>,
    brain_<sex>, brain (.stl/.obj/.ply/.glb). Otherwise the bundled fsaverage cortex."""
    if not templates_dir.is_dir():
        return None
    group = age_group(details.get("age"))
    sex = (details.get("sex") or "").lower() or None
    stems = [f"brain_{group}_{sex}" if group and sex else None,
             f"brain_{group}" if group else None,
             f"brain_{sex}" if sex else None,
             "brain"]
    for stem in filter(None, stems):
        for ext in TEMPLATE_EXTENSIONS:
            path = templates_dir / f"{stem}{ext}"
            if path.is_file():
                return path
    fsavg = templates_dir / "fsaverage"
    if all((fsavg / name).is_file() for name in FSAVERAGE_FILES):
        return fsavg
    return None


_template_cache: dict[Path, Template] = {}


def load_template(path: Path) -> Template:
    if path in _template_cache:
        return _template_cache[path]
    if path.is_dir():  # fsaverage: two pial hemispheres in GIfTI
        parts = []
        for name in FSAVERAGE_FILES:
            verts, faces = nib.load(str(path / name)).agg_data(("pointset", "triangle"))
            parts.append(trimesh.Trimesh(np.asarray(verts, np.float64), np.asarray(faces), process=False))
        mesh = trimesh.util.concatenate(parts)
        x = np.asarray(mesh.vertices)[:, 0]
        outer = np.clip((np.abs(x) - 10.0) / 12.0, 0.0, 1.0)  # medial wall sits near x = 0
        template = Template("FreeSurfer fsaverage pial surface", mesh, outer, convexity(mesh), cerebrum_only=True)
    else:
        mesh = trimesh.load(path, force="mesh", process=True)
        if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
            raise ValueError(f"Template {path.name} has no triangle mesh")
        template = Template(path.name, mesh, np.ones(len(mesh.vertices)), convexity(mesh), cerebrum_only=False)
    _template_cache[path] = template
    return template


def _spread(values: np.ndarray, weights: np.ndarray, laplacian, rounds: int) -> np.ndarray:
    """Normalised smoothing: propagate weighted samples over the mesh graph."""
    num = values * weights[:, None]
    den = weights.astype(np.float64)
    for _ in range(rounds):
        num = laplacian.dot(num)
        den = laplacian.dot(den)
    return num / np.maximum(den, 1e-6)[:, None]


def fit_template(template: Template, target: trimesh.Trimesh, rounds: int = 60,
                 seed: int = 0) -> tuple[trimesh.Trimesh, dict]:
    fitted = template.mesh.copy()
    v = np.asarray(fitted.vertices, np.float64).copy()
    t_lo, t_hi = v.min(axis=0), v.max(axis=0)
    p_lo, p_hi = target.bounds
    scale = (p_hi - p_lo) / np.maximum(t_hi - t_lo, 1e-9)
    if template.cerebrum_only:
        # The patient's brain also spans the cerebellum, so only left-right and front-back
        # extents are comparable; height uses their mean and the tops are aligned.
        scale[2] = (scale[0] + scale[1]) / 2
        anchor_t = np.array([(t_lo[0] + t_hi[0]) / 2, (t_lo[1] + t_hi[1]) / 2, t_hi[2]])
        anchor_p = np.array([(p_lo[0] + p_hi[0]) / 2, (p_lo[1] + p_hi[1]) / 2, p_hi[2]])
    else:
        anchor_t, anchor_p = (t_lo + t_hi) / 2, (p_lo + p_hi) / 2
    v = (v - anchor_t) * scale + anchor_p
    height = (t_hi[2] - t_lo[2]) * scale[2]

    crowns = (template.outer_weight > 0.5) & (template.convexity > np.percentile(template.convexity, 55))
    target_pts = np.asarray(target.vertices)
    z_cut = p_hi[2] - 0.7 * height if template.cerebrum_only else -np.inf
    rng = np.random.default_rng(seed)
    src_idx = np.flatnonzero(crowns & (v[:, 2] > z_cut))
    src_idx = rng.choice(src_idx, size=min(5000, len(src_idx)), replace=False)
    matrix, _, icp_cost = trimesh.registration.icp(
        v[src_idx], target_pts[target_pts[:, 2] > z_cut], max_iterations=50, scale=True, reflection=False
    )
    v = trimesh.transform_points(v, matrix)

    tree = cKDTree(target_pts)
    dist_before, nearest = tree.query(v)
    displacement = target_pts[nearest] - v
    weights = (crowns & (dist_before < 15.0)).astype(np.float64)
    fitted.vertices = v
    laplacian = trimesh.smoothing.laplacian_calculation(fitted, equal_weight=True)
    v = v + _spread(displacement, weights, laplacian, rounds)
    fitted.vertices = v
    dist_after, _ = tree.query(v[crowns])
    paint(fitted, template.convexity)
    return fitted, {
        "template": template.name,
        "axis_scale": [round(float(s), 3) for s in scale],
        "icp_cost_mm": round(float(icp_cost), 2),
        "crown_distance_before_mm": round(float(dist_before[crowns].mean()), 2),
        "crown_distance_after_mm": round(float(dist_after.mean()), 2),
    }


def lower_brain_patch(exact: trimesh.Trimesh, fitted: trimesh.Trimesh, gap_mm: float = 4.0) -> trimesh.Trimesh | None:
    """Cerebellum and brainstem for a cerebrum-only template: the part of the exact
    surface that lies below the fitted cortex and away from it."""
    lo, hi = fitted.bounds
    cut = lo[2] + 0.45 * (hi[2] - lo[2])
    dist, _ = cKDTree(np.asarray(fitted.vertices)).query(exact.vertices)
    keep_vertex = (dist > gap_mm) & (np.asarray(exact.vertices)[:, 2] < cut)
    keep_face = keep_vertex[exact.faces].all(axis=1)
    if keep_face.sum() < 100:
        return None
    patch = exact.submesh([np.flatnonzero(keep_face)], append=True)
    pieces = patch.split(only_watertight=False)
    return max(pieces, key=lambda p: len(p.faces)) if len(pieces) else patch
