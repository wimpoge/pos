"""A cashier's own things: preferences, the PIN that unlocks a locked till, their password (kept
by the ERP), the devices they are logged in on, and how their selling went."""

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..erp_client import ErpClient, ErpRejected, ErpUnavailable
from ..models import AuthSession, Sale, SaleLine, SaleReturn, Shift, User, utcnow
from .auth import LOCKOUT, MAX_FAILED_LOGINS, hash_password, sha256, verify_password
from .common import DomainError, local_date

DEFAULT_PREFERENCES = {
    "auto_print": False,  # open the receipt printer after every sale
    "scan_sound": True,  # a beep when an item goes into the cart
    "default_payment": "cash",  # the method the payment window starts on
    "auto_lock_minutes": 0,  # lock the till after this long without a touch; 0: never
}
PAYMENT_CHOICES = ("cash", "card", "qris")
LOCK_CHOICES = (0, 1, 2, 5, 10, 15, 30)


def preferences_of(user: User) -> dict:
    return {**DEFAULT_PREFERENCES, **{k: v for k, v in (user.preferences or {}).items() if k in DEFAULT_PREFERENCES}}


def save_preferences(user: User, changes: dict) -> dict:
    prefs = preferences_of(user)
    for key, value in changes.items():
        if key not in DEFAULT_PREFERENCES:
            raise DomainError(422, f"Unknown preference {key}.")
        if key in ("auto_print", "scan_sound") and not isinstance(value, bool):
            raise DomainError(422, f"{key} is on or off.")
        if key == "default_payment" and value not in PAYMENT_CHOICES:
            raise DomainError(422, f"The default payment is one of: {', '.join(PAYMENT_CHOICES)}.")
        if key == "auto_lock_minutes" and value not in LOCK_CHOICES:
            raise DomainError(422, f"Lock after one of: {', '.join(map(str, LOCK_CHOICES))} minutes.")
        prefs[key] = value
    user.preferences = prefs
    return prefs


# ---------------------------------------------------------------- PIN and lock screen


def _check_lockout(user: User) -> None:
    if user.locked_until and user.locked_until > utcnow():
        raise DomainError(423, "Too many wrong tries. Wait a few minutes.")


def _failed(db: Session, user: User) -> None:
    user.failed_logins += 1
    if user.failed_logins >= MAX_FAILED_LOGINS:
        user.locked_until, user.failed_logins = utcnow() + LOCKOUT, 0
    db.commit()


def set_pin(db: Session, user: User, password: str, pin: str | None) -> None:
    """A PIN (4 to 6 digits) for unlocking the till; None removes it. Confirmed with the password
    the ERP last accepted, so someone at an unlocked till can't set one."""
    _check_lockout(user)
    if not verify_password(password, user.password_hash):
        _failed(db, user)
        raise DomainError(403, "That is not your password.")
    if pin is not None and not (pin.isdigit() and 4 <= len(pin) <= 6):
        raise DomainError(422, "A PIN is 4 to 6 digits.")
    user.failed_logins = 0
    user.pin_hash = hash_password(pin) if pin else None


def unlock(db: Session, user: User, token: str, secret: str) -> None:
    """Unlock a locked till with the PIN, or the password. Too many wrong tries end the session:
    whoever is trying has to log in properly."""
    _check_lockout(user)
    ok = (user.pin_hash and secret.isdigit() and verify_password(secret, user.pin_hash)) or \
        verify_password(secret, user.password_hash)
    if ok:
        user.failed_logins = 0
        return
    user.failed_logins += 1
    if user.failed_logins >= MAX_FAILED_LOGINS:
        user.failed_logins = 0
        db.query(AuthSession).filter(AuthSession.token_hash == sha256(token)).delete()
        db.commit()
        raise DomainError(423, "Too many wrong tries. Log in again.")
    db.commit()
    raise DomainError(403, "Wrong PIN or password.")


# ---------------------------------------------------------------- password and devices


def change_password(db: Session, erp: ErpClient, user: User, token: str, current: str, new: str) -> int:
    """Changed in the ERP, where the account lives; the till's offline copy follows, and every other
    device is logged out. Returns how many were."""
    db.commit()  # no read transaction open across the ERP call (SQLite could not write after it)
    try:
        erp.post("/cashiers/password", {"username": user.username, "current_password": current, "new_password": new})
    except ErpRejected as e:
        # Never 401 to the till: that means its own session ended.
        raise DomainError(403 if e.status_code == 401 else e.status_code if e.status_code in (403, 422, 423) else 502,
                          e.message) from None
    except ErpUnavailable as e:
        raise DomainError(503, f"{e.message} Your password lives in the ERP; change it once it is back.") from None
    user.password_hash = hash_password(new)
    return end_other_sessions(db, user, token)


