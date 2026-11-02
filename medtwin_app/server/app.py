"""MedTwin web server: doctors log in, upload an MRI (NIfTI or DICOM), follow the analysis,
review and correct the result, sign it off, and compare follow-up scans.

Run from the medtwin_app folder (this computer only):
    .venv\\Scripts\\python -m uvicorn server.app:app --port 8000
or for the hospital network: start_network.bat (binds 0.0.0.0, optional HTTPS).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import threading
import time
import uuid
from collections import OrderedDict
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import trimesh  # noqa: E402
from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from medtwin import __version__, config, dicom, fileio, measurements, model, pipeline, report, review  # noqa: E402
from medtwin.inputs import InputError, find_sequences, safe_extract_zip  # noqa: E402
from medtwin.prepare import hd_bet_executable  # noqa: E402
from medtwin.slices import OVERLAYS, PLANES, load_volumes, render_png  # noqa: E402

from . import auth  # noqa: E402
from .jobs import JobStore  # noqa: E402

MESH_NAME_RE = re.compile(r"^[a-z0-9_]+$")
PATIENT_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STUDY_RE = re.compile(r"^[a-f0-9]{12}$")
UPLOAD_FIELDS = ("t1", "t1c", "t2", "flair")
STUDIES_DIR = config.DATA_DIR / "studies"

app = FastAPI(title="MedTwin", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
store = JobStore()
users = auth.UserStore(config.DATA_DIR)
_volume_cache: OrderedDict[str, dict] = OrderedDict()
VOLUME_CACHE_CASES = 4
_edit_locks: dict[str, threading.Lock] = {}

PUBLIC_API = {"/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/setup",
              "/api/auth/forgot", "/api/auth/recover"}
PASSWORD_CHANGE_API = {"/api/auth/me", "/api/auth/password", "/api/auth/logout", "/api/auth/status",
                       "/api/auth/recovery-code"}
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


def _is_local(request: Request) -> bool:
    return (request.client.host if request.client else "") in ("127.0.0.1", "::1", "localhost")


@app.middleware("http")
async def security(request: Request, call_next):
    """Login required for every API call except health, status and login. State-changing calls
    must carry the X-MedTwin header (blocks cross-site request forgery). Adds security headers."""
    path = request.url.path
    request.state.user = None
    if path.startswith("/api/"):
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.headers.get("x-medtwin") != "1":
            return JSONResponse({"detail": "Missing request header."}, status_code=403)
        try:
            user = users.session_user(request.cookies.get(auth.COOKIE))
        except auth.AccountFileError as exc:
            return JSONResponse({"detail": str(exc)}, status_code=503)
        request.state.user = user
        if path not in PUBLIC_API:
            if user is None:
                return JSONResponse({"detail": "Please log in."}, status_code=401)
            if user.get("must_change_password") and path not in PASSWORD_CHANGE_API:
                return JSONResponse({"detail": "Change your password first."}, status_code=403)
    response = await call_next(request)
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    if not path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"   # page, CSS and JS update at once
    return response


@app.exception_handler(auth.AccountFileError)
async def account_file_error(request: Request, exc: auth.AccountFileError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=503)


def _user(request: Request, permission: str = "view") -> dict:
    user = request.state.user
    if not auth.can(user, permission):
        raise HTTPException(403, "Your account is not allowed to do this.")
    return user


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(auth.COOKIE, token, httponly=True, samesite="strict", path="/",
                        secure=request.url.scheme == "https", max_age=auth.SESSION_IDLE_S)


def _job_dir(job_id: str) -> Path:
    try:
        return store.dir(job_id)
    except KeyError:
        raise HTTPException(404, "Unknown job") from None


def _results(job_id: str) -> dict:
    path = _job_dir(job_id) / "results.json"
    if not path.is_file():
        raise HTTPException(409, "The analysis has not finished yet")
    return json.loads(path.read_text(encoding="utf-8"))


def _demo_cases() -> list[str]:
    """Held-out test patients from the model bundle that exist on this machine."""
    disease = config.DISEASE_MODELS["glioma"]
    try:
        bundle = model.load_bundle(disease.bundle_path)
    except FileNotFoundError:
        return []
    return [pid for pid in bundle["split_info"]["test_patients"] if (config.DATASET_DIR / pid).is_dir()]


def _details(age, sex, patient_code, scan_date) -> dict:
    if age is not None and not 0 <= age <= 120:
        raise HTTPException(422, "Age must be between 0 and 120.")
    sex = (sex or "").lower() or None
    if sex not in (None, "female", "male"):
        raise HTTPException(422, "Sex must be female or male.")
    patient_code = (patient_code or "").strip() or None
    if patient_code and not PATIENT_RE.match(patient_code):
        raise HTTPException(422, "Patient code: letters, digits, - and _ only (max 40). Do not use names.")
    scan_date = (scan_date or "").strip() or None
    if scan_date and not DATE_RE.match(scan_date):
        raise HTTPException(422, "Scan date must be YYYY-MM-DD.")
    return {"age": age, "sex": sex, "patient_code": patient_code, "scan_date": scan_date}


# ------------------------------------------------------------------ status

@app.get("/api/health")
def health() -> dict:
    return {
        "version": __version__,
        "device": str(model.select_device()),
        "diseases": [{"key": d.key, "name": d.name, "description": d.description,
                      "regions": [{"key": r.key, "name": r.name, "color": r.color, "label": r.label} for r in d.regions]}
                     for d in config.DISEASE_MODELS.values()],
        "templates": sorted(p.name for p in config.TEMPLATES_DIR.glob("brain*.*")) if config.TEMPLATES_DIR.is_dir() else [],
        "skull_stripping": hd_bet_executable() is not None,
        "disclaimer": config.DISCLAIMER,
    }


@app.get("/api/demo-cases")
def demo_cases() -> dict:
    return {"cases": _demo_cases()}


# ------------------------------------------------------------------ accounts

@app.get("/api/auth/status")
def auth_status(request: Request) -> dict:
    has_users = users.has_users()
    return {"authenticated": request.state.user is not None, "user": request.state.user,
            "setup_required": not has_users, "setup_allowed": not has_users and _is_local(request)}


@app.post("/api/auth/setup")
def auth_setup(request: Request, payload: dict = Body(...)) -> JSONResponse:
    """Create the first administrator. Only possible from this computer, and only once."""
    if users.has_users():
        raise HTTPException(409, "Setup is already done.")
    if not _is_local(request):
        raise HTTPException(403, "The first administrator must be created on the server computer itself.")
    try:
        users.create(str(payload.get("username", "")), str(payload.get("name", "")), "admin",
                     str(payload.get("password", "")), by="setup", must_change=False)
        token, user = users.login(str(payload["username"]), str(payload["password"]), request.client.host)
    except auth.AuthError as exc:
        raise HTTPException(422, str(exc)) from None
    response = JSONResponse({"user": user})
    _set_session_cookie(response, request, token)
    return response


@app.post("/api/auth/login")
def auth_login(request: Request, payload: dict = Body(...)) -> JSONResponse:
    try:
        token, user = users.login(str(payload.get("username", "")), str(payload.get("password", "")),
                                  request.client.host if request.client else "")
    except auth.AuthError as exc:
        raise HTTPException(401, str(exc)) from None
    response = JSONResponse({"user": user})
    _set_session_cookie(response, request, token)
    return response


@app.post("/api/auth/logout")
def auth_logout(request: Request) -> JSONResponse:
    users.logout(request.cookies.get(auth.COOKIE))
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth.COOKIE, path="/")
    return response


@app.get("/api/auth/me")
def auth_me(request: Request) -> dict:
    user = _user(request)
    return {"user": user, "pending_resets": users.pending_resets() if auth.can(user, "manage_users") else 0}


@app.post("/api/auth/forgot")
def auth_forgot(request: Request, payload: dict = Body(...)) -> dict:
    """Ask an administrator for a password reset. Same answer whether or not the user exists."""
    try:
        users.request_reset(str(payload.get("username", "")), request.client.host if request.client else "")
    except auth.AuthError as exc:
        raise HTTPException(429, str(exc)) from None
    return {"message": "If this username exists, the administrators have been asked to reset the password. "
                       "They will check who you are and give you a temporary password."}


@app.post("/api/auth/recover")
def auth_recover(request: Request, payload: dict = Body(...)) -> dict:
    """Self-service reset with a recovery code."""
    try:
        users.reset_with_recovery(str(payload.get("username", "")), str(payload.get("code", "")),
                                  str(payload.get("new_password", "")), request.client.host if request.client else "")
    except auth.AuthError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"message": "Password changed. Sign in with your new password. Your recovery code is used up; "
                       "create a new one after signing in."}


@app.post("/api/auth/recovery-code")
def auth_recovery_code(request: Request, payload: dict = Body(...)) -> dict:
    user = _user(request)
    try:
        code = users.create_recovery_code(user["username"], str(payload.get("password", "")))
    except auth.AuthError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"code": code}


@app.post("/api/auth/password")
def auth_password(request: Request, payload: dict = Body(...)) -> dict:
    user = _user(request)
    try:
        users.change_password(user["username"], str(payload.get("old", "")), str(payload.get("new", "")))
    except auth.AuthError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"user": users.public(users.get(user["username"]))}


@app.get("/api/users")
def list_users(request: Request) -> dict:
    _user(request, "manage_users")
    return {"users": users.list(), "roles": [{"key": r, "label": auth.ROLE_LABELS[r]} for r in auth.ROLES]}


@app.post("/api/users")
def create_user(request: Request, payload: dict = Body(...)) -> dict:
    admin = _user(request, "manage_users")
    try:
        return {"user": users.create(str(payload.get("username", "")), str(payload.get("name", "")),
                                     str(payload.get("role", "")), str(payload.get("password", "")),
                                     by=admin["username"])}
    except auth.AuthError as exc:
        raise HTTPException(422, str(exc)) from None


@app.patch("/api/users/{username}")
def update_user(username: str, request: Request, payload: dict = Body(...)) -> dict:
    admin = _user(request, "manage_users")
    try:
        return {"user": users.update(username, by=admin["username"], role=payload.get("role"),
                                     active=payload.get("active"), name=payload.get("name"),
                                     new_password=payload.get("password") or None)}
    except auth.AuthError as exc:
        raise HTTPException(422, str(exc)) from None


@app.post("/api/users/{username}/reset-password")
def reset_user_password(username: str, request: Request) -> dict:
    """Generated temporary password, shown once to the administrator; the doctor must change it."""
    admin = _user(request, "manage_users")
    try:
        return {"username": username, "temporary_password": users.admin_reset(username, by=admin["username"])}
    except auth.AuthError as exc:
        raise HTTPException(422, str(exc)) from None


@app.get("/api/security-audit")
def security_audit(request: Request) -> dict:
    _user(request, "manage_users")
    if not users.audit_path.is_file():
        return {"entries": []}
    lines = users.audit_path.read_text(encoding="utf-8").splitlines()[-300:]
    return {"entries": [json.loads(line) for line in reversed(lines) if line.strip()]}


# ------------------------------------------------------------------ DICOM studies

STUDY_MAX_AGE_S = 24 * 3600


def _purge_old_studies() -> None:
    """Uploaded studies that were never analysed are deleted after 24 hours."""
    if not STUDIES_DIR.is_dir():
        return
    now = time.time()
    for d in STUDIES_DIR.iterdir():
        if d.is_dir() and now - d.stat().st_mtime > STUDY_MAX_AGE_S:
            shutil.rmtree(d, ignore_errors=True)


@app.post("/api/studies")
async def create_study(request: Request, archive: UploadFile = File(...)) -> dict:
    """Unpack a zip of DICOM files, convert every MR series to NIfTI, suggest T1/T1c/T2/FLAIR,
    and delete the DICOM files (no patient identifiers are kept)."""
    _user(request, "analyse")
    _purge_old_studies()
    study_id = uuid.uuid4().hex[:12]
    study_dir = STUDIES_DIR / study_id
    raw = study_dir / "dicom"
    raw.mkdir(parents=True)
    try:
        zip_path = study_dir / "upload.zip"
        with open(zip_path, "wb") as out:
            shutil.copyfileobj(archive.file, out)
        safe_extract_zip(zip_path, raw)
        zip_path.unlink()
        series = dicom.scan_and_convert(raw, study_dir / "series")
    except InputError as exc:
        shutil.rmtree(study_dir, ignore_errors=True)
        raise HTTPException(422, str(exc)) from None
    except Exception as exc:
        shutil.rmtree(study_dir, ignore_errors=True)
        raise HTTPException(422, f"Could not read the DICOM files: {exc}") from None
    finally:
        dicom.delete_dicom(raw)
    if not series:
        shutil.rmtree(study_dir, ignore_errors=True)
        raise HTTPException(422, "No usable MR series found in the zip (need at least 20 slices per series).")
    info = {"study_id": study_id, "series": dicom.summary(series),
            "study_date": next((s.study_date for s in series if s.study_date), None)}
    (study_dir / "study.json").write_text(json.dumps(info), encoding="utf-8")
    return info


# ------------------------------------------------------------------ jobs

@app.post("/api/jobs")
async def create_job(
    request: Request,
    t1: UploadFile | None = File(None),
    t1c: UploadFile | None = File(None),
    t2: UploadFile | None = File(None),
    flair: UploadFile | None = File(None),
    archive: UploadFile | None = File(None),
    demo_case: str | None = Form(None),
    study_id: str | None = Form(None),
    roles: str | None = Form(None),
    age: int | None = Form(None),
    sex: str | None = Form(None),
    label: str | None = Form(None),
    patient_code: str | None = Form(None),
    scan_date: str | None = Form(None),
) -> dict:
    who = _user(request, "analyse")
    details = _details(age, sex, patient_code, scan_date)
    job_id = store.new_id()
    job_dir = store.dir(job_id)
    input_dir = job_dir / "input"
    input_dir.mkdir(parents=True)
    ground_truth = None
    try:
        if demo_case:
            if demo_case not in _demo_cases():
                raise InputError("Unknown demo case.")
            files, ground_truth = find_sequences(config.DATASET_DIR / demo_case)
            case_label = demo_case
        elif study_id:
            if not STUDY_RE.match(study_id) or not (STUDIES_DIR / study_id / "study.json").is_file():
                raise InputError("Unknown or expired DICOM study; upload it again.")
            study = json.loads((STUDIES_DIR / study_id / "study.json").read_text(encoding="utf-8"))
            chosen = json.loads(roles or "{}")
            by_index = {str(s["index"]): s for s in study["series"]}
            files = {}
            for key in UPLOAD_FIELDS:
                pick = str(chosen.get(key, ""))
                if pick not in by_index:
                    continue
                target = input_dir / f"{key}.nii.gz"
                shutil.copyfile(STUDIES_DIR / study_id / "series" / by_index[pick]["file"], target)
                files[key] = target
            if not details["scan_date"] and study.get("study_date"):
                details["scan_date"] = study["study_date"]
            case_label = (label or "").strip()[:60] or f"DICOM {job_id[:6]}"
        else:
            uploads = {k: f for k, f in zip(UPLOAD_FIELDS, (t1, t1c, t2, flair)) if f is not None and f.filename}
            if archive is not None and archive.filename:
                zip_path = input_dir / "upload.zip"
                with open(zip_path, "wb") as out:
                    shutil.copyfileobj(archive.file, out)
                safe_extract_zip(zip_path, input_dir / "unzipped")
                zip_path.unlink()
                files, _ = find_sequences(input_dir / "unzipped")
            elif uploads:
                files = {}
                for key, upload in uploads.items():
                    name = Path(upload.filename).name
                    suffix = ".nii.gz" if name.lower().endswith(".nii.gz") else Path(name).suffix
                    if suffix.lower() not in (".nii", ".nii.gz"):
                        raise InputError(f"{config.MODALITY_LABELS[key]}: please upload a .nii or .nii.gz file.")
                    target = input_dir / f"{key}{suffix}"
                    with open(target, "wb") as out:
                        shutil.copyfileobj(upload.file, out)
                    files[key] = target
            else:
                raise InputError("Upload the four MRI sequences, a zip, a DICOM study, or pick a demo case.")
            case_label = (label or "").strip()[:60] or f"Upload {job_id[:6]}"
        missing = [config.MODALITY_LABELS[k] for k in config.MODALITY_KEYS if k not in files]
        if missing:
            raise InputError(f"Missing sequence(s): {', '.join(missing)}. All four are needed: T1, T1 contrast, T2, FLAIR.")
    except (InputError, json.JSONDecodeError) as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(422, str(exc)) from None
    if study_id:
        shutil.rmtree(STUDIES_DIR / study_id, ignore_errors=True)   # the job keeps its own copy
    return store.submit(job_id, files, details, case_label, ground_truth, created_by=auth.actor(who))


@app.get("/api/jobs")
def list_jobs(request: Request) -> dict:
    _user(request)
    return {"jobs": store.list(limit=50)}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, request: Request) -> dict:
    _user(request)
    job_dir = _job_dir(job_id)
    try:
        job = store.read(job_id)
    except KeyError:
        raise HTTPException(404, "Unknown job") from None
    results_path = job_dir / "results.json"
    if job["status"] == "done" and results_path.is_file():
        job["results"] = json.loads(results_path.read_text(encoding="utf-8"))
    return job


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str, request: Request) -> dict:
    admin = _user(request, "delete")
    job_dir = _job_dir(job_id)
    try:
        label = store.read(job_id).get("case_label")
        store.delete(job_id)
    except KeyError:
        raise HTTPException(404, "Unknown job") from None
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from None
    _volume_cache.pop(job_id, None)
    users.log("case_deleted", job=job_id, case_label=label, by=admin["username"])
    return {"deleted": job_id, "path": str(job_dir)}


# ------------------------------------------------------------------ review

def _lock(job_id: str) -> threading.Lock:
    return _edit_locks.setdefault(job_id, threading.Lock())


def _check_revision(job_dir: Path, payload: dict) -> None:
    """Stop a doctor from overwriting a colleague's newer correction or sign-off."""
    seen = payload.get("revision")
    current = pipeline.read_review(job_dir)
    if seen is not None and int(seen) != int(current.get("revision", 0)):
        who = review.read_audit(job_dir)[-1].get("actor", {}).get("name", "a colleague")
        raise HTTPException(409, f"This case was changed by {who} while you were working. "
                                 "Reload it to see the latest version; your unsaved strokes are kept.")


