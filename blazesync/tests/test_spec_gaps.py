"""Spec-gap tests: account opening, direct-debit mandates, expectation
statements, the DB threshold guard, Ecobank notification webhooks, and Ask
BlazeSync.

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

# --- account opening + direct-debit mandates -----------------------------------


def _upload_two_members(client, association, treasurer):
    headers = auth_headers(treasurer["tokens"]["access_token"])
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["name", "email"])
    w.writerow(["Ada Acct", f"ada-acct-{uuid.uuid4().hex[:8]}@example.com"])
    w.writerow(["Bode Acct", f"bode-acct-{uuid.uuid4().hex[:8]}@example.com"])
    up = client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", buf.getvalue().encode(), "text/csv")},
        headers=headers,
    )
    assert up.status_code == 200, up.text
    return up.json()["invites"]


def _roster_items(client, association, treasurer) -> list[dict]:
    headers = auth_headers(treasurer["tokens"]["access_token"])
    roster = client.get(
        f"/api/v1/associations/{association['id']}/roster", headers=headers
    )
    assert roster.status_code == 200, roster.text
    return roster.json()["items"]


def test_open_accounts_issues_unique_accounts(client, treasurer, association):
    _upload_two_members(client, association, treasurer)
    headers = auth_headers(treasurer["tokens"]["access_token"])
    r = client.post(
        f"/api/v1/associations/{association['id']}/roster/open-accounts",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["opened"] == 2
    assert body["pending"] == 0

    items = _roster_items(client, association, treasurer)
    refs = {i["name"]: i["linked_account_ref"] for i in items}
    statuses = {i["name"]: i["account_status"] for i in items}
    assert refs["Ada Acct"] and refs["Bode Acct"]
    assert refs["Ada Acct"] != refs["Bode Acct"], "each member needs a distinct account"
    assert statuses["Ada Acct"] == "opened"

    # Idempotent: second run opens nothing new.
    again = client.post(
        f"/api/v1/associations/{association['id']}/roster/open-accounts",
        headers=headers,
    )
    assert again.status_code == 200
    assert again.json()["opened"] == 0
    assert again.json()["pending"] == 0


def test_open_accounts_requires_treasurer(client, treasurer, association):
    _upload_two_members(client, association, treasurer)
    outsider = register_and_login(client, f"no-action-{uuid.uuid4().hex[:8]}@example.com")
    r = client.post(
        f"/api/v1/associations/{association['id']}/roster/open-accounts",
        headers=auth_headers(outsider["access_token"]),
    )
    assert r.status_code == 403


def test_mandate_requires_opened_account(client, treasurer, association):
    _upload_two_members(client, association, treasurer)
    headers = auth_headers(treasurer["tokens"]["access_token"])
    ada = next(i for i in _roster_items(client, association, treasurer) if i["name"] == "Ada Acct")

    # No account yet → the mandate is refused.
    refused = client.post(
        f"/api/v1/member-records/{ada['id']}/authorize-direct-debit",
        headers=headers,
    )
    assert refused.status_code == 409

    # Open the account, then authorizing succeeds and is idempotent.
    opened = client.post(
        f"/api/v1/member-records/{ada['id']}/open-account", headers=headers
    )
    assert opened.status_code == 200, opened.text
    assert opened.json()["account_status"] == "opened"

    mandate = client.post(
        f"/api/v1/member-records/{ada['id']}/authorize-direct-debit", headers=headers
    )
    assert mandate.status_code == 200, mandate.text
    assert mandate.json()["status"] == "active"

    again = client.post(
        f"/api/v1/member-records/{ada['id']}/authorize-direct-debit", headers=headers
    )
    assert again.status_code == 200
    assert again.json()["mandate_ref"] == mandate.json()["mandate_ref"]


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


# --- direct-debit + account/mandate webhooks -----------------------------------


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


def _setup_payable_member(client, treasurer, association):
    """Cycle + one claimed roster member (claim auto-opens account + mandate)."""
    headers = auth_headers(treasurer["tokens"]["access_token"])
    cycle = client.post(
        f"/api/v1/associations/{association['id']}/dues-cycles",
        json={
            "title": "Session Dues 2026/2027",
            "amount": 2500,
            "deadline": "2026-12-31T00:00:00Z",
        },
        headers=headers,
    )
    assert cycle.status_code == 201, cycle.text
    cycle = cycle.json()

    member_email = f"dd-member-{uuid.uuid4().hex[:8]}@example.com"
    csv_content = f"name,email,matric_number\nAda DD,{member_email},CSC/2023/099\n"
    upload = client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", csv_content.encode(), "text/csv")},
        headers=headers,
    )
    assert upload.status_code == 200, upload.text
    invite_code = upload.json()["invites"][0]["invite_code"]

    member_tokens = register_and_login(client, member_email, name="Ada DD")
    claim = client.post(
        "/api/v1/roster/claim",
        json={"invite_code": invite_code, "email": member_email},
        headers=auth_headers(member_tokens["access_token"]),
    )
    assert claim.status_code == 200, claim.text
    return cycle, member_tokens


def test_direct_debit_webhook_requires_signature(client):
    r = client.post(
        "/api/v1/webhooks/ecobank/notification",
        json={"type": "direct_debit.confirmed", "transactionRef": "X", "amount": 10},
    )
    assert r.status_code == 401


def test_direct_debit_confirmation_completes_pending_payment(
    client, treasurer, association, monkeypatch
):
    from app.ecobank import DirectDebitResult
    from app.ecobank import client as ecobank_client

    # Force the asynchronous path: the provider accepts the pull but confirms
    # later by notification (mock mode settles synchronously by default).
    pending_ref = f"MOCK-DD-{uuid.uuid4().hex[:12].upper()}"

    def _pending(**_kwargs):
        return DirectDebitResult(
            success=True, transaction_ref=pending_ref, status="pending", message="awaiting"
        )

    monkeypatch.setattr(ecobank_client, "initiate_direct_debit_payment", _pending)

    cycle, member_tokens = _setup_payable_member(client, treasurer, association)
    pay = client.post(
        f"/api/v1/dues-cycles/{cycle['id']}/pay",
        json={"paid_via": "blaze", "idempotency_key": f"pay-{uuid.uuid4().hex[:16]}"},
        headers=auth_headers(member_tokens["access_token"]),
    )
    assert pay.status_code == 200, pay.text
    assert pay.json()["status"] == "pending", "async pulls stay pending until confirmed"

    event = {
        "type": "direct_debit.confirmed",
        "transactionRef": pending_ref,
        "amount": 2500,
        "timestamp": "2026-10-06T10:00:00Z",
    }
    r = _signed_webhook(client, event)
    assert r.status_code == 200, r.text
    assert r.json()["matched"] is True

    headers = auth_headers(treasurer["tokens"]["access_token"])
    ledger = client.get(
        f"/api/v1/associations/{association['id']}/ledger", headers=headers
    )
    items = ledger.json()["items"]
    assert any(
        i["type"] == "inflow" and i["amount"] == "2500.00" for i in items
    ), "direct-debit confirmation must reconcile onto the ledger"

    # Redelivery of the same event is idempotent.
    r2 = _signed_webhook(client, event)
    assert r2.status_code == 200
    assert r2.json().get("duplicate") is True
    ledger2 = client.get(
        f"/api/v1/associations/{association['id']}/ledger", headers=headers
    )
    assert len(ledger2.json()["items"]) == len(items), "no double-credit on redelivery"


def test_account_opened_webhook_completes_async_opening(
    client, treasurer, association, monkeypatch
):
    from app.ecobank import AccountOpeningResult
    from app.ecobank import client as ecobank_client

    def _pending(**_kwargs):
        return AccountOpeningResult(
            success=True, account_number=None, status="opening_pending", message="processing"
        )

    monkeypatch.setattr(ecobank_client, "open_account", _pending)

    _upload_two_members(client, association, treasurer)
    headers = auth_headers(treasurer["tokens"]["access_token"])
    r = client.post(
        f"/api/v1/associations/{association['id']}/roster/open-accounts",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["pending"] == 2

    ada = next(i for i in _roster_items(client, association, treasurer) if i["name"] == "Ada Acct")
    assert ada["account_status"] == "opening_pending"
    account_number = f"22{uuid.uuid4().hex[:8].upper()}"

    event = {
        "type": "account.opened",
        "reference": f"{association['id']}:{ada['id']}",
        "accountNumber": account_number,
    }
    resp = _signed_webhook(client, event)
    assert resp.status_code == 200, resp.text
    assert resp.json()["matched"] is True

    updated = next(
        i for i in _roster_items(client, association, treasurer) if i["id"] == ada["id"]
    )
    assert updated["account_status"] == "opened"
    assert updated["linked_account_ref"] == account_number


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
