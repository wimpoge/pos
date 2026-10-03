"""Client for the ERP's integration API (/api/integration/v1), over REST only.

Client-credentials token, cached in memory and in the database so that serverless instances
share one token instead of minting a new one per request. When the ERP answers 401 (token
expired or revoked) the client fetches a new token and retries once.

Two kinds of failure, because the POS handles them differently:
- ErpRejected: the ERP looked at the request and said no (4xx). Retrying won't help; a person must.
- ErpUnavailable: network error, timeout or 5xx. Try again later.
"""

from datetime import datetime, timedelta

import httpx
from sqlalchemy.orm import sessionmaker

from .models import Setting, utcnow

TOKEN_KEY = "_erp_token"  # leading underscore: never shown in the settings API
PAGE_SIZE = 200  # the ERP's maximum


class ErpError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class ErpRejected(ErpError):
    pass


class ErpUnavailable(ErpError):
    pass


class ErpClient:
    def __init__(self, base_url: str, client_id: str, client_secret: str, session_factory: sessionmaker,
                 timeout: float = 20, transport: httpx.BaseTransport | None = None):
        self.configured = bool(base_url and client_id and client_secret)
        self._client_id = client_id
        self._client_secret = client_secret
        self._session_factory = session_factory
        self._http = httpx.Client(base_url=base_url.rstrip("/") + "/api/integration/v1", timeout=timeout,
                                  transport=transport)
        self._token: tuple[str, datetime] | None = None

    # ------------------------------------------------------------ token

    def _load_token(self) -> str | None:
        if self._token is None:
            with self._session_factory() as db:
                row = db.get(Setting, TOKEN_KEY)
                if row and row.value:
                    self._token = (row.value["token"], datetime.fromisoformat(row.value["expires_at"]))
        if self._token and self._token[1] > utcnow() + timedelta(seconds=60):
            return self._token[0]
        return None

    def _fetch_token(self) -> str:
        if not self.configured:
            raise ErpRejected(0, "The POS has no ERP credentials. Set POS_ERP_URL, POS_ERP_CLIENT_ID and "
                                 "POS_ERP_CLIENT_SECRET.")
        res = self._send("POST", "/token", json={"grant_type": "client_credentials", "client_id": self._client_id,
                                                 "client_secret": self._client_secret})
        if res.status_code == 401:
            raise ErpRejected(401, "The ERP refused the POS credentials. Check the API client in the ERP "
                                   "(Settings > API clients) is active and the id and secret are right.")
        body = self._json_or_raise(res)
        expires_at = utcnow() + timedelta(seconds=int(body.get("expires_in", 3600)))
        self._token = (body["access_token"], expires_at)
        with self._session_factory() as db:
            value = {"token": body["access_token"], "expires_at": expires_at.isoformat()}
            row = db.get(Setting, TOKEN_KEY)
            if row is None:
                db.add(Setting(key=TOKEN_KEY, value=value))
            else:
                row.value = value
            db.commit()
        return body["access_token"]

    # ------------------------------------------------------------ requests

    def _send(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            return self._http.request(method, path, **kwargs)
        except httpx.TimeoutException:
            raise ErpUnavailable(0, "The ERP did not answer in time.") from None
        except httpx.HTTPError as e:
            raise ErpUnavailable(0, f"Can't reach the ERP ({type(e).__name__}).") from None

    @staticmethod
    def _json_or_raise(res: httpx.Response):
        if res.status_code >= 500:
            raise ErpUnavailable(res.status_code, f"The ERP had an error ({res.status_code}). Try again later.")
        if res.status_code >= 400:
            detail = None
            try:
                detail = res.json().get("detail")
            except ValueError:
                pass
            if isinstance(detail, list):  # FastAPI validation errors
                detail = "; ".join(f"{'.'.join(map(str, d.get('loc', [])[1:]))}: {d.get('msg')}" for d in detail)
            raise ErpRejected(res.status_code, str(detail or res.reason_phrase))
        return res.json()

    def request(self, method: str, path: str, **kwargs) -> tuple[int, dict]:
        token = self._load_token() or self._fetch_token()
        res = self._send(method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs)
        if res.status_code == 401 and _about_token(res):  # expired early or revoked: one fresh token, one retry
            self._token = None
            res = self._send(method, path, headers={"Authorization": f"Bearer {self._fetch_token()}"}, **kwargs)
        return res.status_code, self._json_or_raise(res)

    def get(self, path: str, params: dict | None = None) -> dict:
        return self.request("GET", path, params=params)[1]

    def post(self, path: str, json: dict) -> tuple[int, dict]:
        return self.request("POST", path, json=json)

    def list_all(self, path: str) -> list[dict]:
        """Every row of a paginated list, page by page."""
        rows: list[dict] = []
        page = 1
        while True:
            body = self.get(path, {"page": page, "page_size": PAGE_SIZE})
            rows.extend(body["items"])
            if not body["items"] or len(rows) >= body["total"]:
                return rows
            page += 1


def _about_token(res: httpx.Response) -> bool:
    """A 401 for the bearer token, not e.g. a cashier's wrong password."""
    try:
        return "token" in str(res.json().get("detail", ""))
    except ValueError:
        return True


def make_erp_client(settings, session_factory: sessionmaker, transport: httpx.BaseTransport | None = None) -> ErpClient:
    return ErpClient(settings.erp_url, settings.erp_client_id, settings.erp_client_secret, session_factory,
                     timeout=settings.erp_timeout_seconds, transport=transport)

