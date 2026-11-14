"""Creative-review fixes: four-answer questions, Other text, and no duplicate facts."""

from app.studio import schema, validate_answer, preview_lines
from types import SimpleNamespace as NS


def test_every_onboarding_question_has_four_answers():
    order = set(schema()["order"])
    for field in schema()["fields"]:
        if field["field_id"] == "Q03":
            continue  # legacy dealbreakers list, not asked in the flow
        assert len(field["options"]) == 4, field["field_id"]
        if field["options"][-1]["id"] == "other":
            assert field["text_max"] > 0, field["field_id"]
    for scene in schema()["calibration"] + schema()["unseen"]:
        assert len(scene["options"]) == 4, scene["id"]
    assert "A01_vibe" in order


def test_other_keeps_their_own_words_and_shows_them_in_the_preview():
    saved = validate_answer("H04_diet", ["other"], "pescatarian", "answered")
    assert saved["free_text"] == "pescatarian"
    try:
        validate_answer("H04_diet", ["vegan"], "extra words", "answered")
        assert False
    except ValueError:
        pass
    lines = preview_lines([NS(field_id="A01_vibe", option_ids=["other"], free_text="a total foodie", status="answered")])
    assert any("a total foodie" in line for line in lines)


def test_same_fact_twice_is_one_fact_and_a_new_answer_replaces_the_old(client, login):
    login("maya")
    first = client.post("/api/memories", json={"category": "lifestyle", "content": "I want a quiet café."}).json()
    again = client.post("/api/memories", json={"category": "lifestyle", "content": "i want a quiet cafe"}).json()
    assert first["id"] == again["id"]
    a = client.post("/api/memories", json={"category": "lifestyle", "content": "My ideal Sunday is brunch with friends.", "question_id": "sunday"}).json()
    b = client.post("/api/memories", json={"category": "lifestyle", "content": "My ideal Sunday is a slow morning at home.", "question_id": "sunday"}).json()
    assert a["id"] == b["id"] and b["content"].endswith("slow morning at home.")
    contents = [m["content"] for m in client.get("/api/memories").json()]
    assert "My ideal Sunday is brunch with friends." not in contents
    assert sum(1 for c in contents if c.lower().startswith("i want a quiet")) == 1
