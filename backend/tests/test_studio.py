"""Twin Studio invariants: stable IDs, skip semantics, blinded prompts, and no score gate."""

from app.studio import decision_context, scenario, validate_answer, why_click


def test_required_questions_cannot_be_skipped_and_none_is_not_a_skip():
    try:
        validate_answer("Q02", [], "", "skipped")
        assert False
    except ValueError:
        pass
    skipped = validate_answer("Q03", [], "", "skipped")
    assert skipped["status"] == "skipped" and skipped["option_ids"] == []
    explicit = validate_answer("Q03", ["none"], "", "answered")
    assert explicit["option_ids"] == ["none"]
    try:
        validate_answer("Q04", ["kindness", "honesty", "humor", "ambition"], "", "answered")
        assert False
    except ValueError:
        pass


def test_calibration_order_and_blind_context():
    from app.studio import schema

    assert schema()["calibration_order"] == ["CAL02", "CAL01", "CAL03"]
    scene = scenario("CAL02")
    context = decision_context(scene, ["I prefer to ask before I decide."], [])
    assert "owner_option" not in context and "owner_why" not in context
    assert context["situation"].startswith("The waiter")
    assert "correct" in {o["id"] for o in context["options"]}


def test_click_uses_only_supplied_facts_and_lines():
    click = why_click(
        ["I value kindness and quiet bookshops."],
        ["Kindness matters more to me than plans."],
        ["I wanted to ask about the bookshop."],
    )
    assert click["shared"]
    assert "not a personality score" in click["note"]
    assert "score" not in click["title"].lower()
    empty = why_click([], [], [])
    assert empty["shared"] == [] and empty["moments"] == []


def test_low_score_does_not_block_acceptance(client, login):
    login("maya")
    partner = next(c for c in client.get("/api/candidates").json()["candidates"])
    sid = client.post("/api/scenes", json={"partner_id": partner["id"], "venue": "cafe"}).json()["id"]
    from app.worker import process_one
    import asyncio

    asyncio.run(process_one())
    scene = client.get("/api/scenes/" + sid).json()
    assert scene["can_connect"] is True
    assert scene["click"]["title"] == "Why you two might click"
    saved = client.put(
        "/api/scenes/" + sid + "/participation",
        json={"reviewed": True, "contribution": "I would like to meet and talk in person.", "decision": "accept", "next_step": "video"},
    )
    assert saved.status_code == 200, saved.text


def test_new_account_does_not_auto_accept_dates(client):
    body = {
        "email": "new-twin@example.invalid",
        "password": "a-long-password-1",
        "name": "Noor",
        "age": 29,
        "city": "Dubai",
        "gender": "woman",
        "seeking": ["man"],
        "age_min": 25,
        "age_max": 40,
        "intent": "relationship",
        "contact": "noor@example.invalid",
        "consent": True,
    }
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["auto_accept"] is False


def test_permissions_default_off_and_blind_run_omits_owner_answer(client, login, monkeypatch):
    login("maya")
    client.headers["X-CSRF-Token"] = client.headers["X-CSRF-Token"]
    perms = client.get("/api/privacy/permissions").json()
    # seeded demo members opted in to dating; outside processing and research stay off
    # (fresh accounts start with everything off: see test_readiness)
    assert perms["grants"]["allow_external_minds"] is False and perms["grants"]["allow_research_feedback"] is False
    age = client.post("/api/onboarding/age", json={"adult": True})
    assert age.status_code == 200, age.text
    saved = client.put(
        "/api/onboarding/answers/Q05",
        json={"option_ids": ["quiet_cafe"], "status": "answered", "mode": "taps"},
    )
    assert saved.status_code == 200, saved.text
    preview = client.post("/api/onboarding/preview").json()
    assert preview["scored"] is False and any("quiet café" in line for line in preview["lines"])
    locked = client.post(
        "/api/calibration/CAL02/owner",
        json={"option_ids": ["correct"], "status": "answered", "free_text": "I would ask politely."},
    )
    assert locked.status_code == 200, locked.text
    assert "twin_option" not in locked.json()
    seen = {}

    async def capture(_scene, context):
        seen["context"] = context

        class Choice:
            option_id = "ask"
            summary = "The approved facts say I ask before deciding."

        return Choice()

    monkeypatch.setattr("app.studio_api.independent_answer", capture)
    run = client.post("/api/calibration/CAL02/run")
    assert run.status_code == 200, run.text
    assert seen["context"]["scenario_id"] == "CAL02"
    assert "owner_option" not in seen["context"]
    blob = str(seen["context"])
    assert "I would ask politely." not in blob
    assert run.json()["twin_option"] == "ask"


def test_partner_lifestyle_picks_become_private_must_haves():
    from types import SimpleNamespace as NS
    from app.about import violates
    from app.studio import apply_profile

    def row(fid, opts, status="answered"):
        return NS(field_id=fid, option_ids=opts, status=status)

    me = NS(about={}, gender=None, seeking=None, intent=None)
    apply_profile(me, [row("H01_drinking", ["socially"]), row("P01_drinking", ["no"]), row("P02_smoking", ["any"])])
    assert me.about["studio_habits"] == {"drinking": "socially"}
    assert me.about["dealbreakers"] == ["drinking"]
    assert violates(me.about, {"studio_habits": {"drinking": "socially"}})
    assert not violates(me.about, {"studio_habits": {"drinking": "no"}})
    assert not violates(me.about, {})  # unknown never excludes
    apply_profile(me, [row("P01_drinking", ["any"])])
    assert me.about["dealbreakers"] == []
