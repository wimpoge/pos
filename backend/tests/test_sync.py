"""Pulling master data from the ERP: mirror, deactivate, guard against empty answers, tokens."""

from fastapi.testclient import TestClient

from conftest import ok


def test_logging_in_fills_the_pos_from_the_erp(login, erp):
    cashier = login()  # the first login finds an empty mirror and pulls everything
    stores = ok(cashier.get("/api/stores"))
    assert [s["code"] for s in stores] == ["BDG-01", "JKT-DC"]
    bandung = next(s for s in stores if s["code"] == "BDG-01")
    catalog = ok(cashier.get(f"/api/stores/{bandung['id']}/catalog"))
    assert {p["sku"]: p["available"] for p in catalog["products"]} == {"PH-1": 5, "CB-1": 100}  # OLD-1 not on sale
    assert catalog["categories"] == ["Cables", "Smartphones"]

    me = ok(cashier.get("/api/auth/me"))
    assert me["company"]["name"] == "Kios Gawai" and me["company"]["tax_rate"] == 11 and me["erp_ready"]
    walk_in = ok(cashier.get(f"/api/customers/{me['walk_in_customer_id']}"))
    assert walk_in["name"] == "Walk-in Customer"

    # Nothing changed in the ERP: nothing changes here, and the walk-in customer is not created twice.
    again = ok(cashier.post("/api/sync"))
    assert again["scope"] == "all" and again["stats"]["products"]["unchanged"] == 3
    assert erp.calls.count("POST /customers") == 1


def test_fresh_data_only_refreshes_the_store_stock(app, login, erp):
    app.state.settings.sync_stale_minutes = 15
    cashier = login()  # full pull: nothing synced yet
    bandung = next(s for s in ok(cashier.get("/api/stores")) if s["code"] == "BDG-01")
    assert ok(cashier.post("/api/sync"))["scope"] == "all"  # no shift, nothing else to do: the last full pull
    ok(cashier.post("/api/shifts", json={"store_id": bandung["id"], "opening_float": 0}), 201)
    erp.stock[(erp.warehouses[1]["id"], erp.products[0]["id"])] = 9
    erp.products[0]["price"] = 999  # a price change waits for the next full pull
    run = ok(cashier.post("/api/sync"))
    assert run["scope"] == "stock:BDG-01" and run["stats"]["stock BDG-01"]["updated"] == 1
    phone = next(p for p in ok(cashier.get(f"/api/stores/{bandung['id']}/catalog"))["products"] if p["sku"] == "PH-1")
    assert phone["available"] == 9 and phone["price"] == 1_000_000


def test_changes_in_the_erp_reach_the_pos(login, erp):
    cashier = login()
    erp.products[0]["price"] = 1_100_000
    gone = erp.products.pop(1)
    erp.customers[0]["discount_pct"] = 15
    run = ok(cashier.post("/api/sync"))
    assert run["stats"]["products"]["updated"] == 1 and run["stats"]["products"]["deactivated"] == 1
    bandung = next(s for s in ok(cashier.get("/api/stores")) if s["code"] == "BDG-01")
    products = ok(cashier.get(f"/api/stores/{bandung['id']}/catalog"))["products"]
    assert [(p["sku"], p["price"]) for p in products] == [("PH-1", 1_100_000)]
    assert gone["sku"] not in {p["sku"] for p in products}
    budi = ok(cashier.get("/api/customers", params={"q": "budi"}))[0]
    assert budi["discount_pct"] == 15 and budi["group"] == "Reseller"


def test_an_empty_answer_never_empties_a_table(login, erp):
    cashier = login()
    erp.products.clear()
    erp.stock.clear()
    run = ok(cashier.post("/api/sync"))
    assert "skipped" in run["stats"]["products"] and "skipped" in run["stats"]["stock BDG-01"]
    bandung = next(s for s in ok(cashier.get("/api/stores")) if s["code"] == "BDG-01")
    assert len(ok(cashier.get(f"/api/stores/{bandung['id']}/catalog"))["products"]) == 2


def test_token_is_reused_and_renewed(login, erp):
    cashier = login()
    assert erp.tokens_issued == 1
    ok(cashier.post("/api/sync"))
    assert erp.tokens_issued == 1  # cached
    erp.expire_tokens()  # e.g. the ERP restarted or the client was rotated
    assert ok(cashier.post("/api/sync"))["status"] == "ok"
    assert erp.tokens_issued == 2


def test_erp_trouble_is_recorded_on_the_run(app, login, erp):
    cashier = login()
    erp.down = True
    run = ok(cashier.post("/api/sync"))
    assert run["status"] == "failed" and "Can't reach the ERP" in run["errors"][0]
    erp.down = False
    erp.expire_tokens()
    app.state.erp._token = None
    app.state.erp._client_secret = "wrong"
    run = ok(cashier.post("/api/sync"))
    assert run["status"] == "failed" and "refused the POS credentials" in run["errors"][0]


def test_an_older_erp_syncs_but_cannot_take_sales(login, erp):
    erp.features = ["cashier_login"]
    cashier = login()
    run = ok(cashier.post("/api/sync"))
    assert run["status"] == "partial" and "paid_sales" in run["errors"][0]
    assert run["stats"]["products"]["unchanged"] == 3  # the catalogue still came through
    store = ok(cashier.get("/api/stores"))[0]
    ok(cashier.post("/api/shifts", json={"store_id": store["id"], "opening_float": 0}), 201)
    sale = cashier.post("/api/sales", json={"lines": [{"product_id": 1, "qty": 1}],
                                            "payments": [{"method": "cash", "amount": 2_000_000}]})
    assert sale.status_code == 409 and "paid_sales" in sale.json()["detail"]


def test_cron_needs_its_secret(app, login):
    login()
    anonymous = TestClient(app)
    assert anonymous.get("/api/cron/sync").status_code == 401
    assert anonymous.get("/api/cron/sync", headers={"Authorization": "Bearer nope"}).status_code == 401
    result = ok(anonymous.get("/api/cron/sync", headers={"Authorization": "Bearer cron-s3cret"}))
    assert result["sync"] == "ok"
