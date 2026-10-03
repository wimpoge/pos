"""python -m pos.cli <command>

  migrate   create/upgrade the database schema (Alembic)
  sync      pull master data from the ERP, then push waiting sales

Cashier accounts are made in the ERP (Settings > Users, role Cashier), not here.
"""

import argparse
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config

from .config import get_settings
from .db import make_session_factory
from .erp_client import make_erp_client
from .services.sales import push_pending
from .services.sync import run_sync

ROOT = Path(__file__).resolve().parent.parent


def migrate() -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    command.upgrade(config, "head")


def main() -> None:
    parser = argparse.ArgumentParser(prog="pos.cli")
    parser.add_argument("command", choices=["migrate", "sync"])
    args = parser.parse_args()
    settings = get_settings()

    if args.command == "migrate":
        migrate()
        print("Schema is up to date.")
        return

    factory = make_session_factory(settings.database_url)
    with factory() as db:
        erp = make_erp_client(settings, factory)
        run = run_sync(db, erp, "cli")
        for name, stats in run.stats.items():
            print(f"  {name:<20} {stats}")
        for error in run.errors:
            print(f"  ! {error}")
        print(f"Sync {run.status}. Sales pushed: {push_pending(db, erp, limit=500)}")
        if run.status == "failed":
            sys.exit(1)


if __name__ == "__main__":
    main()
