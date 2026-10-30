import hashlib
from sqlalchemy import select, or_, and_
from fastapi import HTTPException
from .db import User, Memory, Block, Scene, Participation, PersonalityProfile
from .faces import view as face_view
from .about import violates, completion
from .date_types import spot_for
from .studio import cities_fit, external_allowed, guidance_text, matching_allowed, why_click
from .personality import shared_levels, style_hints


def scene_key(a, b, venue, a_version, b_version):
    pair = sorted(((a, a_version), (b, b_version)))
    raw = f"{pair[0][0]}:{pair[0][1]}|{pair[1][0]}:{pair[1][1]}|{venue}"
    return hashlib.sha256(raw.encode()).hexdigest()


def memories(db, user_id, shareable=False):
    q = (
        select(Memory)
        .where(Memory.user_id == user_id, Memory.status == "approved")
        .order_by(Memory.updated.desc())
    )
    if shareable:
        q = q.where(Memory.visibility == "shareable")
    return db.scalars(q).all()


def fact_data(m):
    return {
        "id": m.id,
        "category": m.category,
        "content": m.content,
        "source_quote": m.source_quote,
        "source_id": m.source_id,
        "status": m.status,
        "visibility": m.visibility,
        "version": m.version,
        "updated": m.updated,
    }


def public_profile(u, revealed=False):
    return {
        "face": face_view(u.face, revealed=revealed),
        "about": {k: v for k, v in (u.about or {}).items() if k != "dealbreakers"},
        "id": u.id,
        "hue": int(hashlib.sha256(u.id.encode()).hexdigest()[:4], 16) % 360,
        "name": u.name,
        "age": u.age,
        "city": u.city,
        "intent": u.intent,
        "synthetic": u.synthetic,
    }


def own_profile(u):
    return {
        **public_profile(u),
        "face": face_view(u.face, owner=True),
        "about": dict(u.about or {}),
        "about_complete": completion(u.about or {}),
        "auto_accept": u.auto_accept is not False,
        "age_verified": bool(getattr(u, "age_verified", False)),
        "identity_status": getattr(u, "identity_status", None) or "unverified",
        "studio": dict(getattr(u, "studio", None) or {}),
        "public_dates": bool(u.public_dates),
        "email": u.email,
        "gender": u.gender,
        "seeking": u.seeking,
        "age_min": u.age_min,
        "age_max": u.age_max,
        "contact": u.contact,
        "discovery": u.discovery,
        "verified": u.verified,
        "email_verified": u.email_verified,
        "role": u.role,
        "memory_version": u.memory_version,
        "mind_ready": bool(u.mind_id),
    }


def blocked(db, a, b):
    return (
        db.scalar(
            select(Block.id)
            .where(
                or_(
                    and_(Block.owner == a, Block.target == b),
                    and_(Block.owner == b, Block.target == a),
                )
            )
            .limit(1)
        )
        is not None
    )


INTENT_STEP = {"marriage": 0, "relationship": 1, "dating": 2}


def intents_fit(a, b):
    """Marriage and a serious relationship fit; so do relationship and dating. Marriage and casual dating don't."""
    return abs(INTENT_STEP.get(a, 1) - INTENT_STEP.get(b, 1)) <= 1


def base_ok(db, a, b):
    """Rules nobody can waive: active, verified, adult, opted in, same city, orientation both ways,
    compatible intentions, not blocked."""
    return bool(
        a
        and b
        and a.id != b.id
        and not a.disabled
        and not b.disabled
        and a.discovery
        and b.discovery
        and a.verified
        and b.verified
        and a.email_verified
        and b.email_verified
        and a.age >= 18
        and b.age >= 18
        and cities_fit(a, b)
        and matching_allowed(db, a)
        and matching_allowed(db, b)
        and intents_fit(a.intent, b.intent)
        and b.gender in a.seeking
        and a.gender in b.seeking
        and not blocked(db, a.id, b.id)
        and not a.synthetic
        and not b.synthetic
    )


def prefs_ok(a, b):
    """a's own soft filters accept b: age range and must-haves."""
    return a.age_min <= b.age <= a.age_max and not violates(a.about or {}, b.about or {})


def eligible(db, a, b, waived_by=None):
    return bool(
        base_ok(db, a, b)
        and (prefs_ok(a, b) or a.id == waived_by)
        and (prefs_ok(b, a) or b.id == waived_by)
    )


