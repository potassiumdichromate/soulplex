import os, hashlib, secrets, hmac, time
from pathlib import Path
from fastapi import HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from .db import AuthSession, User, Quota, Event


def _load_dotenv():
    """Load the project .env without overriding variables already set in the process."""
    root = Path(__file__).resolve().parents[2]
    for path in (root / ".env", root / "backend" / ".env"):
        if not path.is_file():
            continue
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            if key:
                os.environ.setdefault(key, value)


_load_dotenv()

PRODUCTION = os.getenv("APP_ENV", "development") == "production"
# APP_ORIGIN may list several sites, comma-separated (a custom domain, its www form, the
# onrender.com address). The first is the canonical one used in emailed links. Render's own
# address is always allowed.
ORIGINS = [
    o.strip().rstrip("/")
    for o in (
        os.getenv("APP_ORIGIN") or os.getenv("RENDER_EXTERNAL_URL") or "http://localhost:8000"
    ).split(",")
    if o.strip()
]
if os.getenv("RENDER_EXTERNAL_URL", "").rstrip("/") not in ORIGINS + [""]:
    ORIGINS.append(os.environ["RENDER_EXTERNAL_URL"].rstrip("/"))
ORIGIN = ORIGINS[0]


def hash_password(password):
    salt = secrets.token_hex(16)
    work = 65536
    key = hashlib.scrypt(
        password.encode(),
        salt=salt.encode(),
        n=work,
        r=8,
        p=1,
        maxmem=128 * 1024 * 1024,
    ).hex()
    return f"scrypt${work}${salt}${key}"


def check_password(password, encoded):
    try:
        if encoded.startswith("scrypt$"):
            _, work, salt, key = encoded.split("$")
            work = int(work)
            if work not in (16384, 32768, 65536):
                return False
        else:
            # Existing v1 accounts are rehashed on a successful sign-in.
            salt, key = encoded.split(":")
            work = 16384
        actual = hashlib.scrypt(
            password.encode(),
            salt=salt.encode(),
            n=work,
            r=8,
            p=1,
            maxmem=128 * 1024 * 1024,
        ).hex()
        return hmac.compare_digest(key, actual)
    except (ValueError, TypeError):
        return False


# Equalize known/unknown login work without generating a fresh expensive hash
# for every unknown address. This value is deliberately not a real account.
DUMMY_HASH = hash_password("constant-dummy-password")


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def new_session(db, user, response):
    raw = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            token=digest(raw),
            user_id=user.id,
            csrf=csrf,
            expires=time.time() + 86400 * 7,
        )
    )
    response.set_cookie(
        "soulplex_session",
        raw,
        httponly=True,
        secure=PRODUCTION,
        samesite="lax",
        max_age=86400 * 7,
        path="/",
    )
    return csrf


def authenticate(request, db, mutate=False):
    session = db.get(AuthSession, digest(request.cookies.get("soulplex_session", "")))
    if not session or session.expires < time.time():
        raise HTTPException(401, "Please sign in.")
    user = db.get(User, session.user_id)
    if not user or user.disabled:
        raise HTTPException(401, "Account unavailable.")
    if mutate and not hmac.compare_digest(
        request.headers.get("X-CSRF-Token", ""), session.csrf
    ):
        raise HTTPException(403, "Refresh this page before continuing.")
    return user, session


def quota(db, key, limit):
    full = f"{key}:{int(time.time() // 86400)}"
    if not db.get(Quota, full):
        try:
            with db.begin_nested():
                db.add(Quota(key=full, count=0))
                db.flush()
        except IntegrityError:
            pass
    result = db.execute(
        update(Quota)
        .where(Quota.key == full, Quota.count < limit)
        .values(count=Quota.count + 1)
    )
    if not result.rowcount:
        raise HTTPException(429, "Daily pilot limit reached. Please try tomorrow.")


def log(db, user, kind, resource=""):
    db.add(Event(user_id=user.id, kind=kind, resource=resource))
