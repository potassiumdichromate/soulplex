"""Date readiness: a verified email and a chosen face are all a member needs."""

from app.db import SessionLocal, User

NEW = {
    "name": "Nia",
    "city": "Dubai",
    "gender": "woman",
    "age_min": 25,
    "age_max": 40,
    "intent": "relationship",
    "consent": True,
    "email": "nia@example.com",
    "password": "a-long-password-1",
}


def sign_up(client, **over):
    r = client.post("/api/auth/register", json={**NEW, **over})
    assert r.status_code == 200, r.text
    client.headers["X-CSRF-Token"] = r.json()["csrf"]
    with SessionLocal() as db:  # the seeded men only see women aged 25-40 seeking men
        u = db.query(User).filter_by(email=NEW["email"]).one()
        u.age, u.seeking = 29, ["man"]
        db.commit()
    return r.json()["user"]


def verify_email():
    with SessionLocal() as db:
        u = db.query(User).filter_by(email=NEW["email"]).one()
        u.email_verified = True
        from app.domain import auto_discovery

        auto_discovery(u)
        db.commit()


def pick_face(client):
    r = client.put("/api/face", json={"kind": "illustrated", "spec": {}})
    assert r.status_code == 200, r.text
    return r.json()


def test_new_member_is_blocked_until_email_and_face(client):
    sign_up(client)
    r = client.get("/api/candidates").json()
    assert r["blocked"] and "email" in r["reason"].lower()
    verify_email()
    r = client.get("/api/candidates").json()
    assert r["blocked"] and "face" in r["reason"].lower()  # the automatic placeholder doesn't count


def test_email_and_face_are_enough_no_traits_or_operator_check(client):
    sign_up(client)
    verify_email()
    me = pick_face(client)
    assert me["discovery"] is True  # switched on automatically once ready
    assert me["verified"] is False  # no operator check needed
    r = client.get("/api/candidates").json()
    assert not r["blocked"], r
    assert r["candidates"], "should see seeded members without having taught any traits"
    started = client.post("/api/agent/explore", json={"count": 1})
    assert started.status_code == 200, started.text
    assert started.json()["started"], started.json()


def test_auto_discovery_only_once(client):
    sign_up(client)
    verify_email()
    pick_face(client)
    with SessionLocal() as db:  # they turn discovery off themselves
        u = db.query(User).filter_by(email=NEW["email"]).one()
        u.discovery = False
        db.commit()
    assert pick_face(client)["discovery"] is False  # a new face doesn't switch it back on
