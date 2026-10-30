import os, uuid, time
from pathlib import Path
from sqlalchemy import (
    create_engine,
    String,
    Text,
    Integer,
    Float,
    Boolean,
    JSON,
    UniqueConstraint,
    event,
    inspect,
    select,
    update,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def uid():
    return str(uuid.uuid4())


def now():
    return time.time()


class Base(DeclarativeBase):
    pass


def _load_dotenv():
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


def _postgres_url(url):
    """Use the installed psycopg v3 driver. Render supplies postgresql://."""
    if url.startswith("postgresql+"):
        return url
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


_load_dotenv()

url = _postgres_url(os.getenv("DATABASE_URL", "sqlite:///./soulplex.db"))
os.environ["DATABASE_URL"] = url
engine = create_engine(
    url,
    connect_args={"check_same_thread": False, "timeout": 30}
    if url.startswith("sqlite")
    else {},
    pool_pre_ping=True,
)
if url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def pragmas(conn, record):
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(engine, expire_on_commit=False)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    password: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    age: Mapped[int] = mapped_column(Integer)
    city: Mapped[str] = mapped_column(String)
    gender: Mapped[str] = mapped_column(String)
    seeking: Mapped[list] = mapped_column(JSON, default=list)
    age_min: Mapped[int] = mapped_column(Integer, default=18)
    age_max: Mapped[int] = mapped_column(Integer, default=80)
    intent: Mapped[str] = mapped_column(String, default="relationship")
    contact: Mapped[str] = mapped_column(String, default="")
    discovery: Mapped[bool] = mapped_column(Boolean, default=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    role: Mapped[str] = mapped_column(String, default="member")
    memory_version: Mapped[int] = mapped_column(Integer, default=0)
    face: Mapped[dict] = mapped_column(JSON, default=dict)
    about: Mapped[dict] = mapped_column(JSON, default=dict)
    auto_accept: Mapped[bool] = mapped_column(Boolean, default=False)
    # Opt-in: visitors (even signed out) may watch this agent's dates, including the conversation.
    public_dates: Mapped[bool] = mapped_column(Boolean, default=False)
    # Hello Minds identity for this person's agent. Empty until a Mind is awakened.
    mind_id: Mapped[str] = mapped_column(String, default="")
    mind_email: Mapped[str] = mapped_column(String, default="")
    # Twin Studio resume point. Existing about/profile fields stay in their own columns.
    studio: Mapped[dict] = mapped_column(JSON, default=dict)
    age_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    identity_status: Mapped[str] = mapped_column(String, default="unverified")
    created: Mapped[float] = mapped_column(Float, default=now)


class AuthSession(Base):
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    csrf: Mapped[str] = mapped_column(String)
    expires: Mapped[float] = mapped_column(Float)


class AuthToken(Base):
    __tablename__ = "auth_tokens"
    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    purpose: Mapped[str] = mapped_column(String)
    expires: Mapped[float] = mapped_column(Float)


class Invite(Base):
    __tablename__ = "invites"
    token: Mapped[str] = mapped_column(String, primary_key=True)
    expires: Mapped[float] = mapped_column(Float)
    used_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    created: Mapped[float] = mapped_column(Float, default=now)


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String, index=True)
    category: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    source_quote: Mapped[str] = mapped_column(Text)
    source_id: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="proposed")
    visibility: Mapped[str] = mapped_column(String, default="private")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated: Mapped[float] = mapped_column(Float, default=now)


