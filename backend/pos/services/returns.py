"""Returns and voids: goods back on the shelf, money back to the customer, a supervisor's say-so.

A return takes back some or all of a sale's items, within POS_RETURN_DAYS, at any till of the
store, refunded from the current shift's drawer (or by card, QRIS or points). A void cancels a
whole sale in the shift it was made in and refunds exactly how it was paid. Both are pushed to
the ERP as a sales return once the sale is there; a sale voided before it ever reached the ERP
is simply never sent, and neither is its void.
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from ..erp_client import ErpClient
from ..models import ReturnRefund, Sale, SaleReturn, SaleReturnLine, Shift, User, utcnow
from .approvals import Approval, approve
from .common import DomainError, get_setting, line_amount, local_date, next_number, rupiah, tax_amount
from .sales import PAYMENT_METHODS, UNSENT
from .shifts import summary as shift_summary


@dataclass
class ReturnLineIn:
    sale_line_id: int
    qty: int


@dataclass
class RefundIn:
    method: str
    amount: int
    reference: str | None = None


def returned_qty(sale: Sale) -> dict[int, int]:
    """Units of each sale line that already came back."""
    out: dict[int, int] = {}
    for ret in sale.returns:
        for li in ret.lines:
            out[li.sale_line_id] = out.get(li.sale_line_id, 0) + li.qty
    return out


def return_totals(sale: Sale, subtotal: int, closes_sale: bool) -> tuple[int, int, int]:
    """(subtotal, tax, total), the ERP's way: the return that takes back the last unit gives back
    exactly what is left of the sale, so rounding line by line never refunds more than was paid."""
    if closes_sale:
        subtotal = sale.subtotal - sum(r.subtotal for r in sale.returns)
        tax = sale.tax - sum(r.tax for r in sale.returns)
    else:
        tax = tax_amount(subtotal, sale.tax_rate)
    return subtotal, tax, subtotal + tax


def _check_refunds(db: Session, sale: Sale, shift: Shift, total: int, refunds: list[RefundIn]) -> None:
    if sum(r.amount for r in refunds) != total:
        raise DomainError(422, f"Refunds add up to {rupiah(sum(r.amount for r in refunds))}, "
                               f"the return is {rupiah(total)}.")
    for r in refunds:
        if r.method not in PAYMENT_METHODS or r.amount <= 0:
            raise DomainError(422, f"Refund by {', '.join(PAYMENT_METHODS)}, each above zero.")
    cash = sum(r.amount for r in refunds if r.method == "cash")
    if cash and cash > shift_summary(db, shift)["expected_cash"]:
        raise DomainError(422, f"The drawer should hold less than the {rupiah(cash)} cash refund.")
    points = sum(r.amount for r in refunds if r.method == "points")
    if points:
        value = int(get_setting(db, "erp.loyalty_point_value") or 0)
        if sale.customer_id == get_setting(db, "walk_in_customer_id"):
            raise DomainError(422, "A walk-in customer has no points to refund to.")
        if value <= 0 or points % value:
            raise DomainError(422, "A points refund must be a whole number of points.")


def create_return(db: Session, erp: ErpClient, user: User, shift: Shift | None, sale: Sale,
                  lines: list[ReturnLineIn], refunds: list[RefundIn], reason: str, approval: Approval | None,
                  tz: str, return_days: int, void: bool = False) -> SaleReturn:
    if shift is None or shift.status != "open" or shift.user_id != user.id:
        raise DomainError(409, "Open a shift first: refunds come out of your drawer.")
    if sale.store_id != shift.store_id:
        raise DomainError(409, f"{sale.number} was sold at {sale.store.name}; return it there.")
    if sale.erp_status == "voided":
        raise DomainError(409, f"{sale.number} was voided.")
    if not reason.strip():
        raise DomainError(422, "Give a reason.")
    already = returned_qty(sale)
    by_id = {li.id: li for li in sale.lines}

    if void:
        if sale.shift_id != shift.id:
            raise DomainError(409, "Only a sale from this shift can be voided. Take the goods back as a return.")
        if sale.returns:
            raise DomainError(409, f"Part of {sale.number} already came back; return the rest instead.")
        lines = [ReturnLineIn(li.id, li.qty) for li in sale.lines]
        refunds = [RefundIn(p.method, p.amount, p.reference) for p in sale.payments]
    else:
        if local_date(tz) - sale.business_date > timedelta(days=return_days):
            raise DomainError(409, f"{sale.number} is more than {return_days} days old.")

    qty_by_line: dict[int, int] = {}
    for li in lines:
        if li.sale_line_id not in by_id:
            raise DomainError(422, f"Line {li.sale_line_id} is not on {sale.number}.")
        qty_by_line[li.sale_line_id] = qty_by_line.get(li.sale_line_id, 0) + li.qty
    qty_by_line = {k: q for k, q in qty_by_line.items() if q}
    if not qty_by_line:
        raise DomainError(422, "Pick at least one item to take back.")
    for line_id, qty in qty_by_line.items():
        left = by_id[line_id].qty - already.get(line_id, 0)
        if qty < 0 or qty > left:
            raise DomainError(422, f"{by_id[line_id].name}: {left} can still come back.")

    ret_lines = [SaleReturnLine(sale_line_id=line_id, product_id=by_id[line_id].product_id, sku=by_id[line_id].sku,
                                name=by_id[line_id].name, qty=qty, unit_price=by_id[line_id].unit_price,
                                discount_pct=by_id[line_id].discount_pct,
                                line_total=line_amount(qty, by_id[line_id].unit_price, by_id[line_id].discount_pct))
                 for line_id, qty in qty_by_line.items()]
    closes = all(already.get(li.id, 0) + qty_by_line.get(li.id, 0) == li.qty for li in sale.lines)
    subtotal, tax, total = return_totals(sale, sum(li.line_total for li in ret_lines), closes)
    _check_refunds(db, sale, shift, total, refunds)

    kind = "Voiding" if void else "A refund of"
    approved_by = approve(db, erp, approval, f"{kind} {sale.number} ({rupiah(total)})")

    erp_status = "pending"
    if void and sale.erp_status in UNSENT:
        # Not in the ERP yet: make sure no push is on its way, then never send it.
        stopped = db.execute(
            update(Sale).where(Sale.id == sale.id, Sale.erp_status.in_(UNSENT),
                               (Sale.erp_sending_until.is_(None)) | (Sale.erp_sending_until < utcnow()))
            .values(erp_status="voided").execution_options(synchronize_session=False)).rowcount
        if not stopped:
            raise DomainError(409, f"{sale.number} is being sent to the ERP right now. Try again in a minute.")
        db.refresh(sale)
        erp_status = "skipped"
    if void:
        sale.voided_at = utcnow()

    business_date = local_date(tz)
    store = shift.store
    seq = next_number(db, f"return:{store.code}:{business_date.year}")
    ret = SaleReturn(number=f"{store.code}/R/{business_date.year}/{seq:05d}", kind="void" if void else "return",
                     sale_id=sale.id, shift_id=shift.id, store_id=store.id, cashier_id=user.id,
                     approved_by=approved_by, reason=reason.strip()[:200], business_date=business_date,
                     subtotal=subtotal, tax=tax, total=total, erp_status=erp_status, lines=ret_lines,
                     refunds=[ReturnRefund(method=r.method, amount=r.amount,
                                           reference=(r.reference or "").strip() or None) for r in refunds])
    db.add(ret)
    db.flush()
    return ret
