"""POS tables.

Master data (stores, products, stock, customers, promotions) is a mirror of the ERP: the POS
numbers its own rows and links each one to its ERP record by the ERP's public UUID (`erp_id`).
Sales, returns, shifts and cash movements are made here; sales and returns are pushed to the ERP.
"""

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import JSON, CheckConstraint, ForeignKey, MetaData, String, UniqueConstraint, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    # Naive UTC everywhere: SQLite drops tz info, so aware and naive values never mix.
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    # Stable constraint names, so Alembic migrations behave the same on SQLite and Postgres.
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


# ---------------------------------------------------------------- people and settings


class User(Base):
    """A cashier, or a supervisor who approved something at a till. The account lives in the ERP;
    this row keeps a hash of the last password the ERP accepted, so a cashier can still log in
    (and a supervisor still approve) while the ERP is down. Supervisors never log in here."""

    __tablename__ = "user_account"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(40), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="cashier")  # cashier | supervisor
    active: Mapped[bool] = mapped_column(default=True)
    failed_logins: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None]
    last_login_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuthSession(Base):
    """Server-side login session. Only a hash of the cookie value is stored."""

    __tablename__ = "auth_session"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped[User] = relationship()


class Setting(Base):
    """POS settings, plus what the sync copies from the ERP (tax rate, receipt header) under `erp.*`."""

    __tablename__ = "setting"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)


class NumberSequence(Base):
    __tablename__ = "number_sequence"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    next_value: Mapped[int] = mapped_column(default=1)


# ---------------------------------------------------------------- mirrored from the ERP


class Store(Base):
    """A shop. In the ERP it is a warehouse: stock is kept and sold from it."""

    __tablename__ = "store"

    id: Mapped[int] = mapped_column(primary_key=True)
    erp_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(80))
    active: Mapped[bool] = mapped_column(default=True)
    synced_at: Mapped[datetime] = mapped_column(default=utcnow)


class Product(Base):
    __tablename__ = "product"

    id: Mapped[int] = mapped_column(primary_key=True)
    erp_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    sku: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(160))
    barcode: Mapped[str | None] = mapped_column(String(20), index=True)
    unit: Mapped[str] = mapped_column(String(10), default="pcs")
    price: Mapped[int]  # rupiah, excluding tax, as in the ERP
    category: Mapped[str | None] = mapped_column(String(80))
    brand: Mapped[str | None] = mapped_column(String(60))
    active: Mapped[bool] = mapped_column(default=True)
    synced_at: Mapped[datetime] = mapped_column(default=utcnow)


class StockLevel(Base):
    """On hand in a store according to the ERP at the last sync (or the last sale pushed since)."""

    __tablename__ = "stock_level"
    __table_args__ = (UniqueConstraint("store_id", "product_id", name="store_product"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("store.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("product.id"))
    on_hand: Mapped[int] = mapped_column(default=0)


class Customer(Base):
    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(primary_key=True)
    erp_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(160), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(120))
    group_name: Mapped[str | None] = mapped_column(String(80))
    discount_pct: Mapped[int] = mapped_column(default=0)  # the ERP group discount
    points: Mapped[int] = mapped_column(default=0, server_default="0")  # loyalty, as the ERP last said
    active: Mapped[bool] = mapped_column(default=True)
    synced_at: Mapped[datetime] = mapped_column(default=utcnow)


class Promotion(Base):
    """An ERP promotion the till applies. See services/pricing.py for how they combine."""

    __tablename__ = "promotion"

    id: Mapped[int] = mapped_column(primary_key=True)
    erp_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(10))  # percent | price | buy_get | voucher
    value: Mapped[int] = mapped_column(default=0)  # % for percent and voucher, rupiah for price
    buy_qty: Mapped[int] = mapped_column(default=0)
    get_qty: Mapped[int] = mapped_column(default=0)
    code: Mapped[str | None] = mapped_column(String(30))
    min_spend: Mapped[int] = mapped_column(default=0)
    starts_on: Mapped[date | None]
    ends_on: Mapped[date | None]
    product_id: Mapped[int | None] = mapped_column(ForeignKey("product.id"))
    category: Mapped[str | None] = mapped_column(String(80))
    store_id: Mapped[int | None] = mapped_column(ForeignKey("store.id"))  # None: every store
    active: Mapped[bool] = mapped_column(default=True)
    synced_at: Mapped[datetime] = mapped_column(default=utcnow)


class SyncRun(Base):
    """One pull of master data from the ERP: what changed, and what went wrong."""

    __tablename__ = "sync_run"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    finished_at: Mapped[datetime | None]
    trigger: Mapped[str] = mapped_column(String(10))  # manual | stock | cron | cli
    scope: Mapped[str] = mapped_column(String(20), default="all")  # all | stock:<store code>
    status: Mapped[str] = mapped_column(String(10), default="running")  # running | ok | partial | failed
    # {"products": {"added": 3, "updated": 1, "deactivated": 0, "unchanged": 120}, ...}
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    errors: Mapped[list] = mapped_column(JSON, default=list)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("user_account.id"))

    user: Mapped[User | None] = relationship()


