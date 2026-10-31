"""Hello Minds client, consent gating, persona sync and the durable outbox."""

import asyncio

import pytest
from sqlalchemy import select

import app.minds as minds
from app.db import MindLink, MindTask, SessionLocal, User
from app.mind_sync import persona, process_outbox, retire
from minds_fake import FakeMinds


@pytest.fixture()
def fake(monkeypatch):
    server = FakeMinds()
    monkeypatch.setenv("MINDS_BUILDER_API_KEY", "test-builder-key")
    monkeypatch.setenv("MINDS_MAX_RETRIES", "3")
    monkeypatch.setenv("MINDS_SYNC_DELAY", "0")
    monkeypatch.setattr(minds, "transport", server.transport())
    monkeypatch.setattr(minds, "_backoff", lambda attempt, hint=None: 0)
    minds._BREAKER.reset()
    minds._credit_cache.clear()
    for key in ("replies_stream", "replies_poll", "reply_timeouts", "retries", "stream_failures"):
        minds.METRICS[key] = 0
    return server


def run(coro):
    return asyncio.run(coro)


def hits(server, method, path):
    return [c for c in server.calls if c[0] == method and c[1] == path]


def test_429_is_retried_with_retry_after(fake):
    fake.fail["/v1/minds/check/name"] = [(429, {"Retry-After": "0"}, {"error": "rate_limited"})]
    assert run(minds.name_available("Maya abc")) is True
    assert len(hits(fake, "GET", "/v1/minds/check/name")) == 2
    assert minds.METRICS["retries"] == 1


def test_a_send_is_never_repeated_after_a_server_error(fake):
    fake.fail["/v1/messaging/message"] = [(500, {}, {"message": "oops"})]
    with pytest.raises(minds.MindsError) as err:
        run(minds.send("you-1", "hello"))
    assert err.value.status == 500
    assert len(hits(fake, "POST", "/v1/messaging/message")) == 1


def test_a_send_retries_a_409_like_the_client_library(fake):
    fake.fail["/v1/messaging/message"] = [(409, {}, {"error": "busy"})]
    run(minds.send("you-1", "hello"))
    assert len(hits(fake, "POST", "/v1/messaging/message")) == 2


def test_reads_retry_502_and_connection_failures(fake):
    mind_id, _ = run(minds.awaken("Maya one"))
    fake.fail["/v1/minds/" + mind_id] = [(502, {}, {}), ("network", {}, {})]
    assert run(minds.get_mind(mind_id))["mindId"] == mind_id


def test_errors_follow_the_library_precedence(fake):
    fake.fail["/v1/minds/awaken"] = [(400, {}, {"error": {"type": "invalid_id", "message": "Unknown archetype"}})]
    with pytest.raises(minds.MindsError) as err:
        run(minds.awaken("Maya two"))
    assert (err.value.status, err.value.code, str(err.value)) == (400, "invalid_id", "Unknown archetype")
    assert len(hits(fake, "POST", "/v1/minds/awaken")) == 1


def test_circuit_opens_after_repeated_failures(fake, monkeypatch):
    monkeypatch.setenv("MINDS_BREAKER_THRESHOLD", "2")
    monkeypatch.setenv("MINDS_MAX_RETRIES", "0")
    fake.fail["/v1/minds/check/name"] = [(503, {}, {}), (503, {}, {}), (503, {}, {})]
    for _ in range(2):
        with pytest.raises(minds.MindsError):
            run(minds.name_available("x"))
    before = len(fake.calls)
    with pytest.raises(minds.MindsError) as err:
        run(minds.name_available("x"))
    assert err.value.code == "circuit_open"
    assert len(fake.calls) == before
    assert minds.snapshot()["circuit"]["state"] == "open"


def test_sse_parser_handles_crlf_comments_and_split_data():
    raw = ': hi\r\n\r\nevent: message\r\ndata: {"a": 1,\r\ndata: "b": 2}\r\n\r\ndata: not json\r\n\r\ndata: {"c"'
    events, rest = minds.parse_sse(raw)
    assert events == [{"a": 1, "b": 2}]
    assert rest == 'data: {"c"'


def test_reply_detection_ignores_echoes_people_and_old_rows():
    seen = {"fp-1"}
    assert not minds.is_reply({"messageText": "hi", "senderType": 0, "fingerprint": "fp-2"}, "a", "hi", seen)
    assert not minds.is_reply({"messageText": "yo", "senderType": 1, "fingerprint": "fp-3"}, "a", "hi", seen)
    assert not minds.is_reply({"messageText": "yo", "senderType": 0, "fingerprint": "fp-1"}, "a", "hi", seen)
    assert not minds.is_reply({"messageText": "yo", "senderType": 0, "alias": "b", "fingerprint": "fp-4"}, "a", "hi", seen)
    assert minds.is_reply({"messageText": "yo", "senderType": 0, "alias": "a", "fingerprint": "fp-5"}, "a", "hi", seen)


