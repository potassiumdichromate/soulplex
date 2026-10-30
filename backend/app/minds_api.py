"""Hello Minds routes: a member's own Mind, and operator health and repair tools."""

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import minds
from .db import MindLink, MindTask, User, get_db, now
from .mind_sync import enqueue, outbox_summary
from .security import log, quota
from .studio import external_allowed

router = APIRouter(prefix="/api")


class SkillsIn(BaseModel):
    ids: list[str] = Field(max_length=32)


def _me(request, db, mutate=False):
    from .main import me

    return me(request, db, mutate)


def _admin(request, db, mutate=False):
    from .main import admin

    return admin(request, db, mutate)


def _pending_sync(db, user_id):
    return bool(
        db.scalar(
            select(MindTask.id).where(
                MindTask.user_id == user_id, MindTask.kind == "sync_persona", MindTask.status.in_(("pending", "running"))
            )
        )
    )


@router.get("/agent/mind")
async def my_mind(request: Request, usage: bool = False, db: Session = Depends(get_db)):
    """The member's own Mind: status, Cognition balance, persona sync state and, on request, usage."""
    user = _me(request, db)
    data = {
        "integration": minds.enabled(),
        "consented": external_allowed(db, user),
        "mind": None,
        "persona": None,
    }
    if not minds.enabled() or not user.mind_id:
        return data
    link = db.get(MindLink, user.id)
    data["persona"] = {
        "version": link.persona_version if link else 0,
        "synced": link.synced if link else 0,
        "pending": _pending_sync(db, user.id),
    }
    mind = {"id": user.mind_id, "email": user.mind_email}
    user_id, mind_id = user.id, user.mind_id
    db.rollback()
    try:
        detail = await minds.get_mind(mind_id)
        if isinstance(detail, dict):
            mind["enabled"] = detail.get("isEnabled")
            mind["species"] = detail.get("species")
        mind["cognition"] = await minds.cognition(mind_id, max_age=30)
        if usage:
            quota(db, "mind-usage:" + user_id, 60)
            db.commit()
            mind["usage_by_tool"] = await minds.usage_by_tool(mind_id, "day")
    except minds.MindsError as exc:
        mind["error"] = {"status": exc.status, "code": exc.code}
    data["mind"] = mind
    return data


@router.get("/agent/mind/skills")
async def my_skills(request: Request, db: Session = Depends(get_db)):
    """Skills the operator allows, and which of them this Mind carries."""
    user = _me(request, db)
    allowed = minds.allowed_skills()
    if not minds.enabled() or not user.mind_id or not allowed:
        return {"allowed": [], "equipped": []}
    mind_id = user.mind_id
    db.rollback()
    try:
        rows = await minds.equipped_skills(mind_id)
    except minds.MindsError as exc:
        raise HTTPException(503, "Hello Minds could not list skills. " + str(exc)) from exc
    equipped = [str(r.get("skillId") or r.get("id")) for r in rows if isinstance(r, dict)]
    return {"allowed": allowed, "equipped": [s for s in equipped if s in allowed]}


@router.put("/agent/mind/skills")
async def set_skills(body: SkillsIn, request: Request, db: Session = Depends(get_db)):
    """Equip only operator-allowed skills. Skills outside the list are never touched."""
    user = _me(request, db, True)
    allowed = set(minds.allowed_skills())
    if not minds.enabled() or not user.mind_id or not external_allowed(db, user):
        raise HTTPException(409, "Your agent needs Hello Minds turned on first.")
    wanted = set(body.ids)
    if not wanted <= allowed:
        raise HTTPException(422, "That skill is not offered on Soulplex.")
    quota(db, "mind-skills:" + user.id, 30)
    log(db, user, "mind_skills")
    db.commit()
    mind_id = user.mind_id
    try:
        rows = await minds.equipped_skills(mind_id)
        current = {str(r.get("skillId") or r.get("id")) for r in rows if isinstance(r, dict)} & allowed
        add, drop = sorted(wanted - current), sorted(current - wanted)
        if add:
            await minds.equip_skills(mind_id, add)
        if drop:
            await minds.unequip_skills(mind_id, drop)
    except minds.MindsError as exc:
        raise HTTPException(503, "Hello Minds could not update skills. " + str(exc)) from exc
    return {"equipped": sorted(wanted), "added": add, "removed": drop}


@router.get("/admin/minds")
def minds_status(request: Request, db: Session = Depends(get_db)):
    _admin(request, db)
    linked = db.scalar(select(func.count()).select_from(User).where(User.mind_id != "")) or 0
    return {
        "enabled": minds.enabled(),
        "config": {
            "base": os.getenv("MINDS_API_BASE", "https://api.build.hellominds.ai"),
            "mind_type": os.getenv("MINDS_MIND_TYPE", "mastermind"),
            "stream": minds._streaming(),
            "judge": minds.judge_enabled(),
            "allowed_skills": len(minds.allowed_skills()),
        },
        "minds": linked,
        "metrics": minds.snapshot(),
        "outbox": outbox_summary(db),
    }


@router.post("/admin/minds/doctor")
async def minds_doctor(request: Request, db: Session = Depends(get_db)):
    _admin(request, db, True)
    db.rollback()
    if not minds.enabled():
        return {"ok": False, "code": "missing_builder_api_key"}
    return await minds.doctor()


@router.post("/admin/minds/tasks/{task_id}/retry")
def retry_task(task_id: str, request: Request, db: Session = Depends(get_db)):
    operator = _admin(request, db, True)
    task = db.get(MindTask, task_id)
    if not task or task.status != "failed":
        raise HTTPException(404, "No failed task with that id.")
    task.status = "pending"
    task.next_at = now()
    task.attempts = 0
    log(db, operator, "mind_task_retry", task_id)
    db.commit()
    return {"ok": True}


@router.post("/admin/minds/resync")
def resync(request: Request, db: Session = Depends(get_db)):
    """Queue a persona sync for every consenting member with a Mind, after a prompt change."""
    operator = _admin(request, db, True)
    count = 0
    for user in db.scalars(select(User).where(User.mind_id != "")):
        if external_allowed(db, user):
            link = db.get(MindLink, user.id)
            if link:
                link.persona_hash = ""
            enqueue(db, user.id, "sync_persona")
            count += 1
    log(db, operator, "mind_resync", str(count))
    db.commit()
    return {"queued": count}


@router.post("/admin/minds/breaker/reset")
def reset_breaker(request: Request, db: Session = Depends(get_db)):
    _admin(request, db, True)
    minds._BREAKER.reset()
    return {"circuit": minds._BREAKER.state()}
