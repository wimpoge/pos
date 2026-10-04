"""The cashier's own account: profile, preferences, PIN and lock screen, password, devices, stats."""

from fastapi.testclient import TestClient

from conftest import PASSWORD, ok
from test_till import sell


def test_profile_comes_from_the_erp(till, erp):
    p = ok(till.get("/api/me/profile"))
    assert p["account"]["email"] == "cashier@kios.test" and p["erp_reachable"]
    assert p["preferences"] == {"auto_print": False, "scan_sound": True, "default_payment": "cash",
                                "auto_lock_minutes": 0}
    assert len(p["sessions"]) == 1 and p["sessions"][0]["current"]
    erp.down = True
    offline = ok(till.get("/api/me/profile"))
    assert not offline["erp_reachable"] and offline["account"]["full_name"] == "Putri Ayu"


def test_preferences_follow_the_cashier(till, login):
    prefs = ok(till.put("/api/me/preferences", json={"auto_print": True, "default_payment": "qris",
                                                      "auto_lock_minutes": 5}))
    assert prefs["auto_print"] and prefs["default_payment"] == "qris" and prefs["scan_sound"]
    assert till.put("/api/me/preferences", json={"auto_lock_minutes": 7}).status_code == 422
    other_till = login("cashier")
    assert ok(other_till.get("/api/auth/me"))["preferences"]["default_payment"] == "qris"


def test_pin_unlocks_the_till_and_too_many_tries_log_out(till):
    assert ok(till.get("/api/auth/me"))["has_pin"] is False
    assert till.put("/api/me/pin", json={"password": "nope", "pin": "1234"}).status_code == 403
    assert till.put("/api/me/pin", json={"password": PASSWORD, "pin": "12ab"}).status_code == 422
    assert till.put("/api/me/pin", json={"password": PASSWORD, "pin": "2468"}).status_code == 204
    assert ok(till.get("/api/auth/me"))["has_pin"] is True
    assert till.post("/api/me/unlock", json={"secret": "2468"}).status_code == 204
    assert till.post("/api/me/unlock", json={"secret": PASSWORD}).status_code == 204  # the password works too
    for _ in range(4):
        assert till.post("/api/me/unlock", json={"secret": "0000"}).status_code == 403
    assert till.post("/api/me/unlock", json={"secret": "0000"}).status_code == 423
    assert till.get("/api/auth/me").status_code == 401  # logged out: log in properly


def test_password_change_goes_to_the_erp_and_logs_out_other_devices(till, login, app):
    other = login("cashier")
    assert len(ok(till.get("/api/me/profile"))["sessions"]) == 2
    wrong = till.post("/api/me/password", json={"current_password": "nope", "new_password": "new-secret-1"})
    assert wrong.status_code == 403  # never 401: that would log this till out
    done = ok(till.post("/api/me/password", json={"current_password": PASSWORD, "new_password": "new-secret-1"}))
    assert done["other_devices_logged_out"] == 1
    assert other.get("/api/auth/me").status_code == 401 and till.get("/api/auth/me").status_code == 200
    fresh = TestClient(app)
    assert fresh.post("/api/auth/login", json={"username": "cashier", "password": PASSWORD}).status_code == 401
    ok(fresh.post("/api/auth/login", json={"username": "cashier", "password": "new-secret-1"}))


def test_devices_can_be_logged_out(till, login):
    other = login("cashier")
    sessions = ok(till.get("/api/me/profile"))["sessions"]
    mine = next(s for s in sessions if s["current"])
    theirs = next(s for s in sessions if not s["current"])
    assert till.delete(f"/api/me/sessions/{mine['id']}").status_code == 422
    assert till.delete(f"/api/me/sessions/{theirs['id']}").status_code == 204
    assert other.get("/api/auth/me").status_code == 401
    login("cashier")
    assert ok(till.delete("/api/me/sessions/others"))["logged_out"] == 1


def test_stats_sum_up_the_cashiers_selling(till):
    sell(till, [("CB-1", 2)], [{"method": "cash", "amount": 111_000}])
    sale = sell(till, [("PH-1", 1)], [{"method": "card", "amount": 1_110_000}])
    ok(till.post(f"/api/sales/{sale['id']}/void", json={"reason": "x", "approval": {"username": "manager",
                                                                                  "password": PASSWORD}}), 201)
    s = ok(till.get("/api/me/stats"))
    assert len(s["days"]) == 30 and s["days"][-1]["sales"] == 2
    assert s["week"]["sales"] == 2 and s["week"]["total"] == 1_221_000 and s["week"]["net"] == 111_000
    assert s["week"]["items"] == 3 and s["week"]["days_worked"] == 1
    assert s["best_day"]["total"] == 1_221_000 and s["top_products"][0]["name"] == "USB-C Cable"
