"""Accounts, sessions and permissions, through the real API with a temporary user store.
Test accounts and passwords below exist only inside each test's temporary folder."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.app as server_app  # noqa: E402
from server import auth  # noqa: E402
from server.jobs import JobStore  # noqa: E402

H = {"X-MedTwin": "1"}
ADMIN_PW = "Strong-test-pass-1"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server_app, "users", auth.UserStore(tmp_path))
    monkeypatch.setattr(server_app, "store", JobStore(tmp_path / "jobs"))
    monkeypatch.setattr(server_app, "_is_local", lambda request: True)
    return TestClient(server_app.app)


def setup_admin(c: TestClient) -> None:
    r = c.post("/api/auth/setup", json={"username": "admin", "name": "Dr Admin", "password": ADMIN_PW}, headers=H)
    assert r.status_code == 200, r.text


def add_user(c: TestClient, username: str, role: str, password: str = "Temp-pass-123") -> None:
    r = c.post("/api/users", json={"username": username, "name": f"Dr {username}", "role": role, "password": password}, headers=H)
    assert r.status_code == 200, r.text


def login(c: TestClient, username: str, password: str) -> dict:
    r = c.post("/api/auth/login", json={"username": username, "password": password}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["user"]


def test_password_hashing():
    stored = auth.hash_password("Correct-horse-1")
    assert stored.startswith("pbkdf2_sha256$") and "Correct-horse-1" not in stored
    assert auth.verify_password("Correct-horse-1", stored)
    assert not auth.verify_password("wrong-password-1", stored)


def test_api_requires_login(client):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/jobs").status_code == 401
    assert client.get("/api/patients").status_code == 401
    assert client.get("/api/jobs/abcdef123456/report").status_code == 401


def test_first_setup_once_then_login(client):
    status = client.get("/api/auth/status").json()
    assert status["setup_required"] and status["setup_allowed"]
    setup_admin(client)
    assert client.get("/api/jobs").status_code == 200          # signed in by setup
    again = client.post("/api/auth/setup", json={"username": "x2", "name": "X", "password": ADMIN_PW}, headers=H)
    assert again.status_code == 409


def test_state_changes_need_header(client):
    setup_admin(client)
    r = client.post("/api/auth/logout", json={})               # no X-MedTwin header
    assert r.status_code == 403


def test_new_doctor_must_change_password(client):
    setup_admin(client)
    add_user(client, "rad1", "radiologist")
    client.post("/api/auth/logout", json={}, headers=H)
    user = login(client, "rad1", "Temp-pass-123")
    assert user["must_change_password"]
    assert client.get("/api/jobs").status_code == 403           # blocked until changed
    r = client.post("/api/auth/password", json={"old": "Temp-pass-123", "new": "My-own-pass-42"}, headers=H)
    assert r.status_code == 200 and not r.json()["user"]["must_change_password"]
    assert client.get("/api/jobs").status_code == 200


def test_roles(client):
    setup_admin(client)
    add_user(client, "clin1", "clinician")
    client.post("/api/auth/logout", json={}, headers=H)
    login(client, "clin1", "Temp-pass-123")
    client.post("/api/auth/password", json={"old": "Temp-pass-123", "new": "Clinic-pass-77"}, headers=H)
    assert client.get("/api/jobs").status_code == 200           # can view
    assert client.get("/api/users").status_code == 403          # cannot manage accounts
    r = client.post("/api/jobs/abcdef123456/review", json={"decision": "approve"}, headers=H)
    assert r.status_code == 403                                  # cannot sign off
    assert client.delete("/api/jobs/abcdef123456", headers=H).status_code == 403


def test_lockout_after_wrong_passwords(client):
    setup_admin(client)
    client.post("/api/auth/logout", json={}, headers=H)
    for _ in range(auth.LOCK_AFTER):
        assert client.post("/api/auth/login", json={"username": "admin", "password": "nope-nope-1"}, headers=H).status_code == 401
    r = client.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW}, headers=H)
    assert r.status_code == 401 and "Too many" in r.json()["detail"]


def test_deactivation_ends_sessions_and_last_admin_kept(client):
    setup_admin(client)
    add_user(client, "rad2", "radiologist")
    other = TestClient(server_app.app)
    login(other, "rad2", "Temp-pass-123")
    r = client.patch("/api/users/rad2", json={"active": False}, headers=H)
    assert r.status_code == 200
    assert other.get("/api/auth/me").status_code == 401         # signed out at once
    r = client.patch("/api/users/admin", json={"active": False}, headers=H)
    assert r.status_code == 422                                  # last admin cannot be removed


def test_forgot_password_request_reaches_admins_without_revealing_accounts(client):
    setup_admin(client)
    add_user(client, "rad4", "radiologist")
    anon = TestClient(server_app.app)
    real = anon.post("/api/auth/forgot", json={"username": "rad4"}, headers=H)
    fake = anon.post("/api/auth/forgot", json={"username": "nobody"}, headers=H)
    assert real.status_code == fake.status_code == 200
    assert real.json() == fake.json()                            # no hint whether the account exists
    assert client.get("/api/auth/me").json()["pending_resets"] == 1
    listed = {u["username"]: u for u in client.get("/api/users").json()["users"]}
    assert listed["rad4"]["reset_requested_at"]


def test_admin_reset_issues_temporary_password(client):
    setup_admin(client)
    add_user(client, "rad5", "radiologist")
    TestClient(server_app.app).post("/api/auth/forgot", json={"username": "rad5"}, headers=H)
    r = client.post("/api/users/rad5/reset-password", json={}, headers=H)
    temp = r.json()["temporary_password"]
    auth.check_password_rules(temp, "rad5")                      # generated password meets the rules
    assert client.get("/api/auth/me").json()["pending_resets"] == 0
    doctor = TestClient(server_app.app)
    assert login(doctor, "rad5", temp)["must_change_password"]
    clin = TestClient(server_app.app)
    add_user(client, "clin5", "clinician")
    login(clin, "clin5", "Temp-pass-123")
    assert clin.post("/api/users/rad5/reset-password", json={}, headers=H).status_code == 403


def test_recovery_code_self_service(client):
    setup_admin(client)
    add_user(client, "rad6", "radiologist")
    doctor = TestClient(server_app.app)
    login(doctor, "rad6", "Temp-pass-123")
    doctor.post("/api/auth/password", json={"old": "Temp-pass-123", "new": "Own-pass-2468"}, headers=H)
    assert doctor.post("/api/auth/recovery-code", json={"password": "wrong-pass-1"}, headers=H).status_code == 422
    code = doctor.post("/api/auth/recovery-code", json={"password": "Own-pass-2468"}, headers=H).json()["code"]
    assert len(auth.normalise_code(code)) == 20

    anon = TestClient(server_app.app)
    bad = anon.post("/api/auth/recover", json={"username": "rad6", "code": "AAAAA-BBBBB-CCCCC-DDDDD", "new_password": "New-pass-1357"}, headers=H)
    assert bad.status_code == 422
    ok = anon.post("/api/auth/recover", json={"username": "rad6", "code": code.lower(), "new_password": "New-pass-1357"}, headers=H)
    assert ok.status_code == 200
    assert doctor.get("/api/auth/me").status_code == 401         # old sessions ended
    assert not login(anon, "rad6", "New-pass-1357")["must_change_password"]
    again = TestClient(server_app.app).post("/api/auth/recover", json={"username": "rad6", "code": code, "new_password": "Other-pass-97531"}, headers=H)
    assert again.status_code == 422                              # code used up


def test_recovery_code_attempts_lock(client):
    setup_admin(client)
    anon = TestClient(server_app.app)
    for _ in range(auth.LOCK_AFTER):
        anon.post("/api/auth/recover", json={"username": "admin", "code": "AAAAA-BBBBB-CCCCC-DDDDD", "new_password": "New-pass-1357"}, headers=H)
    r = anon.post("/api/auth/recover", json={"username": "admin", "code": "AAAAA-BBBBB-CCCCC-DDDDD", "new_password": "New-pass-1357"}, headers=H)
    assert "Too many" in r.json()["detail"]


def test_server_console_reset(tmp_path):
    store = auth.UserStore(tmp_path)
    store.create("boss", "Dr Boss", "admin", "Strong-test-pass-1", by="setup", must_change=False)
    temp = store.admin_reset("boss", by="server-console")
    token, user = store.login("boss", temp, "127.0.0.1")
    assert user["must_change_password"] and token


def test_tests_never_use_real_data():
    from medtwin import config
    assert "medtwin-test-data-" in str(config.DATA_DIR)


def test_empty_account_file_restored_from_backup(tmp_path):
    store = auth.UserStore(tmp_path)
    store.create("boss", "Dr Boss", "admin", "Strong-test-pass-1", by="setup", must_change=False)
    store.create("rad7", "Dr R", "radiologist", "Temp-pass-123", by="boss")   # first save made a backup
    (tmp_path / "users.json").write_text("", encoding="utf-8")                # file emptied
    assert "boss" in {u["username"] for u in store.list()}                    # restored automatically
    assert store.login("boss", "Strong-test-pass-1", "127.0.0.1")[1]["username"] == "boss"
    (tmp_path / "users.json").write_text("{broken", encoding="utf-8")         # file damaged
    assert store.has_users()
    assert list(tmp_path.glob("users.json.damaged-*"))                        # damaged copy kept


def test_damaged_account_file_without_backup_is_reported(tmp_path):
    (tmp_path / "users.json").write_text("{broken", encoding="utf-8")
    with pytest.raises(auth.AccountFileError):
        auth.UserStore(tmp_path).list()
    (tmp_path / "users.json").write_text("", encoding="utf-8")
    assert auth.UserStore(tmp_path).list() == []                              # empty = no accounts yet


def test_reset_all_archives_accounts_and_reopens_setup(tmp_path):
    store = auth.UserStore(tmp_path)
    store.create("boss", "Dr Boss", "admin", "Strong-test-pass-1", by="setup", must_change=False)
    store.create("rad8", "Dr R", "radiologist", "Temp-pass-123", by="boss")
    token, _ = store.login("boss", "Strong-test-pass-1", "127.0.0.1")
    archived = store.archive_all(by="server-console")
    assert not store.has_users()                                   # setup screen available again
    assert store.session_user(token) is None                       # everyone signed out
    assert archived.is_file() and "boss" in archived.read_text(encoding="utf-8")   # nothing destroyed


def test_weak_passwords_rejected(client):
    setup_admin(client)
    for bad in ("short1", "onlyletters", "12345678901", "rad3-password-1"):
        r = client.post("/api/users", json={"username": "rad3", "name": "Dr R", "role": "radiologist", "password": bad}, headers=H)
        assert r.status_code == 422, bad
