"""Payments + receipt + ledger tests — the demo's non-negotiable core."""

import uuid

from tests.conftest import auth_headers, register_and_login


def _setup_member_and_cycle(client, treasurer, association):
    headers = auth_headers(treasurer["tokens"]["access_token"])
    # Create a dues cycle.
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

    # Upload a one-person roster.
    # Unique per test run: the test schema persists across tests in a session.
    member_email = f"ada.obi-{uuid.uuid4().hex[:8]}@example.com"
    csv_content = f"name,email,matric_number\nAda Obi,{member_email},CSC/2023/011\n"
    upload = client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", csv_content.encode(), "text/csv")},
        headers=headers,
    )
    assert upload.status_code == 200, upload.text
    invite_code = upload.json()["invites"][0]["invite_code"]

    # The member registers and claims with matching email.
    member_tokens = register_and_login(client, member_email, name="Ada Obi")
    claim = client.post(
        "/api/v1/roster/claim",
        json={"invite_code": invite_code, "email": member_email},
        headers=auth_headers(member_tokens["access_token"]),
    )
    assert claim.status_code == 200, claim.text
    return cycle, member_tokens


def test_payment_lands_on_ledger_with_verified_receipt(client, treasurer, association):
    """End-to-end: pay → Ecobank collection (mock) → receipt → ledger → live flag."""
    cycle, member_tokens = _setup_member_and_cycle(client, treasurer, association)
    idempotency_key = f"pay-{uuid.uuid4().hex[:16]}"

    payment = client.post(
        f"/api/v1/dues-cycles/{cycle['id']}/pay",
        json={"paid_via": "blaze", "idempotency_key": idempotency_key},
        headers=auth_headers(member_tokens["access_token"]),
    )
    assert payment.status_code == 200, payment.text
    payment = payment.json()
    assert payment["status"] == "success"
    assert payment["receipt_hash"]

    # Receipt verification: recomputed hash must match stored hash.
    receipt = client.get(
        f"/api/v1/payments/{payment['id']}/receipt",
        headers=auth_headers(member_tokens["access_token"]),
    )
    assert receipt.status_code == 200, receipt.text
    receipt = receipt.json()
    assert receipt["verified"] is True, "receipt hash must recompute exactly"

    # The ledger now shows the inflow with an updated running balance.
    ledger = client.get(
        f"/api/v1/associations/{association['id']}/ledger",
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    assert ledger.status_code == 200
    ledger = ledger.json()
    assert ledger["total"] == 1
    assert ledger["items"][0]["type"] == "inflow"
    assert ledger["items"][0]["amount"] == "2500.00"
    assert ledger["balance"] == "2500.00"


def test_payment_idempotency_same_key_returns_same_payment(client, treasurer, association):
    cycle, member_tokens = _setup_member_and_cycle(client, treasurer, association)
    key = f"pay-{uuid.uuid4().hex[:16]}"
    headers = auth_headers(member_tokens["access_token"])

    first = client.post(
        f"/api/v1/dues-cycles/{cycle['id']}/pay",
        json={"paid_via": "blaze", "idempotency_key": key},
        headers=headers,
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/v1/dues-cycles/{cycle['id']}/pay",
        json={"paid_via": "blaze", "idempotency_key": key},
        headers=headers,
    )
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"], "retry must not double-charge"

    # Only one ledger entry despite the retry.
    ledger = client.get(
        f"/api/v1/associations/{association['id']}/ledger",
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    assert ledger.json()["total"] == 1


def test_manual_payment_marks_roster_member_paid(client, treasurer, association):
    headers = auth_headers(treasurer["tokens"]["access_token"])
    client.post(
        f"/api/v1/associations/{association['id']}/dues-cycles",
        json={"title": "Dues", "amount": 2000, "deadline": "2026-12-31T00:00:00Z"},
        headers=headers,
    ).json()

    csv_content = "name,email,matric_number\nBola Ade,bola@example.com,CSC/2023/012\n"
    client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", csv_content.encode(), "text/csv")},
        headers=headers,
    )
    # roster endpoint gives ids
    roster = client.get(f"/api/v1/associations/{association['id']}/roster", headers=headers)
    items = roster.json()["items"]
    member_id = items[0]["id"]

    marked = client.post(
        f"/api/v1/associations/{association['id']}/roster/{member_id}/mark-paid",
        json={"amount": 2000},
        headers=headers,
    )
    assert marked.status_code == 200, marked.text

    roster_after = client.get(f"/api/v1/associations/{association['id']}/roster", headers=headers)
    assert roster_after.json()["items"][0]["paid"] is True

    ledger = client.get(f"/api/v1/associations/{association['id']}/ledger", headers=headers)
    assert ledger.json()["balance"] == "2000.00"


def test_unclaimed_user_cannot_pay(client, treasurer, association):
    cycle = client.post(
        f"/api/v1/associations/{association['id']}/dues-cycles",
        json={"title": "Dues", "amount": 2000, "deadline": "2026-12-31T00:00:00Z"},
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    ).json()
    outsider = register_and_login(client, f"no-roster-{uuid.uuid4().hex[:8]}@example.com")
    response = client.post(
        f"/api/v1/dues-cycles/{cycle['id']}/pay",
        json={"paid_via": "blaze", "idempotency_key": f"pay-{uuid.uuid4().hex[:16]}"},
        headers=auth_headers(outsider["access_token"]),
    )
    assert response.status_code == 403
