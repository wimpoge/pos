"""Shifts end by themselves at the shop's closing time; the drawer is counted afterwards.

Closing time "00:00" makes the tests independent of the hour they run at: it is always past
00:00 today, and a shift opened yesterday ran past it.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import update

from conftest import ok
from pos.models import Shift, utcnow


def back_date_shifts(db_factory, days: int = 1) -> None:
    with db_factory() as db:
        db.execute(update(Shift).values(opened_at=utcnow() - timedelta(days=days)))
        db.commit()


def jakarta_midnight_today_utc() -> datetime:
    now = datetime.now(UTC).astimezone(ZoneInfo("Asia/Jakarta"))
    return now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC).replace(tzinfo=None)


def test_a_shift_past_closing_time_ends_by_itself(app, till, db_factory):
    shift = ok(till.get("/api/shifts/current"))
    ok(till.post("/api/sales", json={"lines": [{"product_id": 2, "qty": 2}],
                                     "payments": [{"method": "cash", "amount": 111_000}]}), 201)
    assert ok(till.get("/api/auth/me"))["shift"]["ends_at"] is None  # no closing time set

    app.state.settings.shift_end_time = "00:00"
    back_date_shifts(db_factory)  # opened yesterday: ran past last midnight
    me = ok(till.get("/api/auth/me"))
    assert me["shift"] is None and me["after_hours"] and me["shift_end_time"] == "00:00"
    ended = ok(till.get(f"/api/shifts/{shift['id']}"))
    assert ended["status"] == "closed" and ended["auto_closed"] and ended["needs_count"]
    assert ended["expected_cash"] == 500_000 + 111_000 and ended["counted_cash"] is None
    assert ended["closed_at"].startswith(jakarta_midnight_today_utc().isoformat()[:16])  # at closing time, not now

    # No selling and no new shift until tomorrow.
    sale = till.post("/api/sales", json={"lines": [{"product_id": 2, "qty": 1}],
                                         "payments": [{"method": "cash", "amount": 55_500}]})
    assert sale.status_code == 409
    bandung = next(s for s in ok(till.get("/api/stores")) if s["code"] == "BDG-01")
    reopen = till.post("/api/shifts", json={"store_id": bandung["id"], "opening_float": 0})
    assert reopen.status_code == 409 and "Shifts end at 00:00" in reopen.json()["detail"]


def test_the_drawer_is_counted_after_an_automatic_end(app, till, db_factory):
    shift = ok(till.get("/api/shifts/current"))
    app.state.settings.shift_end_time = "00:00"
    back_date_shifts(db_factory)
    assert ok(till.get("/api/shifts/current")) is None

    short = till.post(f"/api/shifts/{shift['id']}/close", json={"counted_cash": 490_000})
    assert short.status_code == 422 and "10.000 short" in short.json()["detail"]
    counted = ok(till.post(f"/api/shifts/{shift['id']}/close", json={"counted_cash": 490_000, "note": "Paid parking"}))
    assert counted["counted_cash"] == 490_000 and counted["variance"] == -10_000 and not counted["needs_count"]
    assert counted["closed_at"] == ok(till.get(f"/api/shifts/{shift['id']}"))["closed_at"]  # still closing time
    again = till.post(f"/api/shifts/{shift['id']}/close", json={"counted_cash": 500_000})
    assert again.status_code == 409  # counted once


def test_a_shift_ended_by_the_cashier_is_not_auto_closed(app, till):
    shift = ok(till.get("/api/shifts/current"))
    closed = ok(till.post(f"/api/shifts/{shift['id']}/close", json={"counted_cash": 500_000}))
    assert closed["status"] == "closed" and not closed["auto_closed"] and not closed["needs_count"]


def test_the_shift_shows_when_it_ends(app, till):
    app.state.settings.shift_end_time = "23:59"
    me = ok(till.get("/api/auth/me"))
    ends_at = datetime.fromisoformat(me["shift"]["ends_at"])
    local = ends_at.replace(tzinfo=UTC).astimezone(ZoneInfo("Asia/Jakarta"))
    assert (local.hour, local.minute) == (23, 59) and ends_at > utcnow()


def test_cron_ends_shifts_nobody_is_looking_at(app, till, db_factory):
    app.state.settings.shift_end_time = "00:00"
    back_date_shifts(db_factory)
    result = ok(TestClient(app).get("/api/cron/sync", headers={"Authorization": "Bearer cron-s3cret"}))
    assert result["shifts_ended"] == 1
    with db_factory() as db:
        assert db.query(Shift).filter_by(status="open").count() == 0
