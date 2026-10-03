"""Checkout at the till, and handing each sale (and each return) to the ERP.

A sale is saved in the POS first; the customer never waits for the ERP. Then it is pushed as a
paid ERP sales order, with the sale's UUID as the ERP's `external_id`, so a push that is retried
(after a timeout, a crash, a second click) can never create a second order there.

  pending --push ok--> synced
  pending --ERP down--> pending (retried later)
  pending --ERP says no (stock, unknown product...)--> failed (fixed in the ERP, retried every 10 min)
  pending/failed --voided at the till--> voided (never sent)

Returns go the same way, once their sale is in the ERP.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from ..erp_client import ErpClient, ErpRejected, ErpUnavailable
from ..models import (
    Customer,
    Product,
    Promotion,
    Sale,
    SaleLine,
    SalePayment,
    SaleReturn,
    SaleReturnLine,
    Shift,
    StockLevel,
    User,
    utcnow,
)
from .approvals import Approval, approve
from .common import DomainError, get_setting, line_amount, local_date, next_number, rupiah, tax_amount
from .pricing import Item, Rule, price_cart
from .sync import NO_PAID_SALES, erp_can_take_sales, unsynced_qty

PAYMENT_METHODS = ("cash", "card", "qris", "points")
# How long one push may hold a sale: longer than the ERP timeout with a token refresh and retry.
SEND_LEASE = timedelta(seconds=90)
# A sale the ERP refused (e.g. no stock there) is tried again this long after, so fixing the cause
# in the ERP is all it takes. Not sooner: the same request would only be refused again.
RETRY_REFUSED_AFTER = timedelta(minutes=10)
UNSENT = ("pending", "failed")


@dataclass
class CartLine:
    product_id: int
    qty: int
    discount_pct: int | None = None  # None: the customer's group discount
    # Only for a sale rung up offline: the price the till charged, kept as it was.
    unit_price: int | None = None
    promo: str | None = None


@dataclass
class PaymentIn:
    method: str
    amount: int  # for cash: what the customer handed over; for points: their rupiah value
    reference: str | None = None


@dataclass
class TillRules:
    max_discount: int
    tz: str


@dataclass
class Offline:
    """A sale the till made while it could not reach this server, sent once it could."""

    sold_at: datetime  # naive UTC
    shift_id: int


@dataclass
class CheckoutIn:
    customer_id: int | None
    cart: list[CartLine]
    payments: list[PaymentIn]
    note: str | None = None
    voucher_code: str | None = None
    approval: Approval | None = None
    public_id: uuid.UUID | None = None  # the till's own id: sending the same sale twice books it once
    offline: Offline | None = None


def available_stock(db: Session, store_id: int, product_ids: list[int] | None = None) -> dict[int, int]:
    """ERP on-hand at the last sync, less what this store sold since that the ERP hasn't booked
    yet, plus what came back that the ERP hasn't booked yet."""
    stmt = select(StockLevel.product_id, StockLevel.on_hand).filter_by(store_id=store_id)
    if product_ids is not None:
        stmt = stmt.where(StockLevel.product_id.in_(product_ids))
    on_hand = dict(db.execute(stmt).all())
    for pid, qty in unsynced_qty(db, store_id).items():
        if pid in on_hand:
            on_hand[pid] -= qty
    return on_hand


def promotion_rules(db: Session) -> list[Rule]:
    return [Rule.of(p) for p in db.scalars(select(Promotion).where(Promotion.active).order_by(Promotion.id))]


def points_available(db: Session, customer: Customer) -> int:
    """The ERP's balance, less points spent on sales the ERP hasn't booked yet."""
    spent = db.scalar(select(func.coalesce(func.sum(Sale.points_redeemed), 0))
                      .where(Sale.customer_id == customer.id, Sale.erp_status.in_(UNSENT)))
    return max(customer.points - spent, 0)


def find_by_public_id(db: Session, public_id: uuid.UUID | None) -> Sale | None:
    return db.scalar(select(Sale).filter_by(public_id=public_id)) if public_id else None


def _offline_lines(data: "CheckoutIn", products: dict[int, Product]) -> list[SaleLine]:
    """The till priced it with what it knew then and the customer paid that: keep it as it was."""
    lines = []
    for li in data.cart:
        product = products[li.product_id]
        price = product.price if li.unit_price is None else li.unit_price
        discount = li.discount_pct or 0
        lines.append(SaleLine(product_id=product.id, sku=product.sku, name=product.name, qty=li.qty, unit_price=price,
                              discount_pct=discount, promo=li.promo, line_total=line_amount(li.qty, price, discount)))
    return lines


