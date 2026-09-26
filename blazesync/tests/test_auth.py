"""Auth + RBAC tests."""

import uuid

from tests.conftest import auth_headers, register_and_login


def test_register_login_refresh_logout(client):
    email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    tokens = register_and_login(client, email)

    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    new_tokens = refreshed.json()
    assert new_tokens["access_token"] != tokens["access_token"]

    # The old refresh token must now be revoked (rotation).
    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 401

    # New refresh token works, then logout revokes it.
    logout = client.post("/api/v1/auth/logout", json={"refresh_token": new_tokens["refresh_token"]})
    assert logout.status_code == 200
    after = client.post("/api/v1/auth/refresh", json={"refresh_token": new_tokens["refresh_token"]})
    assert after.status_code == 401


def test_login_rejects_wrong_password(client):
    email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    register_and_login(client, email, password="correct-horse-9")
    response = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "wrong-password"}
    )
    assert response.status_code == 401


def test_duplicate_email_rejected(client):
    email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    register_and_login(client, email)
    response = client.post(
        "/api/v1/auth/register",
        json={"name": "Second", "email": email, "password": "password-123"},
    )
    assert response.status_code == 409


def test_protected_endpoint_requires_token(client):
    response = client.get("/api/v1/associations/00000000-0000-0000-0000-000000000000")
    assert response.status_code in (401, 403)


def test_member_cannot_call_officer_endpoints(client, treasurer, association):
    """RBAC is association-scoped: a plain member gets 403 on officer routes."""
    outsider_tokens = register_and_login(client, f"member-{uuid.uuid4().hex[:8]}@example.com")
    headers = auth_headers(outsider_tokens["access_token"])

    # Not a member at all → 403 on roster view.
    roster = client.get(f"/api/v1/associations/{association['id']}/roster", headers=headers)
    assert roster.status_code == 403

    # Creating a dues cycle requires treasurer → 403.
    cycle = client.post(
        f"/api/v1/associations/{association['id']}/dues-cycles",
        json={"title": "Dues", "amount": 2000, "deadline": "2026-12-01T00:00:00Z"},
        headers=headers,
    )
    assert cycle.status_code == 403
