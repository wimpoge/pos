"""Carts put on hold: a customer who forgot their wallet steps aside, the next one is served."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..models import Customer, HeldCart
from ..services.common import get_or_404
from ..services.shifts import current_shift
from .catalog import customer_out
from .deps import Clock, CurrentUser, Db

router = APIRouter(prefix="/api/held-carts", tags=["till"])


def held_out(h: HeldCart, db) -> dict:
    return {"id": h.id, "created_at": h.created_at, "user": h.user.full_name, "note": h.note, "lines": h.lines,
            "voucher_code": h.voucher_code, "items": sum(li["qty"] for li in h.lines),
            "customer": customer_out(h.customer, db) if h.customer else None}


class HeldLine(BaseModel):
    product_id: int
    qty: int = Field(gt=0, le=10_000)
    discount_pct: int | None = Field(None, ge=0, le=100)


class HoldIn(BaseModel):
    customer_id: int | None = None
    lines: list[HeldLine] = Field(min_length=1, max_length=200)
    voucher_code: str | None = Field(None, max_length=30)
    note: str | None = Field(None, max_length=120)


def _store_id(db, user, clock) -> int:
    shift = current_shift(db, user, clock)
    if shift is None:
        raise HTTPException(409, "Open a shift first.")
    return shift.store_id


@router.get("")
def held(db: Db, clock: Clock, user: CurrentUser) -> list[dict]:
    """Every cart on hold in this store, newest first: any cashier there may pick one up."""
    store_id = _store_id(db, user, clock)
    return [held_out(h, db) for h in db.scalars(select(HeldCart).filter_by(store_id=store_id)
                                                .order_by(HeldCart.id.desc()))]


@router.post("", status_code=201)
def hold(body: HoldIn, db: Db, clock: Clock, user: CurrentUser) -> dict:
    store_id = _store_id(db, user, clock)
    if body.customer_id is not None:
        get_or_404(db, Customer, body.customer_id, "Customer")
    cart = HeldCart(store_id=store_id, user_id=user.id, customer_id=body.customer_id,
                    lines=[li.model_dump() for li in body.lines], voucher_code=body.voucher_code,
                    note=(body.note or "").strip() or None)
    db.add(cart)
    db.commit()
    return held_out(cart, db)


@router.post("/{cart_id}/resume")
def resume(cart_id: int, db: Db, clock: Clock, user: CurrentUser) -> dict:
    """Take a held cart back to the till; it leaves the hold list."""
    cart = get_or_404(db, HeldCart, cart_id, "Held cart")
    if cart.store_id != _store_id(db, user, clock):
        raise HTTPException(404, "Held cart not found.")
    out = held_out(cart, db)
    db.delete(cart)
    db.commit()
    return out


@router.delete("/{cart_id}", status_code=204)
def discard(cart_id: int, db: Db, clock: Clock, user: CurrentUser) -> None:
    cart = get_or_404(db, HeldCart, cart_id, "Held cart")
    if cart.store_id != _store_id(db, user, clock):
        raise HTTPException(404, "Held cart not found.")
    db.delete(cart)
    db.commit()
