from datetime import date

from fastapi import APIRouter, HTTPException

from ..models import Store
from ..services.common import get_or_404, local_date
from ..services.reports import day_report
from ..services.shifts import current_shift
from .deps import Clock, CurrentUser, Db, Tz

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/day")
def day(db: Db, tz: Tz, clock: Clock, user: CurrentUser, store_id: int | None = None, on: date | None = None) -> dict:
    """The end-of-day report for a store: the shift's store, unless another is asked for."""
    if store_id is None:
        shift = current_shift(db, user, clock)
        if shift is None:
            raise HTTPException(422, "Pick a store.")
        store_id = shift.store_id
    return day_report(db, get_or_404(db, Store, store_id, "Store"), on or local_date(tz), tz)
