"""Surface meshes from label masks, and export for the web viewer.

Meshes are built in RAS millimetres. For the browser they are centred on the brain
and rotated into glTF's Y-up frame: viewer (x, y, z) = (-R, S, A). That is a proper
rotation (no mirroring), so the default front camera sees the face, and the
patient's left appears on the viewer's right, as when facing a person.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh
from scipy import ndimage
from skimage.measure import marching_cubes

from .analysis import voxel_to_mm

RAS_TO_VIEWER = np.array([[-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]])


def mask_to_mesh(mask: np.ndarray, affine: np.ndarray, sigma: float = 0.6, level: float = 0.5) -> trimesh.Trimesh | None:
    """Marching cubes on a lightly blurred binary mask, vertices in RAS mm.
    The blur only softens voxel steps for display; volumes are always taken from voxels."""
    if not mask.any():
        return None
    field = np.pad(mask.astype(np.float32), 1)
    if sigma > 0:
        field = ndimage.gaussian_filter(field, sigma)
    if field.max() <= level:
        return None
    verts, faces, _, _ = marching_cubes(field, level=level, allow_degenerate=False)
    verts -= 1.0
    mesh = trimesh.Trimesh(voxel_to_mm(verts, affine), faces, process=True)
    if mesh.volume < 0:
        mesh.invert()
    return mesh


def smooth(mesh: trimesh.Trimesh, iterations: int = 10) -> trimesh.Trimesh:
    """Taubin smoothing: removes voxel staircase without shrinking the surface."""
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=iterations)
    return mesh


def decimate(mesh: trimesh.Trimesh, max_faces: int) -> trimesh.Trimesh:
    if len(mesh.faces) <= max_faces:
        return mesh
    try:
        return mesh.simplify_quadric_decimation(face_count=max_faces)
    except Exception:  # decimation is an optimisation only
        return mesh


def to_viewer_frame(mesh: trimesh.Trimesh, centre_mm: np.ndarray) -> trimesh.Trimesh:
    out = mesh.copy()
    out.vertices = (np.asarray(mesh.vertices) - centre_mm) @ RAS_TO_VIEWER.T
    return out


def hex_to_rgba(color: str, alpha: float = 1.0) -> list[float]:
    color = color.lstrip("#")
    return [int(color[i:i + 2], 16) / 255.0 for i in (0, 2, 4)] + [alpha]


def export_glb(mesh: trimesh.Trimesh, path: Path, color: str | None = None) -> dict:
    """Write a single-mesh GLB. With ``color`` it gets a PBR base colour (so it opens
    correctly in Blender or any glTF viewer); without, existing vertex colours are kept."""
    mesh = mesh.copy()
    if color is not None:
        try:
            material = trimesh.visual.material.PBRMaterial(
                baseColorFactor=hex_to_rgba(color), metallicFactor=0.0, roughnessFactor=0.6
            )
            mesh.visual = trimesh.visual.TextureVisuals(material=material)
        except Exception:
            pass
    path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(path, file_type="glb")
    return {"file": path.name, "vertices": int(len(mesh.vertices)), "faces": int(len(mesh.faces)),
            "bytes": path.stat().st_size}