def checkout(db: Session, erp: ErpClient, user: User, shift: Shift | None, data: CheckoutIn, rules: TillRules) -> Sale:
    if data.offline is not None:
        shift = db.get(Shift, data.offline.shift_id)
        if shift is None or shift.user_id != user.id:
            raise DomainError(409, "That offline sale belongs to a shift that isn't yours.")
    elif shift is None or shift.status != "open" or shift.user_id != user.id:
        raise DomainError(409, "Open a shift before selling.")
    if not erp_can_take_sales(db):
        raise DomainError(409, NO_PAID_SALES)
    walk_in_id = get_setting(db, "walk_in_customer_id")
    customer_id = data.customer_id or walk_in_id
    customer = db.get(Customer, customer_id) if customer_id else None
    if customer is None or not customer.active:
        raise DomainError(422, "Pick a customer. (No walk-in customer yet: run a sync from the ERP.)")
    if not data.cart:
        raise DomainError(422, "The cart is empty.")
    for line in data.cart:
        if line.qty <= 0:
            raise DomainError(422, "Quantities must be at least 1.")
        if line.discount_pct is not None and not 0 <= line.discount_pct <= 100:
            raise DomainError(422, "Discounts must be between 0 and 100%.")

    products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_({li.product_id for li in data.cart})))}
    for line in data.cart:
        product = products.get(line.product_id)
        if product is None or (not product.active and data.offline is None):
            raise DomainError(422, f"Product {line.product_id} is unknown or no longer sold.")

    sold_at = data.offline.sold_at if data.offline else utcnow()
    business_date = local_date(rules.tz, sold_at)
    store = shift.store
    approved_by = None
    if data.offline is not None:
        lines = _offline_lines(data, products)
        voucher_code = (data.voucher_code or "").strip().upper() or None
    else:
        # One line per product, however many times it was scanned.
        merged: dict[int, CartLine] = {}
        for line in data.cart:
            if line.product_id in merged:
                merged[line.product_id].qty += line.qty
            else:
                merged[line.product_id] = CartLine(line.product_id, line.qty, line.discount_pct)
        stock = available_stock(db, store.id, list(merged))
        for line in merged.values():
            product = products[line.product_id]
            if line.qty > stock.get(product.id, 0):
                raise DomainError(409, f"Only {max(stock.get(product.id, 0), 0)} {product.unit} of {product.name} "
                                       f"in stock here. Refresh stock if goods just arrived.")
        priced, voucher = price_cart(
            [Item(li.product_id, products[li.product_id].category, products[li.product_id].price, li.qty,
                  li.discount_pct) for li in merged.values()],
            customer.discount_pct, promotion_rules(db), store.id, business_date, data.voucher_code)
        cap = max(rules.max_discount, customer.discount_pct)
        over = [p for p in priced if p.manual and p.discount_pct > cap]
        if over:
            names = ", ".join(products[p.product_id].name for p in over)
            approved_by = approve(db, erp, data.approval, f"A discount over {rules.max_discount}% ({names})")
        lines = [SaleLine(product_id=p.product_id, sku=products[p.product_id].sku, name=products[p.product_id].name,
                          qty=p.qty, unit_price=p.unit_price, discount_pct=p.discount_pct, promo=p.promo,
                          line_total=p.line_total) for p in priced]
        voucher_code = voucher.code if voucher and any(li.promo == voucher.name for li in lines) else None

    tax_rate = int(get_setting(db, "erp.tax_rate"))
    subtotal = sum(li.line_total for li in lines)
    tax = tax_amount(subtotal, tax_rate)
    total = subtotal + tax
    if total <= 0:
        raise DomainError(422, "The total must be above zero.")

    recorded, cash_tendered, change = settle(total, data.payments)
    by_points = sum(p.amount for p in recorded if p.method == "points")
    points_redeemed = 0
    if by_points:
        value = int(get_setting(db, "erp.loyalty_point_value") or 0)
        if customer.id == walk_in_id:
            raise DomainError(422, "Pick the customer to pay with their points.")
        if value <= 0:
            raise DomainError(422, "The ERP has no loyalty points set up.")
        if by_points % value:
            raise DomainError(422, f"Points pay in steps of {rupiah(value)}.")
        points_redeemed = by_points // value
        if data.offline is None and points_redeemed > points_available(db, customer):
            raise DomainError(409, f"{customer.name} has {points_available(db, customer)} points to spend.")
    earn_per = int(get_setting(db, "erp.loyalty_earn_per") or 0)
    points_earned = (total - by_points) // earn_per if earn_per > 0 and customer.id != walk_in_id else 0

    seq = next_number(db, f"sale:{store.code}:{business_date.year}")
    sale = Sale(number=f"{store.code}/{business_date.year}/{seq:05d}", shift_id=shift.id, store_id=store.id,
                cashier_id=user.id, customer_id=customer.id, business_date=business_date, created_at=sold_at,
                tax_rate=tax_rate, gross=sum(li.qty * li.unit_price for li in lines), subtotal=subtotal, tax=tax,
                total=total, cash_tendered=cash_tendered, change_due=change, note=(data.note or "").strip() or None,
                voucher_code=voucher_code, points_earned=points_earned, points_redeemed=points_redeemed,
                approved_by=approved_by, offline=data.offline is not None, lines=lines, payments=recorded)
    if data.public_id:
        sale.public_id = data.public_id
    db.add(sale)
    db.flush()
    return sale


