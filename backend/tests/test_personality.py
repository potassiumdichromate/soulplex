"""OCEAN self-report scoring, quality checks, and blinded twin calibration."""

import json
import random

import pytest

import app.personality_api as personality_api
from app.personality import (
    BY_ID,
    ITEMS,
    MINI,
    TRAITS,
    evaluate,
    form_of,
    pair_notes,
    parse_predictions,
    plan_holdout,
    quality,
    score,
    training_view,
)


def keyed_answers(value_for_trait, ids=None):
    """Answer so each trait's keyed value is the given number."""
    out = {}
    for item_id in ids or [row[0] for row in ITEMS]:
        target = value_for_trait[BY_ID[item_id]["trait"]]
        out[item_id] = target if BY_ID[item_id]["key"] > 0 else 6 - target
    return out


def test_item_bank_is_the_ipip_50_with_the_mini_ipip_subset():
    assert len(ITEMS) == 50 and len(MINI) == 20
    for trait in TRAITS:
        assert sum(BY_ID[i]["trait"] == trait for i in BY_ID) == 10
        assert sum(BY_ID[i]["trait"] == trait for i in MINI) == 4


def test_reverse_keyed_items_are_scored_on_the_trait():
    high = keyed_answers({t: 5 for t in TRAITS})
    scores = score(high)
    assert all(scores[t]["score"] == 100 and scores[t]["level"] == "higher" for t in TRAITS)
    mixed = keyed_answers({"openness": 1, "conscientiousness": 3, "extraversion": 5, "agreeableness": 4, "neuroticism": 2})
    s = score(mixed)
    assert (s["openness"]["score"], s["conscientiousness"]["score"], s["extraversion"]["score"]) == (0, 50, 100)
    assert s["agreeableness"]["score"] == 75 and s["neuroticism"]["score"] == 25


def test_short_forms_get_wider_ranges_and_thin_traits_stay_unscored():
    mini = keyed_answers({t: 4 for t in TRAITS}, MINI)
    full = keyed_answers({t: 4 for t in TRAITS})
    assert form_of(mini) == "mini" and form_of(full) == "full"
    m, f = score(mini)["extraversion"], score(full)["extraversion"]
    assert (m["high"] - m["low"]) > (f["high"] - f["low"])
    thin = score({"E1": 5, "E2": 1})
    assert thin["extraversion"]["score"] is None


def test_quality_flags_straight_lining_and_contradictions():
    assert quality(keyed_answers({t: 4 for t in TRAITS}))["status"] == "ok"
    same = {i: 3 for i in BY_ID}
    assert {f["id"] for f in quality(same)["flags"]} == {"same_answer"}
    agree_all = {i: 5 for i in BY_ID}
    assert "contradictory" in {f["id"] for f in quality(agree_all)["flags"]}
    rushed = quality(keyed_answers({t: 4 for t in TRAITS}), [300] * 50)
    assert "rushed" in {f["id"] for f in rushed["flags"]}


def test_holdout_always_leaves_enough_training_items():
    answers = keyed_answers({t: 3 for t in TRAITS})
    held = plan_holdout(answers, random.Random(7))
    assert len(held) == 10
    train = training_view(answers, held)
    for trait in TRAITS:
        assert sum(BY_ID[i]["trait"] == trait for i in train) >= 3
    mini = plan_holdout(keyed_answers({t: 3 for t in TRAITS}, MINI), random.Random(1))
    assert len(mini) == 5


def test_evaluation_compares_against_naive_baselines():
    answers = keyed_answers({"openness": 5, "conscientiousness": 2, "extraversion": 4, "agreeableness": 3, "neuroticism": 1})
    held = plan_holdout(answers, random.Random(3))
    train = score(training_view(answers, held))
    perfect = evaluate(answers, held, {i: answers[i] for i in held}, train)
    assert perfect["mae"] == 0 and perfect["agreement"] == 100 and perfect["within_one"] == 1
    midpoint = evaluate(answers, held, {i: 3 for i in held}, train)
    assert midpoint["mae"] == midpoint["baseline_midpoint_mae"]
    assert midpoint["lift_over_self_report"] < 0


def test_predictions_must_cover_every_statement_in_range():
    assert parse_predictions('ok {"predictions":[{"id":"q1","value":4},{"id":"q2","value":2}]}', ["q1", "q2"]) == {"q1": 4, "q2": 2}
    for bad in ('{"predictions":[{"id":"q1","value":4}]}', '{"predictions":[{"id":"q1","value":9},{"id":"q2","value":2}]}', "nothing"):
        with pytest.raises(ValueError):
            parse_predictions(bad, ["q1", "q2"])


def test_pair_notes_never_compare_neuroticism_and_cap_the_nudge():
    a = {"extraversion": 20, "conscientiousness": 90, "openness": 80, "agreeableness": 70}
    b = {"extraversion": 30, "conscientiousness": 85, "openness": 75, "agreeableness": 65}
    notes = pair_notes(a, b, "A", "B")
    assert "You both recharge quietly" in notes["shared"]
    assert -4 <= notes["nudge"] <= 4 and notes["nudge"] > 0
    assert "neuroticism" not in json.dumps(notes).lower()
    far = pair_notes({"extraversion": 90}, {"extraversion": 10}, "A", "B")
    assert far["explore"] and far["nudge"] < 0
    assert pair_notes(None, b, "A", "B") is None


def test_inventory_is_public_and_versioned(client):
    data = client.get("/api/personality/inventory").json()
    assert data["form"] == "mini" and len(data["items"]) == 20
    assert "ipip.ori.org" in data["citation"]
    assert len(client.get("/api/personality/inventory?form=full").json()["items"]) == 50


