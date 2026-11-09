"""Single-use account tokens and SMTP delivery. Never log or persist raw tokens."""

import logging
import os
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import delete

from .db import AuthToken, User
from .security import ORIGIN, digest

log = logging.getLogger("soulplex.mail")


def mail_ready():
    return all(os.getenv(key) for key in ("SMTP_HOST", "SMTP_FROM")) and (
        not os.getenv("SMTP_USERNAME") or bool(os.getenv("SMTP_PASSWORD"))
    )


def issue_token(db, user, purpose):
    db.execute(
        delete(AuthToken).where(
            AuthToken.user_id == user.id, AuthToken.purpose == purpose
        )
    )
    raw = secrets.token_urlsafe(32)
    db.add(
        AuthToken(
            token=digest(raw),
            user_id=user.id,
            purpose=purpose,
            expires=time.time() + (86400 if purpose == "verify" else 1200),
        )
    )
    return raw


def consume_token(db, raw, purpose):
    if not raw or len(raw) > 200:
        raise HTTPException(400, "Link is invalid or expired.")
    hashed = digest(raw)
    item = db.get(AuthToken, hashed)
    if not item or item.purpose != purpose or item.expires < time.time():
        raise HTTPException(400, "Link is invalid or expired.")
    # A conditional delete makes simultaneous submissions single-use.
    deleted = db.execute(
        delete(AuthToken).where(
            AuthToken.token == hashed,
            AuthToken.purpose == purpose,
            AuthToken.expires >= time.time(),
        )
    )
    if not deleted.rowcount:
        raise HTTPException(400, "Link is invalid or expired.")
    user = db.get(User, item.user_id)
    if not user or user.disabled:
        raise HTTPException(400, "Link is invalid or expired.")
    return user


def send_auth_email(address, raw, purpose):
    if not mail_ready():
        raise HTTPException(503, "Email delivery is unavailable. Try again later.")
    if purpose == "verify":
        subject, instruction, fragment = (
            "Verify your Soulplex email",
            "Verify your email",
            "verify",
        )
    else:
        subject, instruction, fragment = (
            "Reset your Soulplex password",
            "Reset your password",
            "reset",
        )
    link = f"{ORIGIN}/#{fragment}={quote(raw)}"
    message = EmailMessage()
    message["From"] = os.environ["SMTP_FROM"]
    message["To"] = address
    message["Subject"] = subject
    message.set_content(
        f"{instruction}: {link}\n\nThis link expires soon. If you did not request it, you can ignore this email."
    )
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
        context = ssl.create_default_context()
        # 465 speaks TLS from the first byte; 587 (and 25) start plain and upgrade with STARTTLS.
        if port == 465:
            smtp = smtplib.SMTP_SSL(os.environ["SMTP_HOST"], port, timeout=15, context=context)
        else:
            smtp = smtplib.SMTP(os.environ["SMTP_HOST"], port, timeout=15)
        with smtp:
            if port != 465:
                smtp.starttls(context=context)
            if os.getenv("SMTP_USERNAME"):
                smtp.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException, KeyError, ValueError) as exc:
        # The reason only, never the message or credentials.
        log.warning(
            "SMTP delivery to %s:%s failed: %s: %s",
            os.getenv("SMTP_HOST"), os.getenv("SMTP_PORT", "587"), type(exc).__name__, exc,
        )
        raise HTTPException(
            503, "Email delivery is unavailable. Try again later."
        ) from exc