# ---------------------------------------------------------------- made at the till


class Shift(Base):
    """A cashier's session at a store, from counting the opening float to counting the drawer."""

    __tablename__ = "shift"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(40), unique=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("store.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="open", index=True)  # open | closed
    opened_at: Mapped[datetime] = mapped_column(default=utcnow)
    opening_float: Mapped[int] = mapped_column(default=0)
    closed_at: Mapped[datetime | None]
    closed_by_id: Mapped[int | None] = mapped_column(ForeignKey("user_account.id"))
    expected_cash: Mapped[int | None]
    counted_cash: Mapped[int | None]
    closing_note: Mapped[str | None] = mapped_column(String(500))
    # Ended by the clock (the shop's closing time), not by the cashier: the drawer may still need counting.
    auto_closed: Mapped[bool] = mapped_column(default=False, server_default="0")

    store: Mapped[Store] = relationship()
    user: Mapped[User] = relationship(foreign_keys=[user_id])
    closed_by: Mapped[User | None] = relationship(foreign_keys=[closed_by_id])
    movements: Mapped[list["CashMovement"]] = relationship(order_by="CashMovement.id", back_populates="shift")


class CashMovement(Base):
    """Cash put into or taken out of the drawer for something other than a sale."""

    __tablename__ = "cash_movement"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shift.id"), index=True)
    kind: Mapped[str] = mapped_column(String(3))  # in | out
    amount: Mapped[int]
    reason: Mapped[str] = mapped_column(String(200))
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    approved_by: Mapped[str | None] = mapped_column(String(120))  # the supervisor, for a large cash-out
    at: Mapped[datetime] = mapped_column(default=utcnow)

    shift: Mapped[Shift] = relationship(back_populates="movements")
    user: Mapped[User] = relationship()


class Sale(Base):
    __tablename__ = "sale"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Sent to the ERP as external_id: a retried push can never create a second order there.
    public_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, default=uuid.uuid4)
    number: Mapped[str] = mapped_column(String(40), unique=True)  # on the receipt: BDG-01/2026/00042
    shift_id: Mapped[int] = mapped_column(ForeignKey("shift.id"), index=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("store.id"), index=True)
    cashier_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"))
    business_date: Mapped[date] = mapped_column(index=True)  # the shop's local date
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    tax_rate: Mapped[int]
    gross: Mapped[int]  # before line discounts
    subtotal: Mapped[int]  # after discounts, before tax
    tax: Mapped[int]
    total: Mapped[int]
    cash_tendered: Mapped[int] = mapped_column(default=0)
    change_due: Mapped[int] = mapped_column(default=0)
    note: Mapped[str | None] = mapped_column(String(200))
    voucher_code: Mapped[str | None] = mapped_column(String(30))
    points_earned: Mapped[int] = mapped_column(default=0, server_default="0")
    points_redeemed: Mapped[int] = mapped_column(default=0, server_default="0")
    approved_by: Mapped[str | None] = mapped_column(String(120))  # the supervisor, for a discount over the cap
    # Rung up while the till could not reach the POS server, and sent once it could.
    offline: Mapped[bool] = mapped_column(default=False, server_default="0")
    voided_at: Mapped[datetime | None]

    # pending (not in the ERP yet, will retry) | synced | failed (the ERP refused; needs a person)
    # | voided (cancelled before it reached the ERP: never sent)
    erp_status: Mapped[str] = mapped_column(String(10), default="pending", index=True)
    erp_order_number: Mapped[str | None] = mapped_column(String(30))
    erp_invoice_number: Mapped[str | None] = mapped_column(String(30))
    erp_attempts: Mapped[int] = mapped_column(default=0)
    erp_error: Mapped[str | None] = mapped_column(String(500))
    erp_last_attempt_at: Mapped[datetime | None]
    erp_sending_until: Mapped[datetime | None]  # a push is in flight until then; others keep off
    erp_synced_at: Mapped[datetime | None]

    shift: Mapped[Shift] = relationship()
    store: Mapped[Store] = relationship()
    cashier: Mapped[User] = relationship()
    customer: Mapped[Customer] = relationship()
    lines: Mapped[list["SaleLine"]] = relationship(order_by="SaleLine.id", cascade="all, delete-orphan")
    payments: Mapped[list["SalePayment"]] = relationship(order_by="SalePayment.id", cascade="all, delete-orphan")
    returns: Mapped[list["SaleReturn"]] = relationship(order_by="SaleReturn.id", back_populates="sale")


