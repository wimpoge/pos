"""Pull master data from the ERP into the POS mirror tables.

Every list is mirrored the same way: shape the ERP row, match it to a POS row on the ERP's
public UUID, then insert or update. Rows the ERP no longer lists are deactivated, never
deleted, because sales point at them. Two safety rules:
- an ERP answer with 0 rows never empties a table (a broken filter must not wipe the till);
- one failing step is recorded and the others still run.
"""

import uuid
from collections.abc import Callable
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..erp_client import ErpClient, ErpError
from ..models import (
    Customer,
    Product,
    Promotion,
    Sale,
    SaleLine,
    SaleReturn,
    SaleReturnLine,
    StockLevel,
    Store,
    SyncRun,
    User,
    utcnow,
)
from .common import DomainError, get_setting, set_setting

WALK_IN_NAME = "Walk-in Customer"


def _mirror(db: Session, model, rows: list[dict], shape: Callable[[dict], dict], deactivate_missing: bool = True,
            empty_is_real: bool = False) -> dict:
    stats = {"added": 0, "updated": 0, "deactivated": 0, "unchanged": 0}
    if not rows and not empty_is_real:
        stats["skipped"] = "The ERP returned no rows; kept what the POS had."
        return stats
    existing = {r.erp_id: r for r in db.scalars(select(model))}
    seen = set()
    now = utcnow()
    for row in rows:
        values = shape(row)
        erp_id = uuid.UUID(str(row["id"]))
        seen.add(erp_id)
        obj = existing.get(erp_id)
        if obj is None:
            db.add(model(erp_id=erp_id, synced_at=now, **values))
            stats["added"] += 1
            continue
        changed = {k: v for k, v in values.items() if getattr(obj, k) != v}
        for k, v in changed.items():
            setattr(obj, k, v)
        obj.synced_at = now
        stats["updated" if changed else "unchanged"] += 1
    if deactivate_missing:
        for erp_id, obj in existing.items():
            if erp_id not in seen and obj.active:
                obj.active = False
                stats["deactivated"] += 1
    db.flush()
    return stats


def _store(row: dict) -> dict:
    return {"code": row["code"], "name": row["name"], "city": row.get("city"), "active": True}


def _product(row: dict) -> dict:
    return {"sku": row["sku"], "name": row["name"], "barcode": row.get("barcode"), "unit": row.get("unit") or "pcs",
            "price": row["price"], "category": row.get("category"), "brand": row.get("brand"),
            "active": row.get("active", True)}


def _customer(row: dict) -> dict:
    return {"code": row["code"], "name": row["name"], "phone": row.get("phone"), "email": row.get("email"),
            "group_name": row.get("group"), "discount_pct": row.get("discount_pct") or 0,
            "points": row.get("points") or 0, "active": True}


def upsert_customer(db: Session, row: dict) -> Customer:
    """One customer the ERP just answered with (e.g. after creating it), into the mirror."""
    erp_id = uuid.UUID(str(row["id"]))
    customer = db.scalar(select(Customer).filter_by(erp_id=erp_id))
    if customer is None:
        customer = Customer(erp_id=erp_id, **_customer(row))
        db.add(customer)
    else:
        for k, v in _customer(row).items():
            setattr(customer, k, v)
    customer.synced_at = utcnow()
    db.flush()
    return customer


def _sync_settings(db: Session, erp: ErpClient) -> dict:
    remote = erp.get("/settings")
    changed = 0
    loyalty = remote.get("loyalty") or {}
    values = {**remote, "loyalty_earn_per": loyalty.get("earn_per", 0), "loyalty_point_value": loyalty.get("point_value", 0)}
    for key in ("company_name", "company_address", "company_phone", "company_tax_id", "tax_rate", "currency",
                "features", "loyalty_earn_per", "loyalty_point_value"):
        if key in values and get_setting(db, f"erp.{key}") != values[key]:
            set_setting(db, f"erp.{key}", values[key])
            changed += 1
    return {"updated": changed}


