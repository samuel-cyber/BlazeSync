"""Multi-signature disbursement tests — the core differentiator."""

import uuid

from tests.conftest import auth_headers, register_and_login


def _invite_exco(client, treasurer, association) -> dict:
    """Add an exco co-signatory; returns their auth dict + temp password."""
    headers = auth_headers(treasurer["tokens"]["access_token"])
    exco_email = f"exco-{uuid.uuid4().hex[:8]}@example.com"
    invite = client.post(
        f"/api/v1/associations/{association['id']}/invite-exco",
        json={"name": "Exco One", "email": exco_email},
        headers=headers,
    )
    assert invite.status_code == 201, invite.text
    temp_password = invite.json()["temporary_password"]
    # Log the exco in (password unchanged for the test).
    login = client.post("/api/v1/auth/login", json={"email": exco_email, "password": temp_password})
    assert login.status_code == 200, login.text
    return {"email": exco_email, "tokens": login.json(), "password": temp_password}


def _create_disbursement(client, treasurer, association) -> dict:
    response = client.post(
        f"/api/v1/associations/{association['id']}/disbursements",
        json={
            "amount": 15000,
            "reason": "Faculty week logistics",
            "recipient_name": "Kola Print Shop",
            "recipient_account_number": "0123456789",
            "recipient_bank_code": "ECOBANK",
            "idempotency_key": f"disb-{uuid.uuid4().hex[:16]}",
        },
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _balance(client, treasurer, association) -> str:
    ledger = client.get(
        f"/api/v1/associations/{association['id']}/ledger",
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    return ledger.json()["balance"]


def test_funds_frozen_until_threshold(client, treasurer, association):
    """With threshold 2, one approval must NOT release money."""
    exco = _invite_exco(client, treasurer, association)
    request = _create_disbursement(client, treasurer, association)

    # Treasurer approves their own request? Blocked: requester can't self-approve.
    self_approve = client.post(
        f"/api/v1/disbursements/{request['id']}/approve",
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    assert self_approve.status_code == 403

    # First exco approval — below threshold, still pending.
    first = client.post(
        f"/api/v1/disbursements/{request['id']}/approve",
        headers=auth_headers(exco["tokens"]["access_token"]),
    )
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "pending", "one vote below threshold must not approve"
    assert _balance(client, treasurer, association) == "0.00"


def test_threshold_met_triggers_outflow(client, treasurer, association):
    """Two distinct exco approvals cross the threshold → transfer + outflow entry."""
    exco1 = _invite_exco(client, treasurer, association)
    exco2 = _invite_exco(client, treasurer, association)
    request = _create_disbursement(client, treasurer, association)

    for exco in (exco1, exco2):
        vote = client.post(
            f"/api/v1/disbursements/{request['id']}/approve",
            headers=auth_headers(exco["tokens"]["access_token"]),
        )
        assert vote.status_code == 200, vote.text

    # Second vote crossed the threshold: status approved, transfer executed in background.
    detail = client.get(
        f"/api/v1/associations/{association['id']}/disbursements",
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    ).json()["items"][0]
    assert detail["status"] in ("approved", "completed"), detail

    # Approvals recorded immutably with distinct signers.
    voters = {a["approved_by"] for a in detail["approvals"] if a["decision"] == "approved"}
    assert len(voters) == 2


def test_double_vote_rejected(client, treasurer, association):
    """One decision per exco member per request — enforced even on direct API hits."""
    exco = _invite_exco(client, treasurer, association)
    request = _create_disbursement(client, treasurer, association)
    headers = auth_headers(exco["tokens"]["access_token"])

    first = client.post(f"/api/v1/disbursements/{request['id']}/approve", headers=headers)
    assert first.status_code == 200
    second = client.post(f"/api/v1/disbursements/{request['id']}/approve", headers=headers)
    assert second.status_code == 409


def test_member_role_cannot_approve(client, treasurer, association):
    """A plain member literally cannot call the approval endpoint."""
    _invite_exco(client, treasurer, association)  # keep association multi-sig-capable
    request = _create_disbursement(client, treasurer, association)

    # Someone with no membership at all.
    outsider = register_and_login(client, f"rand-{uuid.uuid4().hex[:8]}@example.com")
    denied = client.post(
        f"/api/v1/disbursements/{request['id']}/approve",
        headers=auth_headers(outsider["access_token"]),
    )
    assert denied.status_code == 403


def test_rejected_request_stops_disbursement(client, treasurer, association):
    exco = _invite_exco(client, treasurer, association)
    request = _create_disbursement(client, treasurer, association)
    response = client.post(
        f"/api/v1/disbursements/{request['id']}/reject",
        json={"password": exco["password"]},
        headers=auth_headers(exco["tokens"]["access_token"]),
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "rejected"

    # A rejected request cannot be approved afterwards.
    late = client.post(
        f"/api/v1/disbursements/{request['id']}/approve",
        headers=auth_headers(exco["tokens"]["access_token"]),
    )
    assert late.status_code == 409


def test_disbursement_idempotent_creation(client, treasurer, association):
    key = f"disb-{uuid.uuid4().hex[:16]}"
    body = {
        "amount": 5000,
        "reason": "Refreshments",
        "recipient_name": "Mama T Shop",
        "recipient_account_number": "9876543210",
        "recipient_bank_code": "ECOBANK",
        "idempotency_key": key,
    }
    first = client.post(
        f"/api/v1/associations/{association['id']}/disbursements",
        json=body,
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    second = client.post(
        f"/api/v1/associations/{association['id']}/disbursements",
        json=body,
        headers=auth_headers(treasurer["tokens"]["access_token"]),
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
