"""How a cart is priced: the customer's group discount, the cashier's own discount, and the
ERP's promotions. The till's screen does the same sums (frontend/src/lib/pricing.ts); this is the
one that counts.

Promotions never stack. Each line gets the single best price among:
  - the cashier's discount if they typed one, otherwise the customer's group discount;
  - every percentage-off and special-price promotion covering the product;
  - the voucher, if the customer gave its code and the cart reaches its minimum spend.
Buy X get Y free splits a line: the free units become a line of their own at 100% off, and the
units paid for get their best price as above.
"""

from dataclasses import dataclass
from datetime import date

from .common import DomainError, line_amount, rupiah


@dataclass(frozen=True)
class Rule:
    """A promotion, as the pricing needs it (the Promotion row, or the till's copy of it)."""

    name: str
    kind: str  # percent | price | buy_get | voucher
    value: int = 0
    buy_qty: int = 0
    get_qty: int = 0
    code: str | None = None
    min_spend: int = 0
    starts_on: date | None = None
    ends_on: date | None = None
    product_id: int | None = None
    category: str | None = None
    store_id: int | None = None

    @classmethod
    def of(cls, p) -> "Rule":
        return cls(p.name, p.kind, p.value, p.buy_qty, p.get_qty, p.code, p.min_spend, p.starts_on, p.ends_on,
                   p.product_id, p.category, p.store_id)

    def runs(self, store_id: int, on: date) -> bool:
        return ((self.store_id is None or self.store_id == store_id)
                and (self.starts_on is None or self.starts_on <= on)
                and (self.ends_on is None or self.ends_on >= on))

    def covers(self, product_id: int, category: str | None) -> bool:
        if self.kind == "voucher":
            return True
        if self.product_id is not None:
            return self.product_id == product_id
        if self.category is not None:
            return self.category == category
        return self.kind == "percent"  # a percentage with neither: everything


@dataclass
class Item:
    product_id: int
    category: str | None
    price: int
    qty: int
    manual_pct: int | None = None  # what the cashier typed; None: the group discount


@dataclass
class Priced:
    product_id: int
    qty: int
    unit_price: int
    discount_pct: int
    promo: str | None
    line_total: int
    manual: bool = False  # priced by the cashier's own discount


def _best(item: Item, qty: int, group_pct: int, rules: list[Rule], voucher: Rule | None) -> Priced:
    if item.manual_pct is not None:
        options = [(item.price, item.manual_pct, None, True)]
    else:
        options = [(item.price, group_pct, None, False)]
    for r in rules:
        if r.kind == "percent":
            options.append((item.price, r.value, r.name, False))
        elif r.kind == "price" and r.value < item.price:
            options.append((r.value, 0, r.name, False))
    if voucher is not None:
        options.append((item.price, voucher.value, voucher.name, False))
    # Cheapest for the customer; on a tie, the earlier option (the cashier's or group's discount).
    price, pct, promo, manual = min(options, key=lambda o: line_amount(qty, o[0], o[1]))
    return Priced(item.product_id, qty, price, pct, promo, line_amount(qty, price, pct), manual)


def _price(items: list[Item], group_pct: int, rules: list[Rule], voucher: Rule | None) -> list[Priced]:
    out: list[Priced] = []
    for item in items:
        covering = [r for r in rules if r.kind != "voucher" and r.covers(item.product_id, item.category)]
        paid = item.qty
        free_rule = next((r for r in covering if r.kind == "buy_get" and r.buy_qty > 0 and r.get_qty > 0), None)
        free = (item.qty // (free_rule.buy_qty + free_rule.get_qty)) * free_rule.get_qty if free_rule else 0
        paid -= free
        if paid:
            out.append(_best(item, paid, group_pct, covering, voucher))
        if free:
            out.append(Priced(item.product_id, free, item.price, 100, free_rule.name, 0))
    return out


def price_cart(items: list[Item], group_pct: int, rules: list[Rule], store_id: int, on: date,
               voucher_code: str | None = None) -> tuple[list[Priced], Rule | None]:
    """The priced lines, and the voucher if one was given (whether or not it beat other prices)."""
    running = [r for r in rules if r.runs(store_id, on)]
    lines = _price(items, group_pct, running, None)
    code = (voucher_code or "").strip().upper()
    if not code:
        return lines, None
    voucher = next((r for r in running if r.kind == "voucher" and (r.code or "").upper() == code), None)
    if voucher is None:
        raise DomainError(422, f"Voucher {code} is not valid here today.")
    spend = sum(li.line_total for li in lines)
    if spend < voucher.min_spend:
        raise DomainError(422, f"Voucher {code} needs a spend of {rupiah(voucher.min_spend)} before tax; "
                               f"this cart is {rupiah(spend)}.")
    return _price(items, group_pct, running, voucher), voucher
