# MedTwin web app

Upload a brain MRI (DICOM or NIfTI), get glioma segmented and measured, review and correct the
result, sign it off, follow the patient over time, and explore a realistic 3D brain in the
patient's own shape with each lesion colour-coded.

This file is for developers. See also the full project report, [../README.md](../README.md),
and the step-by-step guide for users, [../USER_MANUAL.md](../USER_MANUAL.md).

> AI decision support for qualified clinicians. Measurements must be verified on the source images
> by a radiologist. Not yet validated or approved for clinical decisions.

The app reuses the model trained in the notebooks (`../outputs/model_bundle/model_bundle.json`
and `../outputs/checkpoints/best_model.pth`). The notebooks are not modified.

## Start

**Hospital network:** double-click `start_network.bat`. It creates or renews `certs/medtwin.crt` +
`.key` (self-signed, covering this computer's name and current addresses; replace with a hospital
certificate if available), prints the addresses for doctors, and runs HTTPS on `0.0.0.0:8443`.
Allow the port once in an Administrator Command Prompt:

```bat
netsh advfirewall firewall add rule name="MedTwin" dir=in action=allow protocol=TCP localport=8443 profile=domain,private
```

The same by hand in Command Prompt, from this folder:

```bat
.venv\Scripts\python scripts\network_setup.py
```

```bat
.venv\Scripts\python -m uvicorn server.app:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs\medtwin.key --ssl-certfile certs\medtwin.crt
```

**This computer only:** double-click `start.bat`, or:

```bat
.venv\Scripts\python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
```

