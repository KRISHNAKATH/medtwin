"""In-process job queue: one worker thread, so only one scan uses the GPU at a time.
Job state is mirrored to data/jobs/<id>/job.json so finished jobs survive restarts."""
from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from medtwin import config, fileio, pipeline, review
from medtwin.inputs import InputError

JOB_ID_RE = re.compile(r"^[a-f0-9]{12}$")


class JobStore:
    def __init__(self, root: Path = config.JOBS_DIR):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="medtwin-worker")
        self._recover()

    # ---------------------------------------------------------------- state
    def new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    @staticmethod
    def dir_ok(job_id: str) -> bool:
        return bool(JOB_ID_RE.match(job_id))

    def dir(self, job_id: str) -> Path:
        if not JOB_ID_RE.match(job_id):
            raise KeyError(job_id)
        return self.root / job_id

    def read(self, job_id: str) -> dict:
        path = self.dir(job_id) / "job.json"
        if not path.is_file():
            raise KeyError(job_id)
        with self._lock:
            return json.loads(path.read_text(encoding="utf-8"))

    def _write(self, job_id: str, job: dict) -> None:
        fileio.write_text(self.dir(job_id) / "job.json", json.dumps(job, indent=2))

    def _update(self, job_id: str, **changes) -> dict:
        with self._lock:
            path = self.dir(job_id) / "job.json"
            job = json.loads(path.read_text(encoding="utf-8"))
            job.update(changes)
            self._write(job_id, job)
            return job

    def list(self, limit: int = 20) -> list[dict]:
        jobs = []
        for path in self.root.glob("*/job.json"):
            if JOB_ID_RE.match(path.parent.name):
                try:
                    job = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                jobs.append({k: job.get(k) for k in ("id", "status", "case_label", "created_at", "error")}
                            | {"created_by": (job.get("created_by") or {}).get("name")})
        return sorted(jobs, key=lambda j: j["created_at"] or "", reverse=True)[:limit]

    def delete(self, job_id: str) -> None:
        job = self.read(job_id)
        if job["status"] in ("queued", "running"):
            raise RuntimeError("Job is still running")
        shutil.rmtree(self.dir(job_id))

    def _recover(self) -> None:
        for path in self.root.glob("*/job.json"):
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if job.get("status") in ("queued", "running"):
                job.update(status="failed", error="The server stopped while this scan was being analysed. Please run it again.")
                self._write(path.parent.name, job)

    # ---------------------------------------------------------------- run
    def submit(self, job_id: str, files: dict[str, Path], details: dict, case_label: str,
               ground_truth: Path | None, created_by: dict | None = None) -> dict:
        job = {
            "id": job_id,
            "status": "queued",
            "case_label": case_label,
            "created_at": dt.datetime.now().isoformat(timespec="seconds"),
            "created_by": created_by,
            "details": details,
            "steps": [{"key": k, "label": label, "state": "pending"} for k, label in pipeline.STEPS],
            "error": None,
        }
        with self._lock:
            self._write(job_id, job)
        if created_by:
            review.audit(self.dir(job_id), "upload", created_by, case_label=case_label)
        self._executor.submit(self._run, job_id, files, details, case_label, ground_truth)
        return job

    def _progress(self, job_id: str, step: str, state: str) -> None:
        """Progress display only: a failed write here must never stop the analysis."""
        try:
            with self._lock:
                path = self.dir(job_id) / "job.json"
                job = json.loads(path.read_text(encoding="utf-8"))
                for s in job["steps"]:
                    if s["key"] == step:
                        s["state"] = state
                self._write(job_id, job)
        except OSError:
            pass

    def _run(self, job_id: str, files, details, case_label, ground_truth) -> None:
        self._update(job_id, status="running", started_at=dt.datetime.now().isoformat(timespec="seconds"))
        try:
            pipeline.run(self.dir(job_id), files, details=details, case_label=case_label,
                         ground_truth=ground_truth, progress=lambda s, st: self._progress(job_id, s, st))
        except InputError as exc:
            self._fail(job_id, str(exc))
        except Exception as exc:  # surface any failure to the user instead of hanging
            (self.dir(job_id) / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
            self._fail(job_id, f"Analysis failed: {exc}")
        else:
            self._update(job_id, status="done", finished_at=dt.datetime.now().isoformat(timespec="seconds"))

    def _fail(self, job_id: str, message: str) -> None:
        with self._lock:
            path = self.dir(job_id) / "job.json"
            job = json.loads(path.read_text(encoding="utf-8"))
            for s in job["steps"]:
                if s["state"] == "running":
                    s["state"] = "failed"
            job.update(status="failed", error=message, finished_at=dt.datetime.now().isoformat(timespec="seconds"))
            self._write(job_id, job)
