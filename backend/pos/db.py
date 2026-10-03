from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool


def make_engine(url: str, serverless: bool = False) -> Engine:
    if url.startswith("postgres://"):  # some hosts hand out the short scheme
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)

    if not url.startswith("sqlite"):
        if serverless:
            # Neon's pooler does the pooling; a per-process pool would just leak connections.
            return create_engine(url, poolclass=NullPool)
        return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)

    engine = create_engine(url, connect_args={"check_same_thread": False})

    # pysqlite manages transactions itself and breaks SAVEPOINTs; hand control back to
    # SQLAlchemy, enforce foreign keys, and use WAL so readers never block the writer.
    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_conn, _record):
        dbapi_conn.isolation_level = None
        dbapi_conn.execute("PRAGMA foreign_keys=ON")
        dbapi_conn.execute("PRAGMA journal_mode=WAL")

    @event.listens_for(engine, "begin")
    def _on_begin(conn):
        conn.exec_driver_sql("BEGIN")

    return engine


def make_session_factory(url: str, serverless: bool = False) -> sessionmaker:
    return sessionmaker(make_engine(url, serverless), expire_on_commit=False)


def get_db(request: Request) -> Iterator[Session]:
    """FastAPI dependency: one session per request, shared by every dependency that asks."""
    with request.app.state.session_factory() as db:
        yield db
