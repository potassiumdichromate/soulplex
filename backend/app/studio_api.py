"""Twin Studio routes. Frontend navigation never grants a permission by itself."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .ai import ProviderError
from .db import (
    CalibrationRun,
    ConsentRecord,
    DeletionRequest,
    Memory,
    Participation,
    Scene,
    StudioAnswer,
    get_db,
    now,
    uid,
)
from .security import log
from .studio import (
    NOTICE_VERSION,
    CONSENTS,
    SCHEMA_VERSION,
    answer_view,
    answers_for,
    apply_profile,
    calibration_view,
    cancel_queued,
    consents_for,
    decision_context,
    external_allowed,
    fidelity,
    granted,
    guidance_text,
    independent_answer,
    pilot_metrics,
    preview_lines,
    prompt_hash,
    scenario,
    schema,
    shareable_text,
    validate_answer,
    why_click,
)

router = APIRouter(prefix="/api")


class AnswerIn(BaseModel):
    option_ids: list[str] = []
    free_text: str = ""
    status: str = "answered"
    mode: str = "taps"


class StateIn(BaseModel):
    step: str = Field(max_length=40)
    mode: str = Field(default="taps", max_length=20)


class AgeIn(BaseModel):
    adult: bool


class RangeIn(BaseModel):
    age_min: int = Field(ge=18, le=100)
    age_max: int = Field(ge=18, le=100)
    city: str


class ScopeIn(BaseModel):
    field_id: str
    permission_scope: str


class PreviewIn(BaseModel):
    lines: list[str] = []


class ConsentIn(BaseModel):
    grants: dict[str, bool]


class ReviewIn(BaseModel):
    rating: str
    correction: str = ""


class RepresentIn(BaseModel):
    rating: str
    note: str = ""


def _external_changed(db, user, allowed):
    """Turning the external provider on wakes or re-enables the Mind; turning it off disables it."""
    from .mind_sync import enqueue

    if allowed:
        if user.mind_id:
            enqueue(db, user.id, "set_enabled", {"enabled": True})
            enqueue(db, user.id, "sync_persona")
        else:
            enqueue(db, user.id, "awaken")
    elif user.mind_id:
        enqueue(db, user.id, "set_enabled", {"enabled": False})


def _me(request, db, mutate=False):
    from .main import me

    return me(request, db, mutate)


def _answers(db, user_id):
    return answers_for(db, user_id)


def _save_answer(db, user, field_id, body: AnswerIn):
    try:
        clean = validate_answer(field_id, body.option_ids, body.free_text, body.status)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    row = db.scalar(
        select(StudioAnswer).where(StudioAnswer.user_id == user.id, StudioAnswer.field_id == field_id)
    )
    if not row:
        row = StudioAnswer(user_id=user.id, field_id=field_id)
        db.add(row)
    else:
        row.answer_version += 1
    row.option_ids = clean["option_ids"]
    row.free_text = clean["free_text"]
    row.status = clean["status"]
    row.source = "owner"
    row.schema_version = SCHEMA_VERSION
    row.permission_scope = row.permission_scope or "private"
    row.updated = now()
    db.flush()
    apply_profile(user, _answers(db, user.id))
    log(db, user, "studio_answer", field_id)
    return row


@router.get("/onboarding/schema")
def onboarding_schema():
    return schema()


@router.get("/onboarding")
def onboarding_state(request: Request, db: Session = Depends(get_db)):
    user = _me(request, db)
    runs = db.scalars(select(CalibrationRun).where(CalibrationRun.user_id == user.id)).all()
    return {
        "studio": dict(user.studio or {}),
        "age_verified": bool(user.age_verified),
        "answers": [answer_view(row) for row in _answers(db, user.id)],
        "consents": {row.purpose: row.granted for row in consents_for(db, user.id)},
        "calibration": [calibration_view(row) for row in runs],
        "fidelity": fidelity(runs),
        "schema_version": SCHEMA_VERSION,
    }


@router.put("/onboarding/state")
def save_state(body: StateIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    studio = dict(user.studio or {})
    studio["step"] = body.step
    studio["mode"] = body.mode if body.mode in ("taps", "talk") else "taps"
    user.studio = studio
    log(db, user, "studio_resume", body.step)
    db.commit()
    return {"studio": studio}


@router.post("/onboarding/age")
def confirm_age(body: AgeIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    if not body.adult or user.age < 18:
        raise HTTPException(422, "Soulplex is for adults. This check is separate from the ages you hope to meet.")
    user.age_verified = True
    studio = dict(user.studio or {})
    studio["step"] = "mode"
    user.studio = studio
    log(db, user, "age_verified")
    db.commit()
    return {"age_verified": True}


@router.put("/onboarding/range")
def save_range(body: RangeIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    if body.age_min > body.age_max:
        raise HTTPException(422, "The youngest age in your range has to come first.")
    if body.city not in ("Dubai", "Delhi NCR"):
        raise HTTPException(422, "Choose Dubai or Delhi NCR.")
    user.age_min = body.age_min
    user.age_max = body.age_max
    user.city = body.city
    log(db, user, "studio_range", body.city)
    db.commit()
    return {"age_min": user.age_min, "age_max": user.age_max, "city": user.city}


@router.put("/onboarding/answers/{field_id}")
def save_answer(field_id: str, body: AnswerIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    if field_id.startswith("Q01") or field_id == "Q02":
        if not user.age_verified:
            raise HTTPException(409, "Confirm that you are 18 or older before matching questions.")
    row = _save_answer(db, user, field_id, body)
    db.commit()
    return answer_view(row)


@router.post("/onboarding/preview")
def make_preview(request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    lines = preview_lines(_answers(db, user.id))
    studio = dict(user.studio or {})
    studio["previewed"] = True
    studio["step"] = "preview"
    user.studio = studio
    log(db, user, "studio_preview")
    db.commit()
    return {
        "lines": lines,
        "scored": False,
        "label": "This is a mirror of what you chose. It is not a personality reading, and it is not a fidelity score.",
    }


@router.post("/onboarding/preview/approve")
def approve_preview(body: PreviewIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    allowed = set(preview_lines(_answers(db, user.id)))
    saved = []
    for line in body.lines:
        text = line.strip()
        if not text or text not in allowed:
            raise HTTPException(422, "Only the preview lines can be saved, and you can delete one before saving.")
        existing = db.scalar(
            select(Memory).where(Memory.user_id == user.id, Memory.source_id == "studio:" + text[:80])
        )
        if existing:
            saved.append(existing.id)
            continue
        memory = Memory(
            user_id=user.id,
            category="values",
            content=text,
            source_quote=text,
            source_id="studio:" + text[:80],
            status="approved",
            visibility="private",
        )
        db.add(memory)
        db.flush()
        saved.append(memory.id)
    if saved:
        user.memory_version += 1
    db.commit()
    return {"saved": saved, "visibility": "private"}


@router.put("/onboarding/facts/{field_id}")
def fact_scope(field_id: str, body: ScopeIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    if body.permission_scope not in ("private", "twin", "shareable"):
        raise HTTPException(422, "Choose private, twin only, or shareable.")
    if not granted(db, user, "allow_shareable_facts") and body.permission_scope == "shareable":
        raise HTTPException(409, "Turn on sharing approved facts before a fact can be shareable.")
    row = db.scalar(select(StudioAnswer).where(StudioAnswer.user_id == user.id, StudioAnswer.field_id == field_id))
    if not row or row.status != "answered":
        raise HTTPException(404, "There is no answered fact to permission.")
    row.permission_scope = body.permission_scope
    row.answer_version += 1
    from .studio import label_of

    text = ". ".join(label_of(field_id, option) for option in row.option_ids)
    linked = db.scalar(select(Memory).where(Memory.user_id == user.id, Memory.source_id == "studio:" + field_id))
    if body.permission_scope == "private":
        if linked:
            linked.visibility = "private"
            linked.status = "approved"
    else:
        if not linked:
            linked = Memory(
                user_id=user.id,
                category="values",
                content=text,
                source_quote=text,
                source_id="studio:" + field_id,
                status="approved",
                visibility=body.permission_scope,
            )
            db.add(linked)
        else:
            linked.visibility = body.permission_scope
            linked.content = text
            linked.status = "approved"
    log(db, user, "fact_scope", field_id)
    user.memory_version += 1
    db.commit()
    return answer_view(row)


@router.post("/calibration/{scenario_id}/owner")
def lock_owner(scenario_id: str, body: AnswerIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    scene = scenario(scenario_id)
    if not scene:
        raise HTTPException(404, "Unknown challenge.")
    if body.status != "answered" or len(body.option_ids) != 1:
        raise HTTPException(422, "Choose one response.")
    allowed = {o["id"] for o in scene["options"]}
    if body.option_ids[0] not in allowed:
        raise HTTPException(422, "Choose one of the listed responses.")
    row = db.scalar(
        select(CalibrationRun).where(CalibrationRun.user_id == user.id, CalibrationRun.scenario_id == scenario_id)
    )
    if not row:
        row = CalibrationRun(user_id=user.id, scenario_id=scenario_id, unseen=scene["unseen"])
        db.add(row)
    changed = row.owner_locked and row.owner_option != body.option_ids[0]
    row.owner_option = body.option_ids[0]
    row.owner_why = (body.free_text or "")[:400]
    row.owner_locked = now()
    if changed:
        row.twin_option = ""
        row.twin_summary = ""
        row.twin_locked = 0
        row.twin_method = ""
        row.rating = ""
        row.prompt_hash = ""
    log(db, user, "calibration_owner", scenario_id)
    db.commit()
    return calibration_view(row, reveal=False)


@router.post("/calibration/{scenario_id}/run")
async def run_twin(scenario_id: str, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    scene = scenario(scenario_id)
    if not scene:
        raise HTTPException(404, "Unknown challenge.")
    row = db.scalar(
        select(CalibrationRun).where(CalibrationRun.user_id == user.id, CalibrationRun.scenario_id == scenario_id)
    )
    if not row or not row.owner_locked:
        raise HTTPException(409, "Lock your own answer before your twin tries.")
    if row.twin_locked:
        return calibration_view(row)
    facts = [item["content"] for item in guidance_text(db, user.id)]
    corrections = [
        other.correction
        for other in db.scalars(select(CalibrationRun).where(CalibrationRun.user_id == user.id)).all()
        if other.correction and other.correction_status == "approved" and other.scenario_id != scenario_id
    ]
    context = decision_context(scene, facts, corrections)
    if row.owner_option and row.owner_option in str(context):
        # Option ids can theoretically collide with fact text. The owner field itself must stay out.
        pass
    if "owner_option" in context or "owner_why" in context:
        raise HTTPException(500, "The twin prompt was refused because it included the held-out answer.")
    try:
        choice = await independent_answer(scene, context)
    except ProviderError as exc:
        raise HTTPException(503, str(exc)) from exc
    row.twin_option = choice.option_id
    row.twin_summary = choice.summary.strip()
    row.twin_locked = now()
    row.twin_method = "model"
    row.provider = "configured"
    row.prompt_hash = prompt_hash(context)
    row.context_version = user.memory_version
    log(db, user, "calibration_locked", scenario_id)
    db.commit()
    return calibration_view(row)


@router.post("/calibration/{scenario_id}/review")
def review_twin(scenario_id: str, body: ReviewIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    if body.rating not in ("yes", "somewhat", "no"):
        raise HTTPException(422, "Choose yes, somewhat, or no.")
    row = db.scalar(
        select(CalibrationRun).where(CalibrationRun.user_id == user.id, CalibrationRun.scenario_id == scenario_id)
    )
    if not row or not row.twin_locked:
        raise HTTPException(409, "There is no locked twin answer to review.")
    row.rating = body.rating
    note = body.correction.strip()
    if note:
        row.correction = note[:600]
        row.correction_status = "proposed"
        db.add(
            Memory(
                user_id=user.id,
                category="communication",
                content=note[:600],
                source_quote=note[:600],
                source_id="calibration:" + scenario_id + ":" + uid()[:8],
                status="proposed",
                visibility="private",
            )
        )
    log(db, user, "calibration_review", scenario_id)
    db.commit()
    return calibration_view(row)


@router.post("/calibration/{scenario_id}/correction")
def approve_correction(scenario_id: str, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    row = db.scalar(
        select(CalibrationRun).where(CalibrationRun.user_id == user.id, CalibrationRun.scenario_id == scenario_id)
    )
    if not row or not row.correction:
        raise HTTPException(404, "There is no correction to approve.")
    row.correction_status = "approved"
    db.add(
        Memory(
            user_id=user.id,
            category="communication",
            content=row.correction,
            source_quote=row.correction,
            source_id="calibration-approved:" + scenario_id,
            status="approved",
            visibility="twin",
        )
    )
    user.memory_version += 1
    log(db, user, "calibration_correction", scenario_id)
    db.commit()
    return calibration_view(row)


@router.get("/privacy/permissions")
def get_permissions(request: Request, db: Session = Depends(get_db)):
    user = _me(request, db)
    stored = {row.purpose: row.granted for row in consents_for(db, user.id)}
    return {
        "notice_version": NOTICE_VERSION,
        "grants": {purpose: stored.get(purpose, False) for purpose, _label in CONSENTS},
        "external_status": "disabled" if not stored.get("allow_external_minds") else "authorized",
    }


@router.put("/privacy/permissions")
def put_permissions(body: ConsentIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    known = {purpose for purpose, _label in CONSENTS}
    for purpose, value in body.grants.items():
        if purpose not in known:
            raise HTTPException(422, "Unknown permission.")
        row = db.scalar(select(ConsentRecord).where(ConsentRecord.user_id == user.id, ConsentRecord.purpose == purpose))
        if not row:
            row = ConsentRecord(user_id=user.id, purpose=purpose)
            db.add(row)
        row.granted = bool(value)
        row.notice_version = NOTICE_VERSION
        row.updated = now()
    if body.grants.get("allow_virtual_interactions") is False:
        user.auto_accept = False
    if "allow_external_minds" in body.grants:
        _external_changed(db, user, bool(body.grants["allow_external_minds"]))
    studio = dict(user.studio or {})
    studio["step"] = "permissions"
    user.studio = studio
    log(db, user, "consent_updated")
    db.commit()
    return {"grants": {row.purpose: row.granted for row in consents_for(db, user.id)}}


@router.post("/privacy/revoke")
def revoke(request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    for row in consents_for(db, user.id):
        if row.purpose != "notice_ack":
            row.granted = False
            row.updated = now()
    user.auto_accept = False
    user.discovery = False
    _external_changed(db, user, False)
    stopped = cancel_queued(db, user.id)
    user.memory_version += 1
    log(db, user, "consent_revoked")
    db.commit()
    return {"stopped": stopped, "external_status": "revoked"}


@router.get("/privacy/delete-status")
def delete_status(request: Request, db: Session = Depends(get_db)):
    user = _me(request, db)
    row = db.get(DeletionRequest, user.id)
    return {"status": row.status if row else "none", "detail": row.detail if row else ""}


@router.post("/twin/authorize")
def authorize(request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    missing = []
    if not user.age_verified:
        missing.append("age")
    if not user.email_verified:
        missing.append("email")
    if not granted(db, user, "allow_matching"):
        missing.append("matching")
    if not granted(db, user, "allow_virtual_interactions"):
        missing.append("virtual_dates")
    runs = db.scalars(select(CalibrationRun).where(CalibrationRun.user_id == user.id)).all()
    reviewed = [r for r in runs if r.scenario_id in ("CAL02", "CAL01", "CAL03") and r.rating and r.twin_method == "model"]
    mode = "ready" if not missing and len(reviewed) >= 3 else "private_only" if not missing else "local_only"
    if not external_allowed(db, user):
        mode = "local_only" if mode == "ready" else mode
    studio = dict(user.studio or {})
    studio["readiness"] = mode
    user.studio = studio
    db.commit()
    from .personality_api import readiness

    return {"readiness": mode, "missing": missing, "fidelity": fidelity(runs), "personality": readiness(db, user)}


@router.post("/trust/identity")
def request_identity(request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    if user.identity_status != "verified":
        user.identity_status = "pending"
    log(db, user, "identity_requested")
    db.commit()
    return {"identity_status": user.identity_status}


@router.post("/scenes/{sid}/representation")
def representation(sid: str, body: RepresentIn, request: Request, db: Session = Depends(get_db)):
    user = _me(request, db, True)
    from .domain import get_scene

    if body.rating not in ("yes", "somewhat", "no"):
        raise HTTPException(422, "Choose yes, somewhat, or no.")
    scene, _a, _b = get_scene(db, sid, user)
    if scene.status != "completed":
        raise HTTPException(409, "Review a completed date.")
    part = db.scalar(select(Participation).where(Participation.scene_id == sid, Participation.user_id == user.id))
    feedback = dict(part.feedback or {})
    feedback["represented"] = body.rating
    note = body.note.strip()
    if note:
        feedback["correction"] = note[:600]
        db.add(
            Memory(
                user_id=user.id,
                category="communication",
                content=note[:600],
                source_quote=note[:600],
                source_id="date-correction:" + sid,
                status="proposed",
                visibility="private",
            )
        )
    part.feedback = feedback
    log(db, user, "representation_" + body.rating, sid)
    db.commit()
    return {"feedback": feedback}


def scene_click(db, scene, user, partner, output):
    if scene.status != "completed":
        return None
    lines = [line.get("text", "") for line in (output.get("dialogue") or [])]
    return why_click(shareable_text(db, user.id), shareable_text(db, partner.id), lines)
