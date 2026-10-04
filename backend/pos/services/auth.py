"""Cashier login (checked by the ERP), server-side sessions, and an offline fallback."""

import hashlib
import hmac
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_client import ErpClient, ErpRejected, ErpUnavailable
from ..models import AuthSession, User, utcnow
from .common import DomainError

MAX_FAILED_LOGINS = 5
LOCKOUT = timedelta(minutes=5)
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **_SCRYPT)
    return hmac.compare_digest(candidate.hex(), digest)


# Checked when the username is unknown, so a wrong username takes as long as a wrong password.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def authenticate(db: Session, erp: ErpClient, username: str, password: str) -> User:
    """Cashier accounts live in the ERP, so the ERP checks the password (with its own lockout).
    Only when the ERP can't be reached does the POS fall back to the last password the ERP
    accepted for this cashier, so a shop can keep selling through an ERP outage."""
    username = username.strip().lower()
    try:
        _, row = erp.post("/cashiers/login", {"username": username, "password": password})
    except ErpRejected as e:
        if e.status_code == 403:  # no longer a cashier in the ERP
            user = db.scalar(select(User).filter_by(username=username))
            if user is not None and user.active:
                user.active = False
                db.commit()
        raise DomainError(e.status_code if e.status_code in (401, 403, 423) else 502, e.message) from None
    except ErpUnavailable:
        return _offline_login(db, username, password)

    user = db.scalar(select(User).filter_by(username=row["username"]))
    if user is None:
        user = User(username=row["username"], full_name=row["full_name"], password_hash="")
        db.add(user)
    user.full_name = row["full_name"]
    user.role = "cashier"
    user.active = True
    if not verify_password(password, user.password_hash):  # hashing is slow; only when it changed
        user.password_hash = hash_password(password)
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    return user


def _offline_login(db: Session, username: str, password: str) -> User:
    user = db.scalar(select(User).where(User.username == username, User.role == "cashier"))
    if user is None or not user.active or not user.password_hash:
        verify_password(password, _DUMMY_HASH)
        raise DomainError(503, "Can't reach the ERP to check your login. Only cashiers who logged in on "
                               "this POS before can log in while it is down.")
    now = utcnow()
    if user.locked_until and user.locked_until > now:
        minutes = int((user.locked_until - now).total_seconds() // 60) + 1
        raise DomainError(423, f"Too many failed attempts. Try again in {minutes} minute(s).")
    if not verify_password(password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= MAX_FAILED_LOGINS:
            user.locked_until = now + LOCKOUT
            user.failed_logins = 0
        db.commit()
        raise DomainError(401, "Wrong username or password.")
    user.failed_logins = 0
    user.last_login_at = now
    return user


# How often a session's "last seen" is written: every request would be a write for nothing.
SEEN_EVERY = timedelta(minutes=5)


def start_session(db: Session, user: User, hours: int, user_agent: str | None = None) -> str:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    db.add(AuthSession(token_hash=sha256(token), user_id=user.id, expires_at=now + timedelta(hours=hours),
                       last_seen_at=now, user_agent=(user_agent or "")[:200] or None))
    return token


def user_for_token(db: Session, token: str) -> User | None:
    session = db.get(AuthSession, sha256(token))
    if session is None or session.expires_at < utcnow() or not session.user.active:
        return None
    now = utcnow()
    if session.last_seen_at is None or session.last_seen_at < now - SEEN_EVERY:
        session.last_seen_at = now
        db.commit()
    return session.user


def end_session(db: Session, token: str) -> None:
    db.query(AuthSession).filter(AuthSession.token_hash == sha256(token)).delete()
