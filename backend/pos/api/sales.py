import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from ..models import Customer, Sale, SaleLine, SalePayment, SaleReturn, User
from ..services import returns as returns_svc
from ..services import sales as svc
from ..services.approvals import Approval
from ..services.common import get_or_404, local_date
from ..services.receipts import send_receipt
from ..services.shifts import current_shift
from .deps import Clock, CurrentUser, Db, Erp, Tz

router = APIRouter(prefix="/api/sales", tags=["sales"])


def erp_out(o) -> dict:
    return {"status": o.erp_status, "error": o.erp_error, "attempts": o.erp_attempts,
            "last_attempt_at": o.erp_last_attempt_at, "synced_at": o.erp_synced_at}


def return_out(r: SaleReturn) -> dict:
    return {
        "id": r.id, "number": r.number, "kind": r.kind, "created_at": r.created_at, "reason": r.reason,
        "approved_by": r.approved_by, "cashier": r.cashier.full_name, "subtotal": r.subtotal, "tax": r.tax,
        "total": r.total, "sale": {"id": r.sale.id, "number": r.sale.number},
        "lines": [{"sale_line_id": li.sale_line_id, "sku": li.sku, "name": li.name, "qty": li.qty,
                   "line_total": li.line_total} for li in r.lines],
        "refunds": [{"method": f.method, "amount": f.amount, "reference": f.reference} for f in r.refunds],
        "erp": {**erp_out(r), "return_number": r.erp_return_number},
    }


def sale_out(s: Sale, detail: bool = False) -> dict:
    out = {
        "id": s.id, "number": s.number, "created_at": s.created_at, "business_date": s.business_date,
        "store": {"id": s.store.id, "code": s.store.code, "name": s.store.name},
        "cashier": {"id": s.cashier.id, "full_name": s.cashier.full_name},
        "customer": {"id": s.customer.id, "code": s.customer.code, "name": s.customer.name},
        "total": s.total, "items": sum(li.qty for li in s.lines),
        "methods": sorted({p.method for p in s.payments}),
        "refunded": sum(r.total for r in s.returns), "voided": s.voided_at is not None, "offline": s.offline,
        "erp": {**erp_out(s), "order_number": s.erp_order_number, "invoice_number": s.erp_invoice_number},
    }
    if detail:
        returned = returns_svc.returned_qty(s)
        out.update({
            "shift": {"id": s.shift.id, "number": s.shift.number}, "tax_rate": s.tax_rate, "gross": s.gross,
            "discount": s.gross - s.subtotal, "subtotal": s.subtotal, "tax": s.tax,
            "cash_tendered": s.cash_tendered, "change_due": s.change_due, "note": s.note,
            "external_id": str(s.public_id), "voucher_code": s.voucher_code, "approved_by": s.approved_by,
            "points_earned": s.points_earned, "points_redeemed": s.points_redeemed,
            "customer_email": s.customer.email, "voided_at": s.voided_at,
            "lines": [{"id": li.id, "product_id": li.product_id, "sku": li.sku, "name": li.name, "qty": li.qty,
                       "unit_price": li.unit_price, "discount_pct": li.discount_pct, "line_total": li.line_total,
                       "promo": li.promo, "returned": returned.get(li.id, 0)} for li in s.lines],
            "payments": [{"method": p.method, "amount": p.amount, "reference": p.reference} for p in s.payments],
            "returns": [return_out(r) for r in s.returns],
        })
    return out


def _load(db, sale_id: int, user: User, clock=None) -> Sale:
    """The cashier's own sales, and any sale of the store their shift is in (to take goods back)."""
    sale = get_or_404(db, Sale, sale_id, "Sale")
    if sale.cashier_id != user.id:
        shift = current_shift(db, user, clock) if clock else None
        if shift is None or shift.store_id != sale.store_id:
            raise HTTPException(404, "Sale not found.")
    return sale


