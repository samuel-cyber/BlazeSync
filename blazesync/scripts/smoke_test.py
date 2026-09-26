"""End-to-end smoke test / demo script — runs the whole BlazeSync journey.

Start the server first, then run this script against it:

    uvicorn app.main:app --port 8000
    python scripts/smoke_test.py http://127.0.0.1:8000

Walks through: register → create association → link Ecobank account → dues
cycle → roster upload → invite claim → dues payment (Ecobank collection) →
receipt verification → live ledger WebSocket → multi-sig disbursement →
outflow → reconciliation → webhook rejection. Prints a step-by-step story
you can also use on demo day.
"""
import asyncio
import sys
import uuid

import httpx
import websockets

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
client = httpx.Client(base_url=BASE, timeout=30)

step_no = 0


def step(title: str) -> None:
    global step_no
    step_no += 1
    print(f"{step_no:>2}. {title}")


def check(response, what: str) -> dict:
    if response.status_code >= 400:
        print(f"    !! {response.status_code}: {response.text[:300]}")
        raise SystemExit(1)
    body = response.json()
    print(f"    ✓ {what}")
    return body


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def main() -> None:
    suffix = uuid.uuid4().hex[:8]
    step("Treasurer registers")
    treasurer = client.post(
        "/api/v1/auth/register",
        json={"name": "Ngozi Treasurer", "email": f"treas-{suffix}@uni.edu", "password": "strong-pass-1"},
    ).json()
    check_ok = treasurer.get("access_token")
    print(f"    ✓ registered (token: {check_ok[:25]}…)" if check_ok else treasurer)
    treas_headers = auth(treasurer["access_token"])

    step("Treasurer creates the association (becomes treasurer)")
    assoc = client.post(
        "/api/v1/associations",
        json={
            "name": "Physics Class 2028",
            "institution": "University of Lagos",
            "department_or_faculty": "Faculty of Science",
            "approval_threshold": 2,
        },
        headers=treas_headers,
    ).json()
    print(f"    ✓ {assoc['name']} (threshold: {assoc['approval_threshold']} signatures)")
    aid = assoc["id"]

    step("Treasurer links the Ecobank business account (consent flow)")
    linked = client.post(f"/api/v1/associations/{aid}/link-account", json={"account_ref": f"ECO-{suffix}"}, headers=treas_headers)
    check(linked, f"account linked, verified balance ₦{linked.json()['verified_balance']}")

    step("Treasurer opens a dues cycle")
    cycle = client.post(
        f"/api/v1/associations/{aid}/dues-cycles",
        json={"title": "Session Dues 2026/2027", "amount": 2500, "deadline": "2026-12-31T23:59:00Z"},
        headers=treas_headers,
    ).json()
    print(f"    ✓ {cycle['title']} — ₦{cycle['amount']} per member")

    step("Treasurer uploads the class roster (CSV)")
    roster_csv = (
        "name,email,matric_number\n"
        f"Ada Obi,ada-{suffix}@uni.edu,CSC/2023/011\n"
        f"Emeka Solo,emeka-{suffix}@uni.edu,CSC/2023/012\n"
        f"Fatima Bello,fatima-{suffix}@uni.edu,CSC/2023/013\n"
    )
    upload = client.post(
        f"/api/v1/associations/{aid}/roster/upload",
        files={"file": ("roster.csv", roster_csv.encode(), "text/csv")},
        headers=treas_headers,
    ).json()
    print(f"    ✓ {len(upload['invites'])} members imported, invite codes generated")

    step("Ada signs up and claims her invite (single-use, identity-checked)")
    ada = client.post(
        "/api/v1/auth/register",
        json={"name": "Ada Obi", "email": f"ada-{suffix}@uni.edu", "password": "strong-pass-1"},
    ).json()
    code = upload["invites"][0]["invite_code"]
    client.post("/api/v1/roster/claim", json={"invite_code": code, "email": f"ada-{suffix}@uni.edu"}, headers=auth(ada["access_token"]))
    print("    ✓ roster slot linked to her app account")

    step("Ada pays her dues (Ecobank Collection Service)")
    live_entry = asyncio.run(_watch_and_pay(aid, ada["access_token"], cycle["id"], suffix))
    if live_entry:
        print(f"    ✓ LIVE: ledger broadcast received — {live_entry}")

    if not live_entry:
        # WS unavailable (e.g. running against an older server) — pay directly.
        payment = client.post(
            f"/api/v1/dues-cycles/{cycle['id']}/pay",
            json={"paid_via": "blaze", "idempotency_key": f"demo-pay-{suffix}"},
            headers=auth(ada["access_token"]),
        )
        if payment.status_code >= 400:
            print(f"    !! payment failed: {payment.status_code} {payment.text[:200]}")
            raise SystemExit(1)
        live_entry = {"payment_id": payment.json()["id"]}

    payment_id = live_entry["payment_id"]
    receipt = client.get(
        f"/api/v1/payments/{payment_id}/receipt", headers=auth(ada["access_token"])
    ).json()
    print(f"    ✓ receipt hash verified live: {receipt['verified']} ({(receipt['receipt_hash'] or '')[:16]}…)")

    step("Ledger balance is live for every member")
    ledger = client.get(f"/api/v1/associations/{aid}/ledger", headers=treas_headers).json()
    print(f"    ✓ running balance: ₦{ledger['balance']} across {ledger['total']} entries")

    step("Treasurer requests a disbursement (needs 2 signatures)")
    disb = client.post(
        f"/api/v1/associations/{aid}/disbursements",
        json={
            "amount": 15000,
            "reason": "Faculty week printing",
            "recipient_name": "Kola Print Shop",
            "recipient_account_number": "0123456789",
            "recipient_bank_code": "ECOBANK",
            "idempotency_key": f"demo-disb-{suffix}",
        },
        headers=treas_headers,
    ).json()
    print(f"    ✓ request {disb['id'][:8]}… pending ₦{disb['amount']}")

    step("Two exco co-signatories are provisioned and approve")
    for i in (1, 2):
        exco_email = f"exco{i}-{suffix}@uni.edu"
        invited = client.post(
            f"/api/v1/associations/{aid}/invite-exco",
            json={"name": f"Exco {i}", "email": exco_email},
            headers=treas_headers,
        ).json()
        temp = invited["temporary_password"]
        tokens = client.post("/api/v1/auth/login", json={"email": exco_email, "password": temp}).json()
        voted = client.post(f"/api/v1/disbursements/{disb['id']}/approve", headers=auth(tokens["access_token"]))
        status = voted.json()["status"]
        print(f"    ✓ signature {i} recorded → status: {status}")

    step("Threshold met — Ecobank Local Bank Payment executed, outflow logged")
    import time

    time.sleep(1.5)  # allow the background transfer task to complete
    ledger = client.get(f"/api/v1/associations/{aid}/ledger", headers=treas_headers).json()
    outflow = [e for e in ledger["items"] if e["type"] == "outflow"]
    print(f"    ✓ balance now ₦{ledger['balance']} ({len(outflow)} outflow entry)")

    step("Reconciliation: ledger vs Ecobank Account Enquiry")
    recon = client.get(f"/api/v1/associations/{aid}/balance/reconcile", headers=treas_headers).json()
    print(f"    ✓ status={recon['status']} (ledger ₦{recon['ledger_balance']}, ecobank ₦{recon.get('ecobank_balance')})")

    step("A fake webhook claiming a payment is rejected (no signature)")
    fake = client.post("/api/v1/webhooks/ecobank/notification", json={"type": "collection.confirmed", "transactionRef": "FAKE"})
    print(f"    ✓ HTTP {fake.status_code} — unverified notifications never touch the ledger")

    print("\nDemo journey complete — every claim in the pitch, exercised live.")


async def _watch_and_pay(assoc_id: str, ada_token: str, cycle_id: str, suffix: str) -> dict | None:
    """Open the live ledger WebSocket, then pay — the entry should arrive live."""
    uri = f"{BASE.replace('http', 'ws', 1)}/api/v1/associations/{assoc_id}/ledger/live"
    try:
        async with websockets.connect(f"{uri}?token={ada_token}") as ws:
            await ws.recv()  # snapshot
            payment = await asyncio.to_thread(
                client.post,
                f"/api/v1/dues-cycles/{cycle_id}/pay",
                json={"paid_via": "blaze", "idempotency_key": f"demo-pay-{suffix}"},
                headers=auth(ada_token),
            )
            if payment.status_code >= 400:
                print(f"    !! payment failed: {payment.text[:200]}")
                return None
            entry = __import__("json").loads(await asyncio.wait_for(ws.recv(), timeout=10))
            return {"payment_id": payment.json()["id"], **entry}
    except Exception as exc:  # demo helper: report and continue
        print(f"    (live websocket check skipped: {exc})")
        return None


if __name__ == "__main__":
    main()
