"""FastAPI application: the POS API for the Next.js till, and the bridge to the ERP."""

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import sessionmaker

from .api import auth, catalog, held, me, reports, sales, shifts, sync
from .config import Settings, get_settings
from .db import make_session_factory
from .erp_client import make_erp_client
from .services.common import ApprovalRequired, DomainError


def create_app(session_factory: sessionmaker | None = None, settings: Settings | None = None,
               erp_transport: httpx.BaseTransport | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="POS API", version="1.0.0",
                  description="Point of sale: shifts, the till, receipts, and the sync with the ERP.")
    app.state.settings = settings
    app.state.session_factory = session_factory or make_session_factory(settings.database_url, settings.serverless)
    app.state.erp = make_erp_client(settings, app.state.session_factory, erp_transport)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(DomainError)
    def domain_error(_: Request, exc: DomainError) -> JSONResponse:
        content = {"detail": exc.message}
        if isinstance(exc, ApprovalRequired):
            content["approval_required"] = True
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.get("/api/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok"}

    for module in (auth, me, catalog, shifts, sales, held, reports, sync):
        app.include_router(module.router)
    return app
