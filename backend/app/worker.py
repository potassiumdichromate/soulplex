"""Durable DB-backed bounded jobs. Run separately: python -m app.worker."""

import asyncio, time, os, logging
from sqlalchemy import select, update
from .db import SessionLocal, Scene, User, init_db
from .domain import scene_ok, stale, actor_data
from .ai import run_dialogue, ProviderError
from . import minds
from .minds import enabled as minds_enabled, bind_mind, judge_score, judge_enabled
from .mind_sync import process_outbox
from .studio import external_allowed
from .resonance import assess
from .security import log

logging.basicConfig(level=logging.INFO)


async def process_one():
    with SessionLocal() as db:
        db.execute(
            update(Scene)
            .where(Scene.status == "running", Scene.started < time.time() - 1100)
            .values(
                status="failed",
                dedupe_key=None,
                error="Worker timed out. Start a new experience.",
            )
        )
        db.commit()
        sid = db.scalar(
            select(Scene.id)
            .where(Scene.status == "queued")
            .order_by(Scene.created)
            .limit(1)
        )
        if not sid:
            return False
        claimed = db.execute(
            update(Scene)
            .where(Scene.id == sid, Scene.status == "queued")
            .values(status="running", started=time.time())
        )
        db.commit()
        if not claimed.rowcount:
            return True
        scene = db.get(Scene, sid)
        a, b = db.get(User, scene.a), db.get(User, scene.b)
        if not scene_ok(db, scene, a, b) or stale(scene, a, b):
            scene.status = "failed"
            scene.dedupe_key = None
            scene.error = "Profiles changed. Start a fresh experience."
            db.commit()
            return True
        try:
            if minds_enabled():
                for person in (a, b):
                    if external_allowed(db, person):
                        await bind_mind(db, person)
                db.commit()
        except ProviderError as exc:
            scene.status = "failed"
            scene.dedupe_key = None
            scene.error = str(exc)
            db.commit()
            return True
        aa, bb = actor_data(db, a), actor_data(db, b)
        venue = scene.venue
        sid = scene.id
    try:
        if not aa["facts"] or not bb["facts"]:
            raise ProviderError(
                "Both representatives need approved shareable memories."
            )
        engine_note = await _check_cognition(aa, bb)
        output, tokens = await asyncio.wait_for(
            run_dialogue(venue, aa, bb, sid),
            timeout=900 if minds_enabled() else 480,
        )
        assessment, extra = await asyncio.wait_for(
            assess(aa, bb, output["dialogue"]), timeout=120
        )
        minds_spoke = bool(minds_enabled() and aa.get("mind_id") and bb.get("mind_id"))
        if minds_spoke and judge_enabled():
            try:
                judged = await asyncio.wait_for(
                    judge_score(sid, aa, bb, output["dialogue"]), timeout=80
                )
                # Blend rather than replace, so the dimensions still explain the number.
                assessment["judge_score"] = judged
                assessment["score"] = round((assessment["score"] + judged) / 2)
                assessment["method"] = assessment["method"] + "+minds-judge"
            except Exception:
                logging.warning("Mind score unavailable; keeping the reflection score")
        output["assessment"] = assessment
        output["engine"] = "hellominds" if minds_spoke else "model"
        if engine_note:
            output["engine_note"] = engine_note
        tokens += extra
        with SessionLocal() as db:
            s = db.get(Scene, sid)
            if not s:
                return True
            a, b = db.get(User, s.a), db.get(User, s.b)
            if not scene_ok(db, s, a, b) or stale(s, a, b):
                s.status = "failed"
                s.dedupe_key = None
                s.error = "Consent or memory changed during the experience."
            else:
                s.output = output
                s.tokens = tokens
                s.model = (
                    "hellominds" if minds_spoke else os.environ.get("AI_MODEL", "")
                )
                s.status = "completed"
                log(db, a, "scene_completed", sid)
            db.commit()
    except Exception as exc:
        with SessionLocal() as db:
            s = db.get(Scene, sid)
            if s:
                s.status = "failed"
                s.dedupe_key = None
                s.error = (
                    str(exc)
                    if isinstance(exc, ProviderError)
                    else "The experience could not complete. Please try again."
                )
                db.commit()
        logging.warning("Scene job %s failed (%s)", sid, type(exc).__name__)
    return True


async def _check_cognition(aa, bb):
    """Hello Minds stops replying when a Mind runs out of Cognition. Check before the first line."""
    if not (minds_enabled() and aa.get("mind_id") and bb.get("mind_id")):
        return ""
    short = await minds.short_of_cognition([aa["mind_id"], bb["mind_id"]])
    if not short:
        return ""
    if os.getenv("AI_API_KEY") and os.getenv("AI_MODEL"):
        aa["mind_id"] = bb["mind_id"] = ""
        return "A Hello Mind was out of Cognition, so the configured model spoke for both agents."
    raise ProviderError(
        "An agent has run out of Cognition on Hello Minds. Top it up, then start the date again."
    )


async def loop():
    init_db()
    try:
        while True:
            busy = await process_one()
            try:
                if await process_outbox():
                    busy = True
            except Exception:
                logging.exception("Hello Minds outbox pass failed")
            if not busy:
                await asyncio.sleep(1)
    finally:
        await minds.aclose()


if __name__ == "__main__":
    asyncio.run(loop())
