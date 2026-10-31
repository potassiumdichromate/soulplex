import os, time, re, json, hashlib, secrets, logging
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Literal
from fastapi import FastAPI, HTTPException, Request, Response, Depends, BackgroundTasks
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, delete, or_, func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .db import *
from .security import *
from .domain import *
from .ai import interview, moderate, contains_contact, QUESTIONS, VENUES, ProviderError
from .minds import (
    enabled as minds_enabled,
    bind_mind,
    private_reply,
    teach,
    link_pair,
    match_line,
)
from .auth_flow import mail_ready, issue_token, consume_token, send_auth_email


@asynccontextmanager
async def lifespan(app):
    if PRODUCTION and (not ORIGIN.startswith("https://") or DEMO):
        raise RuntimeError(
            "Production requires HTTPS APP_ORIGIN and DEMO_MODE=false. Use development only for local or synthetic demos."
        )
    if not DEMO and not os.getenv("AI_API_KEY"):
        raise RuntimeError("Live mode requires AI_API_KEY for safety screening.")
    if not DEMO and not os.getenv("AI_MODEL") and not minds_enabled():
        raise RuntimeError(
            "Live mode requires AI_MODEL, or MINDS_BUILDER_API_KEY so Minds write the dates."
        )
    if PRODUCTION and not mail_ready():
        raise RuntimeError(
            "Production requires SMTP_HOST and SMTP_FROM for email verification and recovery."
        )
    init_db()
    if DEMO:
        from .seed import seed

        seed()
    yield


app = FastAPI(
    title="Soulplex pilot API",
    version="0.5.0",
    lifespan=lifespan,
    docs_url="/api/docs" if not PRODUCTION else None,
    openapi_url="/api/openapi.json",
)
# compress text responses (JS, CSS, HTML, JSON): roughly 3x less to download on slow networks
app.add_middleware(GZipMiddleware, minimum_size=800, compresslevel=6)


BODY_CAPS = {"/api/transcribe": 8 * 1024 * 1024, "/api/face": 300_000, "/api/about": 16_000}


@app.middleware("http")
async def security_headers(request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != ORIGIN:
            return JSONResponse({"detail": "Origin not allowed."}, status_code=403)
        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > (
            BODY_CAPS.get(request.url.path, 32768)
        ):
            return JSONResponse({"detail": "Request is too large."}, status_code=413)
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        cap = BODY_CAPS.get(request.url.path, 32768)
        chunks = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > cap:
                return JSONResponse(
                    {"detail": "Request is too large."}, status_code=413
                )
            chunks.append(chunk)
        request._body = b"".join(chunks)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(self), geolocation=()"
    )
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    elif request.url.path.startswith("/models/") and request.url.path.endswith(".glb"):
        response.headers["Cache-Control"] = "public, max-age=604800"
    elif request.url.path.startswith("/assets/"):
        # file names contain a content hash, so browsers can keep them for a year
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif request.url.path in ("/", "/index.html"):
        response.headers["Cache-Control"] = "no-cache"
    if PRODUCTION:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


@app.exception_handler(ProviderError)
async def ai_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=503)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Profile(Strict):
    name: str = Field(min_length=1, max_length=40)
    age: int = Field(ge=18, le=100)
    city: Literal["Dubai", "Delhi NCR"]
    gender: Literal["woman", "man", "nonbinary", "self-described"]
    seeking: list[Literal["woman", "man", "nonbinary", "self-described"]] = Field(
        min_length=1, max_length=4
    )
    age_min: int = Field(ge=18, le=100)
    age_max: int = Field(ge=18, le=100)
    intent: Literal["relationship", "marriage", "dating"]
    contact: str = Field(default="", max_length=160)
    discovery: bool = False


class Register(Profile):
    email: str = Field(max_length=254)
    password: str = Field(min_length=12, max_length=128)
    consent: bool
    invite_code: str = Field(default="", max_length=128)


class Login(Strict):
    email: str
    password: str = Field(max_length=128)


class EmailAddress(Strict):
    email: str = Field(max_length=254)


class AuthLink(Strict):
    token: str = Field(min_length=20, max_length=200)


class ResetPassword(AuthLink):
    password: str = Field(min_length=12, max_length=128)


class Chat(Strict):
    message: str = Field(min_length=2, max_length=2000)


class DirectText(Strict):
    text: str = Field(min_length=1, max_length=2000)


class MemoryEdit(Strict):
    content: str = Field(min_length=1, max_length=600)
    visibility: Literal["private", "shareable"]
    status: Literal["approved", "rejected"]
    expected_version: int


class NewTrait(Strict):
    category: Literal[
        "backstory", "values", "lifestyle", "communication", "future", "interests", "boundaries"
    ]
    content: str = Field(min_length=3, max_length=600)
    visibility: Literal["private", "shareable"] = "shareable"


class FaceInput(Strict):
    kind: Literal["illustrated", "photo", "none"]
    spec: dict | None = None
    photo: str | None = None
    public: str | None = None
    style: Literal["natural", "dreamy", "painted"] = "natural"
    reveal: Literal["everyone", "mutual"] = "mutual"


class Explore(Strict):
    count: int = Field(default=3, ge=1, le=3)


class StartScene(Strict):
    partner_id: str
    venue: str = Field(default="auto", max_length=20)  # a date type id, or "auto" to let the agents pick
    waive: bool = False


class Respond(Strict):
    accept: bool


class SettingsInput(Strict):
    auto_accept: bool | None = None
    public_dates: bool | None = None


class Participate(Strict):
    reviewed: bool
    contribution: str = Field(default="", max_length=800)
    decision: Literal["pending", "accept", "pass"] = "pending"
    next_step: Literal["video", "public_cafe"] = "video"


class Feedback(Strict):
    met: bool
    represented_accurately: bool
    wants_second_date: bool | None = None


class ReportInput(Strict):
    target_id: str
    reason: str = Field(min_length=5, max_length=1000)


class AdminEdit(Strict):
    verified: bool
    disabled: bool


class DeleteAccount(Strict):
    confirmation: Literal["DELETE"]
    password: str


def me(request, db, mutate=False):
    return authenticate(request, db, mutate)[0]


def validate_profile(p):
    if p.age_min > p.age_max:
        raise HTTPException(422, "Minimum age must not exceed maximum age.")
    if contains_contact(p.name):
        raise HTTPException(
            422, "Use a first name or nickname without contact details."
        )


def auth_limit(request, db, email=""):
    ip = request.client.host if request.client else "local"
    quota(db, "auth:" + hashlib.sha256(ip.encode()).hexdigest(), 60)
    if email:
        quota(
            db, "auth-email:" + hashlib.sha256(email.lower().encode()).hexdigest(), 15
        )
    db.commit()  # failed logins must still consume their quota


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {
        "ok": True,
        "version": "0.5.0",
        "mode": "demo" if DEMO else "live",
        "minds": minds_enabled(),
        "match_line": match_line(),
        "venues": VENUES,
    }


