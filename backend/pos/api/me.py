"""The logged-in cashier's own account: profile, preferences, PIN and lock screen, password,
devices, and how their selling went."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..erp_client import ErpRejected, ErpUnavailable
from ..services import profile as svc
from .deps import SESSION_COOKIE, CurrentUser, Db, Erp, Tz

router = APIRouter(prefix="/api/me", tags=["me"])


def _token(request: Request) -> str:
    return request.cookies.get(SESSION_COOKIE, "")


@router.get("/profile")
def profile(request: Request, db: Db, erp: Erp, user: CurrentUser) -> dict:
    """The account as the ERP holds it (when it can be reached), and the till's own settings."""
    db.commit()  # no read transaction open across the ERP call
    try:
        account = erp.get(f"/cashiers/{user.username}")
        erp_reachable = True
    except (ErpRejected, ErpUnavailable):
        account = {"username": user.username, "full_name": user.full_name, "email": None, "role": "Cashier",
                   "created_at": None, "last_login_at": user.last_login_at}
        erp_reachable = False
    return {
        "account": account, "erp_reachable": erp_reachable, "first_login_here": user.created_at,
        "preferences": svc.preferences_of(user), "has_pin": bool(user.pin_hash),
        "sessions": svc.sessions_of(db, user, _token(request)),
    }


class PreferencesIn(BaseModel):
    auto_print: bool | None = None
    scan_sound: bool | None = None
    default_payment: Literal["cash", "card", "qris"] | None = None
    auto_lock_minutes: int | None = None


@router.put("/preferences")
def preferences(body: PreferencesIn, db: Db, user: CurrentUser) -> dict:
    prefs = svc.save_preferences(user, body.model_dump(exclude_none=True))
    db.commit()
    return prefs


class PinIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    pin: str | None = Field(None, min_length=4, max_length=6)  # None: remove the PIN


@router.put("/pin", status_code=204)
def set_pin(body: PinIn, db: Db, user: CurrentUser) -> None:
    svc.set_pin(db, user, body.password, body.pin)
    db.commit()


class UnlockIn(BaseModel):
    secret: str = Field(min_length=1, max_length=200)  # the PIN or the password


@router.post("/unlock", status_code=204)
def unlock(body: UnlockIn, request: Request, db: Db, user: CurrentUser) -> None:
    svc.unlock(db, user, _token(request), body.secret)
    db.commit()


class PasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


@router.post("/password")
def change_password(body: PasswordIn, request: Request, db: Db, erp: Erp, user: CurrentUser) -> dict:
    """Changed in the ERP; every other device this cashier is logged in on is logged out."""
    ended = svc.change_password(db, erp, user, _token(request), body.current_password, body.new_password)
    db.commit()
    return {"other_devices_logged_out": ended}


@router.delete("/sessions/others")
def end_other_sessions(request: Request, db: Db, user: CurrentUser) -> dict:
    ended = svc.end_other_sessions(db, user, _token(request))
    db.commit()
    return {"logged_out": ended}


@router.delete("/sessions/{session_id}", status_code=204)
def end_session(session_id: str, request: Request, db: Db, user: CurrentUser) -> None:
    svc.end_session_by_id(db, user, _token(request), session_id)
    db.commit()


@router.get("/stats")
def stats(db: Db, tz: Tz, user: CurrentUser) -> dict:
    """The last 30 days of this cashier's selling, day by day, with 7- and 30-day totals."""
    return svc.stats(db, user, tz)
