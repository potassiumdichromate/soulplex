"""OpenAI and 0G Router paths of the model adapter, against a mock transport."""

import asyncio
import json

import httpx
import pytest
from pydantic import BaseModel, ConfigDict

import app.ai as ai


class Pick(BaseModel):
    model_config = ConfigDict(extra="forbid")
    option_id: str


def reply(content, finish="stop", status=200):
    return httpx.Response(
        status,
        json={"choices": [{"message": {"content": content}, "finish_reason": finish}], "usage": {"total_tokens": 12}},
    )


@pytest.fixture()
def wire(monkeypatch):
    calls, queue = [], []

    def handle(request):
        try:
            body = json.loads(request.content)
        except ValueError:
            body = None  # multipart upload
        calls.append({"url": str(request.url), "headers": dict(request.headers), "body": body})
        return queue.pop(0) if queue else reply('{"option_id": "a"}')

    monkeypatch.setattr(ai, "transport", httpx.MockTransport(handle))
    monkeypatch.setattr(ai, "_object_mode", set())
    monkeypatch.setattr(ai, "_wait", lambda response: 0)  # Retries without waiting.
    return calls, queue


@pytest.fixture()
def zero_g(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "0g")
    monkeypatch.setenv("AI_API_KEY", "sk-test")
    monkeypatch.setenv("AI_MODEL", "glm-5.2")
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    monkeypatch.delenv("MODERATION_API_KEY", raising=False)
    monkeypatch.delenv("MODERATION_PROVIDER", raising=False)


def run(coro):
    return asyncio.run(coro)


def test_openai_requests_are_unchanged(wire, monkeypatch):
    calls, _ = wire
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    result, tokens = run(ai.structured("sys", {"x": 1}, Pick))
    assert result.option_id == "a" and tokens == 12
    sent = calls[0]
    assert sent["url"] == "https://api.openai.com/v1/chat/completions"
    assert sent["body"]["store"] is False and sent["body"]["max_completion_tokens"] == 800
    assert sent["body"]["response_format"]["json_schema"]["strict"] is True
    assert "x-0g-provider-trust-mode" not in sent["headers"]


def test_0g_uses_the_router_with_private_providers(wire, zero_g):
    calls, _ = wire
    run(ai.structured("sys", {"x": 1}, Pick))
    sent = calls[0]
    assert sent["url"] == "https://router-api.0g.ai/v1/chat/completions"
    assert sent["headers"]["authorization"] == "Bearer sk-test"
    assert sent["headers"]["x-0g-provider-trust-mode"] == "private"
    assert "store" not in sent["body"] and "max_completion_tokens" not in sent["body"]
    assert sent["body"]["max_tokens"] == 2000


def test_0g_falls_back_to_json_object_when_schema_is_refused(wire, zero_g):
    calls, queue = wire
    queue += [httpx.Response(400, json={"error": {"message": "response_format not supported"}}), reply('```json\n{"option_id": "b"}\n```')]
    result, _ = run(ai.structured("sys", {}, Pick))
    assert result.option_id == "b"
    assert calls[1]["body"]["response_format"] == {"type": "json_object"}
    assert "JSON Schema" in calls[1]["body"]["messages"][0]["content"]
    # Remembered: the next call goes straight to json_object.
    run(ai.structured("sys", {}, Pick))
    assert calls[2]["body"]["response_format"] == {"type": "json_object"}


def test_rate_limits_retry_and_an_empty_balance_is_explained(wire, zero_g):
    calls, queue = wire
    queue += [httpx.Response(429, headers={"Retry-After": "1"}, json={}), reply('{"option_id": "c"}')]
    assert run(ai.structured("sys", {}, Pick))[0].option_id == "c"
    queue += [httpx.Response(402, json={"error": {"code": "insufficient_balance"}})]
    with pytest.raises(ai.ProviderError, match="balance is empty"):
        run(ai.structured("sys", {}, Pick))


def test_invalid_output_never_passes(wire, zero_g):
    _, queue = wire
    queue += [reply('{"option_id": 3, "extra": true}')]
    with pytest.raises(ai.ProviderError):
        run(ai.structured("sys", {}, Pick))
    queue += [reply('{"option_id": "a"}', finish="length")]
    with pytest.raises(ai.ProviderError):
        run(ai.structured("sys", {}, Pick))


