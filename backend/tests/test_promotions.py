"""Promotions from the ERP, and loyalty points earned and spent."""

from datetime import date, timedelta

from pos.services.pricing import Item, Rule, price_cart

from conftest import ok
from test_till import sell

TODAY = date(2026, 10, 3)


def lines(priced):
    return [(p.qty, p.unit_price, p.discount_pct, p.promo) for p in priced]


def test_each_line_gets_its_single_best_price():
    rules = [Rule("Cables 15%", "percent", 15, category="Cables"),
             Rule("Phone deal", "price", 900_000, product_id=1),
             Rule("Old", "percent", 50, ends_on=TODAY - timedelta(days=1)),
             Rule("Elsewhere", "percent", 40, store_id=99)]
    phone, cable = Item(1, "Phones", 1_000_000, 1), Item(2, "Cables", 50_000, 2)
    priced, _ = price_cart([phone, cable], 0, rules, store_id=1, on=TODAY)
    assert lines(priced) == [(1, 900_000, 0, "Phone deal"), (2, 50_000, 15, "Cables 15%")]
    # A reseller's 20% beats both; it is not added on top.
    priced, _ = price_cart([phone, cable], 20, rules, store_id=1, on=TODAY)
    assert lines(priced) == [(1, 1_000_000, 20, None), (2, 50_000, 20, None)]
    # The cashier's own discount stands in for the group's, and still competes.
    priced, _ = price_cart([Item(2, "Cables", 50_000, 1, manual_pct=5)], 20, rules, 1, TODAY)
    assert lines(priced) == [(1, 50_000, 15, "Cables 15%")] and not priced[0].manual


def test_buy_x_get_y_and_vouchers():
    rules = [Rule("3 for 2", "buy_get", buy_qty=2, get_qty=1, product_id=2),
             Rule("Payday", "voucher", 10, code="PAYDAY", min_spend=100_000)]
    priced, _ = price_cart([Item(2, "Cables", 50_000, 7)], 0, rules, 1, TODAY)
    assert lines(priced) == [(5, 50_000, 0, None), (2, 50_000, 100, "3 for 2")]
    priced, voucher = price_cart([Item(2, "Cables", 50_000, 7)], 0, rules, 1, TODAY, " payday ")
    assert voucher.name == "Payday" and lines(priced)[0] == (5, 50_000, 10, "Payday")
    try:
        price_cart([Item(2, "Cables", 50_000, 1)], 0, rules, 1, TODAY, "PAYDAY")
        raise AssertionError("under the minimum spend")
    except Exception as e:
        assert "needs a spend of Rp 100.000" in str(e)
    try:
        price_cart([Item(2, "Cables", 50_000, 1)], 0, rules, 1, TODAY, "NOPE")
        raise AssertionError("unknown code")
    except Exception as e:
        assert "not valid" in str(e)


def test_till_applies_erp_promotions(login, erp):
    cable = erp.products[1]
    erp.promotions = [
        {"id": "11111111-1111-1111-1111-111111111111", "name": "3 for 2 cables", "kind": "buy_get", "value": 0,
         "buy_qty": 2, "get_qty": 1, "code": None, "min_spend": 0, "starts_on": None, "ends_on": None,
         "product_id": cable["id"], "category": None, "warehouse_id": None},
        {"id": "22222222-2222-2222-2222-222222222222", "name": "Payday", "kind": "voucher", "value": 5,
         "buy_qty": 0, "get_qty": 0, "code": "PAYDAY", "min_spend": 500_000, "starts_on": None, "ends_on": None,
         "product_id": None, "category": None, "warehouse_id": None},
    ]
    till = login("cashier")  # logging in syncs, promotions included
    bandung = next(s for s in ok(till.get("/api/stores")) if s["code"] == "BDG-01")
    ok(till.post("/api/shifts", json={"store_id": bandung["id"], "opening_float": 0}), 201)
    catalog = ok(till.get(f"/api/stores/{bandung['id']}/catalog"))
    assert {p["name"] for p in catalog["promotions"]} == {"3 for 2 cables", "Payday"}

    sale = sell(till, [("CB-1", 3), ("PH-1", 1)], [{"method": "card", "amount": 1_159_950}], voucher_code="payday")
    # Cables: 2 paid at 50,000 less 5% voucher = 95,000, 1 free. Phone: 950,000. Total 1,045,000 + 11% tax.
    assert [(li["sku"], li["qty"], li["discount_pct"], li["promo"]) for li in sale["lines"]] == [
        ("CB-1", 2, 5, "Payday"), ("CB-1", 1, 100, "3 for 2 cables"), ("PH-1", 1, 5, "Payday")]
    assert sale["total"] == 1_159_950
    assert sale["voucher_code"] == "PAYDAY"
    sent = erp.orders[sale["external_id"]]["body"]["lines"]
    assert [(li["qty"], li["discount_pct"]) for li in sent] == [(2, 5), (1, 100), (1, 5)]

    # A promotion the ERP drops stops at the next sync.
    erp.promotions = []
    ok(till.post("/api/sync"))
    assert ok(till.get(f"/api/stores/{bandung['id']}/catalog"))["promotions"] == []


def test_loyalty_points_earned_and_spent(till, erp):
    budi = ok(till.get("/api/customers", params={"q": "Budi"}))[0]
    assert budi["points"] == 500
    fresh = ok(till.get(f"/api/customers/{budi['id']}"))
    assert fresh["points"] == 500

    # 1 phone at the reseller's 10%: 999,000. 300 points pay Rp 30,000 of it.
    sale = sell(till, [("PH-1", 1)], [{"method": "points", "amount": 30_000}, {"method": "card", "amount": 969_000}],
                customer_id=budi["id"])
    assert sale["points_redeemed"] == 300
    detail = ok(till.get(f"/api/sales/{sale['id']}"))
    assert detail["erp"]["status"] == "synced" and detail["points_earned"] == 96  # 969,000 / 10,000
    assert ok(till.get(f"/api/customers/{budi['id']}"))["points"] == 500 - 300 + 96

    walk_in = sell(till, [("CB-1", 1)], [{"method": "points", "amount": 55_500}], status=422)
    assert "Pick the customer" in walk_in.json()["detail"]
    odd = sell(till, [("CB-1", 1)], [{"method": "points", "amount": 50}, {"method": "cash", "amount": 55_450}],
               status=422, customer_id=budi["id"])
    assert "steps of Rp 100" in odd.json()["detail"]
    greedy = sell(till, [("PH-1", 1)], [{"method": "points", "amount": 999_000}], status=409, customer_id=budi["id"])
    assert "296 points" in greedy.json()["detail"]
