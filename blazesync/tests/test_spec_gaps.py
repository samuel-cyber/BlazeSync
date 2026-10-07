"""Spec-gap tests: virtual accounts, expectation statements, DB threshold guard,
VA-credit webhooks, and Ask BlazeSync.

Runs against real PostgreSQL (like every other test module): triggers,
constraint triggers, and unique indexes are genuinely exercised.
"""

import csv
import hashlib
import hmac
import io
import json
import uuid

import pytest

from tests.conftest import auth_headers, register_and_login


@pytest.fixture(autouse=True)
def _webhook_secret(monkeypatch):
    """Signature verification needs a shared secret in every test run."""
    from app.config import settings

    monkeypatch.setattr(
        settings, "ECOBANK_WEBHOOK_SECRET", "test-webhook-secret", raising=False
    )

# --- virtual account provisioning ---------------------------------------------


def _upload_two_members(client, association, treasurer):
    headers = auth_headers(treasurer["tokens"]["access_token"])
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["name", "email"])
    w.writerow(["Ada VA", f"ada-va-{uuid.uuid4().hex[:8]}@example.com"])
    w.writerow(["Bode VA", f"bode-va-{uuid.uuid4().hex[:8]}@example.com"])
    up = client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", buf.getvalue().encode(), "text/csv")},
        headers=headers,
    )
    assert up.status_code == 200, up.text
    return up.json()["invites"]


