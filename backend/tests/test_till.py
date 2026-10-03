"""Selling: totals like the ERP's, payments and change, stock, and every sale reaching the ERP once."""

from datetime import timedelta

from sqlalchemy import update

from pos.models import Sale, utcnow

from conftest import ok, product_id


def sell(client, lines: list[tuple], payments: list[dict], status: int = 201, **extra):
    """lines: (sku, qty) or (sku, qty, discount_pct)."""
    body = {"lines": [], "payments": payments, **extra}
    for sku, qty, *discount in lines:
        line = {"product_id": product_id(client, sku), "qty": qty}
        if discount:
            line["discount_pct"] = discount[0]
        body["lines"].append(line)
    response = client.post("/api/sales", json=body)
    return ok(response, status) if status < 400 else response


def available(client, sku: str) -> int:
    store = ok(client.get("/api/auth/me"))["shift"]["store"]["id"]
    return next(p["available"] for p in ok(client.get(f"/api/stores/{store}/catalog"))["products"] if p["sku"] == sku)


def test_cash_sale_with_change_lands_in_the_erp_paid(till, erp):
    sale = sell(till, [("CB-1", 2)], [{"method": "cash", "amount": 150_000}])
    # 2 x 50,000 = 100,000 + 11% tax = 111,000; 150,000 handed over, 39,000 back.
    assert (sale["subtotal"], sale["tax"], sale["total"]) == (100_000, 11_000, 111_000)
    assert sale["cash_tendered"] == 150_000 and sale["change_due"] == 39_000
    assert sale["payments"] == [{"method": "cash", "amount": 111_000, "reference": None}]
    assert sale["number"].startswith("BDG-01/") and sale["number"].endswith("/00001")
    assert sale["customer"]["name"] == "Walk-in Customer"

    pushed = ok(till.get(f"/api/sales/{sale['id']}"))
    assert pushed["erp"]["status"] == "synced" and pushed["erp"]["order_number"] == "SO-2026-00001"
    assert pushed["erp"]["invoice_number"] == "INV-2026-00001"
    sent = erp.orders[sale["external_id"]]["body"]
    assert sent["reference"] == sale["number"] and sent["payments"] == [{"method": "cash", "amount": 111_000,
                                                                          "reference": None}]
    assert sent["lines"][0]["unit_price"] == 50_000 and sent["lines"][0]["discount_pct"] == 0
    assert available(till, "CB-1") == 98


def test_group_discount_and_split_payment(till, erp):
    budi = ok(till.get("/api/customers", params={"q": "Budi"}))[0]
    payments = [{"method": "card", "amount": 500_000, "reference": "APPR-77"}, {"method": "qris", "amount": 499_000}]
    sale = sell(till, [("PH-1", 1)], payments, customer_id=budi["id"])
    # 1,000,000 less the reseller's 10% = 900,000 + 99,000 tax.
    assert sale["discount"] == 100_000 and sale["total"] == 999_000 and sale["change_due"] == 0
    assert sale["lines"][0]["discount_pct"] == 10
    assert ok(till.get(f"/api/sales/{sale['id']}"))["erp"]["status"] == "synced"


def test_payments_must_cover_the_total(till):
    short = sell(till, [("CB-1", 1)], [{"method": "cash", "amount": 50_000}], status=422)
    assert "still to pay" in short.json()["detail"]
    over = sell(till, [("CB-1", 1)], [{"method": "card", "amount": 60_000}], status=422)
    assert "more than the total" in over.json()["detail"]
    pointless = sell(till, [("CB-1", 1)], [{"method": "card", "amount": 55_500}, {"method": "cash", "amount": 10}],
                     status=422)
    assert "remove the cash" in pointless.json()["detail"]
    assert ok(till.get("/api/sales"))["total"] == 0