@app.post("/api/jobs/{job_id}/edits")
def save_edits(job_id: str, request: Request, payload: dict = Body(...)) -> dict:
    """Apply the clinician's brush strokes, recompute volumes, meshes and report."""
    who = auth.actor(_user(request, "review"))
    job_dir = _job_dir(job_id)
    strokes = payload.get("strokes") or []
    if not strokes:
        raise HTTPException(422, "No corrections to save.")
    with _lock(job_id):
        _results(job_id)
        _check_revision(job_dir, payload)
        vols = load_volumes(job_dir / "volumes.npz")
        allowed = {r.label for d in config.DISEASE_MODELS.values() for r in d.regions}
        try:
            labels, changes = review.apply_strokes(vols["labels"], vols["brain_mask"].astype(bool), strokes, allowed)
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(422, f"Invalid correction: {exc}") from None
        state = pipeline.read_review(job_dir)
        was_signed = state["status"] in ("approved", "rejected")
        state.update(revision=state.get("revision", 0) + 1, status="pending", signed_by=None, signed_role=None,
                     signed_at=None, comment=None)
        pipeline.write_review(job_dir, state)
        review.audit(job_dir, "correction", who, revision=state["revision"], voxels_changed=changes,
                     strokes=len(strokes), reopened_sign_off=was_signed)
        _volume_cache.pop(job_id, None)
        return pipeline.rebuild(job_dir, labels)


