"""Around the sale: held carts, big cash-outs, the day report, emailed receipts, stock requests,
and sales the till made while it was offline."""

import smtplib
import uuid
from datetime import UTC, datetime

from conftest import ok, product_id
from test_till import available, sell

BOSS = {"username": "manager", "password": "password123"}


def test_hold_and_resume_a_cart(till, login):
    cable = product_id(till, "CB-1")
    held = ok(till.post("/api/held-carts", json={"lines": [{"product_id": cable, "qty": 2, "discount_pct": None}],
                                                  "note": "Blue jacket, back in 5"}), 201)
    assert held["items"] == 2 and held["user"] == "Putri Ayu"
    # Another cashier of the store sees it and picks it up.
    other = login("cashier2")
    bandung = next(s for s in ok(other.get("/api/stores")) if s["code"] == "BDG-01")
    ok(other.post("/api/shifts", json={"store_id": bandung["id"], "opening_float": 0}), 201)
    assert [h["note"] for h in ok(other.get("/api/held-carts"))] == ["Blue jacket, back in 5"]
    resumed = ok(other.post(f"/api/held-carts/{held['id']}/resume"))
    assert resumed["lines"] == [{"product_id": cable, "qty": 2, "discount_pct": None}]
    assert ok(till.get("/api/held-carts")) == []
    gone = ok(till.post("/api/held-carts", json={"lines": [{"product_id": cable, "qty": 1}]}), 201)
    assert till.delete(f"/api/held-carts/{gone['id']}").status_code == 204


def test_large_cash_out_needs_a_supervisor(till):
    shift = ok(till.get("/api/shifts/current"))
    sell(till, [("PH-1", 2)], [{"method": "cash", "amount": 2_220_000}])
    small = ok(till.post(f"/api/shifts/{shift['id']}/cash", json={"kind": "out", "amount": 50_000, "reason": "Ice"}), 201)
    assert small["movements"][0]["approved_by"] is None
    big = till.post(f"/api/shifts/{shift['id']}/cash", json={"kind": "out", "amount": 1_500_000, "reason": "Bank"})
    assert big.status_code == 403 and big.json()["approval_required"]
    done = ok(till.post(f"/api/shifts/{shift['id']}/cash", json={"kind": "out", "amount": 1_500_000,
                                                                 "reason": "Bank", "approval": BOSS}), 201)
    assert done["movements"][1]["approved_by"] == "Dewi Manager"


def test_day_report_covers_every_cashier_and_refund(till, login):
    sell(till, [("CB-1", 2)], [{"method": "cash", "amount": 111_000}])
    phone = sell(till, [("PH-1", 1)], [{"method": "card", "amount": 1_110_000}])
    ok(till.post(f"/api/sales/{phone['id']}/void", json={"reason": "Wrong", "approval": BOSS}), 201)
    other = login("cashier2")
    bandung = next(s for s in ok(other.get("/api/stores")) if s["code"] == "BDG-01")
    ok(other.post("/api/shifts", json={"store_id": bandung["id"], "opening_float": 100_000}), 201)
    sell(other, [("CB-1", 1)], [{"method": "qris", "amount": 55_500}])

    report = ok(till.get("/api/reports/day"))
    assert report["store"]["code"] == "BDG-01"
    assert report["sales"]["count"] == 3 and report["sales"]["voided"] == 1 and report["sales"]["total"] == 1_276_500
    assert report["returns"]["voids"] == 1 and report["returns"]["total"] == 1_110_000
    assert report["net"]["total"] == 166_500
    methods = {m["method"]: m for m in report["by_method"]}
    assert methods["card"] == {"method": "card", "taken": 1_110_000, "refunded": 1_110_000, "net": 0}
    assert methods["cash"]["net"] == 111_000 and methods["qris"]["net"] == 55_500
    assert {c["name"] for c in report["by_cashier"]} == {"Putri Ayu", "Second Cashier"}
    assert len(report["shifts"]) == 2
    assert report["top_products"][0] == {"sku": "CB-1", "name": "USB-C Cable", "qty": 3, "total": 150_000}
    assert next(p for p in report["top_products"] if p["sku"] == "PH-1")["qty"] == 0


def test_email_receipt(till, app, monkeypatch):
    sale = sell(till, [("CB-1", 1)], [{"method": "cash", "amount": 60_000}])
    off = till.post(f"/api/sales/{sale['id']}/email", json={"to": "a@example.com"})
    assert off.status_code == 503 and "not set up" in off.json()["detail"]

    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            self.host = host

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def starttls(self):
            pass

        def login(self, user, password):
            pass

        def send_message(self, msg):
            sent.append(msg)

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    app.state.settings.smtp_host = "smtp.test"
    app.state.settings.smtp_from = "pos@kios.test"
    assert till.post(f"/api/sales/{sale['id']}/email", json={"to": "a@example.com"}).status_code == 204
    assert sent[0]["To"] == "a@example.com" and sale["number"] in sent[0]["Subject"]
    assert "USB-C Cable" in sent[0].get_body(("plain",)).get_content()
    assert till.post(f"/api/sales/{sale['id']}/email", json={"to": "nope"}).status_code == 422


def test_stock_request_reaches_the_erp(till, erp):
    me = ok(till.get("/api/auth/me"))
    assert me["low_stock_at"] == 3 and me["loyalty"] == {"earn_per": 10_000, "point_value": 100}
    req = ok(till.post("/api/stock-requests", json={"lines": [{"product_id": product_id(till, "PH-1"), "qty": 10}],
                                                    "note": "Weekend"}), 201)
    assert req["erp_transfer_number"] == "TR-2026-00001" and req["source"] == "Jakarta DC"
    assert erp.transfers[0]["requested_by"] == "Putri Ayu" and erp.transfers[0]["lines"][0]["qty"] == 10
    assert [r["id"] for r in ok(till.get("/api/stock-requests"))] == [req["id"]]
    erp.down = True
    assert till.post("/api/stock-requests", json={"lines": [{"product_id": product_id(till, "PH-1"),
                                                             "qty": 1}]}).status_code == 503


def test_offline_sale_is_booked_once_as_it_was_rung_up(till, erp):
    shift = ok(till.get("/api/shifts/current"))
    sale_id = str(uuid.uuid4())
    body = {"public_id": sale_id, "offline": {"sold_at": datetime.now(UTC).isoformat(), "shift_id": shift["id"]},
            "lines": [{"product_id": product_id(till, "CB-1"), "qty": 2, "unit_price": 45_000, "discount_pct": 0,
                       "promo": "Old price"}],
            "payments": [{"method": "cash", "amount": 100_000}]}
    first = ok(till.post("/api/sales", json=body), 201)
    again = ok(till.post("/api/sales", json=body), 200)
    assert first["id"] == again["id"] and first["offline"] and first["external_id"] == sale_id
    assert first["total"] == 99_900 and first["lines"][0]["promo"] == "Old price"  # 90,000 + 9,900
    assert erp.orders[sale_id]["body"]["lines"][0]["unit_price"] == 45_000
    assert available(till, "CB-1") == 98
    # A retried online sale with the same id is booked once too.
    online = {"public_id": str(uuid.uuid4()), "lines": [{"product_id": product_id(till, "CB-1"), "qty": 1}],
              "payments": [{"method": "cash", "amount": 55_500}]}
    assert ok(till.post("/api/sales", json=online), 201)["id"] == ok(till.post("/api/sales", json=online), 200)["id"]
    assert ok(till.get("/api/sales"))["total"] == 2
