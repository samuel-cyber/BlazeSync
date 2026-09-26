"""Database engine and session management — PostgreSQL only.

When DATABASE_URL is unset (local dev), an embedded *real* PostgreSQL cluster
is booted via pgembed (pip package shipping Postgres binaries) and stored
under ./.pgserver. This keeps the dev environment on the same database engine
as production, with zero setup.
"""

import logging

from sqlalchemy import text
from sqlmodel import Session, create_engine

from .config import settings

logger = logging.getLogger(__name__)

_pg_cluster = None  # module-level handle keeps the embedded cluster alive


def _ensure_database(server_uri: str, dbname: str) -> None:
    """Create the app database inside the embedded cluster if missing."""
    import psycopg

    with psycopg.connect(server_uri, autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{dbname}"')
            logger.info("Created embedded database %s", dbname)


def _embedded_postgres_url() -> str:
    """Boot (or reuse) an embedded pgserver cluster and return its SQLAlchemy URL."""
    global _pg_cluster
    if _pg_cluster is None:
        import pgembed  # imported lazily: not needed in production

        logger.info("Booting embedded PostgreSQL cluster (pgembed)…")
        _pg_cluster = pgembed.get_server(str(settings.BASE_DIR / ".pgserver"))
    _ensure_database(_pg_cluster.get_uri("postgres"), "blazesync")
    uri = _pg_cluster.get_uri("blazesync")
    # SQLAlchemy needs the psycopg3 dialect spelled out explicitly.
    for prefix in ("postgres://", "postgresql://"):
        if uri.startswith(prefix):
            return uri.replace(prefix, "postgresql+psycopg://", 1)
    return uri


def _engine_url() -> str:
    return settings.DATABASE_URL or _embedded_postgres_url()


engine = create_engine(
    _engine_url(),
    pool_pre_ping=True,
)


def get_session():
    """FastAPI dependency yielding a SQLModel session."""
    with Session(engine) as session:
        yield session


def _current_revision(session: Session) -> str | None:
    try:
        rows = session.execute(text("SELECT version_num FROM alembic_version")).all()
    except Exception:
        return None
    return rows[0][0] if rows else None


def ensure_schema() -> None:
    """Run Alembic migrations to head (idempotent).

    Used on startup when AUTO_MIGRATE is enabled (dev/demo convenience);
    production deployments can instead run `alembic upgrade head` explicitly.
    """
    from alembic import command
    from alembic.config import Config

    alembic_cfg = Config(str(settings.BASE_DIR / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(settings.BASE_DIR / "migrations"))
    # Point Alembic at the same engine URL the app uses (env.py reuses it too).
    alembic_cfg.set_main_option("sqlalchemy.url", _engine_url())
    with Session(engine) as session:
        current = _current_revision(session)
        if current:
            logger.info("Database schema at revision %s — migrating to head", current)
        else:
            logger.info("Fresh database — running full migration")
    command.upgrade(alembic_cfg, "head")
