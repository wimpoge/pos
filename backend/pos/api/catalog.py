"""What the till sells from: stores, the catalogue with stock and promotions, customers, and
asking the ERP for more stock."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_, select

from ..erp_client import ErpRejected, ErpUnavailable
from ..models import Customer, Product, Promotion, StockRequest, Store
from ..services.common import DomainError, get_or_404
from ..services.sales import available_stock, points_available
from ..services.shifts import current_shift
from ..services.sync import upsert_customer
from .deps import Clock, CurrentUser, Db, Erp

router = APIRouter(prefix="/api", tags=["catalog"])


def store_out(s: Store) -> dict:
    return {"id": s.id, "code": s.code, "name": s.name, "city": s.city, "active": s.active}


@router.get("/stores")
def stores(db: Db, _: CurrentUser) -> list[dict]:
    return [store_out(s) for s in db.scalars(select(Store).where(Store.active).order_by(Store.code))]


@router.get("/stores/{store_id}/catalog")
def catalog(store_id: int, db: Db, _: CurrentUser) -> dict:
    """Every product on sale with what this store can sell of it. The till loads it once and
    searches and scans locally, so a barcode is found without a round trip."""
    store = get_or_404(db, Store, store_id, "Store")
    stock = available_stock(db, store.id)
    products = db.scalars(select(Product).where(Product.active).order_by(Product.name)).all()
    promotions = db.scalars(select(Promotion).where(Promotion.active, or_(Promotion.store_id.is_(None),
                                                                          Promotion.store_id == store.id))
                            .order_by(Promotion.id)).all()
    return {
        "store": store_out(store),
        "products": [{"id": p.id, "sku": p.sku, "name": p.name, "barcode": p.barcode, "unit": p.unit,
                      "price": p.price, "category": p.category, "brand": p.brand,
                      "available": max(stock.get(p.id, 0), 0)} for p in products],
        "categories": sorted({p.category for p in products if p.category}),
        # The till prices the cart with these as you scan (services/pricing.py; the server checks).
        "promotions": [{"id": p.id, "name": p.name, "kind": p.kind, "value": p.value, "buy_qty": p.buy_qty,
                        "get_qty": p.get_qty, "code": p.code, "min_spend": p.min_spend, "starts_on": p.starts_on,
                        "ends_on": p.ends_on, "product_id": p.product_id, "category": p.category,
                        "store_id": p.store_id} for p in promotions],
    }


def customer_out(c: Customer, db=None) -> dict:
    return {"id": c.id, "code": c.code, "name": c.name, "phone": c.phone, "email": c.email, "group": c.group_name,
            "discount_pct": c.discount_pct, "points": points_available(db, c) if db is not None else c.points}


@router.get("/customers")
def customers(db: Db, _: CurrentUser, q: Annotated[str | None, Query(max_length=100)] = None,
              limit: Annotated[int, Query(ge=1, le=50)] = 20) -> list[dict]:
    stmt = select(Customer).where(Customer.active)
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Customer.name.ilike(term), Customer.code.ilike(term), Customer.phone.ilike(term),
                              Customer.email.ilike(term)))
    return [customer_out(c, db) for c in db.scalars(stmt.order_by(Customer.name).limit(limit))]


@router.get("/customers/{customer_id}")
def customer(customer_id: int, db: Db, erp: Erp, _: CurrentUser) -> dict:
    """One customer, with the points balance fresh from the ERP when it can be had."""
    c = get_or_404(db, Customer, customer_id, "Customer")
    db.commit()  # no read transaction open across the ERP call (SQLite could not write after it)
    try:
        c.points = erp.get(f"/customers/{c.erp_id}").get("points", c.points)
        db.commit()
    except (ErpRejected, ErpUnavailable):
        pass
    return customer_out(c, db)


class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    phone: str | None = Field(None, max_length=40)
    email: EmailStr | None = None


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn, db: Db, erp: Erp, _: CurrentUser) -> dict:
    """Created in the ERP first (it owns customers and their codes), then copied here."""
    try:
        _, row = erp.post("/customers", body.model_dump())
    except ErpRejected as e:
        raise DomainError(422, f"The ERP refused the customer: {e.message}") from None
    except ErpUnavailable as e:
        raise DomainError(503, f"{e.message} New customers need the ERP; sell to the walk-in customer for now.") from None
    customer = upsert_customer(db, row)
    db.commit()
    return customer_out(customer)


# ---------------------------------------------------------------- stock requests


def request_out(r: StockRequest) -> dict:
    return {"id": r.id, "created_at": r.created_at, "user": r.user.full_name, "lines": r.lines, "note": r.note,
            "erp_transfer_number": r.erp_transfer_number, "source": r.source}


class RequestLineIn(BaseModel):
    product_id: int
    qty: int = Field(gt=0, le=100_000)


class StockRequestIn(BaseModel):
    lines: list[RequestLineIn] = Field(min_length=1, max_length=100)
    note: str | None = Field(None, max_length=200)


@router.get("/stock-requests")
def stock_requests(db: Db, clock: Clock, user: CurrentUser) -> list[dict]:
    shift = current_shift(db, user, clock)
    if shift is None:
        return []
    rows = db.scalars(select(StockRequest).filter_by(store_id=shift.store_id).order_by(StockRequest.id.desc()).limit(10))
    return [request_out(r) for r in rows]


@router.post("/stock-requests", status_code=201)
def request_stock(body: StockRequestIn, db: Db, erp: Erp, clock: Clock, user: CurrentUser) -> dict:
    """Ask the ERP for goods: it drafts a transfer to this store for the warehouse team."""
    shift = current_shift(db, user, clock)
    if shift is None:
        raise HTTPException(409, "Open a shift first.")
    products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_([li.product_id for li in body.lines])))}
    if len(products) != len({li.product_id for li in body.lines}):
        raise DomainError(422, "Unknown product.")
    store_erp_id = shift.store.erp_id
    db.commit()  # no read transaction open across the ERP call (SQLite could not write after it)
    try:
        _, row = erp.post("/stock-requests", {
            "warehouse_id": str(store_erp_id), "requested_by": user.full_name, "note": body.note,
            "lines": [{"product_id": str(products[li.product_id].erp_id), "qty": li.qty} for li in body.lines]})
    except ErpRejected as e:
        raise DomainError(409 if e.status_code == 409 else 422, f"The ERP refused the request: {e.message}") from None
    except ErpUnavailable as e:
        raise DomainError(503, f"{e.message} Ask again once the ERP is back.") from None
    req = StockRequest(store_id=shift.store_id, user_id=user.id, note=body.note, erp_transfer_number=row["number"],
                       source=row.get("from", ""),
                       lines=[{"product_id": li.product_id, "sku": products[li.product_id].sku,
                               "name": products[li.product_id].name, "qty": li.qty} for li in body.lines])
    db.add(req)
    db.commit()
    return request_out(req)