@app.post("/api/jobs/{job_id}/revert")
def revert_edits(job_id: str, request: Request, payload: dict = Body(...)) -> dict:
    """Go back to the original AI outline."""
    who = auth.actor(_user(request, "review"))
    job_dir = _job_dir(job_id)
    with _lock(job_id):
        _results(job_id)
        _check_revision(job_dir, payload)
        vols = load_volumes(job_dir / "volumes.npz")
        state = pipeline.read_review(job_dir)
        state.update(revision=state.get("revision", 0) + 1, status="pending", signed_by=None, signed_role=None,
                     signed_at=None, comment=None)
        pipeline.write_review(job_dir, state)
        review.audit(job_dir, "revert_to_ai", who, revision=state["revision"])
        _volume_cache.pop(job_id, None)
        return pipeline.rebuild(job_dir, vols["labels_ai"])


@app.post("/api/jobs/{job_id}/review")
def sign_off(job_id: str, request: Request, payload: dict = Body(...)) -> dict:
    """decision: approve | reject | reopen. Approval signs the current revision."""
    who = auth.actor(_user(request, "review"))
    job_dir = _job_dir(job_id)
    decision = payload.get("decision")
    if decision not in ("approve", "reject", "reopen"):
        raise HTTPException(422, "decision must be approve, reject or reopen")
    comment = (str(payload.get("comment") or "").strip()[:1000]) or None
    if decision == "reject" and not comment:
        raise HTTPException(422, "Please give a reason for rejecting.")
    with _lock(job_id):
        results = _results(job_id)
        _check_revision(job_dir, payload)
        state = pipeline.read_review(job_dir)
        if decision == "reopen":
            state.update(status="pending", signed_by=None, signed_role=None, signed_at=None, comment=comment)
        else:
            state.update(status="approved" if decision == "approve" else "rejected", signed_by=who["name"],
                         signed_role=who["role"], signed_at=review.now(), comment=comment)
        pipeline.write_review(job_dir, state)
        review.audit(job_dir, decision, who, revision=state.get("revision", 0), comment=comment)
        results["review"] = state
        fileio.write_text(job_dir / "results.json", json.dumps(results, indent=2))
        vols = load_volumes(job_dir / "volumes.npz")
        fileio.write_text(job_dir / "report.html", report.build_report(results, vols))
        return results


