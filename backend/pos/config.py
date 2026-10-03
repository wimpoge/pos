from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="POS_", env_file=".env", extra="ignore")

    # Neon/Postgres in production, e.g. postgresql://user:pass@host/db?sslmode=require
    database_url: str = "sqlite:///./pos.db"
    # Serverless (Vercel): every invocation may be a new process, so don't keep a pool.
    serverless: bool = False
    session_hours: int = 12
    # True behind HTTPS so the session cookie is never sent in clear text.
    cookie_secure: bool = False
    cors_origins: list[str] = ["http://localhost:3001"]

    # The ERP's integration API, and the API client created for this POS in the ERP
    # (Settings > API clients). The secret is shown once there.
    erp_url: str = "http://localhost:8000"
    erp_client_id: str = ""
    erp_client_secret: str = ""
    erp_timeout_seconds: float = 20

    # Till rules. The highest line discount a cashier may type; the customer's ERP group discount
    # is the default and always allowed.
    max_discount_pct: int = 10
    # Taking more than this out of the drawer in one go needs a manager's approval.
    cash_out_approval_above: int = 1_000_000
    # How many days after a sale its goods can still come back.
    return_days: int = 30
    # A product with this many or fewer left in the store shows as low stock at the till.
    low_stock_at: int = 3
    receipt_footer: str = "Thank you for shopping with us!"
    # Emailed receipts. Empty host: the till offers print only.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True
    # Master data older than this is pulled again on the next login or stock refresh.
    sync_stale_minutes: int = 15

    # The shop's clock: a sale at 01:00 in Jakarta belongs to that day, not to yesterday in UTC.
    timezone: str = "Asia/Jakarta"
    # Shop time (HH:MM) when every open shift ends on its own and no new one can open until the
    # next day. Empty: shifts only end when the cashier ends them.
    shift_end_time: str = Field("17:00", pattern=r"^$|^([01][0-9]|2[0-3]):[0-5][0-9]$")
    # Vercel Cron sends "Authorization: Bearer <this>" to /api/cron/*; empty disables those routes.
    cron_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
