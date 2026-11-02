"""Where the AI provider's credits go. One row per model call, tagged with the feature and the
request (or worker job) that made it, so an operator can see what drains the balance.

Recording never breaks the call it describes. Rows wait in memory and are written by flush(),
outside any request's transaction (a second writer mid-request would lock SQLite). The web app
flushes every few seconds and the worker after each job, so a crash loses at most those seconds;
the log line is written at once either way.
"""

import asyncio
import contextvars
import logging
import re
import threading
import time

from sqlalchemy import delete, func, select

from .db import AiUsage, SessionLocal

log = logging.getLogger("soulplex.usage")
# Its own handler: uvicorn leaves the root logger unconfigured, which would drop INFO lines.
_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
log.addHandler(_handler)
log.setLevel(logging.INFO)
log.propagate = False

KEEP_DAYS = 30
MAX_PENDING = 5000

# What started the call: "PUT /api/about", "worker: date", ... Set per request by main.py.
area = contextvars.ContextVar("ai_usage_area", default="background")

_pending = []
_lock = threading.Lock()

_ID = re.compile(r"/(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,}|\d+)(?=/|$)", re.I)


def route(method, path):
    """A request label with ids folded, so every date's scene shares one row in the totals."""
    return f"{method} {_ID.sub('/:id', path)}"


def record(feature, model, usage=None, status="ok"):
    usage = usage or {}
    details = usage.get("completion_tokens_details") or {}
    row = dict(
        created=time.time(),
        area=area.get()[:120],
        feature=feature,
        model=(model or "")[:120],
        status=status,
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        reasoning_tokens=int(details.get("reasoning_tokens") or 0),
        total_tokens=int(usage.get("total_tokens") or 0),
    )
    log.info(
        "ai_usage area=%r feature=%s model=%s status=%s prompt=%d completion=%d reasoning=%d total=%d",
        row["area"], feature, row["model"], status, row["prompt_tokens"], row["completion_tokens"],
        row["reasoning_tokens"], row["total_tokens"],
    )
    with _lock:
        _pending.append(row)
        del _pending[:-MAX_PENDING]


def flush():
    with _lock:
        rows = _pending[:]
        _pending.clear()
    if not rows:
        return
    try:
        with SessionLocal() as db:
            db.add_all([AiUsage(**r) for r in rows])
            db.commit()
    except Exception:
        log.warning("Could not store AI usage; will retry", exc_info=True)
        with _lock:
            _pending[:0] = rows
            del _pending[:-MAX_PENDING]


async def flush_forever(every=10):
    while True:
        await asyncio.sleep(every)
        await asyncio.to_thread(flush)


def prune():
    try:
        with SessionLocal() as db:
            db.execute(delete(AiUsage).where(AiUsage.created < time.time() - KEEP_DAYS * 86400))
            db.commit()
    except Exception:
        log.warning("Could not prune AI usage", exc_info=True)


def summary(db, days=7):
    since = time.time() - days * 86400
    sums = (
        func.count(),
        func.sum(AiUsage.prompt_tokens),
        func.sum(AiUsage.completion_tokens),
        func.sum(AiUsage.reasoning_tokens),
        func.sum(AiUsage.total_tokens),
    )

    def rows(*keys):
        query = select(*keys, *sums).where(AiUsage.created >= since)
        if keys:
            query = query.group_by(*keys).order_by(func.sum(AiUsage.total_tokens).desc())
        out = []
        for r in db.execute(query).all():
            *labels, calls, prompt, completion, reasoning, total = r
            out.append({
                **{k.key: v for k, v in zip(keys, labels)},
                "calls": calls,
                "prompt_tokens": prompt or 0,
                "completion_tokens": completion or 0,
                "reasoning_tokens": reasoning or 0,
                "total_tokens": total or 0,
            })
        return out

    refused = db.scalar(
        select(func.count()).select_from(AiUsage).where(AiUsage.created >= since, AiUsage.status == "no_balance")
    )
    return {
        "days": days,
        "totals": rows()[0],
        "refused_for_balance": refused,
        "by_feature": rows(AiUsage.feature),
        "by_area": rows(AiUsage.area, AiUsage.feature)[:25],
        "by_model": rows(AiUsage.model),
    }