def _sync_promotions(db: Session, erp: ErpClient) -> dict:
    """Promotions running or coming. Unlike other lists an empty answer is real (none running), so
    it does switch the till's copies off."""
    products = dict(db.execute(select(Product.erp_id, Product.id)).all())
    stores = dict(db.execute(select(Store.erp_id, Store.id)).all())

    def shape(row: dict) -> dict:
        def uid(value):
            return uuid.UUID(str(value)) if value else None
        return {"name": row["name"], "kind": row["kind"], "value": row.get("value") or 0,
                "buy_qty": row.get("buy_qty") or 0, "get_qty": row.get("get_qty") or 0, "code": row.get("code"),
                "min_spend": row.get("min_spend") or 0,
                "starts_on": date.fromisoformat(row["starts_on"]) if row.get("starts_on") else None,
                "ends_on": date.fromisoformat(row["ends_on"]) if row.get("ends_on") else None,
                "product_id": products.get(uid(row.get("product_id"))), "category": row.get("category"),
                "store_id": stores.get(uid(row.get("warehouse_id"))), "active": True}

    return _mirror(db, Promotion, erp.list_all("/promotions"), shape, empty_is_real=True)


def erp_can_take_sales(db: Session) -> bool:
    """An older ERP would accept a till sale's payments field and ignore it, leaving an unshipped,
    unpaid order. Selling waits until the sync has seen the ERP say it understands paid sales."""
    return "paid_sales" in (get_setting(db, "erp.features") or [])


NO_PAID_SALES = ("The ERP does not support paid till sales yet (integration feature 'paid_sales'). "
                 "Deploy the updated ERP, then sync again.")


def sync_store_stock(db: Session, erp: ErpClient, store: Store) -> dict:
    """The ERP's on-hand for one store. A product the ERP lists no stock for has none."""
    rows = erp.list_all(f"/warehouses/{store.erp_id}/stock")
    stats = {"updated": 0, "unchanged": 0, "zeroed": 0, "unknown_products": 0}
    if not rows:
        stats["skipped"] = "The ERP returned no stock rows; kept what the POS had."
        return stats
    products = dict(db.execute(select(Product.erp_id, Product.id)).all())
    levels = {lv.product_id: lv for lv in db.scalars(select(StockLevel).filter_by(store_id=store.id))}
    seen = set()
    for row in rows:
        product_id = products.get(uuid.UUID(str(row["product_id"])))
        if product_id is None:  # a product newer than the last product sync
            stats["unknown_products"] += 1
            continue
        seen.add(product_id)
        level = levels.get(product_id)
        if level is None:
            db.add(StockLevel(store_id=store.id, product_id=product_id, on_hand=row["on_hand"]))
            stats["updated"] += 1
        elif level.on_hand != row["on_hand"]:
            level.on_hand = row["on_hand"]
            stats["updated"] += 1
        else:
            stats["unchanged"] += 1
    for product_id, level in levels.items():
        if product_id not in seen and level.on_hand != 0:
            level.on_hand = 0
            stats["zeroed"] += 1
    db.flush()
    return stats


def ensure_walk_in_customer(db: Session, erp: ErpClient) -> dict:
    """Sales without a named customer go to one ERP customer. Find it, or create it in the ERP once."""
    current = get_setting(db, "walk_in_customer_id")
    customer = db.get(Customer, current) if current else None
    if customer is not None and customer.active:
        return {"customer": customer.code}
    customer = db.scalar(select(Customer).where(func.lower(Customer.name) == WALK_IN_NAME.lower(), Customer.active)
                         .order_by(Customer.id).limit(1))
    created = False
    if customer is None:
        _, row = erp.post("/customers", {"name": WALK_IN_NAME})
        customer = upsert_customer(db, row)
        created = True
    set_setting(db, "walk_in_customer_id", customer.id)
    return {"customer": customer.code, "created_in_erp": created}