def test_cashier_discounts_are_capped(till):
    capped = sell(till, [("CB-1", 1, 20)], [{"method": "cash", "amount": 100_000}], status=403)
    assert capped.json()["approval_required"] and "over 10%" in capped.json()["detail"]
    wrong = sell(till, [("CB-1", 1, 20)], [{"method": "cash", "amount": 100_000}], status=403,
                 approval={"username": "manager", "password": "nope"})
    assert "approval_required" not in wrong.json() and "Not approved" in wrong.json()["detail"]
    not_a_boss = sell(till, [("CB-1", 1, 20)], [{"method": "cash", "amount": 100_000}], status=403,
                      approval={"username": "cashier2", "password": "password123"})
    assert "can't approve" in not_a_boss.json()["detail"]
    approved = sell(till, [("CB-1", 1, 20)], [{"method": "cash", "amount": 100_000}],
                    approval={"username": "manager", "password": "password123"})
    assert approved["total"] == 44_400 and approved["approved_by"] == "Dewi Manager"  # 40,000 + 4,400 tax
    sale = sell(till, [("CB-1", 1, 10)], [{"method": "cash", "amount": 100_000}])
    assert sale["total"] == 49_950 and sale["approved_by"] is None  # 45,000 + 4,950 tax


def test_cannot_sell_more_than_the_store_has(till):
    refused = sell(till, [("PH-1", 6)], [{"method": "cash", "amount": 10_000_000}], status=409)
    assert "Only 5 pcs of Phone One" in refused.json()["detail"]
    # Scanning the same item twice counts as one line of 2.
    sale = sell(till, [("PH-1", 2), ("PH-1", 3)], [{"method": "card", "amount": 5_550_000}])
    assert [(li["sku"], li["qty"]) for li in sale["lines"]] == [("PH-1", 5)]


def test_erp_down_sale_waits_and_is_sent_once_later(till, erp):
    erp.down = True
    sale = sell(till, [("PH-1", 2)], [{"method": "card", "amount": 2_220_000}])
    waiting = ok(till.get(f"/api/sales/{sale['id']}"))["erp"]
    assert waiting["status"] == "pending" and "Can't reach the ERP" in waiting["error"] and waiting["attempts"] == 1
    assert available(till, "PH-1") == 3  # off the shelf even though the ERP doesn't know yet
    assert ok(till.get("/api/sales/summary"))["erp"] == {"pending": 1, "failed": 0}

    erp.down = False
    assert ok(till.post("/api/sales/push-pending")) == {"synced": 1, "pending": 0, "failed": 0, "returns": 0}
    assert ok(till.get(f"/api/sales/{sale['id']}"))["erp"]["status"] == "synced"
    assert available(till, "PH-1") == 3  # counted once, not twice
    assert erp.stock[(erp.warehouses[1]["id"], erp.products[0]["id"])] == 3


def test_a_refused_sale_goes_through_once_fixed_in_the_erp(till, erp, db_factory):
    phone_in_erp = (erp.warehouses[1]["id"], erp.products[0]["id"])
    erp.stock[phone_in_erp] = 0  # someone moved the phones out in the ERP since the last sync
    sale = sell(till, [("PH-1", 1)], [{"method": "cash", "amount": 1_110_000}])
    failed = ok(till.get(f"/api/sales/{sale['id']}"))["erp"]
    assert failed["status"] == "failed" and "Not enough Phone One" in failed["error"]
    # Not retried at once: the same request would only be refused again.
    assert ok(till.post("/api/sales/push-pending")) == {"synced": 0, "pending": 0, "failed": 0, "returns": 0}

    erp.stock[phone_in_erp] = 4  # stock booked in, in the ERP
    with db_factory() as db:  # ten minutes pass
        db.execute(update(Sale).values(erp_last_attempt_at=utcnow() - timedelta(minutes=11)))
        db.commit()
    assert ok(till.post("/api/sales/push-pending")) == {"synced": 1, "pending": 0, "failed": 0, "returns": 0}
    # Sending again by hand (a double click, a lost response) never makes a second ERP order.
    assert ok(till.post(f"/api/sales/{sale['id']}/push"))["erp"]["status"] == "synced"
    assert len(erp.orders) == 1 and erp.stock[phone_in_erp] == 3


