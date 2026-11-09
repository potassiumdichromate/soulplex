import asyncio
from sqlalchemy import select
from app.db import SessionLocal, User, Memory, Scene, Message, AuthSession
from app.worker import process_one

REG = {
    "name": "Sam",
    "age": 28,
    "city": "Dubai",
    "gender": "woman",
    "seeking": ["man"],
    "age_min": 25,
    "age_max": 38,
    "intent": "relationship",
    "contact": "",
    "discovery": True,
    "email": "sam@example.invalid",
    "password": "a-long-test-password",
    "consent": True,
}


def names(client):
    return [c["name"] for c in client.get("/api/candidates").json()["candidates"]]


def names_ids(client):
    return [c["id"] for c in client.get("/api/candidates").json()["candidates"]]


def create_scene(client, login, venue="cafe"):
    maya = login("maya")
    partner = client.get("/api/candidates").json()["candidates"][0]
    r = client.post("/api/scenes", json={"partner_id": partner["id"], "venue": venue})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    asyncio.run(process_one())
    s = client.get("/api/scenes/" + sid).json()
    assert s["status"] == "completed", s
    return sid, maya, partner


def contribute(client, sid, decision="accept"):
    return client.put(
        "/api/scenes/" + sid + "/participation",
        json={
            "reviewed": True,
            "contribution": "Let us try a quiet coffee and bring a favourite book.",
            "decision": decision,
            "next_step": "video",
        },
    )


def test_auth_csrf_and_role_boundary(client, login):
    assert client.get("/api/memories").status_code == 401
    login()
    client.headers.pop("X-CSRF-Token")
    assert client.post("/api/chat", json={"message": "I love tea."}).status_code == 403
    assert client.get("/api/admin").status_code == 403
    assert (
        client.post("/api/auth/register", json={**REG, "role": "admin"}).status_code
        == 422
    )
    assert client.post("/api/auth/register", json={**REG, "age": 17}).status_code == 422
    assert (
        client.post("/api/auth/register", json={**REG, "consent": False}).status_code
        == 422
    )


def test_registration_verification_and_delete(client):
    r = client.post("/api/auth/register", json=REG)
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    client.headers["X-CSRF-Token"] = r.json()["csrf"]
    assert not u["discovery"] and not u["verified"] and u["role"] == "member"
    body = {
        k: REG[k]
        for k in (
            "name",
            "age",
            "city",
            "gender",
            "seeking",
            "age_min",
            "age_max",
            "intent",
            "contact",
            "discovery",
        )
    }
    assert client.put("/api/profile", json=body).status_code == 409
    with SessionLocal() as db:
        account = db.get(User, u["id"])
        account.email_verified = True
        db.commit()
    assert (
        client.post(
            "/api/chat",
            json={"message": "I grew up spending weekends with my cousins."},
        ).status_code
        == 200
    )
    exported = client.get("/api/export").json()
    assert exported["chat"] and exported["memories"]
    assert "password" not in exported["profile"]
    assert (
        client.request(
            "DELETE",
            "/api/account",
            json={"confirmation": "DELETE", "password": "wrong"},
        ).status_code
        == 401
    )
    assert (
        client.request(
            "DELETE",
            "/api/account",
            json={"confirmation": "DELETE", "password": REG["password"]},
        ).status_code
        == 200
    )
    assert client.get("/api/me").status_code == 401
    with SessionLocal() as db:
        assert db.get(User, u["id"]) is None
        for cls in (Memory, Message, AuthSession):
            assert not db.scalars(select(cls).where(cls.user_id == u["id"])).all()


def test_private_proposals_owner_isolation_and_versions(client, login):
    login()
    r = client.post(
        "/api/chat",
        json={
            "message": "I moved cities to study design and enjoy cooking with friends."
        },
    )
    assert r.status_code == 200
    memories = client.get("/api/memories").json()
    m = next(m for m in memories if m["status"] == "proposed")
    assert (
        m["visibility"] == "private"
        and m["source_quote"]
        in "I moved cities to study design and enjoy cooking with friends."
    )
    edit = {
        "content": "I enjoy cooking with friends.",
        "visibility": "shareable",
        "status": "approved",
        "expected_version": m["version"],
    }
    login("arjun")
    assert client.patch("/api/memories/" + m["id"], json=edit).status_code == 404
    assert all(x["id"] != m["id"] for x in client.get("/api/export").json()["memories"])
    login("maya")
    assert client.patch("/api/memories/" + m["id"], json=edit).status_code == 200
    assert client.patch("/api/memories/" + m["id"], json=edit).status_code == 409
    edit.update(expected_version=2, content="Email me at me@example.com")
    assert client.patch("/api/memories/" + m["id"], json=edit).status_code == 422