def push_in_background(request: Request, sale_id: int) -> None:
    """After the response: the till already has its receipt. A fresh session; the request's is closed."""
    with request.app.state.session_factory() as db:
        sale = db.get(Sale, sale_id)
        if sale is not None:
            svc.push_sale(db, request.app.state.erp, sale)


def push_return_in_background(request: Request, return_id: int) -> None:
    with request.app.state.session_factory() as db:
        ret = db.get(SaleReturn, return_id)
        if ret is not None and ret.erp_status == "pending":
            if ret.sale.erp_status in svc.UNSENT:  # its sale first, or the ERP has nothing to return against
                svc.push_sale(db, request.app.state.erp, ret.sale)
            svc.push_return(db, request.app.state.erp, ret)


class ApprovalIn(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=200)

    def to_service(self) -> Approval:
        return Approval(self.username, self.password)


class LineIn(BaseModel):
    product_id: int
    qty: int = Field(gt=0, le=10_000)
    discount_pct: int | None = Field(None, ge=0, le=100)
    # Only read for an offline sale: what the till charged then.
    unit_price: int | None = Field(None, ge=0)
    promo: str | None = Field(None, max_length=80)


class PaymentIn(BaseModel):
    method: Literal["cash", "card", "qris", "points"]
    amount: int = Field(gt=0)
    reference: str | None = Field(None, max_length=60)


class OfflineIn(BaseModel):
    sold_at: datetime
    shift_id: int


class CheckoutIn(BaseModel):
    customer_id: int | None = None  # None: the walk-in customer
    lines: list[LineIn] = Field(min_length=1, max_length=200)
    payments: list[PaymentIn] = Field(min_length=1, max_length=10)
    note: str | None = Field(None, max_length=200)
    voucher_code: str | None = Field(None, max_length=30)
    approval: ApprovalIn | None = None
    # The till's id for the sale: sending it again (a retry, an offline sale replayed) books it once.
    public_id: uuid.UUID | None = None
    offline: OfflineIn | None = None


@router.post("", status_code=201)
def checkout(body: CheckoutIn, request: Request, response: Response, background: BackgroundTasks, db: Db, tz: Tz,
             clock: Clock, erp: Erp, user: CurrentUser) -> dict:
    existing = svc.find_by_public_id(db, body.public_id)
    if existing is not None:
        if existing.cashier_id != user.id:
            raise HTTPException(409, "That sale id is taken.")
        response.status_code = 200
        return sale_out(existing, detail=True)
    offline = None
    if body.offline:
        sold_at = body.offline.sold_at
        if sold_at.tzinfo is not None:
            sold_at = sold_at.astimezone(UTC).replace(tzinfo=None)
        offline = svc.Offline(sold_at, body.offline.shift_id)
    shift = None if offline else current_shift(db, user, clock)
    sale = svc.checkout(db, erp, user, shift, svc.CheckoutIn(
        customer_id=body.customer_id,
        cart=[svc.CartLine(li.product_id, li.qty, li.discount_pct, li.unit_price, li.promo) for li in body.lines],
        payments=[svc.PaymentIn(p.method, p.amount, p.reference) for p in body.payments],
        note=body.note, voucher_code=body.voucher_code,
        approval=body.approval.to_service() if body.approval else None, public_id=body.public_id, offline=offline,
    ), svc.TillRules(request.app.state.settings.max_discount_pct, tz))
    db.commit()
    background.add_task(push_in_background, request, sale.id)
    return sale_out(sale, detail=True)