def test_a_sale_being_sent_is_not_sent_again_meanwhile(till, login, erp):
    """The push after checkout and a till's retry loop overlap. The second one must step aside
    (not wait on a database lock held across the ERP call, not send a second request)."""
    seen = {}
    other_tab = login("cashier")
    erp.while_importing = lambda: seen.update(
        retry=other_tab.post("/api/sales/push-pending").json(),
        push=other_tab.post("/api/sales/1/push").json()["erp"])
    sale = sell(till, [("CB-1", 1)], [{"method": "qris", "amount": 55_500}])
    assert seen["retry"] == {"synced": 0, "pending": 0, "failed": 0, "returns": 0}
    assert seen["push"]["attempts"] == 1 and seen["push"]["status"] == "pending"  # in flight, left alone
    assert erp.calls.count("POST /sales-orders") == 1
    done = ok(till.get(f"/api/sales/{sale['id']}"))["erp"]
    assert done["status"] == "synced" and done["attempts"] == 1


def test_new_customer_is_created_in_the_erp_first(till, erp):
    created = ok(till.post("/api/customers", json={"name": "Siti Rahma", "phone": "0812 3456"}), 201)
    assert created["code"] == f"C-{len(erp.customers):04d}" and created["discount_pct"] == 0
    assert erp.customers[-1]["name"] == "Siti Rahma"
    erp.down = True
    offline = till.post("/api/customers", json={"name": "Nobody"})
    assert offline.status_code == 503 and "walk-in" in offline.json()["detail"]


def test_selling_needs_an_open_shift(login):
    cashier = login()
    refused = cashier.post("/api/sales", json={"lines": [{"product_id": 1, "qty": 1}],
                                               "payments": [{"method": "cash", "amount": 1}]})
    assert refused.status_code == 409 and "Open a shift" in refused.json()["detail"]


def test_shift_cash_count(till):
    shift = ok(till.get("/api/shifts/current"))
    sell(till, [("CB-1", 2)], [{"method": "cash", "amount": 200_000}])  # 111,000 kept
    sell(till, [("CB-1", 1)], [{"method": "qris", "amount": 55_500}])
    ok(till.post(f"/api/shifts/{shift['id']}/cash", json={"kind": "out", "amount": 20_000, "reason": "Ice"}), 201)
    ok(till.post(f"/api/shifts/{shift['id']}/cash", json={"kind": "in", "amount": 100_000, "reason": "Change"}), 201)
    summary = ok(till.get(f"/api/shifts/{shift['id']}"))["summary"]
    assert summary["by_method"] == {"cash": 111_000, "card": 0, "qris": 55_500, "points": 0}
    assert summary["expected_cash"] == 500_000 + 111_000 - 20_000 + 100_000

    short = till.post(f"/api/shifts/{shift['id']}/close", json={"counted_cash": 690_000})
    assert short.status_code == 422 and "1.000 short" in short.json()["detail"]
    closed = ok(till.post(f"/api/shifts/{shift['id']}/close", json={"counted_cash": 690_000, "note": "Coin lost"}))
    assert closed["status"] == "closed" and closed["variance"] == -1_000
    assert ok(till.get("/api/shifts/current")) is None
    assert till.post("/api/sales", json={"lines": [{"product_id": 1, "qty": 1}],
                                         "payments": [{"method": "cash", "amount": 1}]}).status_code == 409


def test_cashiers_see_only_their_own_sales_and_shifts(till, login):
    sale = sell(till, [("CB-1", 1)], [{"method": "cash", "amount": 55_500}])
    assert ok(till.get("/api/sales", params={"q": "walk-in"}))["total"] == 1
    summary = ok(till.get("/api/sales/summary"))
    assert summary["sales_count"] == 1 and summary["total"] == 55_500 and summary["top_products"][0]["qty"] == 1
    other = login("cashier2")
    assert ok(other.get("/api/sales"))["total"] == 0
    assert other.get(f"/api/sales/{sale['id']}").status_code == 404
    assert other.post(f"/api/sales/{sale['id']}/push").status_code == 404
    assert ok(other.get("/api/sales/summary"))["sales_count"] == 0
    assert ok(other.get("/api/shifts")) == []
    assert other.get(f"/api/shifts/{sale['shift']['id']}").status_code == 404
