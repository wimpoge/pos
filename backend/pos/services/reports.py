"""The end-of-day (Z) report: one store, one business day, every cashier and shift."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import Sale, SaleReturn, Shift, Store
from .common import local_date
from .shifts import METHODS


def day_report(db: Session, store: Store, on: date, tz: str) -> dict:
    sales = db.scalars(select(Sale).where(Sale.store_id == store.id, Sale.business_date == on)
                       .options(selectinload(Sale.lines), selectinload(Sale.payments), selectinload(Sale.cashier))
                       .order_by(Sale.id)).all()
    returns = db.scalars(select(SaleReturn).where(SaleReturn.store_id == store.id, SaleReturn.business_date == on)
                         .options(selectinload(SaleReturn.lines), selectinload(SaleReturn.refunds),
                                  selectinload(SaleReturn.cashier))
                         .order_by(SaleReturn.id)).all()
    # Shifts that ran that day: opened then (shop time).
    shifts = [s for s in db.scalars(select(Shift).filter_by(store_id=store.id)
                                    .options(selectinload(Shift.user), selectinload(Shift.movements))
                                    .order_by(Shift.id)).all()
              if local_date(tz, s.opened_at) == on]

    taken = {m: 0 for m in METHODS}
    for s in sales:
        for p in s.payments:
            taken[p.method] = taken.get(p.method, 0) + p.amount
    refunded = {m: 0 for m in METHODS}
    for r in returns:
        for f in r.refunds:
            refunded[f.method] = refunded.get(f.method, 0) + f.amount

    by_cashier: dict[str, dict] = {}
    for s in sales:
        row = by_cashier.setdefault(s.cashier.full_name, {"name": s.cashier.full_name, "sales": 0, "total": 0,
                                                           "refunds": 0})
        row["sales"] += 1
        row["total"] += s.total
    for r in returns:
        row = by_cashier.setdefault(r.cashier.full_name, {"name": r.cashier.full_name, "sales": 0, "total": 0,
                                                           "refunds": 0})
        row["refunds"] += r.total

    products: dict[str, dict] = {}
    promos: dict[str, dict] = {}
    for s in sales:
        for li in s.lines:
            row = products.setdefault(li.sku, {"sku": li.sku, "name": li.name, "qty": 0, "total": 0})
            row["qty"] += li.qty
            row["total"] += li.line_total
            if li.promo:
                promo = promos.setdefault(li.promo, {"name": li.promo, "lines": 0, "discount": 0})
                promo["lines"] += 1
                promo["discount"] += li.qty * li.unit_price - li.line_total
    for r in returns:
        for li in r.lines:
            row = products.setdefault(li.sku, {"sku": li.sku, "name": li.name, "qty": 0, "total": 0})
            row["qty"] -= li.qty
            row["total"] -= li.line_total

    sales_total = sum(s.total for s in sales)
    refunds_total = sum(r.total for r in returns)
    cash_in = sum(m.amount for sh in shifts for m in sh.movements if m.kind == "in")
    cash_out = sum(m.amount for sh in shifts for m in sh.movements if m.kind == "out")
    return {
        "store": {"id": store.id, "code": store.code, "name": store.name}, "date": on,
        "sales": {"count": len(sales), "voided": sum(1 for s in sales if s.voided_at),
                  "offline": sum(1 for s in sales if s.offline),
                  "items": sum(li.qty for s in sales for li in s.lines), "gross": sum(s.gross for s in sales),
                  "discount": sum(s.gross - s.subtotal for s in sales), "subtotal": sum(s.subtotal for s in sales),
                  "tax": sum(s.tax for s in sales), "total": sales_total},
        "returns": {"count": sum(1 for r in returns if r.kind == "return"),
                    "voids": sum(1 for r in returns if r.kind == "void"),
                    "subtotal": sum(r.subtotal for r in returns), "tax": sum(r.tax for r in returns),
                    "total": refunds_total},
        "net": {"total": sales_total - refunds_total,
                "subtotal": sum(s.subtotal for s in sales) - sum(r.subtotal for r in returns),
                "tax": sum(s.tax for s in sales) - sum(r.tax for r in returns)},
        "by_method": [{"method": m, "taken": taken.get(m, 0), "refunded": refunded.get(m, 0),
                       "net": taken.get(m, 0) - refunded.get(m, 0)} for m in METHODS],
        "cash": {"in": cash_in, "out": cash_out},
        "points": {"earned": sum(s.points_earned for s in sales), "redeemed": sum(s.points_redeemed for s in sales)},
        "shifts": [{"id": sh.id, "number": sh.number, "cashier": sh.user.full_name, "status": sh.status,
                    "opened_at": sh.opened_at, "closed_at": sh.closed_at, "opening_float": sh.opening_float,
                    "expected_cash": sh.expected_cash, "counted_cash": sh.counted_cash,
                    "variance": None if sh.counted_cash is None else sh.counted_cash - sh.expected_cash,
                    "auto_closed": sh.auto_closed} for sh in shifts],
        "by_cashier": sorted(by_cashier.values(), key=lambda r: -r["total"]),
        "top_products": sorted(products.values(), key=lambda r: (-r["qty"], r["name"]))[:10],
        "promotions": sorted(promos.values(), key=lambda r: -r["discount"]),
        "erp": {"waiting": sum(1 for s in sales if s.erp_status == "pending")
                + sum(1 for r in returns if r.erp_status == "pending"),
                "refused": sum(1 for s in sales if s.erp_status == "failed")
                + sum(1 for r in returns if r.erp_status == "failed")},
    }

