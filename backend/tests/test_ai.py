import asyncio, json
import httpx, pytest
from app import ai


def test_strict_provider_contract(monkeypatch):
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_MODEL", "test-model")
    real = httpx.AsyncClient

    def reply(request):
        body = json.loads(request.content)
        assert body["response_format"]["json_schema"]["strict"] is True
        assert body["store"] is False
        assert request.headers["authorization"] == "Bearer test-key"
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps(
                                {"reply": "What matters to you?", "facts": []}
                            )
                        },
                    }
                ],
                "usage": {"total_tokens": 22},
            },
        )

    monkeypatch.setattr(
        ai.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(reply), **kw),
    )
    result, tokens = asyncio.run(
        ai.structured("system", {"message": "hello"}, ai.Interview)
    )
    assert result.reply == "What matters to you?" and tokens == 22


def test_provider_failure_never_becomes_demo(monkeypatch):
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_MODEL", "test-model")
    real = httpx.AsyncClient
    monkeypatch.setattr(
        ai.httpx,
        "AsyncClient",
        lambda **kw: real(
            transport=httpx.MockTransport(lambda r: httpx.Response(503)), **kw
        ),
    )
    with pytest.raises(ai.ProviderError):
        asyncio.run(ai.structured("system", {}, ai.Interview))


def test_interview_rejects_invented_memories(monkeypatch):
    async def safe(text):
        pass

    async def fake(system, payload, typ, **_):
        return ai.Interview(
            reply="What else matters?",
            facts=[
                ai.Fact(category="interests", quote="I enjoy cooking."),
                ai.Fact(category="values", quote="I want children."),
                ai.Fact(category="invented", quote="I enjoy cooking."),
            ],
        ), 10

    monkeypatch.setattr(ai, "moderate", safe)
    monkeypatch.setattr(ai, "structured", fake)
    r, t = asyncio.run(ai.interview("I enjoy cooking.", [], [], 0))
    assert len(r.facts) == 1 and r.facts[0].quote == "I enjoy cooking."


def test_scene_cannot_reference_other_persons_private_memory(monkeypatch):
    async def fake(*args, **_):
        return ai.Turn(text="I have a fact.", fact_ids=["someone-elses-fact"]), 10

    monkeypatch.setattr(ai, "structured", fake)
    actor = {
        "id": "a",
        "name": "A",
        "facts": [{"id": "approved-a", "content": "I like cooking."}],
    }
    with pytest.raises(ai.ProviderError):
        asyncio.run(ai.run_dialogue("cafe", actor, {**actor, "id": "b"}))