def sessions_of(db: Session, user: User, token: str) -> list[dict]:
    now = utcnow()
    rows = db.scalars(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at > now)
                      .order_by(AuthSession.last_seen_at.desc().nulls_last(), AuthSession.created_at.desc())).all()
    current = sha256(token)
    return [{"id": s.token_hash[:12], "created_at": s.created_at, "last_seen_at": s.last_seen_at or s.created_at,
             "expires_at": s.expires_at, "user_agent": s.user_agent, "current": s.token_hash == current} for s in rows]


def end_other_sessions(db: Session, user: User, token: str) -> int:
    return db.query(AuthSession).filter(AuthSession.user_id == user.id,
                                        AuthSession.token_hash != sha256(token)).delete()


def end_session_by_id(db: Session, user: User, token: str, session_id: str) -> None:
    if sha256(token).startswith(session_id):
        raise DomainError(422, "That is this device. Log out instead.")
    gone = db.query(AuthSession).filter(AuthSession.user_id == user.id,
                                        AuthSession.token_hash.startswith(session_id)).delete()
    if not gone:
        raise DomainError(404, "Device not found.")


# ---------------------------------------------------------------- how the selling went


def stats(db: Session, user: User, tz: str, days: int = 30) -> dict:
    today = local_date(tz)
    start = today - timedelta(days=days - 1)
    per_day: dict[date, dict] = {start + timedelta(days=i): {"sales": 0, "total": 0, "refunds": 0, "items": 0}
                                 for i in range(days)}
    for day, count, total in db.execute(
            select(Sale.business_date, func.count(Sale.id), func.coalesce(func.sum(Sale.total), 0))
            .where(Sale.cashier_id == user.id, Sale.business_date >= start).group_by(Sale.business_date)):
        per_day[day].update(sales=count, total=int(total))
    for day, items in db.execute(
            select(Sale.business_date, func.coalesce(func.sum(SaleLine.qty), 0)).join(SaleLine)
            .where(Sale.cashier_id == user.id, Sale.business_date >= start).group_by(Sale.business_date)):
        per_day[day]["items"] = int(items)
    for day, total in db.execute(
            select(SaleReturn.business_date, func.coalesce(func.sum(SaleReturn.total), 0))
            .where(SaleReturn.cashier_id == user.id, SaleReturn.business_date >= start)
            .group_by(SaleReturn.business_date)):
        per_day[day]["refunds"] = int(total)

    def window(n: int) -> dict:
        rows = [v for d, v in per_day.items() if d > today - timedelta(days=n)]
        sales = sum(r["sales"] for r in rows)
        total = sum(r["total"] for r in rows)
        return {"sales": sales, "total": total, "refunds": sum(r["refunds"] for r in rows),
                "net": total - sum(r["refunds"] for r in rows), "items": sum(r["items"] for r in rows),
                "average": total // sales if sales else 0, "days_worked": sum(1 for r in rows if r["sales"])}

    best = max(per_day.items(), key=lambda kv: kv[1]["total"])
    top = db.execute(select(SaleLine.name, func.sum(SaleLine.qty), func.sum(SaleLine.line_total)).join(Sale)
                     .where(Sale.cashier_id == user.id, Sale.business_date >= start)
                     .group_by(SaleLine.name).order_by(func.sum(SaleLine.qty).desc()).limit(5)).all()
    shifts = db.scalars(select(Shift).where(Shift.user_id == user.id, Shift.counted_cash.is_not(None),
                                            Shift.opened_at >= utcnow() - timedelta(days=days))).all()
    return {
        "days": [{"date": d, **v} for d, v in per_day.items()],
        "week": window(7), "month": window(days),
        "best_day": {"date": best[0], **best[1]} if best[1]["total"] else None,
        "top_products": [{"name": n, "qty": int(q), "total": int(t)} for n, q, t in top],
        "drawer": {"counted_shifts": len(shifts), "exact": sum(1 for s in shifts if s.counted_cash == s.expected_cash),
                   "variance": sum(s.counted_cash - s.expected_cash for s in shifts)},
    }
