import asyncio, base64
from app.worker import process_one

IMG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8real-photo").decode()
SOFT = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8soft-photo").decode()


def test_seed_people_have_faces(client, login):
    login("maya")
    faces = [c["face"] for c in client.get("/api/candidates").json()["candidates"]]
    kinds = {f["kind"] for f in faces}
    assert kinds <= {"illustrated", "cast"} and "cast" in kinds
    assert all(("skin" in f["spec"]) if f["kind"] == "illustrated" else f["id"] for f in faces)


def test_illustrated_face_validation(client, login):
    login("maya")
    ok = client.put("/api/face", json={"kind": "illustrated", "spec": {"skin": 1, "hair": 2}})
    assert ok.status_code == 200 and ok.json()["face"]["spec"]["hair"] == 2
    bad = client.put("/api/face", json={"kind": "illustrated", "spec": {"skin": 99}})
    assert bad.status_code == 422


def test_photo_is_hidden_until_mutual(client, login):
    login("arjun")
    r = client.put(
        "/api/face",
        json={"kind": "photo", "photo": IMG, "public": SOFT, "style": "dreamy", "reveal": "mutual"},
    )
    assert r.status_code == 200 and r.json()["face"]["photo"] == IMG
    arjun_id = r.json()["id"]
    login("maya")
    c = next(x for x in client.get("/api/candidates").json()["candidates"] if x["id"] == arjun_id)
    assert c["face"] == {"kind": "photo", "image": SOFT, "locked": True}
    sid = client.post("/api/scenes", json={"partner_id": arjun_id}).json()["id"]
    asyncio.run(process_one())
    assert client.get("/api/scenes/" + sid).json()["partner"]["face"]["image"] == SOFT
    body = {"reviewed": True, "contribution": "Coffee and a walk?", "decision": "accept", "next_step": "video"}
    assert client.put(f"/api/scenes/{sid}/participation", json=body).status_code == 200
    login("arjun")
    assert client.put(f"/api/scenes/{sid}/participation", json=body).status_code == 200
    login("maya")
    s = client.get("/api/scenes/" + sid).json()
    assert s["mutual"] and s["partner"]["face"] == {"kind": "photo", "image": IMG, "locked": False}


def test_photo_rejects_non_images(client, login):
    login("maya")
    r = client.put("/api/face", json={"kind": "photo", "photo": "data:text/html;base64,PHNjcmlwdD4=", "reveal": "everyone"})
    assert r.status_code == 422
    r = client.put("/api/face", json={"kind": "photo", "photo": "data:image/png;base64," + "A" * 130000})
    assert r.status_code in (413, 422)