class Scene(Base):
    __tablename__ = "scenes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    a: Mapped[str] = mapped_column(String, index=True)
    b: Mapped[str] = mapped_column(String, index=True)
    venue: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    a_version: Mapped[int] = mapped_column(Integer)
    b_version: Mapped[int] = mapped_column(Integer)
    output: Mapped[dict] = mapped_column(JSON, default=dict)
    model: Mapped[str] = mapped_column(String, default="")
    error: Mapped[str] = mapped_column(String, default="")
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    created: Mapped[float] = mapped_column(Float, default=now)
    started: Mapped[float] = mapped_column(Float, default=0)
    # One scene per pair, venue and approved-memory snapshot. Failed jobs release it.
    dedupe_key: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True
    )
    # Set when the inviter chose "meet anyway" past their own age range / must-haves.
    waived_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Participation(Base):
    __tablename__ = "participations"
    __table_args__ = (UniqueConstraint("scene_id", "user_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    scene_id: Mapped[str] = mapped_column(String, index=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    contribution: Mapped[str] = mapped_column(Text, default="")
    decision: Mapped[str] = mapped_column(String, default="pending")
    next_step: Mapped[str] = mapped_column(String, default="video")
    feedback: Mapped[dict] = mapped_column(JSON, default=dict)


class Block(Base):
    __tablename__ = "blocks"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String, index=True)
    target: Mapped[str] = mapped_column(String, index=True)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String)
    target: Mapped[str] = mapped_column(String)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="open")
    created: Mapped[float] = mapped_column(Float, default=now)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String, index=True)
    kind: Mapped[str] = mapped_column(String)
    resource: Mapped[str] = mapped_column(String, default="")
    created: Mapped[float] = mapped_column(Float, default=now)


class Quota(Base):
    __tablename__ = "quotas"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)


class DirectMessage(Base):
    """Human-to-human chat. Opens only after both people accept a date."""

    __tablename__ = "direct_messages"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    scene_id: Mapped[str] = mapped_column(String, index=True)
    sender_id: Mapped[str] = mapped_column(String, index=True)
    content: Mapped[str] = mapped_column(Text)
    created: Mapped[float] = mapped_column(Float, default=now)


class Setting(Base):
    """Small server-side values, such as the id of the Mind that scores dates."""

    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class StudioAnswer(Base):
    """Versioned owner answer. Skipped stays unanswered; it is not stored as a preference."""

    __tablename__ = "studio_answers"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String, index=True)
    field_id: Mapped[str] = mapped_column(String, index=True)
    option_ids: Mapped[list] = mapped_column(JSON, default=list)
    free_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="answered")
    source: Mapped[str] = mapped_column(String, default="owner")
    schema_version: Mapped[str] = mapped_column(String, default="1.2.0")
    permission_scope: Mapped[str] = mapped_column(String, default="private")
    answer_version: Mapped[int] = mapped_column(Integer, default=1)
    updated: Mapped[float] = mapped_column(Float, default=now)