@app.post("/api/auth/register")
async def register(
    body: Register, request: Request, response: Response, db: Session = Depends(get_db)
):
    auth_limit(request, db, body.email)
    validate_profile(body)
    if not body.consent:
        raise HTTPException(422, "Consent to service processing is required.")
    email = body.email.lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Enter a valid email.")
    if not DEMO:
        if not mail_ready():
            raise HTTPException(503, "Email delivery is unavailable. Try again later.")
        invite = db.get(Invite, digest(body.invite_code)) if body.invite_code else None
        if not invite or invite.expires < time.time() or invite.used_by:
            raise HTTPException(403, "A valid pilot invitation is required.")
    data = body.model_dump(exclude={"email", "password", "consent", "invite_code"})
    data["discovery"] = False
    u = User(
        **data,
        email=email,
        password=hash_password(body.password),
        email_verified=DEMO,
        synthetic=False,
    )
    db.add(u)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(409, "This account cannot be registered. Try signing in.")
    if minds_enabled():
        try:
            await bind_mind(db, u)
        except ProviderError as exc:
            db.rollback()
            raise HTTPException(503, str(exc))
    if not DEMO:
        claimed = db.execute(
            update(Invite)
            .where(
                Invite.token == invite.token,
                Invite.used_by.is_(None),
                Invite.expires >= time.time(),
            )
            .values(used_by=u.id)
        )
        if not claimed.rowcount:
            raise HTTPException(403, "A valid pilot invitation is required.")
        raw = issue_token(db, u, "verify")
    csrf = new_session(db, u, response)
    log(db, u, "service_consent_v1")
    db.commit()
    if not DEMO:
        send_auth_email(u.email, raw, "verify")
    return {"user": own_profile(u), "csrf": csrf, "mode": "demo" if DEMO else "live"}


@app.post("/api/auth/login")
async def login(
    body: Login, request: Request, response: Response, db: Session = Depends(get_db)
):
    auth_limit(request, db, body.email)
    u = db.scalar(select(User).where(User.email == body.email.lower()))
    encoded = u.password if u else DUMMY_HASH
    if not check_password(body.password, encoded) or not u or u.disabled:
        raise HTTPException(401, "Email or password is incorrect.")
    if not u.password.startswith("scrypt$65536$"):
        u.password = hash_password(body.password)
    await _attach_mind(db, u)
    csrf = new_session(db, u, response)
    db.commit()
    return {"user": own_profile(u), "csrf": csrf, "mode": "demo" if DEMO else "live"}


@app.post("/api/auth/resend-verification")
def resend_verification(request: Request, db: Session = Depends(get_db)):
    u = me(request, db, True)
    auth_limit(request, db, u.email)
    if not u.email_verified and not DEMO:
        raw = issue_token(db, u, "verify")
        db.commit()
        send_auth_email(u.email, raw, "verify")
    return {"ok": True}


@app.post("/api/auth/verify-email")
def verify_email(body: AuthLink, request: Request, db: Session = Depends(get_db)):
    auth_limit(request, db)
    u = consume_token(db, body.token, "verify")
    u.email_verified = True
    log(db, u, "email_verified")
    db.commit()
    return {"ok": True}


@app.post("/api/auth/request-reset")
def request_reset(body: EmailAddress, request: Request, db: Session = Depends(get_db)):
    auth_limit(request, db, body.email)
    if not DEMO:
        u = db.scalar(
            select(User).where(User.email == body.email.lower(), User.disabled == False)
        )
        if u:
            raw = issue_token(db, u, "reset")
            db.commit()
            try:
                send_auth_email(u.email, raw, "reset")
            except HTTPException:
                # Do not expose whether this email is registered.
                logging.warning("Password-reset email could not be delivered.")
    return {
        "ok": True,
        "message": "If that account exists, a reset link has been sent.",
    }


@app.post("/api/auth/reset-password")
def reset_password(
    body: ResetPassword, request: Request, db: Session = Depends(get_db)
):
    auth_limit(request, db)
    u = consume_token(db, body.token, "reset")
    u.password = hash_password(body.password)
    db.execute(delete(AuthSession).where(AuthSession.user_id == u.id))
    db.execute(delete(AuthToken).where(AuthToken.user_id == u.id))
    log(db, u, "password_reset")
    db.commit()
    return {"ok": True}


@app.post("/api/auth/demo/{persona}")
async def demo_login(
    persona: str, request: Request, response: Response, db: Session = Depends(get_db)
):
    if not DEMO:
        raise HTTPException(404)
    if persona not in ("maya", "arjun", "operator"):
        raise HTTPException(404)
    auth_limit(request, db)
    u = db.scalar(select(User).where(User.email == persona + "@demo.soulplex.local"))
    await _attach_mind(db, u)
    csrf = new_session(db, u, response)
    db.commit()
    return {"user": own_profile(u), "csrf": csrf, "mode": "demo"}


async def _attach_mind(db, user):
    """Give an existing account a Mind. Sign-in still succeeds if Hello Minds is down."""
    if not minds_enabled() or not user or user.mind_id:
        return
    try:
        await bind_mind(db, user)
    except ProviderError:
        logging.warning("Could not awaken a Mind during sign-in")


def _queue_teach(background: BackgroundTasks, user, text: str):
    if minds_enabled() and user and user.mind_id and text.strip():
        background.add_task(teach, user.mind_id, user.id, text)


@app.get("/api/me")
def get_me(request: Request, db: Session = Depends(get_db)):
    u, s = authenticate(request, db)
    return {"user": own_profile(u), "csrf": s.csrf, "mode": "demo" if DEMO else "live"}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    u, s = authenticate(request, db, True)
    db.delete(s)
    db.commit()
    response.delete_cookie("soulplex_session")
    return {"ok": True}


