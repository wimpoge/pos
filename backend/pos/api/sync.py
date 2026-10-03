import hmac
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request
from sqlalchemy import select

from ..models import SyncRun
from ..services import sales as sales_svc
from ..services.shifts import ShiftClock, current_shift, end_overdue_shifts
from ..services.sync import refresh, run_sync
from .deps import Clock, CurrentUser, Db, Erp

router = APIRouter(prefix="/api", tags=["sync"])


def run_out(r: SyncRun) -> dict:
    return {"id": r.id, "started_at": r.started_at, "finished_at": r.finished_at, "trigger": r.trigger,
            "scope": r.scope, "status": r.status, "stats": r.stats, "errors": r.errors}


@router.post("/sync")
def sync(request: Request, db: Db, erp: Erp, clock: Clock, user: CurrentUser) -> dict:
    """The till's refresh: everything from the ERP when it is stale, otherwise this store's stock."""
    shift = current_shift(db, user, clock)
    run = refresh(db, erp, request.app.state.settings.sync_stale_minutes, "till", user,
                  store=shift.store if shift else None)
    if run is None:  # fresh, and no store to refresh: answer with the last full pull
        run = db.scalar(select(SyncRun).where(SyncRun.scope == "all").order_by(SyncRun.id.desc()).limit(1))
    return run_out(run)


# ---------------------------------------------------------------- scheduled jobs (Vercel Cron)


def _check_cron(request: Request, authorization: str | None) -> None:
    secret = request.app.state.settings.cron_secret
    if not secret or not authorization or not hmac.compare_digest(authorization, f"Bearer {secret}"):
        raise HTTPException(401, "Not allowed.")


@router.get("/cron/sync")
def cron_sync(request: Request, db: Db, erp: Erp, authorization: Annotated[str | None, Header()] = None) -> dict:
    _check_cron(request, authorization)
    ended = end_overdue_shifts(db, ShiftClock.from_settings(request.app.state.settings))
    run = run_sync(db, erp, "cron")
    return {"sync": run.status, "errors": run.errors, "sales": sales_svc.push_pending(db, erp, limit=100),
            "shifts_ended": ended}
