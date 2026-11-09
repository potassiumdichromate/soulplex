"""SMTP delivery picks implicit TLS or STARTTLS from the port."""

import smtplib

import pytest
from fastapi import HTTPException

import app.auth_flow as auth_flow


class FakeSMTP:
    made = []

    def __init__(self, host, port, timeout=None, context=None):
        self.kind = type(self).__name__
        self.calls = []
        FakeSMTP.made.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append("login")

    def send_message(self, message):
        self.calls.append("send")


class FakeSSL(FakeSMTP):
    pass


@pytest.fixture()
def smtp(monkeypatch):
    FakeSMTP.made = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSSL)
    for key, value in {"SMTP_HOST": "mail.example.com", "SMTP_FROM": "a@example.com",
                       "SMTP_USERNAME": "a@example.com", "SMTP_PASSWORD": "pw"}.items():
        monkeypatch.setenv(key, value)
    return FakeSMTP.made


def test_port_465_uses_implicit_tls(smtp, monkeypatch):
    monkeypatch.setenv("SMTP_PORT", "465")
    auth_flow.send_auth_email("b@example.com", "token", "verify")
    assert smtp[0].kind == "FakeSSL" and smtp[0].calls == ["login", "send"]


def test_port_587_upgrades_with_starttls(smtp, monkeypatch):
    monkeypatch.setenv("SMTP_PORT", "587")
    auth_flow.send_auth_email("b@example.com", "token", "reset")
    assert smtp[0].kind == "FakeSMTP" and smtp[0].calls == ["starttls", "login", "send"]


def test_a_failure_is_logged_and_reported(smtp, monkeypatch, caplog):
    def refuse(self, user, password):
        raise smtplib.SMTPAuthenticationError(535, b"bad credentials")

    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setattr(FakeSSL, "login", refuse)
    with pytest.raises(HTTPException) as err:
        auth_flow.send_auth_email("b@example.com", "token", "verify")
    assert err.value.status_code == 503
    assert "SMTPAuthenticationError" in caplog.text and "pw" not in caplog.text