def _answer_all(client, values):
    payload = [{"item_id": i, "value": v, "elapsed_ms": 2500} for i, v in values.items()]
    r = client.put("/api/personality/responses", json={"responses": payload})
    assert r.status_code == 200, r.text
    return r.json()


def test_saving_answers_scores_a_profile(client, login):
    login("maya")
    assert client.get("/api/personality").json()["profile"] is None
    data = _answer_all(client, keyed_answers({"openness": 5, "conscientiousness": 4, "extraversion": 2, "agreeableness": 4, "neuroticism": 2}))
    traits = {t["id"]: t for t in data["profile"]["traits"]}
    assert traits["openness"]["score"] == 100 and traits["extraversion"]["level"] == "lower"
    assert data["profile"]["form"] == "full" and data["remaining"] == []
    assert data["profile"]["quality"]["status"] == "ok"
    assert any("calm" in s for s in data["profile"]["style"])
    bad = client.put("/api/personality/responses", json={"responses": [{"item_id": "Z9", "value": 3}]})
    assert bad.status_code == 422
    assert client.put("/api/personality/responses", json={"responses": [{"item_id": "E1", "value": 6}]}).status_code == 422


def test_flagged_answers_do_not_shape_the_twin_until_confirmed(client, login):
    login("maya")
    data = _answer_all(client, {i: 3 for i in BY_ID})
    assert data["profile"]["quality"]["status"] == "review" and data["profile"]["style"] == []
    confirmed = client.post("/api/personality/confirm").json()
    assert confirmed["profile"]["quality"]["status"] == "confirmed"


def test_scope_controls_what_reaches_dates(client, login):
    from sqlalchemy import select

    from app.db import SessionLocal, User
    from app.domain import actor_data

    login("maya")
    _answer_all(client, keyed_answers({t: 4 for t in TRAITS}))
    with SessionLocal() as db:
        maya = db.scalar(select(User).where(User.email == "maya@demo.soulplex.local"))
        twin = actor_data(db, maya)
    assert twin["style"] and twin["personality"] is None
    assert client.put("/api/personality/scope", json={"scope": "everyone"}).status_code == 422
    client.put("/api/personality/scope", json={"scope": "matching"})
    with SessionLocal() as db:
        maya = db.scalar(select(User).where(User.email == "maya@demo.soulplex.local"))
        assert actor_data(db, maya)["personality"]["extraversion"] == 75
    client.put("/api/personality/scope", json={"scope": "private"})
    with SessionLocal() as db:
        maya = db.scalar(select(User).where(User.email == "maya@demo.soulplex.local"))
        hidden = actor_data(db, maya)
    assert hidden["style"] == [] and hidden["personality"] is None


def test_calibration_is_blinded_and_scored(client, login, monkeypatch):
    seen = {}

    async def fake_structured(system, payload, typ):
        seen["payload"] = payload
        return typ(predictions=[{"id": s["id"], "value": 4} for s in payload["statements"]]), 0

    monkeypatch.setattr(personality_api, "structured", fake_structured)
    login("maya")
    answers = keyed_answers({"openness": 5, "conscientiousness": 4, "extraversion": 2, "agreeableness": 4, "neuroticism": 2})
    _answer_all(client, answers)
    r = client.post("/api/personality/calibrate")
    assert r.status_code == 200, r.text
    run = r.json()["run"]
    assert run["status"] == "complete" and run["method"] == "model" and run["items"] == 10
    for key in ("mae", "within_one", "baseline_self_report_mae", "lift_over_self_report", "agreement"):
        assert key in run["metrics"]
    payload = json.dumps(seen["payload"])
    # No item ids, and no owner answers, reach the twin.
    assert not any(f'"{i}"' in payload for i in BY_ID)
    assert "value" not in json.dumps(seen["payload"]["statements"])
    assert client.get("/api/personality/calibrations").json()["trend"]["runs"] == 1
    export = client.get("/api/export").json()
    assert len(export["personality"]["responses"]) == 50
    assert export["personality"]["calibrations"][0]["status"] == "complete"


def test_calibration_needs_enough_answers(client, login):
    login("maya")
    _answer_all(client, keyed_answers({t: 4 for t in TRAITS}, MINI[:10]))
    assert client.post("/api/personality/calibrate").status_code == 409


def test_deleting_personality_removes_everything(client, login):
    login("maya")
    _answer_all(client, keyed_answers({t: 4 for t in TRAITS}))
    assert client.delete("/api/personality").status_code == 200
    data = client.get("/api/personality").json()
    assert data["profile"] is None and data["answered"] == 0


def test_resonance_uses_personality_only_when_both_opt_in():
    from app.resonance import apply_signals, finalize, heuristic

    a = {"id": "a", "name": "A", "facts": [{"id": "1", "content": "I love books and quiet weekends", "category": "interests"}], "about": {}}
    b = {"id": "b", "name": "B", "facts": [{"id": "2", "content": "Books and long walks", "category": "interests"}], "about": {}}
    plain = finalize(apply_signals(heuristic(a, b, []), a, b), "keyword")
    assert plain["personality"] == {"used": False}
    a["personality"] = {"extraversion": 20, "conscientiousness": 70, "openness": 80, "agreeableness": 60}
    b["personality"] = {"extraversion": 25, "conscientiousness": 75, "openness": 85, "agreeableness": 65}
    used = finalize(apply_signals(heuristic(a, b, []), a, b), "keyword")
    assert used["personality"]["used"] and "You both recharge quietly" in used["shared"]