def test_say_takes_the_reply_from_the_event_stream(fake):
    async def go():
        mind_id, _ = await minds.awaken("Maya three")
        return await minds.say("you-x", mind_id, "hello", 5)

    assert run(go()) == "Hello from your Mind."
    assert minds.METRICS["replies_stream"] == 1


def test_say_falls_back_to_history_without_a_stream(fake):
    fake.stream = False

    async def go():
        mind_id, _ = await minds.awaken("Maya four")
        return await minds.say("you-y", mind_id, "hello", 8)

    assert run(go()) == "Hello from your Mind."
    assert minds.METRICS["replies_poll"] == 1


def test_judge_score_must_be_one_json_object():
    assert minds._score_from(' {"score": 80} ') == 80
    for bad in ('Sure {"score": 80}', '{"score": true}', '{"score": "80"}', "80"):
        with pytest.raises(minds.MindsError):
            minds._score_from(bad)


def test_mind_names_do_not_carry_internal_ids():
    name = minds._mind_name("Maya")
    assert name.startswith("Maya ") and len(name.split()[-1]) == 6


def _grant(client, value):
    r = client.put("/api/privacy/permissions", json={"grants": {"allow_external_minds": value}})
    assert r.status_code == 200, r.text


def _user(email):
    with SessionLocal() as db:
        return db.scalar(select(User).where(User.email == email))


def test_no_mind_is_created_without_consent(client, login, fake):
    login("maya")
    client.post("/api/chat", json={"message": "I love long walks by the sea."})
    assert not hits(fake, "POST", "/v1/minds/awaken")
    assert _user("maya@demo.soulplex.local").mind_id == ""


def test_consent_awakens_syncs_and_revoking_disables(client, login, fake):
    login("maya")
    _grant(client, True)
    run(process_outbox())
    user = _user("maya@demo.soulplex.local")
    assert user.mind_id
    persona_msgs = [c for c in hits(fake, "POST", "/v1/messaging/message") if c[2]["alias"] == "soul-" + user.id]
    assert len(persona_msgs) == 1
    assert "SOULPLEX PERSONA" in persona_msgs[0][2]["messageText"]
    with SessionLocal() as db:
        assert db.get(MindLink, user.id).persona_version == 1
    # A second pass with nothing changed sends nothing.
    with SessionLocal() as db:
        from app.mind_sync import enqueue

        enqueue(db, user.id, "sync_persona")
        db.commit()
    run(process_outbox())
    assert len([c for c in hits(fake, "POST", "/v1/messaging/message") if c[2]["alias"] == "soul-" + user.id]) == 1
    _grant(client, False)
    run(process_outbox())
    assert fake.minds[user.mind_id]["isEnabled"] is False


def test_withdrawing_a_fact_resends_the_persona_without_it(client, login, fake):
    login("maya")
    _grant(client, True)
    run(process_outbox())
    user = _user("maya@demo.soulplex.local")
    facts = client.get("/api/memories").json()
    shared = [f for f in (facts if isinstance(facts, list) else facts.get("memories", [])) if f["visibility"] == "shareable" and f["status"] == "approved"]
    target = shared[0]
    assert client.delete("/api/memories/" + target["id"]).status_code == 200
    run(process_outbox())
    sent = [c[2]["messageText"] for c in hits(fake, "POST", "/v1/messaging/message") if c[2]["alias"] == "soul-" + user.id]
    assert len(sent) == 2
    assert target["content"] in sent[0] and target["content"] not in sent[1]


def test_a_burst_of_saves_sends_one_persona_after_it_settles(client, login, fake, monkeypatch):
    login("maya")
    _grant(client, True)
    run(process_outbox())
    user = _user("maya@demo.soulplex.local")
    monkeypatch.setenv("MINDS_SYNC_DELAY", "60")
    for job in ("a nurse", "a doctor", "a surgeon"):
        assert client.put("/api/about", json={"job": job}).status_code == 200
    with SessionLocal() as db:
        tasks = db.scalars(select(MindTask).where(MindTask.kind == "sync_persona", MindTask.status == "pending")).all()
        assert len(tasks) == 1 and tasks[0].next_at > tasks[0].updated + 50
        assert tasks[0].next_at <= tasks[0].created + 300
    run(process_outbox())
    persona_alias = "soul-" + user.id
    assert len([c for c in hits(fake, "POST", "/v1/messaging/message") if c[2]["alias"] == persona_alias]) == 1
    with SessionLocal() as db:
        db.execute(MindTask.__table__.update().values(next_at=0))
        db.commit()
    run(process_outbox())
    sent = [c[2]["messageText"] for c in hits(fake, "POST", "/v1/messaging/message") if c[2]["alias"] == persona_alias]
    assert len(sent) == 2 and "a surgeon" in sent[1]