def run_sync(db: Session, erp: ErpClient, trigger: str, user: User | None = None, store: Store | None = None) -> SyncRun:
    """Everything (store=None), or only one store's stock. Commits as it goes; returns the run."""
    run = SyncRun(trigger=trigger, scope=f"stock:{store.code}" if store else "all", user_id=user.id if user else None,
                  stats={}, errors=[])
    db.add(run)
    db.commit()

    stats: dict = {}
    errors: list[str] = []

    def step(name: str, fn: Callable[[], dict]) -> bool:
        try:
            stats[name] = fn()
            db.commit()
            return True
        except (ErpError, DomainError) as e:
            db.rollback()
            errors.append(f"{name}: {e.message}")
            return False

    if store is not None:
        step(f"stock {store.code}", lambda: sync_store_stock(db, erp, store))
    else:
        if step("settings", lambda: _sync_settings(db, erp)):
            if not erp_can_take_sales(db):
                errors.append(f"settings: {NO_PAID_SALES}")
            step("stores", lambda: _mirror(db, Store, erp.list_all("/warehouses"), _store))
            step("products", lambda: _mirror(db, Product, erp.list_all("/products"), _product))
            step("customers", lambda: _mirror(db, Customer, erp.list_all("/customers"), _customer))
            if "promotions" in (get_setting(db, "erp.features") or []):
                step("promotions", lambda: _sync_promotions(db, erp))
            for s in db.scalars(select(Store).where(Store.active).order_by(Store.id)).all():
                step(f"stock {s.code}", lambda s=s: sync_store_stock(db, erp, s))
            step("walk-in customer", lambda: ensure_walk_in_customer(db, erp))

    run = db.get(SyncRun, run.id)
    run.stats = stats
    run.errors = errors
    run.status = "ok" if not errors else ("partial" if stats else "failed")
    run.finished_at = utcnow()
    db.commit()
    return run


def unsynced_qty(db: Session, store_id: int) -> dict[int, int]:
    """Units sold here that the ERP does not know about yet (still on its books, gone from the
    shelf), less units that came back that it does not know about yet (back on the shelf)."""
    sold = db.execute(
        select(SaleLine.product_id, func.sum(SaleLine.qty))
        .join(Sale, Sale.id == SaleLine.sale_id)
        .where(Sale.store_id == store_id, Sale.erp_status.in_(("pending", "failed")))
        .group_by(SaleLine.product_id)
    ).all()
    returned = db.execute(
        select(SaleReturnLine.product_id, func.sum(SaleReturnLine.qty))
        .join(SaleReturn, SaleReturn.id == SaleReturnLine.return_id)
        .where(SaleReturn.store_id == store_id, SaleReturn.erp_status.in_(("pending", "failed")))
        .group_by(SaleReturnLine.product_id)
    ).all()
    net = {pid: int(q) for pid, q in sold}
    for pid, q in returned:
        net[pid] = net.get(pid, 0) - int(q)
    return net


def refresh(db: Session, erp: ErpClient, stale_minutes: int, trigger: str, user: User | None = None,
            store: Store | None = None) -> SyncRun | None:
    """What a till asks for: everything when the mirror is stale (or was never filled), otherwise
    just its store's stock. Never two runs at once; None when there was nothing to do."""
    now = utcnow()
    running = db.scalar(select(SyncRun).where(SyncRun.status == "running", SyncRun.started_at > now - timedelta(minutes=2))
                        .order_by(SyncRun.id.desc()).limit(1))
    if running is not None:
        return running
    last_full = db.scalar(select(SyncRun.finished_at)
                          .where(SyncRun.scope == "all", SyncRun.status.in_(("ok", "partial")))
                          .order_by(SyncRun.id.desc()).limit(1))
    if last_full is None or last_full < now - timedelta(minutes=stale_minutes):
        return run_sync(db, erp, trigger, user)
    if store is not None:
        return run_sync(db, erp, trigger, user, store=store)
    return None
