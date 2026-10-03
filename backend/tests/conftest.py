import os

import pytest
from fastapi.testclient import TestClient

from fake_erp import FakeErp
from pos.config import Settings
from pos.db import make_session_factory
from pos.main import create_app
from pos.models import Base

PASSWORD = "password123"


@pytest.fixture
def db_factory(tmp_path):
    # SQLite by default; set POS_TEST_DATABASE_URL to run the same tests on Postgres.
    url = os.environ.get("POS_TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'pos.db'}"
    factory = make_session_factory(url)
    engine = factory.kw["bind"]
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    return factory


@pytest.fixture
def erp():
    return FakeErp()


@pytest.fixture
def app(db_factory, erp):
    # _env_file=None: a local backend/.env must not leak into tests. sync_stale_minutes=0: every
    # login and refresh pulls everything, so a test sees ERP changes at once. shift_end_time="": no closing
    # time, so tests do not depend on the hour they run at (test_shift_end sets one).
    settings = Settings(_env_file=None, database_url="sqlite://", erp_url="http://erp.test", erp_client_id="cli_pos",
                        erp_client_secret="s3cret", cron_secret="cron-s3cret", sync_stale_minutes=0,
                        shift_end_time="")
    return create_app(db_factory, settings, erp_transport=erp.transport())


@pytest.fixture
def login(app):
    """A cashier logged in through the POS, which asks the (fake) ERP. Logging in also syncs."""
    clients = []

    def _login(username: str = "cashier") -> TestClient:
        client = TestClient(app)
        ok(client.post("/api/auth/login", json={"username": username, "password": PASSWORD}))
        clients.append(client)
        return client

    yield _login
    for c in clients:
        c.close()


@pytest.fixture
def till(login):
    """A cashier with an open shift in Bandung (5 phones, 100 cables in stock) and a 500,000 float."""
    cashier = login("cashier")
    bandung = next(s for s in ok(cashier.get("/api/stores")) if s["code"] == "BDG-01")
    ok(cashier.post("/api/shifts", json={"store_id": bandung["id"], "opening_float": 500_000}), 201)
    return cashier


def ok(response, status: int = 200):
    assert response.status_code == status, response.text
    return response.json()


def product_id(client, sku: str) -> int:
    store = ok(client.get("/api/auth/me"))["shift"]["store"]["id"]
    return next(p["id"] for p in ok(client.get(f"/api/stores/{store}/catalog"))["products"] if p["sku"] == sku)
