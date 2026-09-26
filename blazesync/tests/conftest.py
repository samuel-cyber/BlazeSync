"""Test fixtures — a real (embedded) PostgreSQL, isolated per run.

The whole API is exercised over HTTP against the actual Postgres engine the
app uses, so triggers, constraints, and advisory locks are genuinely tested.
"""

import os
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("RECONCILE_INTERVAL_SECONDS", "0")  # no background loop in tests
os.environ.setdefault("AUTO_MIGRATE", "false")  # migrations run explicitly below

from sqlmodel import text

from app.config import settings
from app.db import engine
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def _database() -> Iterator[None]:
    """Create a uniquely-named schema for this test run and migrate it in."""
    schema = f"test_{uuid.uuid4().hex[:10]}"
    with engine.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        conn.commit()
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        # ONLY the test schema — public must stay invisible so the dev
        # database's alembic_version/tables can never leak into the run.
        cursor.execute(f'SET search_path TO "{schema}"')
        cursor.close()

    # Drop pooled connections opened before the listener was attached —
    # otherwise they keep pointing at the public schema.
    engine.dispose()

    # Run migrations inside the test schema — env.py reuses the app engine,
    # whose search_path is pinned above, so no URL juggling is needed.
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(settings.BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(settings.BASE_DIR / "migrations"))
    command.upgrade(cfg, "head")

    yield

    with engine.connect() as conn:
        conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        conn.commit()


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def register_and_login(
    client: TestClient, email: str, password: str = "password-123", name: str = "Test User"
) -> dict:
    response = client.post(
        "/api/v1/auth/register",
        json={"name": name, "email": email, "password": password},
    )
    assert response.status_code == 201, response.text
    return response.json()


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def treasurer(client: TestClient) -> dict:
    """A registered user with an access token (becomes treasurer on create)."""
    email = f"treasurer-{uuid.uuid4().hex[:8]}@example.com"
    tokens = register_and_login(client, email, name="Treasurer Test")
    return {"email": email, "tokens": tokens}


@pytest.fixture()
def association(client: TestClient, treasurer: dict) -> dict:
    """An association owned by `treasurer` with the Ecobank account linked."""
    headers = auth_headers(treasurer["tokens"]["access_token"])
    response = client.post(
        "/api/v1/associations",
        json={
            "name": "Computer Science Class 2027",
            "institution": "University of Lagos",
            "department_or_faculty": "Faculty of Science",
            "approval_threshold": 2,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assoc = response.json()
    link = client.post(
        f"/api/v1/associations/{assoc['id']}/link-account",
        json={"account_ref": f"ECO-{uuid.uuid4().hex[:10]}"},
        headers=headers,
    )
    assert link.status_code == 200, link.text
    return assoc
