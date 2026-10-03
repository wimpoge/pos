"""Returns and voids: a supervisor approves, goods go back on the shelf, money comes out of the drawer."""

from conftest import ok
from test_till import available, sell

BOSS = {"username": "manager", "password": "password123"}


def drawer(client) -> int:
    return ok(client.get("/api/shifts/current"))["summary"]["expected_cash"]


def test_partial_return_then_the_rest(till, erp):
    sale = sell(till, [("CB-1", 3)], [{"method": "cash", "amount": 166_500}])  # 150,000 + 16,500
    line = sale["lines"][0]
    assert available(till, "CB-1") == 97 and drawer(till) == 500_000 + 166_500

    body = {"lines": [{"sale_line_id": line["id"], "qty": 1}], "reason": "Doesn't fit",
            "refunds": [{"method": "cash", "amount": 55_500}]}
    needs = till.post(f"/api/sales/{sale['id']}/returns", json=body)
    assert needs.status_code == 403 and needs.json()["approval_required"]
    done = ok(till.post(f"/api/sales/{sale['id']}/returns", json={**body, "approval": BOSS}), 201)
    ret = done["return"]
    assert ret["total"] == 55_500 and ret["approved_by"] == "Dewi Manager" and ret["number"].startswith("BDG-01/R/")
    assert done["sale"]["lines"][0]["returned"] == 1 and done["sale"]["refunded"] == 55_500
    assert ok(till.get(f"/api/sales/{sale['id']}"))["returns"][0]["erp"]["status"] == "synced"
    assert next(iter(erp.returns.values()))["body"]["lines"][0]["unit_price"] == 50_000
    assert available(till, "CB-1") == 98 and drawer(till) == 500_000 + 111_000

    too_many = till.post(f"/api/sales/{sale['id']}/returns", json={
        **body, "approval": BOSS, "lines": [{"sale_line_id": line["id"], "qty": 3}],
        "refunds": [{"method": "cash", "amount": 166_500}]})
    assert too_many.status_code == 422 and "2 can still come back" in too_many.json()["detail"]
    wrong_sum = till.post(f"/api/sales/{sale['id']}/returns", json={**body, "approval": BOSS,
                                                                    "refunds": [{"method": "cash", "amount": 1}]})
    assert wrong_sum.status_code == 422 and "add up to" in wrong_sum.json()["detail"]
    rest = ok(till.post(f"/api/sales/{sale['id']}/returns", json={
        **body, "approval": BOSS, "lines": [{"sale_line_id": line["id"], "qty": 2}],
        "refunds": [{"method": "card", "amount": 111_000}]}), 201)
    assert rest["return"]["total"] == 111_000  # what is left of the sale, to the rupiah
    summary = ok(till.get("/api/shifts/current"))["summary"]
    assert summary["refunds_total"] == 166_500 and summary["by_method"]["card"] == -111_000
    assert ok(till.get("/api/sales/summary"))["net"] == 0


def test_any_cashier_of_the_store_takes_goods_back(till, login):
    sale = sell(till, [("PH-1", 1)], [{"method": "card", "amount": 1_110_000}])
    other = login("cashier2")
    bandung = next(s for s in ok(other.get("/api/stores")) if s["code"] == "BDG-01")
    ok(other.post("/api/shifts", json={"store_id": bandung["id"], "opening_float": 2_000_000}), 201)
    found = ok(other.get("/api/sales/lookup", params={"number": "1"}))
    assert found["id"] == sale["id"] and found["lines"][0]["returned"] == 0
    assert ok(other.get("/api/sales/lookup", params={"number": sale["number"]}))["id"] == sale["id"]
    assert other.get("/api/sales/lookup", params={"number": "999"}).status_code == 404
    ok(other.post(f"/api/sales/{sale['id']}/returns", json={
        "lines": [{"sale_line_id": found["lines"][0]["id"], "qty": 1}], "reason": "Dead on arrival",
        "refunds": [{"method": "cash", "amount": 1_110_000}], "approval": BOSS}), 201)
    # Their drawer paid it, not the first cashier's.
    assert drawer(other) == 2_000_000 - 1_110_000 and drawer(till) == 500_000
    # Not more cash than the drawer holds.
    again = sell(till, [("PH-1", 2)], [{"method": "card", "amount": 2_220_000}])
    line = again["lines"][0]["id"]
    broke = other.post(f"/api/sales/{again['id']}/returns", json={
        "lines": [{"sale_line_id": line, "qty": 1}], "reason": "x", "approval": BOSS,
        "refunds": [{"method": "cash", "amount": 1_110_000}]})
    assert broke.status_code == 422 and "drawer" in broke.json()["detail"]