@app.get("/api/jobs/{job_id}/audit")
def get_audit(job_id: str, request: Request) -> dict:
    _user(request)
    return {"entries": review.read_audit(_job_dir(job_id))}


# ------------------------------------------------------------------ files

@app.get("/api/jobs/{job_id}/meshes/{name}.glb")
def get_mesh(job_id: str, name: str, request: Request) -> FileResponse:
    _user(request)
    if not MESH_NAME_RE.match(name):
        raise HTTPException(404, "Unknown mesh")
    path = _job_dir(job_id) / "meshes" / f"{name}.glb"
    if not path.is_file():
        raise HTTPException(404, "Unknown mesh")
    return FileResponse(path, media_type="model/gltf-binary", headers={"Cache-Control": "no-cache"})


@app.get("/api/jobs/{job_id}/download/{name}.{fmt}")
def download_mesh(job_id: str, name: str, fmt: str, request: Request) -> Response:
    """Mesh as STL or OBJ for 3D printing / Blender (viewer frame, millimetres)."""
    _user(request)
    if fmt not in ("stl", "obj") or not MESH_NAME_RE.match(name):
        raise HTTPException(404, "Unknown file")
    path = _job_dir(job_id) / "meshes" / f"{name}.glb"
    if not path.is_file():
        raise HTTPException(404, "Unknown mesh")
    mesh = trimesh.load(path, force="mesh")
    data = mesh.export(file_type=fmt)
    data = data.encode() if isinstance(data, str) else data
    return Response(data, media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{name}.{fmt}"'})


@app.get("/api/jobs/{job_id}/slice")
def get_slice(
    job_id: str,
    request: Request,
    plane: str = Query("axial"),
    index: int = Query(0, ge=0),
    channel: str = Query("flair"),
    overlay: str = Query("prediction"),
) -> Response:
    _user(request)
    if plane not in PLANES or channel not in config.MODALITY_KEYS or overlay not in OVERLAYS:
        raise HTTPException(422, "Bad slice request")
    job_dir = _job_dir(job_id)
    if job_id in _volume_cache:
        _volume_cache.move_to_end(job_id)
    else:
        path = job_dir / "volumes.npz"
        if not path.is_file():
            raise HTTPException(404, "Slices are not ready")
        _volume_cache[job_id] = load_volumes(path)
        while len(_volume_cache) > VOLUME_CACHE_CASES:   # several doctors, several open cases
            _volume_cache.popitem(last=False)
    colours = {r.label: r.color for d in config.DISEASE_MODELS.values() for r in d.regions}
    png = render_png(_volume_cache[job_id], plane, index, channel, colours, overlay)
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/jobs/{job_id}/report", response_class=HTMLResponse)
def get_report(job_id: str, request: Request) -> HTMLResponse:
    _user(request)
    path = _job_dir(job_id) / "report.html"
    if not path.is_file():
        raise HTTPException(404, "Report is not ready")
    return HTMLResponse(path.read_text(encoding="utf-8"), headers={"Cache-Control": "no-cache"})


# ------------------------------------------------------------------ patients / follow-up

def _all_results() -> list[tuple[str, dict]]:
    out = []
    for path in config.JOBS_DIR.glob("*/results.json"):
        if store.dir_ok(path.parent.name):
            try:
                out.append((path.parent.name, json.loads(path.read_text(encoding="utf-8"))))
            except (OSError, json.JSONDecodeError):
                continue
    return out


@app.get("/api/patients")
def list_patients(request: Request) -> dict:
    _user(request)
    groups: dict[str, list] = {}
    for job_id, r in _all_results():
        if r.get("patient_code"):
            groups.setdefault(r["patient_code"], []).append(r.get("scan_date") or "")
    return {"patients": sorted(({"code": c, "scans": len(d), "latest": max(d)} for c, d in groups.items()),
                               key=lambda p: p["latest"], reverse=True)}


@app.get("/api/patients/{code}")
def patient_timeline(code: str, request: Request) -> dict:
    _user(request)
    if not PATIENT_RE.match(code):
        raise HTTPException(404, "Unknown patient")
    scans = []
    for job_id, r in _all_results():
        if r.get("patient_code") != code:
            continue
        disease = r["diseases"][0]
        regions = {reg["key"]: reg["volume_cm3"] for reg in disease["regions"]}
        scans.append({
            "job_id": job_id,
            "scan_date": r.get("scan_date") or r["created_at"][:10],
            "case_label": r["case_label"],
            "regions": regions,
            "enhancing_cm3": regions.get("enhancing_tumor", 0.0),
            "total_cm3": disease["total_volume_cm3"],
            "spd_mm2": (disease.get("rano") or {}).get("sum_of_products_mm2", 0.0),
            "review_status": r.get("review", {}).get("status", "pending"),
        })
    if not scans:
        raise HTTPException(404, "Unknown patient")
    scans.sort(key=lambda s: (s["scan_date"], s["job_id"]))
    return {"code": code, "scans": measurements.assess(scans), "note": measurements.__doc__.split("\n\n")[-1].strip()}


app.mount("/", StaticFiles(directory=config.WEB_DIR, html=True), name="web")