def settle(total: int, payments: list[PaymentIn]) -> tuple[list[SalePayment], int, int]:
    """Card, QRIS and points pay exact amounts; cash covers the rest and gets change. Returns
    (payments as recorded, cash handed over, change)."""
    if not payments:
        raise DomainError(422, "Add a payment.")
    for p in payments:
        if p.method not in PAYMENT_METHODS:
            raise DomainError(422, f"Payment method must be one of: {', '.join(PAYMENT_METHODS)}.")
        if p.amount <= 0:
            raise DomainError(422, "Payment amounts must be above zero.")
    non_cash = sum(p.amount for p in payments if p.method != "cash")
    tendered = sum(p.amount for p in payments if p.method == "cash")
    if non_cash > total:
        raise DomainError(422, f"Card, QRIS and points add up to {rupiah(non_cash)}, more than the total "
                               f"{rupiah(total)}.")
    cash_due = total - non_cash
    if tendered < cash_due:
        raise DomainError(422, f"{rupiah(cash_due - tendered)} still to pay.")
    if cash_due == 0 and tendered:
        raise DomainError(422, "Card, QRIS and points already cover the total; remove the cash.")
    recorded = [SalePayment(method=p.method, amount=p.amount, reference=(p.reference or "").strip() or None)
                for p in payments if p.method != "cash"]
    if cash_due:
        recorded.insert(0, SalePayment(method="cash", amount=cash_due))
    return recorded, tendered, tendered - cash_due


def erp_order(db: Session, sale: Sale) -> dict:
    """The sale as an ERP paid sales order. Prices and discounts are sent explicitly, so the ERP
    invoices exactly what the receipt says even if its list price changed since the last sync."""
    return {
        "external_id": str(sale.public_id),
        "customer_id": str(sale.customer.erp_id),
        "warehouse_id": str(sale.store.erp_id),
        "order_date": sale.business_date.isoformat(),
        "reference": sale.number,
        "lines": [{"product_id": str(li.product.erp_id), "qty": li.qty, "unit_price": li.unit_price,
                   "discount_pct": li.discount_pct} for li in sale.lines],
        "payments": [{"method": p.method, "amount": p.amount, "reference": p.reference} for p in sale.payments],
        "earn_points": sale.customer_id != get_setting(db, "walk_in_customer_id"),
    }


def erp_return(ret: SaleReturn) -> dict:
    return {
        "external_id": str(ret.public_id),
        "order_external_id": str(ret.sale.public_id),
        "return_date": ret.business_date.isoformat(),
        "reason": f"{ret.number}: {ret.reason}"[:200],
        "lines": [{"product_id": str(li.product.erp_id), "qty": li.qty, "unit_price": li.unit_price,
                   "discount_pct": li.discount_pct} for li in ret.lines],
        "refunds": [{"method": r.method, "amount": r.amount, "reference": r.reference} for r in ret.refunds],
    }