def test_0g_moderation_uses_the_model_and_fails_closed(wire, zero_g):
    calls, queue = wire
    assert ai.moderation_mode() == "llm"
    queue += [reply('{"flagged": false, "categories": []}')]
    run(ai.moderate("I love long walks."))
    assert calls[-1]["url"].endswith("/chat/completions")
    assert calls[-1]["body"]["messages"][1]["content"] == json.dumps({"text": "I love long walks."})
    queue += [reply('{"flagged": true, "categories": ["harassment"]}')]
    with pytest.raises(ai.ProviderError, match="needs review"):
        run(ai.moderate("..."))
    queue += [httpx.Response(500, json={}), httpx.Response(500, json={})]
    with pytest.raises(ai.ProviderError, match="Safety screening is unavailable"):
        run(ai.moderate("hello"))


def test_a_moderation_key_keeps_the_dedicated_endpoint(wire, zero_g, monkeypatch):
    calls, queue = wire
    monkeypatch.setenv("MODERATION_API_KEY", "sk-openai")
    assert ai.moderation_mode() == "openai"
    queue += [httpx.Response(200, json={"results": [{"flagged": False}]})]
    run(ai.moderate("hello"))
    assert calls[-1]["url"] == "https://api.openai.com/v1/moderations"
    assert calls[-1]["headers"]["authorization"] == "Bearer sk-openai"


def test_transcription_goes_to_the_router(wire, zero_g, monkeypatch):
    calls, queue = wire
    monkeypatch.setenv("TRANSCRIBE_MODEL", "openai/whisper-large-v3")
    queue += [httpx.Response(200, json={"text": "hello there"}), reply('{"flagged": false, "categories": []}')]
    assert run(ai.transcribe_audio(b"abc", "audio/webm")) == "hello there"
    assert calls[0]["url"] == "https://router-api.0g.ai/v1/audio/transcriptions"
    assert calls[0]["headers"]["x-0g-provider-trust-mode"] == "private"


def test_an_openai_base_url_left_in_the_env_group_is_ignored_for_0g(zero_g, monkeypatch):
    monkeypatch.setenv("AI_BASE_URL", "https://api.openai.com/v1")
    assert ai.base_url() == "https://router-api.0g.ai/v1"


def test_every_call_is_logged_with_its_feature_tokens_and_cause(wire, zero_g, client, login, monkeypatch):
    import app.main as main
    from sqlalchemy import delete, select, update
    from app.db import AiUsage, SessionLocal, User
    from app.usage import flush

    flush()  # Start from an empty log; earlier tests in this process made calls too.
    with SessionLocal() as db:
        db.execute(delete(AiUsage))
        db.commit()
    calls, queue = wire
    monkeypatch.setattr(main, "moderate", ai.moderate)
    usage = {"prompt_tokens": 300, "completion_tokens": 900, "total_tokens": 1200,
             "completion_tokens_details": {"reasoning_tokens": 850}}
    verdict = httpx.Response(200, json={"choices": [{"message": {"content": '{"flagged": false, "categories": []}'}, "finish_reason": "stop"}], "usage": usage})
    login("maya")
    queue += [verdict, verdict]
    assert client.put("/api/about", json={"job": "a nurse", "prompts": [{"id": "win", "answer": "Kind to waiters."}]}).status_code == 200
    # Billed even when unusable, and an empty balance is counted as refused.
    queue += [reply('{"option_id": "a"}', finish="length"), httpx.Response(402, json={})]
    for _ in range(2):
        with pytest.raises(ai.ProviderError):
            run(ai.structured("sys", {}, Pick, feature="date_line"))

    flush()
    with SessionLocal() as db:
        rows = db.scalars(select(AiUsage).order_by(AiUsage.created)).all()
        assert [(r.feature, r.status) for r in rows] == [
            ("moderation", "ok"), ("moderation", "ok"), ("date_line", "unusable"), ("date_line", "no_balance"),
        ]
        assert rows[0].area == "PUT /api/about" and rows[0].reasoning_tokens == 850 and rows[0].model == "glm-5.2"
        assert rows[2].total_tokens == 12 and rows[3].total_tokens == 0
        db.execute(update(User).where(User.email == "maya@demo.soulplex.local").values(role="admin"))
        db.commit()

    report = client.get("/api/admin/ai-usage").json()
    assert report["totals"]["calls"] == 4 and report["totals"]["total_tokens"] == 2412
    assert report["totals"]["reasoning_tokens"] == 1700 and report["refused_for_balance"] == 1
    top = report["by_area"][0]
    assert (top["area"], top["feature"], top["calls"]) == ("PUT /api/about", "moderation", 2)
    assert report["by_feature"][0]["feature"] == "moderation"


def test_ids_are_folded_out_of_request_labels():
    from app.usage import route

    assert route("POST", "/api/scenes/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f/decision") == "POST /api/scenes/:id/decision"
    assert route("PUT", "/api/about") == "PUT /api/about"


def test_a_member_cannot_read_ai_usage(client, login):
    login("maya")
    assert client.get("/api/admin/ai-usage").status_code == 403
