"""Cashiers log in with their ERP account; the POS keeps working when the ERP is down."""

from fastapi.testclient import TestClient

from conftest import PASSWORD, ok


def attempt(app, username: str, password: str = PASSWORD):
    return TestClient(app).post("/api/auth/login", json={"username": username, "password": password})


def test_the_erp_checks_the_password(app, erp):
    me = ok(attempt(app, " Cashier "))
    assert me["username"] == "cashier" and me["full_name"] == "Putri Ayu" and me["shift"] is None
    assert me["max_discount_pct"] == 10 and "permissions" not in me

    wrong = attempt(app, "cashier", "nope")
    unknown = attempt(app, "ghost")
    assert wrong.status_code == unknown.status_code == 401 and wrong.json() == unknown.json()
    office = attempt(app, "sales")  # an ERP account, but not a cashier
    assert office.status_code == 403 and "Only cashier accounts" in office.json()["detail"]
    for _ in range(4):
        attempt(app, "cashier", "nope")
    assert attempt(app, "cashier").status_code == 423  # the ERP's lockout


def test_session_cookie_and_logout(app):
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"username": "cashier", "password": PASSWORD})
    cookie = response.headers["set-cookie"]
    assert "pos_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert ok(client.get("/api/auth/me"))["username"] == "cashier"
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_erp_down_cashiers_who_logged_in_before_still_can(app, erp):
    ok(attempt(app, "cashier"))
    erp.users["cashier"][0] = "changed-in-erp"  # irrelevant while the ERP can't be asked
    erp.down = True
    assert ok(attempt(app, "cashier"))["username"] == "cashier"  # the last password the ERP accepted
    assert attempt(app, "cashier", "changed-in-erp").status_code == 401
    never = attempt(app, "cashier2")
    assert never.status_code == 503 and "Can't reach the ERP" in never.json()["detail"]

    erp.down = False  # back up: the ERP decides again, and the new password is remembered
    assert attempt(app, "cashier").status_code == 401
    ok(attempt(app, "cashier", "changed-in-erp"))
    erp.down = True
    ok(attempt(app, "cashier", "changed-in-erp"))


def test_a_cashier_moved_to_another_role_in_the_erp_is_locked_out_here(app, erp):
    ok(attempt(app, "cashier"))
    erp.users["cashier"][2] = "sales"
    assert attempt(app, "cashier").status_code == 403
    erp.down = True  # not even with the remembered password
    assert attempt(app, "cashier").status_code == 503
