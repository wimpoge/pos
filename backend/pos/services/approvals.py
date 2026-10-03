"""A supervisor's approval at the till: their ERP username and password, checked by the ERP.

Asked for discounts over the cashier's cap, voids, refunds and large cash-outs. While the ERP is
down, a supervisor who approved on this POS before is checked against the password the ERP last
accepted, the same way a cashier logs in offline.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..erp_client import ErpClient, ErpRejected, ErpUnavailable
from ..models import User, utcnow
from .auth import LOCKOUT, MAX_FAILED_LOGINS, hash_password, verify_password
from .common import ApprovalRequired, DomainError


@dataclass
class Approval:
    username: str
    password: str


def approve(db: Session, erp: ErpClient, approval: Approval | None, what: str) -> str:
    """The supervisor's name, or ApprovalRequired (403) saying what needs approving."""
    if approval is None:
        raise ApprovalRequired(f"{what} needs a supervisor's approval.")
    username = approval.username.strip().lower()
    # End the read transaction before the slow call: on SQLite a snapshot that others wrote past
    # meanwhile can't become a write ("database is locked"). Nothing is written before an approval.
    db.commit()
    try:
        _, row = erp.post("/supervisors/verify", {"username": username, "password": approval.password})
    except ErpRejected as e:
        if e.status_code == 404:  # an ERP without supervisors: nobody can approve
            raise DomainError(409, "The ERP can't check supervisors yet. Update the ERP.") from None
        # Never 401: to the till that means its own session ended.
        raise DomainError(e.status_code if e.status_code in (403, 423) else 403 if e.status_code == 401 else 502,
                          f"Not approved: {e.message}") from None
    except ErpUnavailable:
        return _offline(db, username, approval.password)

    user = db.scalar(select(User).filter_by(username=row["username"]))
    if user is None:
        user = User(username=row["username"], full_name=row["full_name"], password_hash="")
        db.add(user)
    user.full_name = row["full_name"]
    user.role = "supervisor"
    user.active = True
    if not verify_password(approval.password, user.password_hash):
        user.password_hash = hash_password(approval.password)
    user.failed_logins = 0
    db.flush()
    return user.full_name


def _offline(db: Session, username: str, password: str) -> str:
    user = db.scalar(select(User).filter_by(username=username, role="supervisor", active=True))
    if user is None or not user.password_hash:
        raise DomainError(503, "Can't reach the ERP to check the approval. Only a supervisor who approved "
                               "on this POS before can approve while it is down.")
    now = utcnow()
    if user.locked_until and user.locked_until > now:
        raise DomainError(423, "Too many failed attempts. Try again in a few minutes.")
    if not verify_password(password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= MAX_FAILED_LOGINS:
            user.locked_until, user.failed_logins = now + LOCKOUT, 0
        db.commit()
        raise DomainError(403, "Not approved: wrong username or password.")
    user.failed_logins = 0
    return user.full_name
