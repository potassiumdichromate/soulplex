import asyncio
import hashlib
import sqlite3

import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.exc import IntegrityError

from app import main, domain, db as database
from app.db import SessionLocal, User, Scene, Participation, Quota
from app.security import check_password, hash_password
from app.worker import process_one
from test_flows import REG


def live_for_test(monkeypatch):
    sent = []
    monkeypatch.setattr(main, "mail_ready", lambda: True)
    monkeypatch.setattr(
        main,
        "send_auth_email",
        lambda email, token, purpose: sent.append((email, token, purpose)),
    )
    return sent


def test_email_verification_gate(client, monkeypatch):
    sent = live_for_test(monkeypatch)
    r = client.post("/api/auth/register", json=REG)
    assert r.status_code == 200, r.text
    assert not r.json()["user"]["email_verified"]
    client.headers["X-CSRF-Token"] = r.json()["csrf"]
    assert (
        client.post("/api/chat", json={"message": "This is my story."}).status_code
        == 403
    )
    assert (
        client.post(
            "/api/transcribe", content=b"abc", headers={"content-type": "audio/webm"}
        ).status_code
        == 403
    )
    assert client.get("/api/candidates").json()["candidates"] == []
    first_token = sent[-1][1]
    assert client.post("/api/auth/resend-verification").status_code == 200
    assert (
        client.post("/api/auth/verify-email", json={"token": first_token}).status_code
        == 400
    )
    token = sent[-1][1]
    assert (
        client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    )
    assert (
        client.post("/api/auth/verify-email", json={"token": token}).status_code == 400
    )
    assert client.get("/api/me").json()["user"]["email_verified"]


def test_password_reset_revokes_sessions_and_replay(client, monkeypatch):
    sent = live_for_test(monkeypatch)
    r = client.post("/api/auth/register", json=REG)
    assert r.status_code == 200
    unknown = client.post(
        "/api/auth/request-reset", json={"email": "nobody@example.invalid"}
    )
    known = client.post("/api/auth/request-reset", json={"email": REG["email"]})
    assert known.json() == unknown.json()
    token = sent[-1][1]
    assert sent[-1][2] == "reset"
    r = client.post(
        "/api/auth/reset-password",
        json={"token": token, "password": "a-new-secure-password"},
    )
    assert r.status_code == 200, r.text
    assert (
        client.post(
            "/api/auth/reset-password",
            json={"token": token, "password": "another-secure-password"},
        ).status_code
        == 400
    )
    assert client.get("/api/me").status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"email": REG["email"], "password": REG["password"]}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login",
            json={"email": REG["email"], "password": "a-new-secure-password"},
        ).status_code
        == 200
    )


def test_operator_cannot_approve_unverified_email_but_can_suspend(client, monkeypatch):
    live_for_test(monkeypatch)
    with SessionLocal() as db:
        operator = db.scalar(select(User).where(User.name == "Pilot operator"))
        operator.password = hash_password("known-operator-password")
        operator.email_verified = True
        db.commit()
    member = client.post("/api/auth/register", json=REG).json()["user"]
    r = client.post(
        "/api/auth/login",
        json={
            "email": "operator@demo.soulplex.local",
            "password": "known-operator-password",
        },
    )
    assert r.status_code == 200
    client.headers["X-CSRF-Token"] = r.json()["csrf"]
    target = "/api/admin/users/" + member["id"]
    assert (
        client.patch(target, json={"verified": True, "disabled": False}).status_code
        == 409
    )
    assert (
        client.patch(target, json={"verified": True, "disabled": True}).status_code
        == 200
    )


def test_legacy_password_upgrades_on_login(client):
    salt = "fixed-legacy-salt"
    password = "legacy-test-password"
    old = (
        salt
        + ":"
        + hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    )
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.name == "Maya"))
        u.password = old
        db.commit()
    r = client.post(
        "/api/auth/login",
        json={"email": "maya@demo.soulplex.local", "password": password},
    )
    assert r.status_code == 200
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.name == "Maya"))
        assert u.password.startswith("scrypt$65536$") and check_password(
            password, u.password
        )


def test_unique_scene_snapshot_and_failed_retry(client, login):
    login()
    partner = client.get("/api/candidates").json()["candidates"][0]
    first = client.post("/api/scenes", json={"partner_id": partner["id"]}).json()["id"]
    for _ in range(3):
        assert (
            client.post("/api/scenes", json={"partner_id": partner["id"]}).json()["id"]
            == first
        )
    with SessionLocal() as db:
        original = db.get(Scene, first)
        key = original.dedupe_key
        assert key
        assert len(db.scalars(select(Scene).where(Scene.dedupe_key == key)).all()) == 1
        assert db.scalar(select(Quota.count).where(Quota.key.like("scene:%"))) == 1
    with SessionLocal() as db:
        db.add(
            Scene(
                a=original.a,
                b=original.b,
                venue=original.venue,
                a_version=original.a_version,
                b_version=original.b_version,
                dedupe_key=key,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    with SessionLocal() as db:
        partner_user = db.get(User, partner["id"])
        partner_user.discovery = False
        db.commit()
    asyncio.run(process_one())
    with SessionLocal() as db:
        assert db.get(Scene, first).status == "failed"
        assert db.get(Scene, first).dedupe_key is None
        db.get(User, partner["id"]).discovery = True
        db.commit()
    second = client.post("/api/scenes", json={"partner_id": partner["id"]}).json()["id"]
    assert second != first


def test_upgrade_from_v1_preserves_existing_scene(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    raw = sqlite3.connect(path)
    raw.execute("CREATE TABLE schema_version (version INTEGER PRIMARY KEY)")
    raw.execute("INSERT INTO schema_version VALUES (1)")
    raw.execute("CREATE TABLE users (id VARCHAR PRIMARY KEY)")
    raw.execute(
        "CREATE TABLE scenes (id VARCHAR PRIMARY KEY, a VARCHAR, b VARCHAR, venue VARCHAR, status VARCHAR, a_version INTEGER, b_version INTEGER, created FLOAT)"
    )
    raw.execute("INSERT INTO scenes VALUES ('old','a','b','cafe','queued',1,1,1)")
    raw.commit()
    raw.close()
    engine = create_engine("sqlite:///" + str(path))
    monkeypatch.setattr(database, "engine", engine)
    database.init_db()
    database.init_db()  # Safe to run twice after a restart.
    with engine.connect() as conn:
        assert conn.scalar(select(database.SchemaVersion.version)) == 9
        cols = [c["name"] for c in inspect(conn).get_columns("users")]
        assert "face" in cols and "about" in cols and "auto_accept" in cols and "public_dates" in cols
        assert "mind_id" in cols and "mind_email" in cols and "studio" in cols and "age_verified" in cols
        assert "waived_by" in [c["name"] for c in inspect(conn).get_columns("scenes")]
        row = conn.execute(select(Scene.dedupe_key).where(Scene.id == "old")).scalar()
        assert row == domain.scene_key("a", "b", "cafe", 1, 1)
        assert "email_verified" in [
            c["name"] for c in inspect(conn).get_columns("users")
        ]
        assert inspect(conn).has_table("auth_tokens") and inspect(conn).has_table(
            "invites"
        )
    engine.dispose()
