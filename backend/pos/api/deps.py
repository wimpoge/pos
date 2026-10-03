"""Shared request plumbing: which cashier is calling, and the ERP client."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..erp_client import ErpClient
from ..models import User
from ..services.auth import user_for_token
from ..services.shifts import ShiftClock

SESSION_COOKIE = "pos_session"

Db = Annotated[Session, Depends(get_db)]


def current_user(request: Request, db: Db) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    user = user_for_token(db, token) if token else None
    if user is None:
        raise HTTPException(401, "Please log in.")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def get_erp(request: Request) -> ErpClient:
    return request.app.state.erp


Erp = Annotated[ErpClient, Depends(get_erp)]


def get_tz(request: Request) -> str:
    return request.app.state.settings.timezone


Tz = Annotated[str, Depends(get_tz)]


def get_clock(request: Request) -> ShiftClock:
    return ShiftClock.from_settings(request.app.state.settings)


Clock = Annotated[ShiftClock, Depends(get_clock)]
