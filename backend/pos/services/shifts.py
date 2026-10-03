"""Shifts: open with a counted float, move cash in and out, close by counting the drawer.

At the shop's closing time (POS_SHIFT_END_TIME, shop time) every open shift ends by itself and
no new one opens until the next day. Nobody has counted the drawer then, so such a shift is
marked auto-closed and the cashier records the count afterwards.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..erp_client import ErpClient
from ..models import CashMovement, ReturnRefund, Sale, SalePayment, SaleReturn, Shift, Store, User, utcnow
from .approvals import Approval, approve
from .common import DomainError, next_number, rupiah

METHODS = ("cash", "card", "qris", "points")


@dataclass(frozen=True)
class ShiftClock:
    tz: str
    end_time: str = ""  # "HH:MM" shop time; empty: shifts never end by themselves

    @classmethod
    def from_settings(cls, settings) -> "ShiftClock":
        return cls(settings.timezone, settings.shift_end_time)

    def _end(self) -> time | None:
        if not self.end_time:
            return None
        hours, minutes = self.end_time.split(":")
        return time(int(hours), int(minutes))

    def _to_utc(self, local: datetime) -> datetime:
        return local.astimezone(UTC).replace(tzinfo=None)

    def ends_at(self, opened_at: datetime) -> datetime | None:
        """When a shift opened at `opened_at` (naive UTC) ends: closing time on the day it opened."""
        end = self._end()
        if end is None:
            return None
        opened = opened_at.replace(tzinfo=UTC).astimezone(ZoneInfo(self.tz))
        cutoff = opened.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)
        if cutoff <= opened:  # opened after closing time (only before this rule existed): the next day's
            cutoff += timedelta(days=1)
        return self._to_utc(cutoff)

    def after_hours(self) -> bool:
        """Past today's closing time in the shop: no new shift until tomorrow."""
        end = self._end()
        if end is None:
            return False
        now = utcnow().replace(tzinfo=UTC).astimezone(ZoneInfo(self.tz))
        return now >= now.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)


def open_shift(db: Session, user: User, store: Store, opening_float: int, clock: ShiftClock) -> Shift:
    if clock.after_hours():
        raise DomainError(409, f"Shifts end at {clock.end_time}. The till opens again tomorrow.")
    if not store.active:
        raise DomainError(422, f"{store.name} is closed in the ERP.")
    if opening_float < 0:
        raise DomainError(422, "The opening float can't be negative.")
    if current_shift(db, user, clock) is not None:
        raise DomainError(409, "You already have an open shift. Close it first.")
    year = utcnow().year
    number = f"{store.code}/SH/{year}/{next_number(db, f'shift:{store.code}:{year}'):04d}"
    shift = Shift(number=number, store_id=store.id, user_id=user.id, opening_float=opening_float)
    db.add(shift)
    db.flush()
    return shift


def current_shift(db: Session, user: User, clock: ShiftClock) -> Shift | None:
    """The cashier's open shift, if it hasn't run past closing time (then it is ended here)."""
    shift = db.scalar(select(Shift).filter_by(user_id=user.id, status="open"))
    if shift is not None and _end_if_overdue(db, shift, clock):
        db.commit()
        return None
    return shift


def end_overdue_shifts(db: Session, clock: ShiftClock) -> int:
    """Every shift past closing time, e.g. on a till nobody looked at after 17:00. Commits."""
    ended = sum(_end_if_overdue(db, s, clock) for s in db.scalars(select(Shift).filter_by(status="open")).all())
    db.commit()
    return ended


def _end_if_overdue(db: Session, shift: Shift, clock: ShiftClock) -> bool:
    ends_at = clock.ends_at(shift.opened_at)
    if ends_at is None or utcnow() < ends_at:
        return False
    shift.expected_cash = summary(db, shift)["expected_cash"]
    shift.status = "closed"
    shift.closed_at = ends_at
    shift.auto_closed = True
    return True


