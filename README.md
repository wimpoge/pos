# POS

A cashier's point of sale for the stores of the [ERP](https://erp-otw7.vercel.app), connected through the ERP's integration API. Everything else (products, prices, customers, users) is run in the ERP.

## Features

- **Till**: barcode scanning or search, categories, live stock per store, customer group discounts, line discounts (capped for cashiers), PPN calculated the ERP's way
- **Payments**: cash with change, card, QRIS, split payments
- **Receipts**: on screen and printable on 80 mm thermal printers
- **Shifts**: opening float, cash in/out, end of shift with a drawer count (over/short). At closing time (17:00 shop time, `POS_SHIFT_END_TIME`) open shifts end by themselves and none opens until the next day; the drawer is counted afterwards
- **Profile**: the cashier's account, today's takings, the current shift with End shift, appearance
- **ERP sync**: stores, products, prices, stock and customers pulled from the ERP automatically (at login when stale, from the till's Stock button, daily cron); new customers created in the ERP
- **Sales to the ERP**: every sale is booked in the ERP as a sales order that is shipped, invoiced and paid in one step
- **Cashiers only**: accounts are ERP users with the Cashier role; the ERP checks the password. A cashier who logged in before can still log in while the ERP is down

## How it fits together

```
 Browser ──► Next.js (web) ──/api/*──► FastAPI (backend) ──REST──► ERP /api/integration/v1
                                          │
                                       Postgres (POS's own database)
```

- **The ERP owns master data.** The POS keeps a mirror of stores (ERP warehouses), products, stock and customers. Each row is linked to its ERP record by the ERP's public UUID. A sync upserts every list. Rows the ERP drops are deactivated, never deleted. An answer with 0 rows never empties a table.
- **The POS owns sales.** A sale is saved in the POS first, so the customer never waits for the ERP. It is then pushed as a paid ERP sales order. The sale's UUID is the ERP's `external_id`, so a retry can never book it twice.
- **When the ERP is down,** sales stay *waiting* and are retried. Tills retry every minute, and a daily cron catches anything left. Stock on the till already accounts for sales the ERP hasn't booked yet.
- **When the ERP refuses a sale** (e.g. no stock left there), it is marked *refused* with the reason. Once the cause is fixed in the ERP, the POS sends it again by itself within 10 minutes.
- Only one push per sale runs at a time (a short lease). No database transaction is held open while waiting for the ERP.

## Tech stack

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query
- **Backend**: Python, FastAPI, SQLAlchemy, Alembic, httpx, pytest
- **Database**: PostgreSQL (Neon) in production, SQLite locally

## Run locally

Needs the ERP running (default `http://localhost:8000`) with:
- an API client for the POS: **Settings → API clients → New**. Copy the secret; it is shown once.
- at least one cashier: **Settings → Users → New**, role **Cashier**. (The ERP's demo seed includes `cashier` / `demo1234`.)

```bash
# backend (port 8001)
python -m venv .venv && .venv/Scripts/pip install -r backend/requirements-dev.txt   # .venv/bin on macOS/Linux
cd backend
cp .env.example .env            # fill in POS_ERP_CLIENT_ID and POS_ERP_CLIENT_SECRET
../.venv/Scripts/python -m pos.cli migrate
../.venv/Scripts/python -m pos.cli sync           # first pull from the ERP
../.venv/Scripts/python -m uvicorn app:app --port 8001

# web (port 3001), in another terminal
cd web
npm install
npm run dev
```

Open http://localhost:3001, log in with the cashier account, open a shift and sell.

Tests: `cd backend && ../.venv/Scripts/python -m pytest` (uses an in-memory fake of the ERP API).

## Deploy (Vercel + Neon)

Two Vercel projects from this repo, like the ERP:

| Project | Root directory | Environment variables |
|---|---|---|
| POS API | `backend` | `POS_DATABASE_URL` (Neon), `POS_SERVERLESS=true`, `POS_COOKIE_SECURE=true`, `POS_ERP_URL=https://erp-otw7.vercel.app`, `POS_ERP_CLIENT_ID`, `POS_ERP_CLIENT_SECRET`, `POS_CRON_SECRET` and `CRON_SECRET` (same value) |
| POS web | `web` | `API_URL` = the POS API's URL |

Before first use, run `python -m pos.cli migrate` against the Neon database. The first cashier login pulls everything from the ERP.

The ERP must include the integration API features `paid_sales`, `line_discounts`, `customer_create` and `cashier_login`. Without `paid_sales` the POS syncs but will not sell.