def test_void_before_the_erp_saw_it_is_never_sent(till, erp):
    erp.down = True
    sale = sell(till, [("CB-1", 2)], [{"method": "cash", "amount": 200_000}])
    assert ok(till.get(f"/api/sales/{sale['id']}"))["erp"]["status"] == "pending"
    erp.down = False  # back, but the sale has not been sent yet
    voided = ok(till.post(f"/api/sales/{sale['id']}/void", json={"reason": "Rang up twice", "approval": BOSS}), 201)
    assert voided["return"]["kind"] == "void" and voided["return"]["erp"]["status"] == "skipped"
    assert voided["sale"]["voided"] and voided["sale"]["erp"]["status"] == "voided"
    assert voided["return"]["refunds"] == [{"method": "cash", "amount": 111_000, "reference": None}]
    ok(till.post("/api/sales/push-pending"))
    assert erp.orders == {} and erp.returns == {}
    assert available(till, "CB-1") == 100 and drawer(till) == 500_000
    again = till.post(f"/api/sales/{sale['id']}/void", json={"reason": "x", "approval": BOSS})
    assert again.status_code == 409


def test_void_after_the_erp_booked_it_becomes_an_erp_return(till, erp):
    sale = sell(till, [("CB-1", 1)], [{"method": "qris", "amount": 55_500, "reference": "Q1"}])
    voided = ok(till.post(f"/api/sales/{sale['id']}/void", json={"reason": "Wrong item", "approval": BOSS}), 201)
    assert voided["return"]["refunds"] == [{"method": "qris", "amount": 55_500, "reference": "Q1"}]
    sent = ok(till.get(f"/api/sales/{sale['id']}"))
    assert sent["returns"][0]["erp"]["status"] == "synced" and len(erp.returns) == 1
    assert sent["erp"]["status"] == "synced" and available(till, "CB-1") == 100


def test_returns_wait_for_their_sale_to_reach_the_erp(till, erp):
    erp.down = True
    sale = sell(till, [("CB-1", 2)], [{"method": "cash", "amount": 111_000}])
    body = {"lines": [{"sale_line_id": sale["lines"][0]["id"], "qty": 1}], "reason": "Changed mind",
            "refunds": [{"method": "cash", "amount": 55_500}], "approval": BOSS}
    # While the ERP is down, only a supervisor who approved on this POS before can approve.
    refused = till.post(f"/api/sales/{sale['id']}/returns", json=body)
    assert refused.status_code == 503 and "approved on this POS before" in refused.json()["detail"]
    erp.down = False
    other = sell(till, [("PH-1", 1)], [{"method": "card", "amount": 1_110_000}])
    ok(till.post(f"/api/sales/{other['id']}/void", json={"reason": "Test", "approval": BOSS}), 201)
    erp.down = True
    wrong = till.post(f"/api/sales/{sale['id']}/returns", json={**body, "approval": {**BOSS, "password": "x"}})
    assert wrong.status_code == 403
    ok(till.post(f"/api/sales/{sale['id']}/returns", json=body), 201)

    assert available(till, "CB-1") == 99  # sold 2, 1 back, the ERP knows of neither
    erp.down = False
    assert ok(till.post("/api/sales/push-pending")) == {"synced": 1, "pending": 0, "failed": 0, "returns": 1}
    assert available(till, "CB-1") == 99 and len(erp.returns) == 2