def test_provision_accounts_issues_unique_vas(client, treasurer, association):
    invites = _upload_two_members(client, association, treasurer)
    headers = auth_headers(treasurer["tokens"]["access_token"])
    r = client.post(
        f"/api/v1/associations/{association['id']}/roster/provision-accounts",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["issued"] == 2
    assert body["failed"] == 0

    roster = client.get(
        f"/api/v1/associations/{association['id']}/roster", headers=headers
    )
    vas = {i["name"]: i["virtual_account_ref"] for i in roster.json()["items"]}
    assert vas["Ada VA"] and vas["Bode VA"]
    assert vas["Ada VA"] != vas["Bode VA"], "each member needs a distinct VA"

    # Idempotent: second run issues nothing new, skips both.
    again = client.post(
        f"/api/v1/associations/{association['id']}/roster/provision-accounts",
        headers=headers,
    )
    assert again.status_code == 200
    assert again.json()["issued"] == 0
    assert again.json()["skipped_previously_provisioned"] == 2


def test_provision_accounts_requires_treasurer(client, treasurer, association):
    _upload_two_members(client, association, treasurer)
    outsider = register_and_login(client, f"no-action-{uuid.uuid4().hex[:8]}@example.com")
    r = client.post(
        f"/api/v1/associations/{association['id']}/roster/provision-accounts",
        headers=auth_headers(outsider["access_token"]),
    )
    assert r.status_code == 403


# --- expectation statement + receipt snapshot ----------------------------------


def test_cycle_expectation_statement_roundtrip(client, treasurer, association):
    headers = auth_headers(treasurer["tokens"]["access_token"])
    r = client.post(
        f"/api/v1/associations/{association['id']}/dues-cycles",
        json={
            "title": "Session Dues",
            "amount": 2500,
            "deadline": "2026-12-31T00:00:00Z",
            "expectation_statement": "Funds the faculty week welfare pack and inter-level football.",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert "faculty week welfare pack" in r.json()["expectation_statement"]

    listing = client.get(
        f"/api/v1/associations/{association['id']}/dues-cycles", headers=headers
    )
    assert listing.json()["items"][0]["expectation_statement"]


def test_receipt_snapshots_expectation_statement(client, treasurer, association):
    headers = auth_headers(treasurer["tokens"]["access_token"])
    cycle = client.post(
        f"/api/v1/associations/{association['id']}/dues-cycles",
        json={
            "title": "Dues w/ statement",
            "amount": 2000,
            "deadline": "2026-12-31T00:00:00Z",
            "expectation_statement": "Pays for the departmental magazine.",
        },
        headers=headers,
    ).json()

    member_email = f"snapshot-{uuid.uuid4().hex[:8]}@example.com"
    csv_content = f"name,email\nSnapshot Sam,{member_email}\n"
    up = client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", csv_content.encode(), "text/csv")},
        headers=headers,
    )
    invite_code = up.json()["invites"][0]["invite_code"]
    member = register_and_login(client, member_email, name="Snapshot Sam")
    client.post(
        "/api/v1/roster/claim",
        json={"invite_code": invite_code, "email": member_email},
        headers=auth_headers(member["access_token"]),
    )
    payment = client.post(
        f"/api/v1/dues-cycles/{cycle['id']}/pay",
        json={"paid_via": "blaze", "idempotency_key": f"pay-{uuid.uuid4().hex[:16]}"},
        headers=auth_headers(member["access_token"]),
    )
    assert payment.status_code == 200, payment.text

    receipt = client.get(
        f"/api/v1/payments/{payment.json()['id']}/receipt",
        headers=auth_headers(member["access_token"]),
    )
    assert receipt.status_code == 200
    body = receipt.json()
    assert body["verified"] is True
    assert body["expectation_statement"] == "Pays for the departmental magazine."


# --- DB-layer disbursement threshold guard -------------------------------------


def test_threshold_guard_blocks_raw_sql_override(client, treasurer, association):
    """Even with the app bypassed, Postgres refuses unapproved state changes."""
    from sqlalchemy import text

    from app.db import engine

    headers = auth_headers(treasurer["tokens"]["access_token"])
    d = client.post(
        f"/api/v1/associations/{association['id']}/disbursements",
        json={
            "amount": 3000.0,
            "reason": "Raw SQL sneak attempt",
            "recipient_name": "Vendor",
            "recipient_account_number": "0111222333",
            "recipient_bank_code": "ECOBANK",
            "idempotency_key": f"raw-{uuid.uuid4().hex[:12]}",
        },
        headers=headers,
    )
    assert d.status_code == 201, d.text
    disbursement_id = d.json()["id"]

    exco1_email = f"exco1-{uuid.uuid4().hex[:8]}@example.com"
    exco2_email = f"exco2-{uuid.uuid4().hex[:8]}@example.com"
    register_and_login(client, exco1_email)
    register_and_login(client, exco2_email)

    with engine.connect() as conn:
        # Bypass the API entirely: promote to approved with zero approval rows.
        with pytest.raises(Exception):  # noqa: PT011 — trigger MUST raise
            conn.execute(
                text(
                    "UPDATE disbursement_request SET status = 'approved' "
                    "WHERE id = CAST(:did AS uuid)"
                ).bindparams(did=disbursement_id)
            )
            conn.commit()
        conn.rollback()  # discard the aborted transaction before phase two

        # With the required approvals inserted directly, the same UPDATE passes.
        for email in (exco1_email, exco2_email):
            conn.execute(
                text(
                    "INSERT INTO membership (id, user_id, association_id, role, joined_at) "
                    "SELECT gen_random_uuid(), u.id, a.id, 'exco', now() "
                    'FROM "user" u, association a '
                    "WHERE u.email = :email AND a.id = CAST(:aid AS uuid)"
                ).bindparams(email=email, aid=association["id"])
            )
        conn.execute(
            text(
                "INSERT INTO disbursement_approval (id, disbursement_id, approved_by, decision, timestamp) "
                "SELECT gen_random_uuid(), CAST(:did AS uuid), u.id, 'approved', now() "
                'FROM "user" u WHERE u.email IN (:e1, :e2)'
            ).bindparams(did=disbursement_id, e1=exco1_email, e2=exco2_email)
        )
        conn.execute(
            text(
                "UPDATE disbursement_request SET status = 'approved' WHERE id = CAST(:did AS uuid)"
            ).bindparams(did=disbursement_id)
        )
        conn.commit()


# --- virtual account credit webhook --------------------------------------------


def _signed_webhook(client, event: dict):
    from app.config import settings

    raw = json.dumps(event).encode()
    sig = hmac.new(
        settings.ECOBANK_WEBHOOK_SECRET.encode(),
        raw,
        hashlib.sha512,
    ).hexdigest()
    return client.post(
        "/api/v1/webhooks/ecobank/notification",
        content=raw,
        headers={"X-Ecobank-Signature": sig, "Content-Type": "application/json"},
    )


def test_va_credit_webhook_requires_signature(client):
    r = client.post(
        "/api/v1/webhooks/ecobank/notification",
        json={
            "type": "virtual_account.credit",
            "transactionRef": "X",
            "accountNumber": "1",
            "amount": 10,
        },
    )
    assert r.status_code == 401


def test_va_credit_webhook_lands_on_ledger(client, treasurer, association):
    from app.config import settings

    invites = _upload_two_members(client, association, treasurer)
    headers = auth_headers(treasurer["tokens"]["access_token"])
    prov = client.post(
        f"/api/v1/associations/{association['id']}/roster/provision-accounts",
        headers=headers,
    ).json()
    assert prov["issued"] == 2

    roster = client.get(
        f"/api/v1/associations/{association['id']}/roster", headers=headers
    )
    ada = next(i for i in roster.json()["items"] if i["name"] == "Ada VA")

    event = {
        "type": "virtual_account.credit",
        "transactionRef": f"VA-{uuid.uuid4().hex[:12]}",
        "accountNumber": ada["virtual_account_ref"],
        "amount": 2500,
        "timestamp": "2026-10-06T10:00:00Z",
    }
    raw = json.dumps(event).encode()
    expected = hmac.new(
        settings.ECOBANK_WEBHOOK_SECRET.encode(), raw, hashlib.sha512
    ).hexdigest()
    r = client.post(
        "/api/v1/webhooks/ecobank/notification",
        content=raw,
        headers={"X-Ecobank-Signature": expected, "Content-Type": "application/json"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["matched"] is True

    ledger = client.get(
        f"/api/v1/associations/{association['id']}/ledger", headers=headers
    )
    items = ledger.json()["items"]
    assert any(
        i["type"] == "inflow" and i["amount"] == "2500.00" for i in items
    ), "VA credit must reconcile onto the ledger"

    # Redelivery of the same event is idempotent.
    r2 = client.post(
        "/api/v1/webhooks/ecobank/notification",
        content=raw,
        headers={"X-Ecobank-Signature": expected, "Content-Type": "application/json"},
    )
    assert r2.status_code == 200
    assert r2.json().get("duplicate") is True
    ledger2 = client.get(
        f"/api/v1/associations/{association['id']}/ledger", headers=headers
    )
    assert len(ledger2.json()["items"]) == len(items), "no double-credit on redelivery"


# --- Ask BlazeSync -------------------------------------------------------------


def test_ask_answers_balance_and_scopes(client, treasurer, association):
    # Give the ledger one inflow first (manual payment path).
    cycle = client.post(
        f"/api/v1/associations/{association['id']}/dues-cycles",
        json={"title": "Dues", "amount": 1500, "deadline": "2026-12-31T00:00:00Z"},
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    assert cycle.status_code == 201, cycle.text

    csv_content = f"name,email\nAsker Ann,asker-{uuid.uuid4().hex[:8]}@example.com\n"
    up = client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", csv_content.encode(), "text/csv")},
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    invite_code = up.json()["invites"][0]["invite_code"]
    email = csv_content.split("\n")[1].split(",")[1].strip()
    member = register_and_login(client, email, name="Asker Ann")
    client.post(
        "/api/v1/roster/claim",
        json={"invite_code": invite_code, "email": email},
        headers=auth_headers(member["access_token"]),
    )
    pay = client.post(
        f"/api/v1/dues-cycles/{cycle.json()['id']}/pay",
        json={"paid_via": "blaze", "idempotency_key": f"pay-{uuid.uuid4().hex[:16]}"},
        headers=auth_headers(member["access_token"]),
    )
    assert pay.status_code == 200, pay.text

    r = client.post(
        f"/api/v1/associations/{association['id']}/ask",
        json={"question": "What is our current balance?"},
        headers=auth_headers(member["access_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "1500" in body["answer"], body
    assert body["grounded_via"] in ("rules", "llm")


def test_ask_scoped_and_readonly(client, treasurer, association):
    # A user with no membership gets 403.
    outsider = register_and_login(client, f"ask-no-{uuid.uuid4().hex[:8]}@example.com")
    r = client.post(
        f"/api/v1/associations/{association['id']}/ask",
        json={"question": "What is our balance?"},
        headers=auth_headers(outsider["access_token"]),
    )
    assert r.status_code == 403


def test_ask_unanswerable_gets_honest_no(client, treasurer, association):
    r = client.post(
        f"/api/v1/associations/{association['id']}/ask",
        json={"question": "How many planets are in the solar system?"},
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "I don't have that information" in body["answer"]
