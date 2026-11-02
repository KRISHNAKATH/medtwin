"""Doctor accounts, sessions and permissions.

Roles
    admin        manage accounts, delete cases, plus everything a radiologist can do
    radiologist  upload and analyse, correct outlines, approve / reject / reopen
    clinician    upload and analyse, view results and reports (read-only review)

Passwords are stored as PBKDF2-SHA256 hashes (260,000 iterations, per-user salt). Sessions are
random tokens held in memory and sent as an HttpOnly, SameSite=Strict cookie; they end after
12 hours without activity or when the server restarts. Five wrong passwords lock an account
name for 5 minutes. Security events go to data/security_audit.jsonl.

Forgotten passwords (no email needed):
    recovery code   each doctor may create a one-time code (shown once, stored hashed) and use it
                    with their username to set a new password themselves
    ask an admin    a request flags the account for administrators, who verify the doctor and
                    issue a generated temporary password that must be changed at sign-in
    server console  scripts/reset_password.py resets any account on the server computer, so a
                    lone administrator can never be locked out for good
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from medtwin import fileio

ROLES = ("admin", "radiologist", "clinician")
PERMISSIONS = {
    "admin": {"view", "analyse", "review", "manage_users", "delete"},
    "radiologist": {"view", "analyse", "review"},
    "clinician": {"view", "analyse"},
}
ROLE_LABELS = {"admin": "Administrator", "radiologist": "Radiologist", "clinician": "Clinician"}
USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")
MIN_PASSWORD = 10
ITERATIONS = 260_000
SESSION_IDLE_S = 12 * 3600
LOCK_AFTER = 5
LOCK_S = 300
COOKIE = "medtwin_session"
RESET_REQUESTS_PER_HOUR = 5          # per client address, for the public "forgot password" form
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O, 1/I: easy to read and type
TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


class AuthError(ValueError):
    """Message is safe to show to the user."""


def hash_password(password: str, salt: bytes | None = None, iterations: int = ITERATIONS) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations))
    return hmac.compare_digest(digest.hex(), digest_hex)


def generate_temporary_password() -> str:
    """Readable one-time password such as 'kq7m-r2xh-9tfd' (always letters and digits)."""
    while True:
        raw = "".join(secrets.choice(TEMP_ALPHABET) for _ in range(12))
        if any(c.isdigit() for c in raw) and any(c.isalpha() for c in raw):
            return "-".join(raw[i:i + 4] for i in (0, 4, 8))


def generate_recovery_code() -> str:
    """20 characters from a 32-letter alphabet (100 bits), as XXXXX-XXXXX-XXXXX-XXXXX."""
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(20))
    return "-".join(raw[i:i + 5] for i in range(0, 20, 5))


def normalise_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", code.upper())


def check_password_rules(password: str, username: str = "") -> None:
    if len(password) < MIN_PASSWORD:
        raise AuthError(f"Password must be at least {MIN_PASSWORD} characters.")
    if username and username.lower() in password.lower():
        raise AuthError("Password must not contain the username.")
    if password.isdigit() or password.isalpha():
        raise AuthError("Use letters and numbers (or other characters) in the password.")


@dataclass
class Session:
    token: str
    username: str
    last_seen: float


class AccountFileError(RuntimeError):
    """users.json is unreadable and no good backup exists; shown to the administrator."""


def _read_json(path: Path) -> dict | None:
    """Parsed account file, or None when missing, empty or damaged."""
    try:
        text = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    if not text:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


class UserStore:
    """Accounts in a JSON file (with a last-good backup); sessions in memory."""

    def __init__(self, data_dir: Path):
        self.path = data_dir / "users.json"
        self.backup = data_dir / "users.json.bak"
        self.audit_path = data_dir / "security_audit.jsonl"
        data_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}
        self._failures: dict[str, list[float]] = {}
        self._reset_requests: dict[str, list[float]] = {}

    # ------------------------------------------------------------ storage
    def _load(self) -> dict[str, dict]:
        """Accounts from users.json. If that file is empty or damaged, the last good backup is
        restored automatically (the damaged copy is kept). With neither, an empty or missing file
        means 'no accounts yet'; a damaged file without backup stops sign-in with a clear message."""
        data = _read_json(self.path)
        if data is not None:
            return data
        exists = self.path.is_file()
        damaged = exists and bool(self.path.read_text(encoding="utf-8", errors="replace").strip())
        backup = _read_json(self.backup)
        if backup is not None and exists:
            if damaged:
                stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
                self.path.replace(self.path.with_name(f"users.json.damaged-{stamp}"))
            fileio.write_text(self.path, json.dumps(backup, indent=2))
            self.log("users_file_restored_from_backup", reason="damaged" if damaged else "empty")
            return backup
        if damaged:
            raise AccountFileError(
                "The account file data/users.json is damaged and there is no backup. Restore it from a "
                "copy, or rename it and create the administrator again on the server computer.")
        return {}

    def archive_all(self, by: str) -> Path | None:
        """Start over: move every account (and the backup) into data/account_archive/, so the
        first-time setup screen appears again. Nothing is destroyed; cases and logs are kept."""
        with self._lock:
            files = [p for p in (self.path, self.backup) if p.is_file()]
            if not files:
                return None
            count = len(_read_json(self.path) or _read_json(self.backup) or {})
            folder = self.path.parent / "account_archive"
            folder.mkdir(exist_ok=True)
            stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
            archived = folder / f"users-{stamp}.json"
            for p in files:
                fileio.replace(p, folder / f"{p.name.replace('users.json', f'users-{stamp}.json')}")
            self._sessions.clear()
            self._failures.clear()
        self.log("all_accounts_archived", by=by, accounts=count, archive=archived.name)
        return archived

    def _save(self, users: dict[str, dict]) -> None:
        current = _read_json(self.path)
        if current is not None:                      # keep the last good version
            fileio.write_text(self.backup, json.dumps(current, indent=2))
        fileio.write_text(self.path, json.dumps(users, indent=2))

    def log(self, event: str, **details) -> None:
        entry = {"time": dt.datetime.now().isoformat(timespec="seconds"), "event": event, **details}
        with open(self.audit_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    @staticmethod
    def public(user: dict) -> dict:
        return {k: user.get(k) for k in ("username", "name", "role", "active", "created_at", "last_login",
                                         "must_change_password", "reset_requested_at")} | {
            "role_label": ROLE_LABELS.get(user.get("role"), user.get("role")),
            "permissions": sorted(PERMISSIONS.get(user.get("role"), set())),
            "has_recovery_code": bool(user.get("recovery_hash")),
        }

    # ------------------------------------------------------------ accounts
    def has_users(self) -> bool:
        return bool(self._load())

    def list(self) -> list[dict]:
        return [self.public(u) for u in sorted(self._load().values(), key=lambda u: u["username"])]

    def get(self, username: str) -> dict | None:
        return self._load().get(username)

    def create(self, username: str, name: str, role: str, password: str, by: str,
               must_change: bool = True) -> dict:
        username = username.strip().lower()
        name = name.strip()[:80]
        if not USERNAME_RE.match(username):
            raise AuthError("Username: 3–32 lower-case letters, digits, '.', '_' or '-'.")
        if not name:
            raise AuthError("Enter the doctor's full name.")
        if role not in ROLES:
            raise AuthError("Role must be admin, radiologist or clinician.")
        check_password_rules(password, username)
        with self._lock:
            users = self._load()
            if username in users:
                raise AuthError("That username already exists.")
            users[username] = {
                "username": username, "name": name, "role": role, "active": True,
                "password": hash_password(password), "must_change_password": must_change,
                "created_at": dt.datetime.now().isoformat(timespec="seconds"), "created_by": by, "last_login": None,
            }
            self._save(users)
        self.log("user_created", username=username, role=role, by=by)
        return self.public(users[username])

    def update(self, username: str, by: str, role: str | None = None, active: bool | None = None,
               name: str | None = None, new_password: str | None = None) -> dict:
        with self._lock:
            users = self._load()
            user = users.get(username)
            if user is None:
                raise AuthError("Unknown user.")
            if role is not None:
                if role not in ROLES:
                    raise AuthError("Unknown role.")
                user["role"] = role
            if active is not None:
                user["active"] = bool(active)
            if name:
                user["name"] = name.strip()[:80]
            if new_password:
                check_password_rules(new_password, username)
                user["password"] = hash_password(new_password)
                user["must_change_password"] = True
                user["reset_requested_at"] = None
            admins = [u for u in users.values() if u["role"] == "admin" and u["active"]]
            if not admins:
                raise AuthError("At least one active administrator must remain.")
            self._save(users)
        if active is False or new_password or role is not None:
            self.end_sessions(username)
        self.log("user_updated", username=username, by=by, role=role, active=active, password_reset=bool(new_password))
        return self.public(user)

    def change_password(self, username: str, old: str, new: str) -> None:
        with self._lock:
            users = self._load()
            user = users.get(username)
            if user is None or not verify_password(old, user["password"]):
                raise AuthError("Current password is wrong.")
            if old == new:
                raise AuthError("Choose a new password, different from the current one.")
            check_password_rules(new, username)
            user["password"] = hash_password(new)
            user["must_change_password"] = False
            user["reset_requested_at"] = None
            self._save(users)
        self.log("password_changed", username=username)

    # ------------------------------------------------------------ forgotten passwords
    def _check_lock(self, username: str, now: float) -> None:
        """Caller holds the lock. Shared by sign-in and recovery-code attempts."""
        recent = [t for t in self._failures.get(username, []) if now - t < LOCK_S]
        self._failures[username] = recent
        if len(recent) >= LOCK_AFTER:
            raise AuthError("Too many wrong attempts. Try again in 5 minutes.")

    def request_reset(self, username: str, client: str) -> None:
        """'Forgot password' without a recovery code: flag the account for administrators.
        Always succeeds silently, so the form never reveals which usernames exist."""
        username = username.strip().lower()
        now = time.time()
        with self._lock:
            recent = [t for t in self._reset_requests.get(client, []) if now - t < 3600]
            if len(recent) >= RESET_REQUESTS_PER_HOUR:
                raise AuthError("Too many requests from this computer. Ask an administrator directly.")
            self._reset_requests[client] = recent + [now]
            users = self._load()
            user = users.get(username)
            if user is None or not user.get("active"):
                self.log("reset_request_unknown", username=username, client=client)
                return
            if not user.get("reset_requested_at"):
                user["reset_requested_at"] = dt.datetime.now().isoformat(timespec="seconds")
                self._save(users)
        self.log("reset_requested", username=username, client=client)

    def pending_resets(self) -> int:
        return sum(1 for u in self._load().values() if u.get("reset_requested_at") and u.get("active"))

    def admin_reset(self, username: str, by: str) -> str:
        """Issue a generated temporary password; clears lock-outs and any pending request."""
        temporary = generate_temporary_password()
        with self._lock:
            users = self._load()
            user = users.get(username)
            if user is None:
                raise AuthError("Unknown user.")
            user["password"] = hash_password(temporary)
            user["must_change_password"] = True
            user["reset_requested_at"] = None
            self._failures.pop(username, None)
            self._save(users)
        self.end_sessions(username)
        self.log("password_reset_by_admin", username=username, by=by)
        return temporary

    def create_recovery_code(self, username: str, password: str) -> str:
        """New one-time recovery code for the signed-in doctor (replaces any older one)."""
        code = generate_recovery_code()
        with self._lock:
            users = self._load()
            user = users.get(username)
            if user is None or not verify_password(password, user["password"]):
                raise AuthError("Current password is wrong.")
            user["recovery_hash"] = hash_password(normalise_code(code))
            user["recovery_created_at"] = dt.datetime.now().isoformat(timespec="seconds")
            self._save(users)
        self.log("recovery_code_created", username=username)
        return code

    def reset_with_recovery(self, username: str, code: str, new_password: str, client: str) -> None:
        """Self-service reset: username + recovery code + new password. The code is used up."""
        username = username.strip().lower()
        now = time.time()
        with self._lock:
            self._check_lock(username, now)
            users = self._load()
            user = users.get(username)
            ok = (user is not None and user.get("active") and user.get("recovery_hash")
                  and verify_password(normalise_code(code), user["recovery_hash"]))
            if not ok:
                self._failures[username].append(now)
                self.log("recovery_failed", username=username, client=client)
                raise AuthError("Username or recovery code is wrong.")
            check_password_rules(new_password, username)
            user["password"] = hash_password(new_password)
            user["must_change_password"] = False
            user["recovery_hash"] = None
            user["reset_requested_at"] = None
            self._failures.pop(username, None)
            self._save(users)
        self.end_sessions(username)
        self.log("password_reset_with_recovery_code", username=username, client=client)

    # ------------------------------------------------------------ sessions
    def login(self, username: str, password: str, client: str) -> tuple[str, dict]:
        username = username.strip().lower()
        now = time.time()
        with self._lock:
            self._check_lock(username, now)
            users = self._load()
            user = users.get(username)
            ok = user is not None and user.get("active") and verify_password(password, user["password"])
            if not ok:
                self._failures[username].append(now)
                self.log("login_failed", username=username, client=client)
                raise AuthError("Wrong username or password.")
            self._failures.pop(username, None)
            user["last_login"] = dt.datetime.now().isoformat(timespec="seconds")
            self._save(users)
            token = secrets.token_urlsafe(32)
            self._sessions[token] = Session(token, username, now)
        self.log("login", username=username, client=client)
        return token, self.public(user)

    def session_user(self, token: str | None) -> dict | None:
        if not token:
            return None
        with self._lock:
            sess = self._sessions.get(token)
            if sess is None:
                return None
            if time.time() - sess.last_seen > SESSION_IDLE_S:
                self._sessions.pop(token, None)
                return None
            sess.last_seen = time.time()
            user = self._load().get(sess.username)
        if user is None or not user.get("active"):
            return None
        return self.public(user)

    def logout(self, token: str | None) -> None:
        with self._lock:
            sess = self._sessions.pop(token or "", None)
        if sess:
            self.log("logout", username=sess.username)

    def end_sessions(self, username: str) -> None:
        with self._lock:
            for token in [t for t, s in self._sessions.items() if s.username == username]:
                self._sessions.pop(token, None)


def can(user: dict | None, permission: str) -> bool:
    return bool(user) and permission in PERMISSIONS.get(user.get("role"), set())


def actor(user: dict) -> dict:
    """How a user appears in case audit trails and sign-offs."""
    return {"username": user["username"], "name": user["name"], "role": user["role_label"]}