def test_mutual_human_contributions_required(client, login):
    sid, maya, partner = create_scene(client, login)
    r = client.get("/api/scenes/" + sid).json()
    assert r["contact"] is None and len(r["output"]["dialogue"]) == 8
    assert (
        client.put(
            "/api/scenes/" + sid + "/participation",
            json={"reviewed": False, "contribution": "", "decision": "accept"},
        ).status_code
        == 422
    )
    assert contribute(client, sid).json()["contact"] is None
    login("arjun")
    r = client.get("/api/scenes/" + sid).json()
    assert r["other"]["contribution"] == "" and r["contact"] is None
    r = contribute(client, sid)
    assert r.status_code == 200, r.text
    assert r.json()["mutual"] and r.json()["contact"] == "maya@example.invalid"
    login("maya")
    assert client.get("/api/scenes/" + sid).json()["contact"] == "arjun@example.invalid"
    contribute(client, sid, "pass")
    assert client.get("/api/scenes/" + sid).json()["contact"] is None


def test_memory_changes_revoke_existing_introduction(client, login):
    sid, maya, partner = create_scene(client, login)
    contribute(client, sid)
    login("arjun")
    contribute(client, sid)
    m = client.get("/api/memories").json()[0]
    assert (
        client.patch(
            "/api/memories/" + m["id"],
            json={
                "content": m["content"],
                "visibility": "private",
                "status": "approved",
                "expected_version": m["version"],
            },
        ).status_code
        == 200
    )
    r = client.get("/api/scenes/" + sid).json()
    assert r["stale"] and r["contact"] is None and r["output"] == {}
    assert contribute(client, sid).status_code == 409
    login("maya")
    assert client.get("/api/scenes/" + sid).json()["contact"] is None


def test_block_revokes_contact_and_discovery(client, login):
    sid, maya, partner = create_scene(client, login)
    contribute(client, sid)
    login("arjun")
    contribute(client, sid)
    assert client.post("/api/blocks/" + maya["id"]).status_code == 200
    assert client.get("/api/scenes/" + sid).status_code == 404
    assert maya["id"] not in names_ids(client)
    login("maya")
    assert client.get("/api/scenes/" + sid).status_code == 404


def test_worker_rechecks_consent_before_running(client, login):
    login()
    p = client.get("/api/candidates").json()["candidates"][0]
    sid = client.post("/api/scenes", json={"partner_id": p["id"]}).json()["id"]
    with SessionLocal() as db:
        u = db.get(User, p["id"])
        u.discovery = False
        db.commit()
    asyncio.run(process_one())
    with SessionLocal() as db:
        assert db.get(Scene, sid).status == "failed"


def test_cross_city_and_preferences_excluded(client, login):
    login()
    with SessionLocal() as db:
        p = db.scalar(select(User).where(User.name == "Arjun"))
        p.city = "Delhi NCR"
        db.commit()
    assert "Arjun" not in names(client)
    with SessionLocal() as db:
        p = db.scalar(select(User).where(User.name == "Arjun"))
        p.city = "Dubai"
        p.seeking = ["man"]
        db.commit()
    assert "Arjun" not in names(client)


def test_every_listed_origin_is_allowed(client, login, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "ORIGINS", ["https://soulplex.xyz", "https://www.soulplex.xyz", "http://testserver"])
    login()
    for site, status in (("https://www.soulplex.xyz", 200), ("https://soulplex.xyz/", 200), ("https://evil.invalid", 403)):
        r = client.put("/api/about", json={}, headers={"Origin": site})
        assert r.status_code == status, (site, r.text)


def test_origin_and_body_limit(client, login):
    login()
    assert (
        client.post(
            "/api/chat",
            json={"message": "Hello there"},
            headers={"Origin": "https://evil.invalid"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/chat",
            content=b"x" * 40000,
            headers={"content-type": "application/json"},
        ).status_code
        == 413
    )
    assert (
        client.post(
            "/api/transcribe", content=b"abc", headers={"content-type": "audio/webm"}
        ).status_code
        == 503
    )


def test_reports_and_operator_boundary(client, login):
    u = login()
    p = client.get("/api/candidates").json()["candidates"][0]
    assert (
        client.post(
            "/api/reports",
            json={
                "target_id": p["id"],
                "reason": "This fictional interaction needs an operator review.",
            },
        ).status_code
        == 200
    )
    assert client.get("/api/admin").status_code == 403
    login("operator")
    dashboard = client.get("/api/admin").json()
    assert len(dashboard["reports"]) == 1
    assert all("contact" not in m and "email" not in m for m in dashboard["members"])
    assert (
        client.patch(
            "/api/admin/users/" + u["id"], json={"verified": True, "disabled": True}
        ).status_code
        == 200
    )


def test_scene_reuse_and_different_venues(client, login):
    sid, u, p = create_scene(client, login)
    assert (
        client.post(
            "/api/scenes", json={"partner_id": p["id"], "venue": "cafe"}
        ).json()["id"]
        == sid
    )
    assert (
        client.post(
            "/api/scenes", json={"partner_id": p["id"], "venue": "garden"}
        ).json()["id"]
        != sid
    )


def test_feedback_counts_people_not_repeated_submissions(client, login):
    sid, u, p = create_scene(client, login)
    contribute(client, sid)
    login("arjun")
    contribute(client, sid)
    for _ in range(2):
        assert (
            client.post(
                "/api/scenes/" + sid + "/feedback",
                json={"met": False, "represented_accurately": True},
            ).status_code
            == 200
        )
    login("operator")
    assert client.get("/api/admin").json()["metrics"]["outcome_responses"] == 1
