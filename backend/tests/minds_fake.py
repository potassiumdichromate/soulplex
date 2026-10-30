"""An in-process Hello Minds API for tests, served through httpx.MockTransport.

It follows the wire shapes in app/minds.py: no envelope, newest-first history, and an SSE
stream that emits MessageRecord JSON. Each human message gets one Mind reply.
"""

import asyncio
import json
import re

import httpx


class FakeMinds:
    def __init__(self, stream=True, crlf=True):
        self.stream = stream
        self.crlf = crlf
        self.minds = {}
        self.conversations = {}
        self.messages = {}
        self.circles = {}
        self.skills = {}
        self.credits = 500
        self.calls = []
        self.fail = {}  # path prefix -> list of (status, headers, body) to return first
        self.counter = 0

    def transport(self):
        return httpx.MockTransport(self.handle)

    def _fp(self):
        self.counter += 1
        return f"fp-{self.counter:05d}"

    def reply_for(self, alias, text):
        if "predictions" in text:
            labels = sorted(set(re.findall(r'"id": "(q\d+)"', text)), key=lambda x: int(x[1:]))
            return json.dumps({"predictions": [{"id": label, "value": 4} for label in labels]})
        if alias.startswith("judge-"):
            return '{"score": 80}'
        if alias.startswith("date-"):
            return "I love a slow weekend with long lunches, what about you?"
        if alias.startswith("soul-"):
            return "Understood."
        return "Hello from your Mind."

    async def handle(self, request: httpx.Request):
        path = request.url.path
        method = request.method
        body = json.loads(request.content) if request.content else None
        self.calls.append((method, path, body, dict(request.url.params)))
        for prefix, queue in self.fail.items():
            if path.startswith(prefix) and queue:
                status, headers, payload = queue.pop(0)
                if status == "network":
                    raise httpx.ConnectError("boom", request=request)
                return httpx.Response(status, headers=headers, json=payload)
        if path == "/v1/minds/check/name":
            taken = any(m["mindName"] == request.url.params.get("name") for m in self.minds.values())
            return httpx.Response(200, json={"isAvailable": not taken})
        if path == "/v1/minds/awaken" and method == "POST":
            mind_id = f"mind-{len(self.minds) + 1}"
            self.minds[mind_id] = {
                "mindId": mind_id,
                "mindName": body["mindName"],
                "mindEmail": f"{mind_id}@hellominds.ai",
                "isEnabled": True,
                "type": body["id"],
            }
            return httpx.Response(200, json={"mindId": mind_id, "mindEmail": f"{mind_id}@hellominds.ai"})
        m = re.fullmatch(r"/v1/minds/([^/]+)(/.*)?", path)
        if m and m.group(1) in self.minds:
            mind = self.minds[m.group(1)]
            rest = m.group(2) or ""
            if rest == "" and method == "GET":
                return httpx.Response(200, json={"mindId": mind["mindId"], "email": mind["mindEmail"], "isEnabled": mind["isEnabled"]})
            if rest == "" and method == "PATCH":
                mind["isEnabled"] = body["isEnabled"]
                return httpx.Response(200, json={"msg": "ok", "result": None})
            if rest == "/credits":
                return httpx.Response(200, json={"mindId": mind["mindId"], "swarm": self.credits})
            if rest == "/cognition/usage-by-tool":
                return httpx.Response(200, json={"summary": [], "timeline": []})
            if rest == "/skills":
                have = self.skills.setdefault(mind["mindId"], set())
                if method == "GET":
                    return httpx.Response(200, json=[{"skillId": s, "source": "mind"} for s in sorted(have)])
                if method == "PUT":
                    have.update(body["ids"])
                else:
                    have.difference_update(body["ids"])
                return httpx.Response(200, json={"results": [{"skillId": s, "changed": True} for s in body["ids"]]})
        if path == "/v1/messaging/conversation" and method == "POST":
            if body["alias"] in self.conversations:
                return httpx.Response(409, json={"error": {"type": "conflict", "message": "exists"}})
            self.conversations[body["alias"]] = body["mindId"]
            self.messages.setdefault(body["alias"], [])
            return httpx.Response(200, json={"alias": body["alias"], "mindId": body["mindId"]})
        m = re.fullmatch(r"/v1/messaging/conversations/(.+)", path)
        if m:
            return httpx.Response(200, json={"alias": m.group(1), "mindId": self.conversations.get(m.group(1))})
        m = re.fullmatch(r"/v1/messaging/histories/(.+)", path)
        if m:
            rows = list(reversed(self.messages.get(m.group(1), [])))
            return httpx.Response(200, json=rows[: int(request.url.params.get("limit", 50))])
        if path == "/v1/messaging/message" and method == "POST":
            alias = body["alias"]
            log = self.messages.setdefault(alias, [])
            log.append({"fingerprint": self._fp(), "messageText": body["messageText"], "senderType": 1, "senderName": "You", "alias": alias})
            log.append({
                "fingerprint": self._fp(),
                "messageText": self.reply_for(alias, body["messageText"]),
                "senderType": 0,
                "mindId": self.conversations.get(alias),
                "alias": alias,
            })
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/messaging/events":
            if not self.stream:
                return httpx.Response(404, json={"error": "not_found"})
            alias = request.url.params.get("alias")
            start = len(self.messages.get(alias, []))
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=self._events(alias, start))
        m = re.fullmatch(r"/v1/circles/([^/]+)", path)
        if m:
            members = self.circles.setdefault(m.group(1), set())
            if method == "POST":
                members.update(body["emails"])
            elif method == "DELETE":
                members.difference_update(body["emails"])
            return httpx.Response(200, json={"items": sorted(members)})
        return httpx.Response(404, json={"error": "not_found", "message": path})

    async def _events(self, alias, start):
        nl = "\r\n" if self.crlf else "\n"
        yield f": connected{nl}{nl}".encode()
        sent = start
        for _ in range(500):
            rows = self.messages.get(alias, [])
            while sent < len(rows):
                row = rows[sent]
                sent += 1
                data = json.dumps(row)
                # Split one event across two data lines (between JSON keys) to exercise multi-line parsing.
                head, tail = data.split(", ", 1)
                yield f"event: message{nl}data: {head},{nl}data:{tail}{nl}{nl}".encode()
            await asyncio.sleep(0.01)
