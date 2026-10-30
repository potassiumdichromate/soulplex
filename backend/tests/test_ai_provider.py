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
    real_sleep = asyncio.sleep
    monkeypatch.setattr(ai.asyncio, "sleep", lambda *_: real_sleep(0))
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
