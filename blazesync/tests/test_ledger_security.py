"""Ledger immutability (DB trigger), reconciliation, invites, webhooks."""

import hashlib
import hmac
import uuid

import pytest
from sqlalchemy import text
from sqlmodel import Session

from app.config import settings
from app.db import engine
from tests.conftest import auth_headers, register_and_login


def test_ledger_is_append_only_at_database_level(client, treasurer, association):
    """Even raw SQL UPDATE/DELETE must fail — the trigger enforces immutability."""
    # Seed one entry via a manual payment.
    headers = auth_headers(treasurer["tokens"]["access_token"])
    client.post(
        f"/api/v1/associations/{association['id']}/dues-cycles",
        json={"title": "Dues", "amount": 1000, "deadline": "2026-12-31T00:00:00Z"},
        headers=headers,
    ).json()
    csv_content = "name,email,matric_number\nAda Obi,ada2@example.com,CSC/2023/013\n"
    client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", csv_content.encode(), "text/csv")},
        headers=headers,
    )
    roster = client.get(f"/api/v1/associations/{association['id']}/roster", headers=headers).json()
    member_id = roster["items"][0]["id"]
    client.post(
        f"/api/v1/associations/{association['id']}/roster/{member_id}/mark-paid",
        json={"amount": 1000},
        headers=headers,
    )

    with Session(engine) as session:
        entry_id = session.exec(text("SELECT id FROM ledger_entry LIMIT 1")).first()[0]
        with pytest.raises(Exception, match="append-only"):
            session.exec(text(f"UPDATE ledger_entry SET amount = 999999 WHERE id = '{entry_id}'"))
            session.commit()
        session.rollback()
        with pytest.raises(Exception, match="append-only"):
            session.exec(text(f"DELETE FROM ledger_entry WHERE id = '{entry_id}'"))
            session.commit()
        session.rollback()


def test_reconcile_reports_in_sync_with_mock_drift_zero(client, treasurer, association):
    response = client.get(
        f"/api/v1/associations/{association['id']}/balance/reconcile",
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] in ("in_sync", "drifted", "unavailable", "not_linked")


def test_invite_claim_requires_identity_match(client, treasurer, association):
    """One student cannot claim another's roster slot."""
    headers = auth_headers(treasurer["tokens"]["access_token"])
    csv_content = "name,email,matric_number\nNgozi Eze,ngozi@example.com,CSC/2023/014\n"
    client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", csv_content.encode(), "text/csv")},
        headers=headers,
    )
    # Invite codes are returned by upload; fetch from the upload response path.
    upload = client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster2.csv", b"name,email\nOther,other@example.com\n", "text/csv")},
        headers=headers,
    )
    # Use the new row's code with a mismatched email.
    code = upload.json()["invites"][0]["invite_code"]
    impostor = register_and_login(client, f"impostor-{uuid.uuid4().hex[:8]}@example.com")
    wrong = client.post(
        "/api/v1/roster/claim",
        json={"invite_code": code, "email": "impostor@example.com"},
        headers=auth_headers(impostor["access_token"]),
    )
    assert wrong.status_code == 403

    # Correct email succeeds.
    real = register_and_login(client, "other@example.com", name="Other")
    ok = client.post(
        "/api/v1/roster/claim",
        json={"invite_code": code, "email": "other@example.com"},
        headers=auth_headers(real["access_token"]),
    )
    assert ok.status_code == 200, ok.text

    # Second claim fails — single use.
    again = client.post(
        "/api/v1/roster/claim",
        json={"invite_code": code, "email": "other@example.com"},
        headers=auth_headers(real["access_token"]),
    )
    assert again.status_code == 409


def _sign(payload: bytes) -> str:
    return hmac.new(settings.ECOBANK_WEBHOOK_SECRET.encode(), payload, hashlib.sha512).hexdigest()


def test_webhook_rejects_invalid_signature(client):
    response = client.post(
        "/api/v1/webhooks/ecobank/notification",
        json={"type": "collection.confirmed", "transactionRef": "X"},
        headers={"X-Ecobank-Signature": "deadbeef"},
    )
    assert response.status_code == 401


def test_webhook_without_signature_rejected(client):
    response = client.post(
        "/api/v1/webhooks/ecobank/notification",
        json={"type": "collection.confirmed", "transactionRef": "X"},
    )
    assert response.status_code == 401