def scene_ok(db, s, a=None, b=None):
    a = a or db.get(User, s.a)
    b = b or db.get(User, s.b)
    return eligible(db, a, b, s.waived_by)


def outside_reasons(a, b):
    """Why b falls outside a's own filters (only age range and must-haves)."""
    from .about import violations, MUST_LABEL

    out = []
    if not a.age_min <= b.age <= a.age_max:
        out.append(f"{b.age} is outside your {a.age_min}–{a.age_max} age range")
    for d in violations(a.about or {}, b.about or {}):
        out.append("Your must-have: " + MUST_LABEL[d])
    return out


def actor_data(db, u):
    profile = db.get(PersonalityProfile, u.id)
    return {
        "id": u.id,
        "name": u.name,
        "about": dict(u.about or {}),
        # Prompts and hand-written traits lead the conversation; vitals follow.
        "facts": [
            {"id": m.id, "content": m.content, "category": m.category}
            for m in sorted(
                memories(db, u.id, True),
                key=lambda m: 0 if m.source_id.startswith("about:prompt")
                else 2 if m.source_id.startswith("about:")
                else 1,
            )[:16]
        ],
        "mind_id": (u.mind_id or "") if external_allowed(db, u) else "",
        "guidance": [item["content"] for item in guidance_text(db, u.id) if not item["disclose"]],
        # Tone guidance from the owner's own IPIP answers, and levels only if they opted into matching.
        "style": style_hints(profile),
        "personality": shared_levels(profile),
        "intent": u.intent,
        "city": u.city,
        "age_min": u.age_min,
        "age_max": u.age_max,
    }


def get_scene(db, sid, user):
    s = db.get(Scene, sid)
    if not s or user.id not in (s.a, s.b):
        raise HTTPException(404, "Experience not found.")
    a, b = db.get(User, s.a), db.get(User, s.b)
    if not scene_ok(db, s, a, b):
        raise HTTPException(404, "This introduction is no longer available.")
    return s, a, b


def stale(s, a, b):
    return s.a_version != a.memory_version or s.b_version != b.memory_version


def scene_data(db, s, user):
    a, b = db.get(User, s.a), db.get(User, s.b)
    changed = stale(s, a, b)
    parts = db.scalars(
        select(Participation).where(Participation.scene_id == s.id)
    ).all()
    mine = next(p for p in parts if p.user_id == user.id)
    other = next(p for p in parts if p.user_id != user.id)
    mutual = (
        not changed
        and s.status == "completed"
        and all(p.reviewed and p.contribution and p.decision == "accept" for p in parts)
    )
    partner = b if user.id == a.id else a
    output = {} if changed else dict(s.output or {})
    if output.get("assessment"):
        # Each person only sees their own agent's private perspective.
        full = output["assessment"]
        output["assessment"] = {
            **{k: v for k, v in full.items() if k != "perspectives"},
            "perspective": full.get("perspectives", {}).get(user.id),
        }
    return {
        "id": s.id,
        "venue": s.venue,
        "spot": spot_for(s.venue, s.id),
        "status": s.status,
        "stale": changed,
        "partner": public_profile(partner, revealed=mutual),
        "incoming": s.a != user.id,
        "waived": bool(s.waived_by),
        "output": output,
        "model": s.model,
        "error": s.error,
        "tokens": s.tokens,
        "created": s.created,
        "mine": {
            "reviewed": mine.reviewed,
            "contribution": mine.contribution,
            "decision": mine.decision,
            "next_step": mine.next_step,
            "feedback": mine.feedback,
        },
        "other": {
            "contribution": other.contribution
            if not changed and mine.contribution
            else "",
            "decision": other.decision,
            "next_step": other.next_step if mutual else "",
        },
        "mutual": mutual,
        "contact": partner.contact if mutual else None,
        "match_line": None,
        "can_connect": s.status == "completed" and not changed,
        "click": why_click(
            [m.content for m in memories(db, user.id, True)],
            [m.content for m in memories(db, partner.id, True)],
            [line.get("text", "") for line in (output.get("dialogue") or [])],
        )
        if s.status == "completed" and not changed
        else None,
    }


def _match_line():
    from .minds import match_line

    return match_line()


def _can_connect(output):
    """A resonance score is guidance. It does not open or close an introduction."""
    return True
