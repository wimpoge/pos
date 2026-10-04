from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, Field

from ..models import User
from ..services import auth as auth_service
from ..services.common import all_settings
from ..services.profile import preferences_of
from ..services.shifts import ShiftClock, current_shift
from ..services.sync import erp_can_take_sales, refresh
from .deps import SESSION_COOKIE, CurrentUser, Db, Erp

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=200)


def me_out(user: User, db, settings) -> dict:
    s = all_settings(db)
    clock = ShiftClock.from_settings(settings)
    shift = current_shift(db, user, clock)
    return {
        "id": user.id, "username": user.username, "full_name": user.full_name, "last_login_at": user.last_login_at,
        "shift": {"id": shift.id, "number": shift.number, "opened_at": shift.opened_at,
                  "ends_at": clock.ends_at(shift.opened_at),
                  "store": {"id": shift.store.id, "code": shift.store.code, "name": shift.store.name}} if shift else None,
        "shift_end_time": settings.shift_end_time or None,
        "after_hours": clock.after_hours(),
        "company": {"name": s["erp.company_name"], "address": s["erp.company_address"], "phone": s["erp.company_phone"],
                    "tax_id": s["erp.company_tax_id"], "tax_rate": s["erp.tax_rate"], "currency": s["erp.currency"],
                    "receipt_footer": settings.receipt_footer},
        "max_discount_pct": settings.max_discount_pct,
        "cash_out_approval_above": settings.cash_out_approval_above,
        "return_days": settings.return_days,
        "low_stock_at": settings.low_stock_at,
        "email_receipts": bool(settings.smtp_host),
        "loyalty": {"earn_per": s["erp.loyalty_earn_per"], "point_value": s["erp.loyalty_point_value"]},
        "walk_in_customer_id": s["walk_in_customer_id"],
        "preferences": preferences_of(user),
        "has_pin": bool(user.pin_hash),
        "erp_ready": erp_can_take_sales(db),
    }


def sync_if_stale(request: Request) -> None:
    """After a login: freshen the mirror in the background if it is old, so the till is current."""
    with request.app.state.session_factory() as db:
        refresh(db, request.app.state.erp, request.app.state.settings.sync_stale_minutes, "login")


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, background: BackgroundTasks, db: Db,
          erp: Erp) -> dict:
    settings = request.app.state.settings
    user = auth_service.authenticate(db, erp, body.username, body.password)
    db.flush()
    token = auth_service.start_session(db, user, settings.session_hours, request.headers.get("user-agent"))
    db.commit()
    response.set_cookie(SESSION_COOKIE, token, max_age=settings.session_hours * 3600, httponly=True,
                        samesite="lax", secure=settings.cookie_secure, path="/")
    background.add_task(sync_if_stale, request)
    return me_out(user, db, settings)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Db) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        auth_service.end_session(db, token)
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me")
def me(user: CurrentUser, request: Request, db: Db) -> dict:
    return me_out(user, db, request.app.state.settings)