def add_cash_movement(db: Session, user: User, shift: Shift, kind: str, amount: int, reason: str,
                      erp: ErpClient | None = None, approval: Approval | None = None,
                      approval_above: int | None = None) -> CashMovement:
    """Cash in or out. Taking out more than `approval_above` at once needs a supervisor."""
    if shift.status != "open":
        raise DomainError(409, f"Shift {shift.number} is closed.")
    if kind not in ("in", "out") or amount <= 0:
        raise DomainError(422, "Cash in or out, with an amount above zero.")
    if kind == "out" and amount > summary(db, shift)["expected_cash"]:
        raise DomainError(422, "That is more cash than the drawer should hold.")
    approved_by = None
    if kind == "out" and approval_above is not None and amount > approval_above:
        approved_by = approve(db, erp, approval, f"Taking out more than {rupiah(approval_above)}")
    movement = CashMovement(shift_id=shift.id, kind=kind, amount=amount, reason=reason.strip(), user_id=user.id,
                            approved_by=approved_by)
    db.add(movement)
    db.flush()
    return movement


def summary(db: Session, shift: Shift) -> dict:
    """What the drawer should hold, and the shift's takings by payment method (net of refunds
    made in this shift, which may be for sales of earlier days)."""
    paid = dict(db.execute(
        select(SalePayment.method, func.sum(SalePayment.amount))
        .join(Sale, Sale.id == SalePayment.sale_id).where(Sale.shift_id == shift.id)
        .group_by(SalePayment.method)
    ).all())
    refunded = dict(db.execute(
        select(ReturnRefund.method, func.sum(ReturnRefund.amount))
        .join(SaleReturn, SaleReturn.id == ReturnRefund.return_id).where(SaleReturn.shift_id == shift.id)
        .group_by(ReturnRefund.method)
    ).all())
    sales_count, sales_total = db.execute(
        select(func.count(Sale.id), func.coalesce(func.sum(Sale.total), 0)).where(Sale.shift_id == shift.id)).one()
    refunds_count, refunds_total = db.execute(
        select(func.count(SaleReturn.id), func.coalesce(func.sum(SaleReturn.total), 0))
        .where(SaleReturn.shift_id == shift.id)).one()
    cash_in = sum(m.amount for m in shift.movements if m.kind == "in")
    cash_out = sum(m.amount for m in shift.movements if m.kind == "out")
    by_method = {m: int(paid.get(m, 0)) - int(refunded.get(m, 0)) for m in METHODS}
    expected = shift.opening_float + by_method["cash"] + cash_in - cash_out
    return {
        "sales_count": sales_count, "sales_total": int(sales_total),
        "refunds_count": refunds_count, "refunds_total": int(refunds_total),
        "net_total": int(sales_total) - int(refunds_total),
        "by_method": by_method, "cash_in": cash_in, "cash_out": cash_out, "expected_cash": expected,
    }


def close_shift(db: Session, user: User, shift: Shift, counted_cash: int, note: str | None) -> Shift:
    """End the shift with the drawer count, or record the count for one that ended at closing time."""
    counting_later = shift.status == "closed" and shift.auto_closed and shift.counted_cash is None
    if shift.status != "open" and not counting_later:
        raise DomainError(409, f"Shift {shift.number} is already closed.")
    if counted_cash < 0:
        raise DomainError(422, "Counted cash can't be negative.")
    expected = summary(db, shift)["expected_cash"]
    if counted_cash != expected and not (note and note.strip()):
        raise DomainError(422, f"The drawer is {rupiah(abs(counted_cash - expected))} "
                               f"{'over' if counted_cash > expected else 'short'}. Add a note explaining why.")
    if not counting_later:
        shift.status = "closed"
        shift.closed_at = utcnow()
    shift.closed_by_id = user.id
    shift.expected_cash = expected
    shift.counted_cash = counted_cash
    shift.closing_note = note.strip() if note else None
    return shift
