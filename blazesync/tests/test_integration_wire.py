"""Tests for GET /auth/me/memberships and GET /associations/{id}/audit."""

import uuid


def test_memberships_empty_and_after_create(client, treasurer, association):
    headers = {"Authorization": f"Bearer {treasurer['tokens']['access_token']}"}
    r = client.get("/api/v1/auth/me/memberships", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == treasurer["email"]
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["association_id"] == association["id"]
    assert item["role"] == "treasurer"
    assert item["account_linked"] is True
    assert item["name"] == association["name"]


def test_memberships_requires_auth(client):
    assert client.get("/api/v1/auth/me/memberships").status_code == 401


def test_audit_feed_lists_and_scopes(client, treasurer, association):
    headers = {"Authorization": f"Bearer {treasurer['tokens']['access_token']}"}
    # Actions so far: association_created + account_linked (both scoped here).
    r = client.get(f"/api/v1/associations/{association['id']}/audit", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 2
    actions = {i["action"] for i in body["items"]}
    assert "association_created" in actions
    assert "account_linked" in actions
    first = body["items"][0]
    assert first["actor_name"]
    assert isinstance(first["summary"], str)


def test_audit_feed_rejects_non_member(client, treasurer, association):
    other = client.post(
        "/api/v1/auth/register",
        json={"name": "Out Sider", "email": f"{uuid.uuid4().hex[:8]}@example.com", "password": "password-123"},
    )
    assert other.status_code == 201
    tok = other.json()["access_token"]
    r = client.get(
        f"/api/v1/associations/{association['id']}/audit",
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 403


def test_disbursement_wire_has_names(client, treasurer, association):
    import json as _json

    headers = {"Authorization": f"Bearer {treasurer['tokens']['access_token']}"}
    body = {
        "amount": 5000.0,
        "reason": "Printing handbills",
        "recipient_name": "Yaba Prints",
        "recipient_account_number": "0123456789",
        "recipient_bank_code": "ECOBANK",
        "idempotency_key": f"idem-{uuid.uuid4().hex[:12]}",
    }
    r = client.post(f"/api/v1/associations/{association['id']}/disbursements", json=body, headers=headers)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["requested_by_name"] == "Treasurer Test"
    assert d["approval_threshold"] == 2
    assert d["status"] == "pending"