class ConsentRecord(Base):
    __tablename__ = "consents"
    __table_args__ = (UniqueConstraint("user_id", "purpose"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String, index=True)
    purpose: Mapped[str] = mapped_column(String)
    granted: Mapped[bool] = mapped_column(Boolean, default=False)
    notice_version: Mapped[str] = mapped_column(String, default="2026-10-24")
    updated: Mapped[float] = mapped_column(Float, default=now)


class CalibrationRun(Base):
    """Owner choice is stored before the twin answers, and is not part of the twin prompt."""

    __tablename__ = "calibrations"
    __table_args__ = (UniqueConstraint("user_id", "scenario_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String, index=True)
    scenario_id: Mapped[str] = mapped_column(String, index=True)
    unseen: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_option: Mapped[str] = mapped_column(String, default="")
    owner_why: Mapped[str] = mapped_column(Text, default="")
    owner_locked: Mapped[float] = mapped_column(Float, default=0)
    twin_option: Mapped[str] = mapped_column(String, default="")
    twin_summary: Mapped[str] = mapped_column(Text, default="")
    twin_locked: Mapped[float] = mapped_column(Float, default=0)
    twin_method: Mapped[str] = mapped_column(String, default="")
    provider: Mapped[str] = mapped_column(String, default="")
    prompt_hash: Mapped[str] = mapped_column(String, default="")
    context_version: Mapped[int] = mapped_column(Integer, default=0)
    rating: Mapped[str] = mapped_column(String, default="")
    correction: Mapped[str] = mapped_column(Text, default="")
    correction_status: Mapped[str] = mapped_column(String, default="")
    created: Mapped[float] = mapped_column(Float, default=now)


class DeletionRequest(Base):
    __tablename__ = "deletion_requests"
    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String, default="requested")
    detail: Mapped[str] = mapped_column(Text, default="")
    updated: Mapped[float] = mapped_column(Float, default=now)


class PersonalityResponse(Base):
    """One owner answer to one IPIP item: 1 (very inaccurate) to 5 (very accurate)."""

    __tablename__ = "personality_responses"
    __table_args__ = (UniqueConstraint("user_id", "item_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String, index=True)
    item_id: Mapped[str] = mapped_column(String)
    value: Mapped[int] = mapped_column(Integer)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    answer_version: Mapped[int] = mapped_column(Integer, default=1)
    answered: Mapped[float] = mapped_column(Float, default=now)


class PersonalityProfile(Base):
    """Scored from the owner's own responses. A model never writes these numbers."""

    __tablename__ = "personality_profiles"
    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    instrument: Mapped[str] = mapped_column(String, default="")
    form: Mapped[str] = mapped_column(String, default="partial")
    scores: Mapped[dict] = mapped_column(JSON, default=dict)
    quality: Mapped[dict] = mapped_column(JSON, default=dict)
    # private: owner only. twin: shapes how the twin speaks. matching: also informs date reflections.
    scope: Mapped[str] = mapped_column(String, default="twin")
    version: Mapped[int] = mapped_column(Integer, default=0)
    computed: Mapped[float] = mapped_column(Float, default=now)


class TwinCalibration(Base):
    """Blinded run: the twin predicts held-out items. Owner answers never enter the prompt."""

    __tablename__ = "twin_calibrations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, default="running")
    method: Mapped[str] = mapped_column(String, default="")
    held_out: Mapped[list] = mapped_column(JSON, default=list)
    predictions: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    profile_version: Mapped[int] = mapped_column(Integer, default=0)
    memory_version: Mapped[int] = mapped_column(Integer, default=0)
    prompt_hash: Mapped[str] = mapped_column(String, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created: Mapped[float] = mapped_column(Float, default=now)


class MindLink(Base):
    """What this server last told a person's Hello Mind. One row per person with a Mind."""

    __tablename__ = "mind_links"
    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    persona_hash: Mapped[str] = mapped_column(String, default="")
    persona_version: Mapped[int] = mapped_column(Integer, default=0)
    synced: Mapped[float] = mapped_column(Float, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_error: Mapped[str] = mapped_column(Text, default="")


class MindTask(Base):
    """Durable outbox for Hello Minds side effects. The worker retries with backoff."""

    __tablename__ = "mind_tasks"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String, index=True)
    kind: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_at: Mapped[float] = mapped_column(Float, default=now, index=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    # Set while pending so repeated requests coalesce. Cleared when the task finishes.
    dedupe_key: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    created: Mapped[float] = mapped_column(Float, default=now)
    updated: Mapped[float] = mapped_column(Float, default=now)


SCHEMA = 9


class SchemaVersion(Base):
    __tablename__ = "schema_version"
    version: Mapped[int] = mapped_column(Integer, primary_key=True)


def init_db():
    # Transactional v1 -> v2 upgrade. Take a backup and stop old workers first.
    # Compose starts the API before the worker, so only the API migrates on boot.
    with engine.begin() as conn:
        if not inspect(conn).has_table("schema_version"):
            Base.metadata.create_all(conn)
            conn.execute(SchemaVersion.__table__.insert().values(version=SCHEMA))
            return
        version = conn.scalar(select(SchemaVersion.version))
        if version == 1:
            _upgrade_v1(conn)
            version = 2
        if version == 2:
            _add_face_column(conn)
            version = 3
        if version == 3:
            _add_about_column(conn)
            version = 4
        if version == 4:
            _add_invitation_columns(conn)
            version = 5
        if version == 5:
            _add_public_dates_column(conn)
            version = 6
        if version == 6:
            _add_mind_columns(conn)
            version = 7
        if version == 7:
            _add_studio_columns(conn)
            version = 8
        if version == 8:
            _add_personality_tables(conn)
            version = 9
        if version != SCHEMA:
            raise RuntimeError(f"Unsupported schema version {version!r}; expected {SCHEMA}.")


def _upgrade_v1(conn):
    if conn.dialect.name == "postgresql":
        conn.execute(
            text(
                "ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )
    elif conn.dialect.name == "sqlite":
        conn.execute(
            text(
                "ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 0"
            )
        )
    else:
        raise RuntimeError("Unsupported database for the v1 to v2 migration.")
    conn.execute(text("ALTER TABLE scenes ADD COLUMN dedupe_key VARCHAR(64)"))
    conn.execute(
        text("CREATE UNIQUE INDEX ix_scenes_dedupe_key ON scenes (dedupe_key)")
    )
    Base.metadata.create_all(conn)
    # Older active scenes must also take part in the uniqueness guard.
    from .domain import scene_key

    rows = conn.execute(
        select(
            Scene.id,
            Scene.a,
            Scene.b,
            Scene.venue,
            Scene.a_version,
            Scene.b_version,
            Scene.status,
        ).order_by(Scene.created.desc())
    ).all()
    seen = set()
    for row in rows:
        if row.status not in ("queued", "running", "completed"):
            continue
        key = scene_key(row.a, row.b, row.venue, row.a_version, row.b_version)
        if key not in seen:
            conn.execute(
                update(Scene).where(Scene.id == row.id).values(dedupe_key=key)
            )
            seen.add(key)
    conn.execute(
        update(SchemaVersion)
        .where(SchemaVersion.version == 1)
        .values(version=2)
    )


def _add_face_column(conn):
    """v2 -> v3: agent faces (illustrated spec or photo with a public variant)."""
    kind = "JSON" if conn.dialect.name == "postgresql" else "TEXT"
    conn.execute(text(f"ALTER TABLE users ADD COLUMN face {kind} NOT NULL DEFAULT '{{}}'"))
    conn.execute(update(SchemaVersion).values(version=3))


def get_db():
    with SessionLocal() as db:
        yield db


def _add_about_column(conn):
    """v3 -> v4: structured About-me profile (vitals, prompts, must-haves)."""
    kind = "JSON" if conn.dialect.name == "postgresql" else "TEXT"
    conn.execute(text(f"ALTER TABLE users ADD COLUMN about {kind} NOT NULL DEFAULT '{{}}'"))
    conn.execute(update(SchemaVersion).values(version=4))


def _add_invitation_columns(conn):
    """v4 -> v5: invitations (auto-accept setting) and one-sided "meet anyway" waivers."""
    true = "TRUE" if conn.dialect.name == "postgresql" else "1"
    conn.execute(text(f"ALTER TABLE users ADD COLUMN auto_accept BOOLEAN NOT NULL DEFAULT {true}"))
    conn.execute(text("ALTER TABLE scenes ADD COLUMN waived_by VARCHAR"))
    conn.execute(update(SchemaVersion).values(version=5))


def _add_public_dates_column(conn):
    """v5 -> v6: members can let visitors watch their agent's dates (off by default)."""
    false = "FALSE" if conn.dialect.name == "postgresql" else "0"
    conn.execute(text(f"ALTER TABLE users ADD COLUMN public_dates BOOLEAN NOT NULL DEFAULT {false}"))
    conn.execute(update(SchemaVersion).values(version=6))


def _add_mind_columns(conn):
    """v6 -> v7: one Hello Mind per person, plus human chat after a mutual accept."""
    conn.execute(text("ALTER TABLE users ADD COLUMN mind_id VARCHAR NOT NULL DEFAULT ''"))
    conn.execute(text("ALTER TABLE users ADD COLUMN mind_email VARCHAR NOT NULL DEFAULT ''"))
    Base.metadata.create_all(conn)
    conn.execute(update(SchemaVersion).values(version=7))


def _add_studio_columns(conn):
    """v7 -> v8: Twin Studio resume, adult check, and identity status. Answers live in new tables."""
    kind = "JSON" if conn.dialect.name == "postgresql" else "TEXT"
    false = "FALSE" if conn.dialect.name == "postgresql" else "0"
    conn.execute(text(f"ALTER TABLE users ADD COLUMN studio {kind} NOT NULL DEFAULT '{{}}'"))
    conn.execute(text(f"ALTER TABLE users ADD COLUMN age_verified BOOLEAN NOT NULL DEFAULT {false}"))
    conn.execute(text("ALTER TABLE users ADD COLUMN identity_status VARCHAR NOT NULL DEFAULT 'unverified'"))
    Base.metadata.create_all(conn)
    conn.execute(update(SchemaVersion).values(version=8))


def _add_personality_tables(conn):
    """v8 -> v9: OCEAN self-report, blinded twin calibration, and the Hello Minds outbox."""
    Base.metadata.create_all(
        conn,
        tables=[
            PersonalityResponse.__table__,
            PersonalityProfile.__table__,
            TwinCalibration.__table__,
            MindLink.__table__,
            MindTask.__table__,
        ],
    )
    conn.execute(update(SchemaVersion).values(version=9))