def claim(db: Session, model, obj) -> bool:
    """Take a sale or return for one push attempt, unless another push (the after-checkout task, a
    till's retry, the cron) is already on it. Committed at once: no transaction stays open while
    the ERP works."""
    now = utcnow()
    claimed = db.execute(
        update(model)
        .where(model.id == obj.id, model.erp_status.in_(UNSENT),
               or_(model.erp_sending_until.is_(None), model.erp_sending_until < now))
        .values(erp_sending_until=now + SEND_LEASE, erp_attempts=model.erp_attempts + 1, erp_last_attempt_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount
    db.commit()
    db.refresh(obj)
    return bool(claimed)


def _mirror_stock(db: Session, store_id: int, moved: list[tuple[int, int]]) -> None:
    """The ERP's stock just changed by these (product, signed qty); mirror it until the next sync."""
    levels = {lv.product_id: lv for lv in db.scalars(
        select(StockLevel).filter_by(store_id=store_id).where(StockLevel.product_id.in_([p for p, _ in moved])))}
    for product_id, qty in moved:
        if product_id in levels:
            levels[product_id].on_hand = max(levels[product_id].on_hand + qty, 0)


def push_sale(db: Session, erp: ErpClient, sale: Sale) -> bool:
    """Send one sale to the ERP and record the outcome. Commits. Never raises for ERP trouble.
    False when there was nothing to do: already in the ERP, voided, or being sent right now."""
    if not claim(db, Sale, sale):
        return False
    order = erp_order(db, sale)
    db.commit()  # end the read transaction before the slow call
    try:
        _, body = erp.post("/sales-orders", order)
    except ErpUnavailable as e:
        sale.erp_status = "pending"
        sale.erp_error = e.message[:500]
    except ErpRejected as e:
        sale.erp_status = "failed"
        sale.erp_error = e.message[:500]
    else:
        if body.get("total") != sale.total or body.get("invoice_status") != "paid":
            # Should not happen: the ERP checks payments equal its total. Stop and let a person look.
            sale.erp_status = "failed"
            sale.erp_error = (f"The ERP booked {body.get('number')} for {rupiah(body.get('total') or 0)} "
                              f"(invoice {body.get('invoice_status')}), the POS sold {rupiah(sale.total)}.")[:500]
        else:
            sale.erp_status = "synced"
            sale.erp_error = None
            sale.erp_synced_at = utcnow()
            _mirror_stock(db, sale.store_id, [(li.product_id, -li.qty) for li in sale.lines])
            if "points_balance" in body:
                sale.points_earned = body.get("points_earned") or 0
                sale.customer.points = body["points_balance"]
        sale.erp_order_number = body.get("number")
        sale.erp_invoice_number = body.get("invoice_number")
    sale.erp_sending_until = None
    db.commit()
    return True


def push_return(db: Session, erp: ErpClient, ret: SaleReturn) -> bool:
    """Send one return to the ERP, once its sale is there. Same rules as push_sale."""
    if ret.sale.erp_status != "synced":
        return False
    if not claim(db, SaleReturn, ret):
        return False
    body_out = erp_return(ret)
    db.commit()
    try:
        _, body = erp.post("/sales-returns", body_out)
    except ErpUnavailable as e:
        ret.erp_status = "pending"
        ret.erp_error = e.message[:500]
    except ErpRejected as e:
        ret.erp_status = "failed"
        ret.erp_error = e.message[:500]
    else:
        ret.erp_status = "synced"
        ret.erp_error = None
        ret.erp_synced_at = utcnow()
        ret.erp_return_number = body.get("number")
        _mirror_stock(db, ret.store_id, [(li.product_id, li.qty) for li in ret.lines])
        if "points_balance" in body:
            ret.sale.customer.points = body["points_balance"]
    ret.erp_sending_until = None
    db.commit()
    return True


def _due(model, now):
    return and_(or_(model.erp_status == "pending",
                    and_(model.erp_status == "failed", model.erp_last_attempt_at < now - RETRY_REFUSED_AFTER)),
                or_(model.erp_sending_until.is_(None), model.erp_sending_until < now))


def push_pending(db: Session, erp: ErpClient, limit: int = 25) -> dict:
    """Send what the ERP has not booked, oldest first: waiting sales, then returns whose sale is
    there, and refused ones once they have rested. Stops early while the ERP is unreachable."""
    now = utcnow()
    sales = db.scalars(select(Sale).where(_due(Sale, now)).order_by(Sale.id).limit(limit)
                       .options(selectinload(Sale.lines).selectinload(SaleLine.product),
                                selectinload(Sale.payments))).all()
    result = {"synced": 0, "pending": 0, "failed": 0, "returns": 0}
    for sale in sales:
        if not push_sale(db, erp, sale):
            continue
        result[sale.erp_status] += 1
        if sale.erp_status == "pending":
            return result  # the ERP is down; the rest would only wait for the same timeout
    returns = db.scalars(select(SaleReturn).join(Sale, Sale.id == SaleReturn.sale_id)
                         .where(_due(SaleReturn, now), Sale.erp_status == "synced")
                         .order_by(SaleReturn.id).limit(limit)
                         .options(selectinload(SaleReturn.lines).selectinload(SaleReturnLine.product))).all()
    for ret in returns:
        if push_return(db, erp, ret):
            if ret.erp_status == "synced":
                result["returns"] += 1
            elif ret.erp_status == "pending":
                break
    return result