Always use `.venv\Scripts\python`: the system `python` lacks scikit-image, trimesh and HD-BET.
The full step-by-step guide with common errors is in the project README, section
[Quick start](../README.md#quick-start-run-medtwin-from-command-prompt).

First start takes about 20 s while PyTorch loads. Restart the server after changing Python code.
The first administrator is created in the browser on the server computer (`/api/auth/setup` only
accepts requests from 127.0.0.1 and only while no account exists).

## Accounts and security (`server/auth.py`)

- Roles: `admin` (manage users, delete cases, review), `radiologist` (analyse, correct, sign),
  `clinician` (analyse, view).
- Accounts in `data/users.json` (PBKDF2-SHA256, 260,000 iterations, per-user salt) with a
  last-good backup `users.json.bak`; an empty or damaged file is repaired from the backup (damaged
  copy kept as `users.json.damaged-<time>`). Security events in `data/security_audit.jsonl`.
- Forgotten passwords: recovery codes (20 characters, 100 bits, hashed, one use), administrator
  resets with generated temporary passwords, and `scripts/reset_password.py <username>` on the
  server computer (`--list` shows usernames, `--activate` re-enables an account, `--reset-all`
  moves every account to `data/account_archive/` so first-time setup appears again).
- Tests set `MEDTWIN_DATA_DIR` to a temporary folder (`tests/conftest.py`), so they never touch
  real accounts or cases.
- Sessions: in-memory random tokens, cookie `medtwin_session` (HttpOnly, SameSite=Strict, Secure
  on HTTPS), 12 h idle timeout; lockout after 5 failures for 5 min.
- Middleware: every `/api/*` route except health, auth status, login and setup requires a session;
  POST/PATCH/DELETE require header `X-MedTwin: 1`; security headers on all responses; OpenAPI docs off.
- Edits, revert and sign-off take `revision`; a mismatch returns 409 so a colleague's newer work is
  never overwritten.
- State files are written atomically with retries (`medtwin/fileio.py`) because Windows refuses to
  replace a file that antivirus or another reader briefly holds open.

## Set-up notes

- `.venv` is created with `--system-site-packages`, so it reuses the system PyTorch, MONAI and
  SimpleITK. Extras installed into it: scikit-image, trimesh, fast-simplification, hd-bet (with
  nnU-Net). NumPy is pinned to 1.26.4 in the venv because the system OpenCV and TensorFlow (pulled
  in by MONAI's optional imports) are built for NumPy 1.x.
- HD-BET weights (114.7 MB, CC BY-NC 4.0) live in `%USERPROFILE%\hd-bet_params\release_2.0.0`.
  HD-BET runs in its own process; it uses the GPU only with 4 GB or more (a 2 GB MX550 took 12
  minutes), otherwise the CPU (about 5 minutes on this laptop).
- fsaverage pial surfaces (TemplateFlow, FreeSurfer licence) live in `assets/templates/fsaverage/`.

## How a case is processed

| Step | Module | What happens |
| --- | --- | --- |
| DICOM import | `medtwin/dicom.py` | Series found recursively; roles suggested from description, TR/TE/TI and contrast agent; converted to NIfTI; DICOM deleted; patient tags never read |
| Check | `medtwin/inputs.py` | Four readable 3D sequences |
| Align + strip skull | `medtwin/prepare.py` | Rigid Mattes-MI registration to T1c at 1 mm; skull detected when visible tissue exceeds 2,100 cm³; HD-BET mask applied to all sequences |
| Preprocess, segment | `medtwin/model.py` | Phase 2 preprocessing from the bundle; sliding window 96³; label map + confidence (winning-class probability) |
| Brain | `medtwin/anatomy.py` | Exact surface from the scan; fsaverage warped to it (scale, ICP on gyral crowns, crown displacements spread over the mesh); cerebellum from the scan |
| Measure | `medtwin/analysis.py`, `medtwin/measurements.py` | Volumes, location vs brain centre in RAS mm, lesions, confidence, RANO diameters and SPD, sanity warnings |
| Meshes, report | `medtwin/meshing.py`, `medtwin/report.py` | Marching cubes → Taubin → decimate → GLB in a Y-up frame; printable HTML report |
| Review | `medtwin/review.py`, `pipeline.rebuild` | Brush strokes in slice-pixel coordinates → voxels; measure, meshes and report rebuilt in about 3 s; append-only `audit.jsonl` |

Files per case in `data/jobs/<id>/`: `input/`, `prepared/`, `volumes.npz` (display volumes,
current and AI labels, confidence, brain mask, affine), `results.json`, `review.json`,
`audit.jsonl`, `meshes/*.glb`, `report.html`.

Command-line runs:

```bash
.venv\Scripts\python scripts\run_case.py ..\Dataset\ASNR-MICCAI-BraTS2023-GLI-Challenge-TrainingData\BraTS-GLI-00449-000 --ground-truth
```

```bash
.venv\Scripts\python scripts\make_test_dicom.py ..\Dataset\ASNR-MICCAI-BraTS2023-GLI-Challenge-TrainingData\BraTS-GLI-00403-000 test_study.zip
```

The second builds a synthetic hospital-style DICOM study (skull, noise, tilted 3 mm FLAIR, fake
patient name) for testing the DICOM path.

## API

All routes except health and the auth status/login/setup routes require a signed-in session.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/status` | Signed in?, user, whether first-time setup is needed/allowed |
| POST | `/api/auth/setup` | First administrator (local only, once) |
| POST | `/api/auth/login`, `/api/auth/logout` | JSON `{username, password}` → session cookie |
| GET | `/api/auth/me` | Current user with permissions |
| POST | `/api/auth/password` | JSON `{old, new}` |
| POST | `/api/auth/forgot` | Public. JSON `{username}` → flags the account for administrators; same answer for unknown names; 5 per hour per client |
| POST | `/api/auth/recover` | Public. JSON `{username, code, new_password}` → self-service reset with a recovery code (code used up; failures count toward the lockout) |
| POST | `/api/auth/recovery-code` | JSON `{password}` → new one-time recovery code, shown once |
| POST | `/api/users/{username}/reset-password` | Admin. Generated temporary password, shown once; clears the request and the lockout |
| GET / POST | `/api/users` | List accounts / add `{username, name, role, password}` (admin) |
| PATCH | `/api/users/{username}` | `{role?, active?, name?, password?}` (admin; password = reset) |
| GET | `/api/security-audit` | Last 300 security events (admin) |
| GET | `/api/health` | Device, disease models (regions, colours, labels), templates, skull stripping available |
| GET | `/api/demo-cases` | Held-out test patients on this machine |
| POST | `/api/studies` | Multipart `archive` (DICOM zip) → `study_id`, series with suggested roles and thumbnails, study date |
| POST | `/api/jobs` | Multipart: `t1`/`t1c`/`t2`/`flair`, or `archive`, or `demo_case`, or `study_id` + `roles` (JSON `{"t1": "<series index>", …}`); optional `patient_code`, `scan_date`, `age`, `sex`, `label` |
| GET | `/api/jobs` | Recent cases |
| GET | `/api/jobs/{id}` | Status, step progress, then results |
| DELETE | `/api/jobs/{id}` | Delete the case's files |
| POST | `/api/jobs/{id}/edits` | JSON `{revision, strokes: [{plane, index, label, radius, points: [[col, row], …]}]}` → rebuilt results (radiologist/admin) |
| POST | `/api/jobs/{id}/revert` | JSON `{revision}` → back to the AI outline (radiologist/admin) |
| POST | `/api/jobs/{id}/review` | JSON `{revision, decision: approve \| reject \| reopen, comment}` (radiologist/admin) |
| GET | `/api/jobs/{id}/audit` | Audit trail entries |
| GET | `/api/jobs/{id}/meshes/{name}.glb` | 3D meshes |
| GET | `/api/jobs/{id}/download/{name}.stl` | Mesh as STL (or `.obj`) |
| GET | `/api/jobs/{id}/slice?plane=&index=&channel=&overlay=` | Slice PNG; overlay `prediction`, `ai`, `confidence`, `ground_truth`, `none` |
| GET | `/api/jobs/{id}/report` | Printable report |
| GET | `/api/patients` | Patient codes with scan counts |
| GET | `/api/patients/{code}` | Timeline with changes and RANO-based categories |

## Adding another disease

Train a model the same way as Phase 2, save its bundle, and add a `DiseaseModel` entry with its
regions and colours to `DISEASE_MODELS` in `medtwin/config.py`. Give each disease distinct label
values; the combined label map, overlays, editing and report use them.

## Brain templates

Your own standard brain (STL, OBJ, PLY or GLB, RAS millimetres) in `assets/templates/` overrides
fsaverage. Age and sex pick the most specific file: `brain_<child|adult|older>_<female|male>`,
`brain_<agegroup>`, `brain_<sex>`, `brain`.

## Tests

```bash
.venv\Scripts\python -m pytest tests -q
```

62 tests: localisation, volumes, file and DICOM series recognition, slice orientation, 3D frame,
brush mapping in all planes, RANO diameters and categories, skull detection, accounts and
permissions through the real API, password recovery (codes, admin resets, server console),
account-file backup and repair, and a regression on BraTS-GLI-00449-000.

## Layout

```
medtwin/        pipeline package (config, dicom, inputs, prepare, model, analysis, measurements,
                anatomy, meshing, slices, review, report, pipeline)
server/         FastAPI app, accounts and sessions (auth.py), single-worker job queue
certs/          HTTPS certificate for network mode (created by start_network.bat)
web/            page, styles, Three.js viewer and slice viewer with brush (no build step)
scripts/        command-line runner, synthetic DICOM generator, network/certificate setup
tests/          unit, clinical and regression tests
assets/         brain templates
data/           studies (temporary) and jobs
```

## Limits

- Glioma only.
- Local accounts only (no hospital single sign-on); sessions end when the server restarts.
- No DICOM SEG / structured-report export to PACS yet.
- HD-BET weights are non-commercial (CC BY-NC 4.0).
- The realistic cortex is a fitted template; folds are approximate.
