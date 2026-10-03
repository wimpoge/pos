"""Errors, numbering, money and settings shared by every service."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..models import NumberSequence, Setting, utcnow


class DomainError(Exception):
    """A business rule said no. The API turns it into an HTTP error with this message."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class ApprovalRequired(DomainError):
    """Allowed, but only with a supervisor's approval. The till asks for one and sends it again."""

    def __init__(self, message: str):
        super().__init__(403, message)


def get_or_404(db: Session, model, id_: int, what: str):
    obj = db.get(model, id_)
    if obj is None:
        raise DomainError(404, f"{what} not found.")
    return obj


def next_number(db: Session, key: str) -> int:
    """Gapless counter per key. The row lock serialises concurrent tills on Postgres."""
    seq = db.get(NumberSequence, key, with_for_update=True)
    if seq is None:
        seq = NumberSequence(key=key, next_value=1)
        db.add(seq)
        db.flush()
    value = seq.next_value
    seq.next_value += 1
    return value


def local_date(tz: str, at: datetime | None = None) -> date:
    """The shop's calendar date for a naive-UTC moment (now by default)."""
    moment = (at or utcnow()).replace(tzinfo=ZoneInfo("UTC"))
    return moment.astimezone(ZoneInfo(tz)).date()


# ---------------------------------------------------------------- money (whole rupiah)
# Exactly the ERP's arithmetic, so the till charges what the ERP invoices.


def _div_round(numerator: int, denominator: int) -> int:
    """Integer division rounding half up, for non-negative amounts."""
    return (numerator * 2 + denominator) // (denominator * 2)


def rupiah(amount: int) -> str:
    return f"Rp {amount:,}".replace(",", ".")


def line_amount(qty: int, unit_price: int, discount_pct: int = 0) -> int:
    return _div_round(qty * unit_price * (100 - discount_pct), 100)


def tax_amount(subtotal: int, rate_pct: int) -> int:
    return _div_round(subtotal * rate_pct, 100)


# ---------------------------------------------------------------- settings

DEFAULT_SETTINGS = {
    # Copied from the ERP by the sync.
    "erp.company_name": "",
    "erp.company_address": "",
    "erp.company_phone": "",
    "erp.company_tax_id": "",
    "erp.tax_rate": 11,
    "erp.currency": "IDR",
    "erp.features": [],
    "erp.loyalty_earn_per": 0,  # rupiah spent per point; 0: no points
    "erp.loyalty_point_value": 0,  # rupiah a point pays for
    # Found or created in the ERP by the sync.
    "walk_in_customer_id": None,  # the customer a sale goes to when the cashier picks nobody
}


def get_setting(db: Session, key: str):
    row = db.get(Setting, key)
    return row.value if row is not None else DEFAULT_SETTINGS.get(key)


def all_settings(db: Session) -> dict:
    stored = {s.key: s.value for s in db.query(Setting).all() if not s.key.startswith("_")}
    return {**DEFAULT_SETTINGS, **stored}


def set_setting(db: Session, key: str, value) -> None:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value