@app.put("/api/profile")
def profile(
    body: Profile,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    u = me(request, db, True)
    validate_profile(body)
    if body.discovery and (not u.verified or (not DEMO and not u.email_verified)):
        raise HTTPException(
            409, "An operator must verify your eligibility before discovery opens."
        )
    for key, value in body.model_dump().items():
        setattr(u, key, value)
    db.execute(
        update(User)
        .where(User.id == u.id)
        .values(memory_version=User.memory_version + 1)
    )
    db.refresh(u)
    log(db, u, "profile_and_discovery_updated")
    db.commit()
    _queue_teach(
        background,
        u,
        f"Updated requirements: looking for a {u.intent} in {u.city}, ages {u.age_min} to {u.age_max}.",
    )
    return own_profile(u)


@app.put("/api/about")
async def set_about(
    request: Request, background: BackgroundTasks, db: Session = Depends(get_db)
):
    """Save the About-me profile and regenerate the agent traits it implies."""
    from .about import clean, facts

    u = me(request, db, True)
    quota(db, "about:" + u.id, 60)
    try:
        body = await request.json()
        about = clean(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    texts = [p["answer"] for p in about.get("prompts", [])] + [about.get("job", ""), about.get("hometown", "")]
    if any(contains_contact(t) for t in texts):
        raise HTTPException(422, "Keep contact details out of your profile. Use the private contact field.")
    for t in [x for x in texts if x]:
        await moderate(t)
    db.rollback()
    u = me(request, db, True)
    db.execute(delete(Memory).where(Memory.user_id == u.id, Memory.source_id.like("about:%")))
    learned = []
    for key, category, sentence in facts(about):
        learned.append(f"({category}) {sentence}")
        db.add(
            Memory(
                user_id=u.id,
                category=category,
                content=sentence,
                source_quote=sentence,
                source_id="about:" + key,
                status="approved",
                visibility="shareable",
            )
        )
    u.about = about
    db.execute(update(User).where(User.id == u.id).values(memory_version=User.memory_version + 1))
    log(db, u, "about_updated")
    db.commit()
    db.refresh(u)
    if learned:
        _queue_teach(
            background,
            u,
            "Approved profile facts. Use only these on dates:\n" + "\n".join(learned),
        )
    return own_profile(u)


@app.put("/api/face")
def set_face(body: FaceInput, request: Request, db: Session = Depends(get_db)):
    """Give my agent a face. Photos ship with a soft-focus public variant."""
    from .faces import clean_spec, clean_image

    u = me(request, db, True)
    quota(db, "face:" + u.id, 30)
    try:
        if body.kind == "illustrated":
            face = {"kind": "illustrated", "spec": clean_spec(body.spec)}
        elif body.kind == "photo":
            face = {
                "kind": "photo",
                "photo": clean_image(body.photo),
                "public": clean_image(body.public or body.photo),
                "style": body.style,
                "reveal": body.reveal,
            }
        else:
            face = {}
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    u.face = face
    log(db, u, "face_updated")
    db.commit()
    return own_profile(u)


@app.get("/api/chat")
def chat_history(request: Request, db: Session = Depends(get_db)):
    u = me(request, db)
    rows = db.scalars(
        select(Message).where(Message.user_id == u.id).order_by(Message.created)
    ).all()
    return {
        "messages": [{"id": m.id, "role": m.role, "content": m.content} for m in rows],
        "opening": (
            "I'm your agent. I'll only take something on a date after you approve it. "
            if u.mind_id
            else ""
        )
        + QUESTIONS[0][1],
        "mind": bool(u.mind_id),
    }


@app.post("/api/chat")
async def chat(body: Chat, request: Request, db: Session = Depends(get_db)):
    u = me(request, db, True)
    if not DEMO and not u.email_verified:
        raise HTTPException(403, "Verify your email before using the AI guide.")
    if minds_enabled():
        try:
            await bind_mind(db, u)
        except ProviderError as exc:
            raise HTTPException(503, str(exc))
    quota(db, "chat:" + u.id, 40)
    db.commit()
    u = me(request, db, True)
    if minds_enabled() and not DEMO:
        await moderate(body.message)
    history = db.scalars(
        select(Message).where(Message.user_id == u.id).order_by(Message.created)
    ).all()
    idx = sum(m.role == "user" for m in history)
    result, tokens = await interview(
        body.message,
        [{"role": m.role, "content": m.content} for m in history],
        [m.content for m in memories(db, u.id)[:16]],
        idx,
    )
    if minds_enabled() and u.mind_id:
        approved = [
            {"category": m.category, "content": m.content}
            for m in memories(db, u.id, True)[:16]
        ]
        try:
            spoken = await private_reply(u, body.message, approved)
        except ProviderError as exc:
            raise HTTPException(503, str(exc))
        if spoken:
            if not DEMO:
                await moderate(spoken)
            result.reply = spoken
        else:
            result.reply += " Your agent is still thinking. Ask again in a moment."
    db.rollback()
    u = me(request, db, True)
    source = Message(user_id=u.id, role="user", content=body.message)
    db.add(source)
    db.flush()
    db.add(Message(user_id=u.id, role="assistant", content=result.reply))
    for fact in result.facts:
        db.add(
            Memory(
                user_id=u.id,
                category=fact.category,
                content=fact.quote,
                source_quote=fact.quote,
                source_id=source.id,
            )
        )
    log(db, u, "chat_answer")
    db.commit()
    return {"reply": result.reply, "proposals": len(result.facts), "tokens": tokens}


@app.get("/api/memories")
def list_memories(request: Request, db: Session = Depends(get_db)):
    u = me(request, db)
    return [
        fact_data(m)
        for m in db.scalars(
            select(Memory).where(Memory.user_id == u.id).order_by(Memory.updated.desc())
        )
    ]


@app.patch("/api/memories/{mid}")
async def edit_memory(
    mid: str,
    body: MemoryEdit,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    u = me(request, db, True)
    m = db.get(Memory, mid)
    if not m or m.user_id != u.id:
        raise HTTPException(404)
    if m.version != body.expected_version:
        raise HTTPException(409, "This memory changed. Refresh before editing.")
    if body.visibility == "shareable" and contains_contact(body.content):
        raise HTTPException(
            422,
            "Keep contact details out of agent memory. Use the mutual introduction contact field.",
        )
    await moderate(body.content)
    db.rollback()
    u = me(request, db, True)
    changed = db.execute(
        update(Memory)
        .where(
            Memory.id == mid,
            Memory.user_id == u.id,
            Memory.version == body.expected_version,
        )
        .values(
            content=body.content,
            status=body.status,
            visibility=body.visibility,
            version=Memory.version + 1,
            updated=time.time(),
        )
    )
    if not changed.rowcount:
        raise HTTPException(409, "This memory changed. Refresh before editing.")
    db.execute(
        update(User)
        .where(User.id == u.id)
        .values(memory_version=User.memory_version + 1)
    )
    db.expire_all()
    m = db.get(Memory, mid)
    log(db, u, "memory_" + body.status, mid)
    db.commit()
    if body.status == "approved" and body.visibility == "shareable":
        _queue_teach(
            background,
            u,
            f"Approved shareable fact ({m.category}): {m.content}. Use this on dates. Do not invent beyond approved facts.",
        )
    return fact_data(m)


@app.post("/api/memories")
async def add_trait(
    body: NewTrait,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """The owner writes a behaviour trait directly. Owner-authored, so it is approved."""
    u = me(request, db, True)
    quota(db, "trait:" + u.id, 60)
    db.commit()
    if contains_contact(body.content):
        raise HTTPException(
            422,
            "Keep contact details out of agent memory. Use the mutual introduction contact field.",
        )
    await moderate(body.content)
    db.rollback()
    u = me(request, db, True)
    m = Memory(
        user_id=u.id,
        category=body.category,
        content=body.content.strip(),
        source_quote=body.content.strip(),
        source_id="owner-written",
        status="approved",
        visibility=body.visibility,
    )
    db.add(m)
    db.execute(
        update(User)
        .where(User.id == u.id)
        .values(memory_version=User.memory_version + 1)
    )
    log(db, u, "trait_added")
    db.commit()
    if body.visibility == "shareable":
        _queue_teach(
            background,
            u,
            f"Approved shareable fact ({body.category}): {body.content.strip()}. Use this on dates. Do not invent beyond approved facts.",
        )
    return fact_data(m)


@app.delete("/api/memories/{mid}")
def delete_memory(mid: str, request: Request, db: Session = Depends(get_db)):
    u = me(request, db, True)
    m = db.get(Memory, mid)
    if not m or m.user_id != u.id:
        raise HTTPException(404)
    db.delete(m)
    db.execute(
        update(User)
        .where(User.id == u.id)
        .values(memory_version=User.memory_version + 1)
    )
    log(db, u, "memory_deleted", mid)
    db.commit()
    return {"ok": True}


def eligible_partners(db, u):
    for p in db.scalars(
        select(User)
        .where(
            User.city == u.city,
            User.discovery == True,
            User.verified == True,
            User.disabled == False,
            User.id != u.id,
        )
        .order_by(User.created)
        .limit(300)
    ):
        if eligible(db, u, p):
            facts = memories(db, p.id, True)
            if facts:
                yield p, facts


def discovery_blocker(db, u):
    if not u.discovery or not u.verified or (not DEMO and not u.email_verified):
        return "Complete your profile, operator verification and discovery opt-in."
    if not memories(db, u.id, True):
        return "Approve at least one shareable memory first."
    return ""


def preview_resonance(own, facts, limit=3):
    """Cheap pre-date signal from shared themes; the real score comes after the date."""
    from .resonance import _dim_themes, DIMENSIONS

    ta, tb = _dim_themes([fact_data(m) for m in own]), _dim_themes(
        [fact_data(m) for m in facts]
    )
    common = sorted({t for d in DIMENSIONS for t in (ta[d] & tb[d]) if t})
    return common[:limit]


@app.get("/api/candidates")
def candidates(request: Request, db: Session = Depends(get_db)):
    u = me(request, db)
    blocker = discovery_blocker(db, u)
    if blocker:
        return {"candidates": [], "reason": blocker, "blocked": True}
    own = memories(db, u.id, True)
    result = []
    for p, facts in eligible_partners(db, u):
        common = preview_resonance(own, facts)
        result.append(
            {
                **public_profile(p),
                "preview": [m.content for m in facts[:2]],
                "traits": len(facts),
                "common": common,
                "reason": (
                    "Your agents may connect over " + ", ".join(common) + "."
                    if common
                    else "Mutual preferences, intention and city fit. Their agent might surprise yours."
                ),
            }
        )
    return {
        "candidates": result[:12],
        "reason": ""
        if result
        else "No one matches both ways yet. Search below to see who's close.",
        "blocked": False,
    }


def choose_type(db, u, p, venue):
    """Validate a date type, or let the two agents pick one from what they share."""
    from .date_types import DATE_TYPES, pick

    if venue in DATE_TYPES:
        return venue
    if venue not in ("auto", ""):
        raise HTTPException(422, "Unknown date type.")
    themes = preview_resonance(memories(db, u.id, True), memories(db, p.id, True), limit=20) if p else []
    return pick(themes, f"{u.id}:{p.id if p else ''}:{u.memory_version}")


def queue_scene(db, u, p, venue, waive=False):
    venue = choose_type(db, u, p, venue)
    waived_by = u.id if waive and p and not prefs_ok(u, p) else None
    if not eligible(db, u, p, waived_by):
        raise HTTPException(409, "Both people must be eligible, verified and opted in.")
    if not memories(db, u.id, True) or not memories(db, p.id, True):
        raise HTTPException(
            409, "Both representatives need approved shareable memories."
        )
    key = scene_key(u.id, p.id, venue, u.memory_version, p.memory_version)
    existing = db.scalar(select(Scene).where(Scene.dedupe_key == key))
    if existing:
        return existing.id, False
    quota(db, "scene:" + u.id, 5)
    s = Scene(
        a=u.id,
        b=p.id,
        venue=venue,
        a_version=u.memory_version,
        b_version=p.memory_version,
        dedupe_key=key,
        waived_by=waived_by,
        # People who turned off auto-accept decide before their agent goes.
        status="queued" if p.auto_accept is not False else "invited",
    )
    try:
        db.add(s)
        db.flush()
        db.add_all(
            [
                Participation(scene_id=s.id, user_id=u.id),
                Participation(scene_id=s.id, user_id=p.id),
            ]
        )
        log(db, u, "scene_queued", s.id)
        db.commit()
    except IntegrityError:
        db.rollback()  # Also refunds the losing request's quota increment.
        existing = db.scalar(select(Scene).where(Scene.dedupe_key == key))
        if existing:
            return existing.id, False
        raise HTTPException(409, "The experience changed. Please try again.")
    return s.id, True


@app.post("/api/scenes")
def start_scene(body: StartScene, request: Request, db: Session = Depends(get_db)):
    u = me(request, db, True)
    sid, _ = queue_scene(db, u, db.get(User, body.partner_id), body.venue, body.waive)
    return {"id": sid}


@app.post("/api/scenes/{sid}/respond")
def respond(sid: str, body: Respond, request: Request, db: Session = Depends(get_db)):
    """The invited person accepts or declines before their agent goes on the date."""
    u = me(request, db, True)
    s, a, b = get_scene(db, sid, u)
    if s.b != u.id or s.status != "invited":
        raise HTTPException(409, "There's no open invitation here.")
    s.status = "queued" if body.accept else "declined"
    if not body.accept:
        s.dedupe_key = None
    log(db, u, "invite_" + ("accepted" if body.accept else "declined"), sid)
    db.commit()
    return scene_data(db, s, u)


@app.put("/api/settings")
def settings(body: SettingsInput, request: Request, db: Session = Depends(get_db)):
    u = me(request, db, True)
    if body.auto_accept is not None:
        u.auto_accept = body.auto_accept
    if body.public_dates is not None:
        u.public_dates = body.public_dates
    db.commit()
    return own_profile(u)


@app.get("/api/search")
def search(
    request: Request,
    q: str = "",
    age_min: int = 18,
    age_max: int = 100,
    intent: str = "",
    diet: str = "",
    family_plans: str = "",
    religion: str = "",
    db: Session = Depends(get_db),
):
    """Search the local pool. Only people whose own preferences include you are ever shown.
    Matches fit both ways; "outside" people fit theirs but not your age range or must-haves."""
    u = me(request, db)
    blocker = discovery_blocker(db, u)
    if blocker:
        return {"matches": [], "outside": [], "hidden": 0, "blocked": True, "reason": blocker}
    from .about import VEG

    own = memories(db, u.id, True)
    q = q.strip().lower()[:60]
    matches, outside, hidden = [], [], 0
    for p in db.scalars(
        select(User)
        .where(User.city == u.city, User.discovery == True, User.verified == True, User.disabled == False, User.id != u.id)
        .order_by(User.created)
        .limit(500)
    ):
        if not base_ok(db, u, p) or not prefs_ok(p, u):
            hidden += 1  # their side (or a rule nobody can waive) says no: never shown
            continue
        facts = memories(db, p.id, True)
        if not facts:
            continue
        ab = p.about or {}
        text = " ".join([p.name, ab.get("job", ""), ab.get("hometown", "")] + [x["answer"] for x in ab.get("prompts", [])] + [m.content for m in facts]).lower()
        if q and q not in text:
            continue
        if not age_min <= p.age <= age_max or (intent and p.intent != intent):
            continue
        if diet == "veg" and ab.get("diet") not in VEG:
            continue
        if family_plans and ab.get("family_plans") != family_plans:
            continue
        if religion and ab.get("religion") != religion:
            continue
        common = preview_resonance(own, facts)
        card = {
            **public_profile(p),
            "preview": [m.content for m in facts[:2]],
            "traits": len(facts),
            "common": common,
            "reason": "Your agents may connect over " + ", ".join(common) + "." if common else "",
        }
        reasons = outside_reasons(u, p)
        if reasons:
            outside.append({**card, "outside": reasons})
        else:
            matches.append(card)
    return {"matches": matches[:30], "outside": outside[:30], "hidden": hidden, "blocked": False, "reason": ""}


@app.post("/api/agent/explore")
def explore(body: Explore, request: Request, db: Session = Depends(get_db)):
    """Send my agent out: it picks partners it hasn't met at this memory version."""
    u = me(request, db, True)
    blocker = discovery_blocker(db, u)
    if blocker:
        raise HTTPException(409, blocker)
    met = set()
    for sc in db.scalars(
        select(Scene).where(
            or_(Scene.a == u.id, Scene.b == u.id), Scene.status != "failed"
        )
    ):
        other = sc.b if sc.a == u.id else sc.a
        mine = sc.a_version if sc.a == u.id else sc.b_version
        if mine == u.memory_version:
            met.add(other)
    own = memories(db, u.id, True)
    pool = [
        (len(preview_resonance(own, facts)), p)
        for p, facts in eligible_partners(db, u)
        if p.id not in met
    ]
    pool.sort(key=lambda x: -x[0])
    started = []
    for i, (_, p) in enumerate(pool[: body.count]):
        u = me(request, db, True)
        try:
            sid, new = queue_scene(db, u, p, "auto")
        except HTTPException as exc:
            if exc.status_code == 429 and started:
                break
            raise
        if new:
            started.append({"id": sid, "partner": p.name})
    return {
        "started": started,
        "message": (
            f"Your agent is heading out on {len(started)} date{'s' if len(started) != 1 else ''}."
            if started
            else (
                "Your agent has already met everyone available. Add new traits to see them with fresh eyes."
                if met
                else "No one nearby matches your preferences yet. Try a wider age range or fewer must-haves."
            )
        ),
    }


@app.get("/api/scenes")
def scenes(request: Request, db: Session = Depends(get_db)):
    u = me(request, db)
    result = []
    if DEMO_INVITES:
        demo_invite(db, u)
    for s in db.scalars(
        select(Scene)
        .where(or_(Scene.a == u.id, Scene.b == u.id))
        .order_by(Scene.created.desc())
        .limit(50)
    ):
        if scene_ok(db, s):
            result.append(scene_data(db, s, u))
    return result


DEMO_INVITES = DEMO and os.getenv("DEMO_INVITES", "true").lower() == "true"


def demo_invite(db, u):
    """Demo only: fictional people's agents occasionally invite yours on a date."""
    if u.synthetic and u.role == "admin" or discovery_blocker(db, u):
        return
    incoming = db.scalars(select(Scene).where(Scene.b == u.id).order_by(Scene.created.desc())).all()
    if incoming and time.time() - incoming[0].created < 75:
        return
    open_ = [s for s in incoming if s.status in ("invited", "queued", "running")]
    if len(open_) >= 2 or len(incoming) >= 6:
        return
    met = {s.a if s.b == u.id else s.b for s in db.scalars(select(Scene).where(or_(Scene.a == u.id, Scene.b == u.id)))}
    for p, facts in eligible_partners(db, u):
        if p.synthetic and p.id not in met:
            venue = choose_type(db, p, u, "auto")
            key = scene_key(p.id, u.id, venue, p.memory_version, u.memory_version)
            if db.scalar(select(Scene.id).where(Scene.dedupe_key == key)):
                continue
            s = Scene(a=p.id, b=u.id, venue=venue, a_version=p.memory_version, b_version=u.memory_version,
                      dedupe_key=key, status="queued" if u.auto_accept is not False else "invited")
            db.add(s)
            db.flush()
            db.add_all([Participation(scene_id=s.id, user_id=p.id), Participation(scene_id=s.id, user_id=u.id)])
            db.commit()
            return


@app.get("/api/dates")
def dates(
    request: Request,
    q: str = "",
    status: str = "",
    type: str = "",
    sort: str = "new",
    offset: int = 0,
    limit: int = 30,
    db: Session = Depends(get_db),
):
    """Every date your agent has been on, paginated and filterable (scales to thousands)."""
    u = me(request, db)
    limit = max(1, min(limit, 100))
    query = select(Scene).where(or_(Scene.a == u.id, Scene.b == u.id))
    if type:
        query = query.where(Scene.venue == type)
    if status in ("queued", "running", "completed", "failed", "invited", "declined"):
        query = query.where(Scene.status == status)
    rows = []
    q = q.strip().lower()
    for s in db.scalars(query.order_by(Scene.created.desc()).limit(5000)):
        if not scene_ok(db, s):
            continue
        d = scene_data(db, s, u)
        if q and q not in d["partner"]["name"].lower():
            continue
        if status == "waiting" and not (d["status"] == "completed" and not d["stale"] and d["mine"]["decision"] == "pending"):
            continue
        if status == "mutual" and not d["mutual"]:
            continue
        rows.append(d)
    if sort == "score":
        rows.sort(key=lambda d: -((d["output"].get("assessment") or {}).get("score") or -1))
    total = len(rows)
    page = rows[offset : offset + limit]
    for d in page:  # the list doesn't need full transcripts
        d["output"] = {k: v for k, v in d["output"].items() if k in ("assessment",)} | (
            {"assessment": {k: v for k, v in d["output"]["assessment"].items() if k in ("score", "confidence", "shared")}}
            if d["output"].get("assessment")
            else {}
        )
    return {"items": page, "total": total, "offset": offset, "limit": limit}


def live_agent(u):
    """What other members may see of an agent on a live date: first name and the same public face shown in Discover."""
    if not u or not u.discovery or u.disabled:
        return {"name": "Private agent", "hue": 260, "face": None}
    return {
        "name": u.name.split()[0],
        "hue": int(hashlib.sha256(u.id.encode()).hexdigest()[:4], 16) % 360,
        "face": face_view(u.face),
    }


def watchable(a, b):
    """Both members opted in to visitors watching their agents' dates."""
    return bool(a and b and a.public_dates and b.public_dates and a.discovery and b.discovery and not a.disabled and not b.disabled)


def live_dates(db, u, active):
    """Who is on which island right now. Each island has 2-3 spots; extra dates wait for a free one."""
    from .date_types import DATE_TYPES, resolve, spot_for

    taken: dict[str, set[int]] = {}
    out = []
    for s in sorted(active, key=lambda s: s.started or s.created):
        t = resolve(s.venue)
        n = len(DATE_TYPES[t]["spots"])
        used = taken.setdefault(t, set())
        want = spot_for(t, s.id)
        spot = next((x % n for x in range(want, want + n) if x % n not in used), None)
        if spot is not None:
            used.add(spot)
        a, b = db.get(User, s.a), db.get(User, s.b)
        began = s.started or s.created
        out.append({
            "id": s.id,
            "type": t,
            "spot": spot,  # None: waiting for a free spot on that island
            "status": s.status,
            "started": began,
            "step": min(3, int(max(0, time.time() - began) // 12)) if s.status == "running" else 0,
            "mine": bool(u) and u.id in (s.a, s.b),
            "public": watchable(a, b),
            "a": live_agent(a),
            "b": live_agent(b),
        })
    return out


def island_activity(db, u):
    """Island-wide activity: counts plus the dates happening right now (agent names only, never private conversations)."""
    from .date_types import DATE_TYPES

    day = time.time() - 86400
    active = db.scalars(select(Scene).where(Scene.status.in_(["queued", "running"]))).all()
    today = db.scalar(select(func.count()).select_from(Scene).where(Scene.created >= day)) or 0
    done_today = db.scalars(select(Scene).where(Scene.status == "completed", Scene.created >= day)).all()
    by_type = {k: 0 for k in DATE_TYPES}
    for s in active + done_today:
        if s.venue in by_type:
            by_type[s.venue] += 1
    agents = db.scalar(select(func.count()).select_from(User).where(User.discovery == True, User.disabled == False)) or 0
    scores = [(s.output or {}).get("assessment", {}).get("score") for s in done_today]
    scores = [x for x in scores if x is not None]
    return {
        "agents": agents,
        "active": len(active),
        "today": today,
        "avg_resonance": round(sum(scores) / len(scores)) if scores else None,
        "by_type": by_type,
        "live": live_dates(db, u, active),
        "simulated": False,
    }


@app.get("/api/island")
def island(request: Request, db: Session = Depends(get_db)):
    return island_activity(db, me(request, db))


@app.get("/api/public/island")
def public_island(db: Session = Depends(get_db)):
    """The same view for visitors who are not signed in."""
    return island_activity(db, None)


@app.get("/api/public/dates/{sid}")
def public_date(sid: str, db: Session = Depends(get_db)):
    """Watch a date without signing in, only when both members chose to allow it."""
    from .date_types import resolve

    s = db.get(Scene, sid)
    a, b = (db.get(User, s.a), db.get(User, s.b)) if s else (None, None)
    if not s or s.status not in ("queued", "running", "completed") or not watchable(a, b):
        raise HTTPException(404, "This date is private.")
    lines = []
    if s.status == "completed" and not stale(s, a, b):
        names = {a.id: a.name.split()[0], b.id: b.name.split()[0]}
        for l in (s.output or {}).get("dialogue", []):
            lines.append({
                "side": "a" if l.get("speaker_id") == a.id else "b",
                "speaker": names.get(l.get("speaker_id"), "Agent") + "'s agent",
                "text": l.get("text", ""),
                "stage": l.get("stage", 0),
                "mood": l.get("mood", ""),
            })
    return {
        "id": s.id,
        "type": resolve(s.venue),
        "status": s.status,
        "a": live_agent(a),
        "b": live_agent(b),
        "lines": lines,
    }


@app.get("/api/scenes/{sid}")
def scene(sid: str, request: Request, db: Session = Depends(get_db)):
    u = me(request, db)
    s, a, b = get_scene(db, sid, u)
    return scene_data(db, s, u)


@app.put("/api/scenes/{sid}/participation")
async def participate(
    sid: str,
    body: Participate,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    u = me(request, db, True)
    s, a, b = get_scene(db, sid, u)
    if s.status != "completed" or stale(s, a, b):
        raise HTTPException(409, "Review a current, completed experience first.")
    if body.decision == "accept":
        score = ((s.output or {}).get("assessment") or {}).get("score")
        line = match_line()
        if not isinstance(score, (int, float)) or isinstance(score, bool) or score < line:
            shown = int(score) if isinstance(score, (int, float)) and not isinstance(score, bool) else "unavailable"
            raise HTTPException(
                422,
                f"A connection opens at {line}% or above. This date scored {shown}.",
            )
    if body.decision == "accept" and (
        not body.reviewed or len(body.contribution.strip()) < 5 or not u.contact
    ):
        raise HTTPException(
            422,
            "Review the scene, write your own contribution and add a contact method in your profile before accepting.",
        )
    if contains_contact(body.contribution):
        raise HTTPException(
            422,
            "Share your contact only after mutual acceptance, using your profile contact field.",
        )
    await moderate(body.contribution or "pass")
    db.rollback()
    u = me(request, db, True)
    s, a, b = get_scene(db, sid, u)
    if s.status != "completed" or stale(s, a, b):
        raise HTTPException(409, "The experience changed while saving. Please refresh.")
    part = db.scalar(
        select(Participation).where(
            Participation.scene_id == sid, Participation.user_id == u.id
        )
    )
    part.reviewed = body.reviewed
    part.contribution = body.contribution
    part.decision = body.decision
    part.next_step = body.next_step
    log(db, u, "human_" + body.decision, sid)
    minds = (a.mind_id, a.mind_email, b.mind_id, b.mind_email)
    parts = db.scalars(select(Participation).where(Participation.scene_id == sid)).all()
    opened = all(p.reviewed and p.contribution and p.decision == "accept" for p in parts)
    db.commit()
    if opened:
        background.add_task(link_pair, *minds)
    return scene_data(db, s, u)


def _direct_rows(db, sid, user_id):
    rows = db.scalars(
        select(DirectMessage)
        .where(DirectMessage.scene_id == sid)
        .order_by(DirectMessage.created)
    ).all()
    return [
        {"id": m.id, "mine": m.sender_id == user_id, "text": m.content, "created": m.created}
        for m in rows
    ]


@app.get("/api/scenes/{sid}/messages")
def direct_history(sid: str, request: Request, db: Session = Depends(get_db)):
    u = me(request, db)
    s, a, b = get_scene(db, sid, u)
    if not scene_data(db, s, u)["mutual"]:
        raise HTTPException(409, "You can talk after you both accept.")
    return _direct_rows(db, sid, u.id)


@app.post("/api/scenes/{sid}/messages")
async def direct_send(
    sid: str, body: DirectText, request: Request, db: Session = Depends(get_db)
):
    u = me(request, db, True)
    s, a, b = get_scene(db, sid, u)
    if not scene_data(db, s, u)["mutual"]:
        raise HTTPException(409, "You can talk after you both accept.")
    quota(db, "dm:" + u.id, 80)
    db.commit()
    await moderate(body.text)
    db.rollback()
    u = me(request, db, True)
    s, a, b = get_scene(db, sid, u)
    if not scene_data(db, s, u)["mutual"]:
        raise HTTPException(409, "You can talk after you both accept.")
    message = DirectMessage(scene_id=sid, sender_id=u.id, content=body.text.strip())
    db.add(message)
    log(db, u, "direct_message", sid)
    db.commit()
    return {"id": message.id, "mine": True, "text": message.content, "created": message.created}


@app.post("/api/scenes/{sid}/feedback")
def feedback(sid: str, body: Feedback, request: Request, db: Session = Depends(get_db)):
    u = me(request, db, True)
    s, a, b = get_scene(db, sid, u)
    if not scene_data(db, s, u)["mutual"]:
        raise HTTPException(409, "Feedback opens after mutual acceptance.")
    p = db.scalar(
        select(Participation).where(
            Participation.scene_id == sid, Participation.user_id == u.id
        )
    )
    p.feedback = body.model_dump()
    log(db, u, "outcome_reported", sid)
    db.commit()
    return {"ok": True}


@app.get("/api/insights")
def insights(request: Request, db: Session = Depends(get_db)):
    """What my agent has learned across every date, plus how well it knows me."""
    from .ai import CATEGORIES
    from .resonance import DIMENSIONS, GROWTH, CATEGORY_DIM

    u = me(request, db)
    approved = memories(db, u.id)
    shareable = [m for m in approved if m.visibility == "shareable"]
    coverage = {c: sum(m.category == c for m in approved) for c in CATEGORIES}
    knowledge = round(
        100
        * (
            0.6 * sum(1 for c in CATEGORIES if coverage[c]) / len(CATEGORIES)
            + 0.4 * min(len(approved), 14) / 14
        )
    )
    dates, dims, shared, explore_, growth, learned = [], {}, {}, [], [], []
    venues = {}
    accepted = mutual = 0
    for sc in db.scalars(
        select(Scene)
        .where(or_(Scene.a == u.id, Scene.b == u.id), Scene.status == "completed")
        .order_by(Scene.created.desc())
        .limit(50)
    ):
        a, b = db.get(User, sc.a), db.get(User, sc.b)
        if not scene_ok(db, sc, a, b):
            continue
        data = scene_data(db, sc, u)
        if data["mine"]["decision"] == "accept":
            accepted += 1
        mutual += data["mutual"]
        asm = (sc.output or {}).get("assessment")
        if not asm:
            continue
        persp = asm.get("perspectives", {}).get(u.id) or {}
        dates.append(
            {
                "id": sc.id,
                "partner": data["partner"]["name"],
                "hue": data["partner"]["hue"],
                "face": data["partner"]["face"],
                "partner_id": data["partner"]["id"],
                "venue": sc.venue,
                "score": asm["score"],
                "created": sc.created,
                "stale": data["stale"],
            }
        )
        venues.setdefault(sc.venue, []).append(asm["score"])
        for d in asm["dimensions"]:
            if d.get("known", True):
                dims.setdefault(d["name"], []).append(d["score"])
        for t in asm.get("shared", []):
            shared[t] = shared.get(t, 0) + 1
        explore_ += asm.get("explore", [])
        if persp.get("growth"):
            growth.append(persp["growth"])
        for x in persp.get("learned_about_partner", [])[:2]:
            learned.append({"partner": data["partner"]["name"], "text": x})
    avg = {d: round(sum(v) / len(v)) for d, v in dims.items()}
    strengths = sorted(avg, key=lambda d: -avg[d])[:2]
    missing = [
        d
        for d in DIMENSIONS
        if d not in avg
        and not any(coverage.get(c) for c, dd in CATEGORY_DIM.items() if dd == d)
    ]
    tips = list(dict.fromkeys([GROWTH[d] for d in missing] + growth))[:4]
    feedbacks = [
        p.feedback
        for p in db.scalars(select(Participation).where(Participation.user_id == u.id))
        if p.feedback
    ]
    return {
        "knowledge": knowledge,
        "coverage": coverage,
        "traits": {"approved": len(approved), "shareable": len(shareable)},
        "dates": dates,
        "average": round(sum(d["score"] for d in dates) / len(dates)) if dates else None,
        "dimensions": avg,
        "strengths": strengths,
        "shared_themes": sorted(shared.items(), key=lambda x: -x[1])[:6],
        "explore": list(dict.fromkeys(explore_))[:4],
        "growth": tips,
        "learned": learned[:8],
        "best_venue": max(venues, key=lambda v: sum(venues[v]) / len(venues[v]))
        if venues
        else None,
        "funnel": {"dates": len(dates), "accepted": accepted, "mutual": mutual},
        "feedback": {
            "responses": len(feedbacks),
            "represented_accurately": sum(
                1 for f in feedbacks if f.get("represented_accurately")
            ),
        },
    }


@app.post("/api/blocks/{target}")
def block(target: str, request: Request, db: Session = Depends(get_db)):
    u = me(request, db, True)
    if target == u.id or not db.get(User, target):
        raise HTTPException(404)
    db.add(Block(owner=u.id, target=target))
    log(db, u, "blocked", target)
    db.commit()
    return {"ok": True}


@app.post("/api/reports")
def report(body: ReportInput, request: Request, db: Session = Depends(get_db)):
    u = me(request, db, True)
    quota(db, "report:" + u.id, 10)
    if not db.get(User, body.target_id) or body.target_id == u.id:
        raise HTTPException(404)
    db.add(Report(owner=u.id, target=body.target_id, reason=body.reason))
    log(db, u, "report")
    db.commit()
    return {"ok": True}


@app.get("/api/export")
def export(request: Request, db: Session = Depends(get_db)):
    u = me(request, db)
    return {
        "profile": own_profile(u),
        "memories": [
            fact_data(m)
            for m in db.scalars(select(Memory).where(Memory.user_id == u.id))
        ],
        "chat": [
            {"role": m.role, "content": m.content, "created": m.created}
            for m in db.scalars(select(Message).where(Message.user_id == u.id))
        ],
        "participations": [
            {
                "scene_id": p.scene_id,
                "contribution": p.contribution,
                "decision": p.decision,
                "feedback": p.feedback,
            }
            for p in db.scalars(
                select(Participation).where(Participation.user_id == u.id)
            )
        ],
    }


@app.delete("/api/account")
def delete_account(
    body: DeleteAccount,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    u = me(request, db, True)
    if u.synthetic:
        raise HTTPException(
            409,
            "Use a test registration to exercise account deletion; demo identities are shared fixtures.",
        )
    if not check_password(body.password, u.password):
        raise HTTPException(401, "Password is incorrect.")
    ids = list(
        db.scalars(select(Scene.id).where(or_(Scene.a == u.id, Scene.b == u.id)))
    )
    db.execute(delete(Participation).where(Participation.scene_id.in_(ids)))
    db.execute(delete(Scene).where(Scene.id.in_(ids)))
    for cls in (Message, Memory, AuthSession, AuthToken, Event):
        db.execute(delete(cls).where(cls.user_id == u.id))
    db.execute(delete(Block).where(or_(Block.owner == u.id, Block.target == u.id)))
    db.execute(delete(Report).where(or_(Report.owner == u.id, Report.target == u.id)))
    db.execute(update(Invite).where(Invite.used_by == u.id).values(used_by="deleted"))
    db.delete(u)
    db.commit()
    response.delete_cookie("soulplex_session")
    return {"ok": True}


def admin(request, db, mutate=False):
    u = me(request, db, mutate)
    if u.role != "admin":
        raise HTTPException(403, "Operator access required.")
    return u


@app.get("/api/admin")
def dashboard(request: Request, db: Session = Depends(get_db)):
    admin(request, db)
    return {
        "members": [
            {
                "id": u.id,
                "name": u.name,
                "city": u.city,
                "verified": u.verified,
                "email_verified": u.email_verified,
                "disabled": u.disabled,
                "synthetic": u.synthetic,
            }
            for u in db.scalars(select(User).order_by(User.created.desc()).limit(200))
        ],
        "reports": [
            {
                "id": r.id,
                "owner": r.owner,
                "target": r.target,
                "reason": r.reason,
                "status": r.status,
            }
            for r in db.scalars(
                select(Report).order_by(Report.created.desc()).limit(100)
            )
        ],
        "metrics": {
            "members": db.scalar(
                select(func.count()).select_from(User).where(User.synthetic == False)
            ),
            "completed_scenes": db.scalar(
                select(func.count())
                .select_from(Scene)
                .where(Scene.status == "completed")
            ),
            "human_accepts": db.scalar(
                select(func.count())
                .select_from(Participation)
                .where(Participation.decision == "accept")
            ),
            "outcome_responses": len(
                {
                    (e.user_id, e.resource)
                    for e in db.scalars(
                        select(Event).where(Event.kind == "outcome_reported")
                    )
                }
            ),
        },
        "mode": "demo" if DEMO else "live",
    }


@app.patch("/api/admin/users/{uid}")
def admin_user(
    uid: str, body: AdminEdit, request: Request, db: Session = Depends(get_db)
):
    operator = admin(request, db, True)
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404)
    if u.role == "admin":
        raise HTTPException(409, "Manage operators using the CLI.")
    if body.verified and not body.disabled and not DEMO and not u.email_verified:
        raise HTTPException(409, "The member must first verify their email.")
    u.verified = body.verified
    u.disabled = body.disabled
    db.execute(
        update(User)
        .where(User.id == u.id)
        .values(memory_version=User.memory_version + 1)
    )
    log(db, operator, "operator_verified_or_suspended", uid)
    db.commit()
    return {"ok": True}


@app.post("/api/admin/reports/{rid}/resolve")
def resolve(rid: str, request: Request, db: Session = Depends(get_db)):
    operator = admin(request, db, True)
    r = db.get(Report, rid)
    if not r:
        raise HTTPException(404)
    r.status = "resolved"
    log(db, operator, "report_resolved", rid)
    db.commit()
    return {"ok": True}


static = Path(os.getenv("STATIC_DIR", "../frontend/dist"))
if static.exists():
    app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")
    if (static / "models").exists():
        # 3D character models (GLB) and their models.json manifest
        app.mount("/models", StaticFiles(directory=static / "models"), name="models")

    @app.get("/")
    def home():
        return FileResponse(static / "index.html")

    PUBLIC_FILES = {"favicon.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "manifest.webmanifest"}

    @app.get("/{name}")
    def public_file(name: str):
        """Logo icons and the web-app manifest (for "Add to home screen")."""
        if name in PUBLIC_FILES and (static / name).exists():
            return FileResponse(static / name, headers={"Cache-Control": "public, max-age=86400"})
        raise HTTPException(404)


@app.post("/api/transcribe")
async def transcribe(request: Request, db: Session = Depends(get_db)):
    from .ai import transcribe_audio

    u = me(request, db, True)
    if not DEMO and not u.email_verified:
        raise HTTPException(403, "Verify your email before using voice input.")
    quota(db, "voice:" + u.id, 10)
    db.commit()
    mime = request.headers.get("content-type", "").split(";")[0].strip()
    if mime not in ("audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"):
        raise HTTPException(415, "Unsupported audio format.")
    raw = await request.body()
    if not raw:
        raise HTTPException(422, "Recording is empty.")
    result = await transcribe_audio(raw, mime)
    return {"text": result, "stored": False}
