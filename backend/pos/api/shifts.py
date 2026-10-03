from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..models import Shift, Store, User
from ..services import shifts as svc
from ..services.common import get_or_404
from .deps import Clock, CurrentUser, Db, Erp
from .sales import ApprovalIn

router = APIRouter(prefix="/api/shifts", tags=["shifts"])


def shift_out(db, s: Shift, detail: bool = False) -> dict:
    out = {
        "id": s.id, "number": s.number, "status": s.status, "opened_at": s.opened_at, "closed_at": s.closed_at,
        "store": {"id": s.store.id, "code": s.store.code, "name": s.store.name},
        "cashier": {"id": s.user.id, "full_name": s.user.full_name},
        "opening_float": s.opening_float, "expected_cash": s.expected_cash, "counted_cash": s.counted_cash,
        "variance": None if s.counted_cash is None else s.counted_cash - s.expected_cash,
        "closing_note": s.closing_note, "auto_closed": s.auto_closed,
        "needs_count": s.auto_closed and s.counted_cash is None,
    }
    if detail:
        out["summary"] = svc.summary(db, s)
        out["movements"] = [{"id": m.id, "kind": m.kind, "amount": m.amount, "reason": m.reason, "at": m.at,
                             "user": m.user.full_name, "approved_by": m.approved_by} for m in s.movements]
        out["closed_by"] = s.closed_by.full_name if s.closed_by else None
    return out


def _shift_for(db, user: User, shift_id: int) -> Shift:
    shift = get_or_404(db, Shift, shift_id, "Shift")
    if shift.user_id != user.id:
        raise HTTPException(404, "Shift not found.")
    return shift


@router.get("/current")
def current(db: Db, clock: Clock, user: CurrentUser) -> dict | None:
    shift = svc.current_shift(db, user, clock)
    return shift_out(db, shift, detail=True) if shift else None


class OpenIn(BaseModel):
    store_id: int
    opening_float: int = Field(ge=0)


@router.post("", status_code=201)
def open_shift(body: OpenIn, db: Db, clock: Clock, user: CurrentUser) -> dict:
    store = get_or_404(db, Store, body.store_id, "Store")
    shift = svc.open_shift(db, user, store, body.opening_float, clock)
    db.commit()
    return shift_out(db, shift, detail=True)


@router.get("")
def list_shifts(db: Db, user: CurrentUser, status: Literal["open", "closed"] | None = None,
                limit: Annotated[int, Query(ge=1, le=200)] = 50) -> list[dict]:
    stmt = (select(Shift).options(selectinload(Shift.store), selectinload(Shift.user))
            .where(Shift.user_id == user.id).order_by(Shift.id.desc()))
    if status:
        stmt = stmt.where(Shift.status == status)
    return [shift_out(db, s) for s in db.scalars(stmt.limit(limit))]


@router.get("/{shift_id}")
def get_shift(shift_id: int, db: Db, clock: Clock, user: CurrentUser) -> dict:
    shift = _shift_for(db, user, shift_id)
    if shift.status == "open":
        svc.current_shift(db, user, clock)  # ends it if it ran past closing time
        db.refresh(shift)
    return shift_out(db, shift, detail=True)


class CashIn(BaseModel):
    kind: Literal["in", "out"]
    amount: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=200)
    approval: ApprovalIn | None = None  # for a cash-out over POS_CASH_OUT_APPROVAL_ABOVE


@router.post("/{shift_id}/cash", status_code=201)
def cash_movement(shift_id: int, body: CashIn, request: Request, db: Db, erp: Erp, user: CurrentUser) -> dict:
    shift = _shift_for(db, user, shift_id)
    svc.add_cash_movement(db, user, shift, body.kind, body.amount, body.reason, erp,
                          body.approval.to_service() if body.approval else None,
                          request.app.state.settings.cash_out_approval_above)
    db.commit()
    db.refresh(shift)
    return shift_out(db, shift, detail=True)


class CloseIn(BaseModel):
    counted_cash: int = Field(ge=0)
    note: str | None = Field(None, max_length=500)


@router.post("/{shift_id}/close")
def close(shift_id: int, body: CloseIn, db: Db, user: CurrentUser) -> dict:
    """End the shift with the drawer count; also records the count for one that ended at closing time."""
    shift = _shift_for(db, user, shift_id)
    svc.close_shift(db, user, shift, body.counted_cash, body.note)
    db.commit()
    return shift_out(db, shift, detail=True)