def test_transient_failures_are_rescheduled_not_lost(client, login, fake):
    login("maya")
    fake.fail["/v1/minds/awaken"] = [(503, {}, {})]
    _grant(client, True)
    run(process_outbox())
    with SessionLocal() as db:
        task = db.scalar(select(MindTask).where(MindTask.kind == "awaken"))
        assert task.status == "pending" and task.attempts == 1 and task.next_at > task.updated
        assert "503" in task.last_error


def test_deleting_an_account_turns_its_mind_off(client, login, fake):
    login("maya")
    _grant(client, True)
    run(process_outbox())
    user = _user("maya@demo.soulplex.local")
    r = client.request("DELETE", "/api/account", json={"confirmation": "DELETE", "password": "fixture-password-ok"})
    assert r.status_code == 200, r.text
    run(process_outbox())
    assert fake.minds[user.mind_id]["isEnabled"] is False


def test_persona_lists_only_shareable_facts(client, fake):
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "maya@demo.soulplex.local"))
        text, digest = persona(db, user)
        from app.domain import memories

        private = [m for m in memories(db, user.id) if m.visibility != "shareable"]
        assert len(digest) == 64
        assert all(m.content not in text for m in private)


def test_cognition_shortfall_falls_back_to_the_model(fake, monkeypatch):
    import app.worker as worker
    from app.ai import ProviderError

    fake.credits = 0
    mind_id, _ = run(minds.awaken("Maya five"))
    aa, bb = {"mind_id": mind_id}, {"mind_id": mind_id}
    assert "out of Cognition" in run(worker._check_cognition(aa, bb))
    assert aa["mind_id"] == "" and bb["mind_id"] == ""
    monkeypatch.delenv("AI_MODEL")
    minds._credit_cache.clear()
    with pytest.raises(ProviderError):
        run(worker._check_cognition({"mind_id": mind_id}, {"mind_id": mind_id}))


def test_operator_minds_status_needs_an_admin(client, login, fake):
    login("maya")
    assert client.get("/api/admin/minds").status_code == 403


def test_own_mind_view_reports_balance(client, login, fake):
    login("maya")
    assert client.get("/api/agent/mind").json()["mind"] is None
    _grant(client, True)
    run(process_outbox())
    data = client.get("/api/agent/mind").json()
    assert data["consented"] is True
    assert data["mind"]["cognition"] == 500
    assert data["persona"]["version"] == 1


def test_skills_are_limited_to_the_operator_allowlist(client, login, fake, monkeypatch):
    monkeypatch.setenv("MINDS_ALLOWED_SKILLS", "calendar-lite,icebreakers")
    login("maya")
    _grant(client, True)
    run(process_outbox())
    assert client.put("/api/agent/mind/skills", json={"ids": ["shell"]}).status_code == 422
    r = client.put("/api/agent/mind/skills", json={"ids": ["icebreakers"]})
    assert r.status_code == 200 and r.json()["added"] == ["icebreakers"]
    assert client.get("/api/agent/mind/skills").json()["equipped"] == ["icebreakers"]


def test_retire_unlinks_mutual_partners(client, fake):
    with SessionLocal() as db:
        maya = db.scalar(select(User).where(User.email == "maya@demo.soulplex.local"))
        maya.mind_id, maya.mind_email = "mind-x", "mind-x@hellominds.ai"
        retire(db, maya)
        kinds = [t.kind for t in db.scalars(select(MindTask).where(MindTask.user_id == maya.id))]
        db.rollback()
    assert "retire" in kinds


def test_a_full_date_is_spoken_by_two_minds_over_the_stream(fake, monkeypatch):
    import app.ai as ai

    async def no_moderation(text):
        return None

    monkeypatch.setattr(ai, "moderate", no_moderation)

    async def go():
        mind_a, _ = await minds.awaken("Ana one")
        mind_b, _ = await minds.awaken("Ben one")
        person = lambda pid, name, mind: {
            "id": pid,
            "name": name,
            "mind_id": mind,
            "facts": [{"id": pid + "-f", "content": "I love a slow weekend with long lunches", "category": "lifestyle"}],
            "style": ["Be calm and unhurried."],
            "intent": "relationship",
            "city": "Dubai",
        }
        return await ai.run_dialogue("coffee", person("a", "Ana", mind_a), person("b", "Ben", mind_b), "scene-1")

    output, _tokens = run(go())
    assert len(output["dialogue"]) == 8
    assert all(line["fact_ids"] for line in output["dialogue"])
    assert minds.METRICS["replies_stream"] == 8
    prompts = [c[2]["messageText"] for c in hits(fake, "POST", "/v1/messaging/message")]
    assert all("Be calm and unhurried." in p for p in prompts)