class SaleLine(Base):
    __tablename__ = "sale_line"
    __table_args__ = (
        CheckConstraint("qty > 0", name="qty_positive"),
        CheckConstraint("discount_pct >= 0 AND discount_pct <= 100", name="discount_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sale.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("product.id"))
    # Copied at the time of sale, so the receipt never changes when the catalogue does.
    sku: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(160))
    qty: Mapped[int]
    unit_price: Mapped[int]
    discount_pct: Mapped[int] = mapped_column(default=0)
    line_total: Mapped[int]  # after discount, before tax
    promo: Mapped[str | None] = mapped_column(String(80))  # the promotion that priced it

    product: Mapped[Product] = relationship()


class SalePayment(Base):
    __tablename__ = "sale_payment"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sale.id", ondelete="CASCADE"), index=True)
    method: Mapped[str] = mapped_column(String(10))  # cash | card | qris | points
    amount: Mapped[int]  # applied to the sale; for cash, what was kept after change; points at their rupiah value
    reference: Mapped[str | None] = mapped_column(String(60))  # card approval code, QRIS reference


class SaleReturn(Base):
    """Goods brought back, or a whole sale voided, with the money handed back from this shift's
    drawer (or card, QRIS, points). Pushed to the ERP like a sale, once the sale is there."""

    __tablename__ = "sale_return"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, default=uuid.uuid4)
    number: Mapped[str] = mapped_column(String(40), unique=True)  # BDG-01/R/2026/00003
    kind: Mapped[str] = mapped_column(String(6), default="return")  # return | void
    sale_id: Mapped[int] = mapped_column(ForeignKey("sale.id"), index=True)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shift.id"), index=True)  # the drawer refunded from
    store_id: Mapped[int] = mapped_column(ForeignKey("store.id"), index=True)
    cashier_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    approved_by: Mapped[str] = mapped_column(String(120))
    reason: Mapped[str] = mapped_column(String(200))
    business_date: Mapped[date] = mapped_column(index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    subtotal: Mapped[int]
    tax: Mapped[int]
    total: Mapped[int]

    # pending | synced | failed, as for sales; skipped: the sale never reached the ERP (voided), nor does this
    erp_status: Mapped[str] = mapped_column(String(10), default="pending", index=True)
    erp_return_number: Mapped[str | None] = mapped_column(String(30))
    erp_attempts: Mapped[int] = mapped_column(default=0)
    erp_error: Mapped[str | None] = mapped_column(String(500))
    erp_last_attempt_at: Mapped[datetime | None]
    erp_sending_until: Mapped[datetime | None]
    erp_synced_at: Mapped[datetime | None]

    sale: Mapped[Sale] = relationship(back_populates="returns")
    shift: Mapped[Shift] = relationship()
    store: Mapped[Store] = relationship()
    cashier: Mapped[User] = relationship()
    lines: Mapped[list["SaleReturnLine"]] = relationship(order_by="SaleReturnLine.id", cascade="all, delete-orphan")
    refunds: Mapped[list["ReturnRefund"]] = relationship(order_by="ReturnRefund.id", cascade="all, delete-orphan")


class SaleReturnLine(Base):
    __tablename__ = "sale_return_line"
    __table_args__ = (CheckConstraint("qty > 0", name="qty_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("sale_return.id", ondelete="CASCADE"), index=True)
    sale_line_id: Mapped[int] = mapped_column(ForeignKey("sale_line.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("product.id"))
    sku: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(160))
    qty: Mapped[int]
    unit_price: Mapped[int]
    discount_pct: Mapped[int] = mapped_column(default=0)
    line_total: Mapped[int]

    product: Mapped[Product] = relationship()


class ReturnRefund(Base):
    __tablename__ = "return_refund"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("sale_return.id", ondelete="CASCADE"), index=True)
    method: Mapped[str] = mapped_column(String(10))  # cash | card | qris | points
    amount: Mapped[int]
    reference: Mapped[str | None] = mapped_column(String(60))


# ---------------------------------------------------------------- the till's helpers


class HeldCart(Base):
    """A cart put aside to serve the next customer, resumed later by any cashier of the store."""

    __tablename__ = "held_cart"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("store.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"))
    # [{"product_id": 3, "qty": 2, "discount_pct": null}]
    lines: Mapped[list] = mapped_column(JSON, default=list)
    voucher_code: Mapped[str | None] = mapped_column(String(30))
    note: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped[User] = relationship()
    customer: Mapped[Customer | None] = relationship()


class StockRequest(Base):
    """Goods a store asked the ERP for; there it is a draft transfer for the warehouse team."""

    __tablename__ = "stock_request"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("store.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    # [{"product_id": 3, "sku": "CB-1", "name": "USB-C Cable", "qty": 20}]
    lines: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str | None] = mapped_column(String(200))
    erp_transfer_number: Mapped[str] = mapped_column(String(30))
    source: Mapped[str] = mapped_column(String(120))  # the warehouse sending the goods
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped[User] = relationship()
