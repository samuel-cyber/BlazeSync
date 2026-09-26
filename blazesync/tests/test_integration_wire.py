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


def test_invite_preview_public(client, treasurer, association):
    headers = {"Authorization": f"Bearer {treasurer['tokens']['access_token']}"}
    import csv as _csv
    import io as _io

    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["name", "email"])
    w.writerow(["Ada Obi", "ada@example.com"])
    buf.seek(0)
    up = client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", buf.getvalue().encode(), "text/csv")},
        headers=headers,
    )
    assert up.status_code == 200, up.text
    code = up.json()["invites"][0]["invite_code"]
    r = client.get(f"/api/v1/invites/{code}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Ada Obi"
    assert body["association"]["id"] == association["id"]
    assert "email" not in body and "phone" not in body


def test_patch_association_threshold(client, treasurer, association):
    headers = {"Authorization": f"Bearer {treasurer['tokens']['access_token']}"}
    r = client.patch(
        f"/api/v1/associations/{association['id']}",
        json={"approval_threshold": 3},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["approval_threshold"] == 3
    # Below the two-signature floor is refused.
    r2 = client.patch(
        f"/api/v1/associations/{association['id']}",
        json={"approval_threshold": 1},
        headers=headers,
    )
    assert r2.status_code == 422


def test_roster_level_roundtrip(client, treasurer, association):
    """CSV level column survives import and shows up on the roster view."""
    headers = {"Authorization": f"Bearer {treasurer['tokens']['access_token']}"}
    csv = "name,matric_number,email,phone,level\nAda Obi,260805001,ada2@example.com,08030001122,100L\n"
    up = client.post(
        f"/api/v1/associations/{association['id']}/roster/upload",
        files={"file": ("roster.csv", csv.encode(), "text/csv")},
        headers=headers,
    )
    assert up.status_code == 200, up.text
    r = client.get(f"/api/v1/associations/{association['id']}/roster", headers=headers)
    assert r.status_code == 200, r.text
    item = next(i for i in r.json()["items"] if i["name"] == "Ada Obi")
    assert item["level"] == "100L"


def test_cycle_per_level_roundtrip(client, treasurer, association):
    """A cycle can carry per-level pricing and reports it back on the wire."""
    import datetime as dt

    headers = {"Authorization": f"Bearer {treasurer['tokens']['access_token']}"}
    body = {
        "title": "Dues 2026",
        "amount": 5000.0,
        "deadline": (dt.datetime.now(dt.UTC) + dt.timedelta(days=30)).isoformat(),
        "per_level": {"100L": 3000.0, "300L": 5000.0},
    }
    r = client.post(f"/api/v1/associations/{association['id']}/dues-cycles", json=body, headers=headers)
    assert r.status_code == 201, r.text
    cycle = r.json()
    assert cycle["per_level"] == {"100L": "3000.0", "300L": "5000.0"}
    listing = client.get(f"/api/v1/associations/{association['id']}/dues-cycles", headers=headers)
    assert listing.status_code == 200
    assert listing.json()["items"][0]["per_level"] is not None