@router.get("")
def list_sales(
    db: Db, user: CurrentUser,
    q: Annotated[str | None, Query(max_length=60)] = None,
    erp_status: Literal["pending", "synced", "failed", "voided"] | None = None,
    store_id: int | None = None, shift_id: int | None = None, on: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> dict:
    stmt = select(Sale).where(Sale.cashier_id == user.id)
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.join(Customer, Customer.id == Sale.customer_id).where(
            or_(Sale.number.ilike(term), Sale.erp_order_number.ilike(term), Customer.name.ilike(term)))
    for column, value in ((Sale.erp_status, erp_status), (Sale.store_id, store_id), (Sale.shift_id, shift_id),
                          (Sale.business_date, on)):
        if value is not None:
            stmt = stmt.where(column == value)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.options(selectinload(Sale.lines), selectinload(Sale.payments), selectinload(Sale.store),
                                   selectinload(Sale.cashier), selectinload(Sale.customer),
                                   selectinload(Sale.returns))
                      .order_by(Sale.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [sale_out(s) for s in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/summary")
def summary(db: Db, user: CurrentUser, tz: Tz, on: date | None = None, store_id: int | None = None) -> dict:
    """A day's takings net of refunds, and how many sales and returns are still waiting for the ERP."""
    on = on or local_date(tz)
    day = select(Sale).where(Sale.business_date == on, Sale.cashier_id == user.id)
    if store_id:
        day = day.where(Sale.store_id == store_id)
    ids = day.with_only_columns(Sale.id).scalar_subquery()
    count, total, tax = db.execute(select(func.count(Sale.id), func.coalesce(func.sum(Sale.total), 0),
                                          func.coalesce(func.sum(Sale.tax), 0)).where(Sale.id.in_(ids))).one()
    by_method = dict(db.execute(select(SalePayment.method, func.sum(SalePayment.amount))
                                .where(SalePayment.sale_id.in_(ids)).group_by(SalePayment.method)).all())
    returns = select(SaleReturn).where(SaleReturn.business_date == on, SaleReturn.cashier_id == user.id)
    if store_id:
        returns = returns.where(SaleReturn.store_id == store_id)
    refunded_rows = db.scalars(returns.options(selectinload(SaleReturn.refunds))).all()
    for r in refunded_rows:
        for f in r.refunds:
            by_method[f.method] = by_method.get(f.method, 0) - f.amount
    refunds = sum(r.total for r in refunded_rows)
    items = db.scalar(select(func.coalesce(func.sum(SaleLine.qty), 0)).where(SaleLine.sale_id.in_(ids)))
    top = db.execute(select(SaleLine.name, func.sum(SaleLine.qty).label("qty"), func.sum(SaleLine.line_total))
                     .where(SaleLine.sale_id.in_(ids)).group_by(SaleLine.name)
                     .order_by(func.sum(SaleLine.qty).desc()).limit(5)).all()
    erp = {"pending": 0, "failed": 0}
    for model, owner in ((Sale, Sale.cashier_id), (SaleReturn, SaleReturn.cashier_id)):
        for status, n in db.execute(select(model.erp_status, func.count(model.id))
                                    .where(model.erp_status.in_(("pending", "failed")), owner == user.id)
                                    .group_by(model.erp_status)).all():
            erp[status] += n
    return {
        "date": on, "sales_count": count, "total": int(total), "tax": int(tax), "items": int(items),
        "average": int(total) // count if count else 0, "refunds": refunds, "net": int(total) - refunds,
        "by_method": {m: int(by_method.get(m, 0)) for m in ("cash", "card", "qris", "points")},
        "top_products": [{"name": n, "qty": int(q), "total": int(t)} for n, q, t in top],
        "erp": erp,
    }


@router.get("/lookup")
def lookup(number: Annotated[str, Query(min_length=1, max_length=60)], db: Db, clock: Clock,
           user: CurrentUser) -> dict:
    """A receipt the customer brought back: any sale of the store this cashier's shift is in.
    The full number, its last digits ("42"), or the ERP order number."""
    shift = current_shift(db, user, clock)
    if shift is None:
        raise HTTPException(409, "Open a shift first.")
    term = number.strip().upper()
    match = [func.upper(Sale.number) == term, func.upper(Sale.erp_order_number) == term]
    if term.isdigit():
        match.append(Sale.number.like(f"%/{int(term):05d}"))
    sale = db.scalar(select(Sale).where(Sale.store_id == shift.store_id, or_(*match))
                     .order_by(Sale.id.desc()).limit(1))
    if sale is None:
        raise HTTPException(404, f"No sale {number.strip()} at {shift.store.name}.")
    return sale_out(sale, detail=True)


@router.get("/{sale_id}")
def get_sale(sale_id: int, db: Db, clock: Clock, user: CurrentUser) -> dict:
    return sale_out(_load(db, sale_id, user, clock), detail=True)


@router.post("/{sale_id}/push")
def push(sale_id: int, db: Db, erp: Erp, clock: Clock, user: CurrentUser) -> dict:
    """Send one sale to the ERP now (also a refused one once its problem is fixed in the ERP), then
    any of its returns."""
    sale = _load(db, sale_id, user, clock)
    svc.push_sale(db, erp, sale)
    for ret in sale.returns:
        if ret.erp_status in ("pending", "failed"):
            svc.push_return(db, erp, ret)
    db.refresh(sale)
    return sale_out(sale, detail=True)


@router.post("/push-pending")
def push_pending(db: Db, erp: Erp, _: CurrentUser) -> dict:
    """Retry sales and returns the ERP has not booked. Tills call this every minute or so while any are open."""
    return svc.push_pending(db, erp)


# ---------------------------------------------------------------- returns and voids


class ReturnLineIn(BaseModel):
    sale_line_id: int
    qty: int = Field(gt=0, le=10_000)


class ReturnIn(BaseModel):
    lines: list[ReturnLineIn] = Field(min_length=1, max_length=200)
    refunds: list[PaymentIn] = Field(min_length=1, max_length=10)
    reason: str = Field(min_length=1, max_length=200)
    approval: ApprovalIn | None = None


class VoidIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200)
    approval: ApprovalIn | None = None


def _take_back(request, background, db, erp, tz, clock, user, sale_id, lines, refunds, reason, approval, void):
    sale = _load(db, sale_id, user, clock)
    ret = returns_svc.create_return(
        db, erp, user, current_shift(db, user, clock), sale,
        [returns_svc.ReturnLineIn(li.sale_line_id, li.qty) for li in lines],
        [returns_svc.RefundIn(r.method, r.amount, r.reference) for r in refunds],
        reason, approval.to_service() if approval else None, tz, request.app.state.settings.return_days, void)
    db.commit()
    if ret.erp_status == "pending":
        background.add_task(push_return_in_background, request, ret.id)
    db.refresh(sale)
    return {"return": return_out(ret), "sale": sale_out(sale, detail=True)}


@router.post("/{sale_id}/returns", status_code=201)
def take_back(sale_id: int, body: ReturnIn, request: Request, background: BackgroundTasks, db: Db, erp: Erp,
              tz: Tz, clock: Clock, user: CurrentUser) -> dict:
    """Goods back, money back. Needs a supervisor."""
    return _take_back(request, background, db, erp, tz, clock, user, sale_id, body.lines, body.refunds, body.reason,
                      body.approval, void=False)


@router.post("/{sale_id}/void", status_code=201)
def void(sale_id: int, body: VoidIn, request: Request, background: BackgroundTasks, db: Db, erp: Erp, tz: Tz,
         clock: Clock, user: CurrentUser) -> dict:
    """Cancel a whole sale of this shift, refunded the way it was paid. Needs a supervisor."""
    return _take_back(request, background, db, erp, tz, clock, user, sale_id, [], [], body.reason, body.approval,
                      void=True)


class EmailIn(BaseModel):
    to: EmailStr


@router.post("/{sale_id}/email", status_code=204)
def email_receipt(sale_id: int, body: EmailIn, request: Request, db: Db, clock: Clock, user: CurrentUser) -> None:
    send_receipt(db, request.app.state.settings, _load(db, sale_id, user, clock), str(body.to))
