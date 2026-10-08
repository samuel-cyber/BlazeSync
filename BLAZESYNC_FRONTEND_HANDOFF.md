# BlazeSync — Backend → Frontend Handoff

**Read this fully before writing code.** It documents the *actual implemented* backend — every path, auth rule, and response shape below was verified against the source code, not the original spec. When in doubt, the OpenAPI docs at `GET /docs` are the live source of truth (FastAPI auto-generates them from the code).

---

## 1. Build status (what already works)

| Area | Status |
|---|---|
| All data models + Postgres migrations (append-only trigger on ledger) | ✅ done |
| Auth (JWT access+refresh, rotation, revocation) + RBAC | ✅ done |
| Associations, account linking, exco invites | ✅ done |
| Roster upload (CSV/XLSX), invites, claim, manual payments | ✅ done |
| Dues cycles + payments (idempotent) + hashed receipts | ✅ done |
| Ledger feed + **WebSocket live updates** + reconciliation | ✅ done |
| Multi-sig disbursements (server-enforced threshold) | ✅ done |
| Ecobank webhook with HMAC signature verification | ✅ done |
| Backend test suite | ✅ 47/47 passing, lint clean |
| End-to-end smoke test (real HTTP incl. WebSocket) | ✅ passing |

**Ecobank layer**: fully built (SHA-512 `requestToken`/`secureHash` per the developer-portal formulas, bearer auth, retries with backoff, webhook HMAC verification). Known-answer unit tests verify the hashing formulas. **Without sandbox credentials it runs in deterministic MOCK mode** — every endpoint behaves as if Ecobank answered, so the entire product can be developed and demoed offline.

**You (frontend) do not need the backend running to start** — but you do need it for integration testing. Run it locally (§8) in mock mode.

---

## 2. Conventions (read first, they apply everywhere)

- **Base URL**: `http://localhost:8000` locally; all routes are prefixed `/api/v1`. Health check is `GET /api/health` (no `/v1`).
- **Auth header**: `Authorization: Bearer <access_token>` on every request except register/login/refresh/logout/webhook.
- **Money is always a string in responses**: `"2500.00"` — never a float. Request bodies take numbers (`amount: 2500`) or strings; the API converts.
- **All timestamps are ISO-8601 UTC** (e.g. `"2026-09-25T14:03:22.481271+00:00"`).
- **Errors**: FastAPI standard shape — `{"detail": "human-readable message"}` with proper status codes (401 unauthenticated, 403 wrong role/not member/not payer, 404, 409 conflict, 422 validation with a `detail` array).
- **No `DELETE` or `PUT` methods exist anywhere.** CORS allows `GET, POST, PATCH` only.
- **Enums are lowercase strings**: roles `treasurer | exco | member`; cycle status `active | closed`; payment `pending | success | failed`; channel `blaze | other | manual`; disbursement `pending | approved | rejected | completed`; invite `pending | sent | claimed | expired`; ledger `inflow | outflow`.
- **IDs are UUID strings.**
- **CORS**: origins come from the backend's `ALLOWED_ORIGINS` env var (comma-separated). Ask the backend owner to add your dev origin (`http://localhost:3000`) — or set it yourself in `blazesync/.env`.

---

## 3. Auth endpoints

### `POST /api/v1/auth/register` → 201
```json
{ "name": "Ada Obi", "email": "ada@uni.edu.ng", "phone": "+2348012345678", "password": "min 8 chars" }
```
→ `{ "access_token": "...", "refresh_token": "...", "token_type": "bearer", "expires_in": 900 }`
`409` if email/phone already registered. `expires_in` = access token lifetime in seconds.

### `POST /api/v1/auth/login` → same TokenPair body
`{ "email": "...", "password": "..." }` — `401` on bad credentials.

### `POST /api/v1/auth/refresh`
`{ "refresh_token": "..." }` → **new TokenPair**. Refresh tokens are single-use (rotated): store the new pair and discard the old refresh token. `401` if revoked/expired.

### `POST /api/v1/auth/logout`
`{ "refresh_token": "..." }` → `{ "ok": true }` (idempotent). Revokes that refresh token server-side.

**Frontend duty**: on any `401` from a data call, attempt one refresh then retry; if refresh fails, log out and route to login.

---

## 4. Associations

| Endpoint | Method | Who | Body | Returns |
|---|---|---|---|---|
| `/api/v1/associations` | POST | any authed user (becomes **treasurer** of it) | `{ "name", "institution", "department_or_faculty", "approval_threshold" (1-10, default 2) }` | 201 + association object |
| `/api/v1/associations/{assoc_id}` | GET | any member | — | association object |
| `/api/v1/associations/{assoc_id}/link-account` | POST | treasurer | `{ "account_ref": "..." }` | `{ "ok": true, "account_ref", "verified_balance" }` |
| `/api/v1/associations/{assoc_id}/invite-exco` | POST | treasurer | `{ "name", "email" }` | 201 `{ "ok", "user_id", "temporary_password": "..."\|null, "note" }` |

**Association object shape:**
```json
{
  "id": "uuid", "name": "...", "institution": "...",
  "department_or_faculty": "...", "approval_threshold": 2,
  "account_linked": true,
  "treasury_account_ref": "EB-REF-1234",
  "your_role": "treasurer",
  "created_at": "iso"
}
```
`your_role` is the caller's role in *this* association — use it to drive UI gating, but never trust it for security (the server enforces independently).

`invite-exco`: `temporary_password` is returned **exactly once** and only when the account was newly created (`null` if the user already existed). Show it to the treasurer with clear "share securely, must be changed" copy. There is a `POST /auth/change-password` route for rotation.

---

## 5. Roster

| Endpoint | Method | Who | Notes |
|---|---|---|---|
| `/api/v1/associations/{assoc_id}/roster/upload` | POST | treasurer | **multipart/form-data**, field name `file` (CSV or XLSX; columns: name, email, optional phone/matric). Max 5 MB. |
| `/api/v1/associations/{assoc_id}/roster/send-invites` | POST | treasurer | `{ "sent": <count> }` |
| `/api/v1/associations/{assoc_id}/roster` | GET | treasurer or exco | status dashboard (below) |
| `/api/v1/roster/claim` | POST | any authed user | claim own invite (below) |
| `/api/v1/associations/{assoc_id}/roster/{member_record_id}/mark-paid` | POST | treasurer | `{ "amount"?: number, "note"?: string }` → `{ "ok", "payment_id", "amount" }` |

**Upload response** (201): `{ "created": 52, "invites": [ { "name", "email", "invite_code" } ], "note": "..." }` — invite codes are visible here once; your UI should let the treasurer copy them.

**Roster dashboard response:**
```json
{
  "cycle": { "id": "uuid", "title": "2026 Dues", "amount": "2500.00" } ,
  "summary": { "total": 52, "claimed": 38, "unclaimed": 14 },
  "items": [
    { "id": "uuid", "name": "Ada", "matric_number": "CSC/21/0142", "email": "...",
      "phone": null, "claimed": true, "claimed_by": "Ada Obi",
      "invite_status": "claimed", "paid": true }
  ]
}
```
`cycle` is `null` when no active cycle exists — show the designed empty state, not an error. `paid` is `null` when there's no active cycle.

**Claim flow** (`POST /roster/claim`): body `{ "invite_code": "...", "email": "ada@uni.edu.ng" }` (email or phone must **match the roster record** — identity check is enforced server-side). → `{ "ok": true, "association_id": "uuid", "member_record_id": "uuid" }`. Errors: `404` unknown code, `403` identity mismatch, `409` already claimed. The invite link your app generates should carry the code; after register/login, post the code + the user's email.

---

## 6. Dues cycles & payments

| Endpoint | Method | Who | Body |
|---|---|---|---|
| `/api/v1/associations/{assoc_id}/dues-cycles` | POST | treasurer | `{ "title", "amount": >0, "deadline": "iso-datetime" }` |
| `/api/v1/associations/{assoc_id}/dues-cycles` | GET | any member | — |
| `/api/v1/dues-cycles/{cycle_id}` | PATCH | treasurer (of owning assoc) | `{ "title"?, "deadline"?, "status"?: "active"\|"closed" }` |
| `/api/v1/dues-cycles/{cycle_id}/pay` | POST | claimed roster member | `{ "paid_via": "blaze"\|"other"\|"manual", "idempotency_key": "8-120 chars" }` |
| `/api/v1/payments/{payment_id}/receipt` | GET | payer or any member of that assoc | — |
| `/api/v1/users/me/payments` | GET | any authed user | — |

Cycle object: `{ "id", "association_id", "title", "amount": "2500.00", "deadline": "iso", "status": "active", "created_at": "iso" }`.

**Pay**: `idempotency_key` is **client-generated** (e.g. `crypto.randomUUID()`), must be stable across retries of the same payment attempt — regenerate per *new* payment, never per retry. `403` if the user hasn't claimed a roster invite in that association (good moment to route to the claim flow). Payment object returned:
```json
{ "id": "uuid", "dues_cycle_id": "uuid", "amount": "2500.00", "paid_via": "blaze",
  "status": "success", "ecobank_transaction_ref": "EBK-...", "timestamp": "iso",
  "receipt_hash": "sha256-hex" }
```

**Receipt (the demo moment)**: `GET /payments/{id}/receipt` →
```json
{ "payment_id": "uuid", "amount": "2500.00", "paid_via": "blaze", "status": "success",
  "ecobank_transaction_ref": "EBK-...", "timestamp": "iso",
  "receipt_hash": "abc...", "recomputed_hash": "abc...", "verified": true }
```
Render a big green "verified" state when `verified: true` (badge it as cryptographically checked). The hash is SHA-256 over `payer_id | amount | timestamp | association_id | transaction_ref` joined by `|` — you can display the canonical string on an "advanced" receipt detail view.

`GET /users/me/payments` → `{ "items": [payment objects] }` across all associations, newest first.

---

## 7. Ledger (the hero screen)

### REST: `GET /api/v1/associations/{assoc_id}/ledger?limit=50&offset=0` (any member)
```json
{
  "balance": "12500.00",
  "total": 42,
  "items": [
    { "id": "uuid", "type": "inflow", "amount": "2500.00",
      "reason_or_category": "Dues: 2026 Dues",
      "linked_payment_id": "uuid" | null,
      "linked_disbursement_id": "uuid" | null,
      "linked_entry_id": "uuid" | null,
      "running_balance": "12500.00",
      "created_at": "iso" }
  ]
}
```
Newest first. Paginate with `offset` (there is no cursor). `balance` is the current running balance for the header.

### Reconcile: `GET /api/v1/associations/{assoc_id}/balance/reconcile` (any member)
```json
{ "association_id": "uuid", "ledger_balance": "12500.00",
  "ecobank_balance": "12500.00" | null, "drift": "0.00" | null,
  "status": "in_sync" | "drifted" | "not_linked" | "unavailable",
  "message": "..." , "checked_at": "iso" }
```
Show a small live reconciliation badge: green "in sync with Ecobank", amber "drifted", grey for the other two.

### WebSocket: `ws://localhost:8000/api/v1/associations/{assoc_id}/ledger/live?token=<ACCESS_TOKEN>`
- Auth is the `token` query param (browser WebSockets can't set headers). Invalid/expired token → server closes with code **4401**; non-member → **4403**.
- **First message after connect** (initialization snapshot):
  `{ "event": "snapshot", "balance": "12500.00" }`
- **Push events:**
  - New payment: `{ "event": "ledger_entry", "ledger_entry_id": "uuid"|null, "payment_id": "uuid", "type": "inflow", "amount": "2500.00", "member": "Ada Obi", "cycle": "2026 Dues", "at": "iso" }`
  - Disbursement state change: `{ "event": "disbursement_update", "disbursement_id": "uuid", "status": "approved"|"completed", "amount": "5000.00", "at": "iso" }`
- Server never sends anything else; it ignores client messages. On `onclose`, reconnect with fresh token (access tokens expire after `expires_in` seconds).
- This is the one place to spend animation budget: animate new ledger rows in.

---

## 8. Disbursements (multi-sig)

| Endpoint | Method | Who | Body |
|---|---|---|---|
| `/api/v1/associations/{assoc_id}/disbursements` | POST | treasurer | `{ "amount": >0, "reason", "recipient_name", "recipient_account_number", "recipient_bank_code" (default "ECOBANK"), "idempotency_key" }` |
| `/api/v1/associations/{assoc_id}/disbursements?status=pending` | GET | treasurer or exco | filter optional |
| `/api/v1/disbursements/{id}/approve` | POST | treasurer or exco | **empty body `{}`** |
| `/api/v1/disbursements/{id}/reject` | POST | treasurer or exco | `{ "password": "<their password>" }` (re-entry required) |

Disbursement object:
```json
{ "id": "uuid", "association_id": "uuid", "requested_by": "uuid",
  "amount": "5000.00", "reason": "Party logistics",
  "recipient": { "name": "...", "account_number": "...", "bank_code": "ECOBANK" },
  "status": "pending", "ecobank_transaction_ref": null,
  "approvals": [ { "approved_by": "uuid", "decision": "approved", "timestamp": "iso" } ],
  "approval_threshold": 2, "created_at": "iso" }
```
UI rules that mirror server rules: requesters cannot approve their own request (server rejects), one vote per person (DB constraint — `409` on double vote), the payout fires automatically when `approvals` count ≥ `approval_threshold` (status flips to `approved`, then `completed` via webhook/transfer). Show progress like "1 of 2 signatures".

---

## 9. Webhook (backend-to-backend only)

`POST /api/v1/webhooks/ecobank/notification` with `X-Ecobank-Signature` header (HMAC-SHA512 of the raw body). Invalid signature → `401`. The frontend never calls this; it exists for Ecobank.

---

## 10. RBAC cheat-sheet (server-enforced; mirror in UI)

| Action | member | exco | treasurer |
|---|---|---|---|
| View association / ledger / reconcile / WS / receipts | ✅ | ✅ | ✅ |
| List dues cycles | ✅ | ✅ | ✅ |
| Create/edit dues cycles | ❌ | ❌ | ✅ |
| Pay dues | ✅ (must have claimed roster invite) | ✅ | ✅ |
| Roster dashboard, disbursement list/approve/reject | ❌ | ✅ | ✅ |
| Upload roster, send invites, mark-paid, link account, invite-exco, create disbursement | ❌ | ❌ | ✅ |
| Create association | any authed user (becomes treasurer) | | |

Role is resolved **per association** — being treasurer of one association grants nothing in another.

---

## 11. Frontend page checklist → endpoints (from the product spec)

- **Auth screens** → §3. Role is auto-detected via memberships + `your_role`; role selection screen is unnecessary.
- **Association setup wizard** → `POST /associations` → `link-account` → `invite-exco`.
- **Roster upload + dashboard + manual entry** → §5.
- **Dues cycle manager** → §6 create/list/patch.
- **Member home (active cycles)** → `GET /associations/{id}/dues-cycles` for each membership; **claim flow** → §5; **pay flow** → §6 (badge "blaze = fee-free" clearly; `other` shows a fee warning).
- **Receipt view** → §6 receipt endpoint, big verified badge.
- **Ledger dashboard (hero, both portals)** → §7 REST + WebSocket. Balance figure = largest number on screen.
- **Disbursement form + approval queue** → §8.
- **Personal payment history** → `GET /users/me/payments`.
- **Live indicator** → WS connection state + reconcile badge.
- Empty/error states must be designed: "No dues cycles yet — ask your treasurer to open one", etc.

## 12. Suggested frontend data layer

- One API client module with the base URL from env (`NEXT_PUBLIC_API_URL`), auto-injecting the bearer token, a single refresh-and-retry interceptor, and typed helpers per §3–8.
- Keep tokens in memory + refresh in an httpOnly cookie if you can; at minimum never persist the access token to localStorage beyond the session need.
- WebSocket hook: connect per association page, seed from the REST feed + `snapshot`, append on `ledger_entry`, reconcile badge refresh on `disbursement_update`.

---

## 13. Running the backend locally (mock mode, zero setup)

```bash
cd blazesync
python -m venv ../.venv          # any venv
pip install -r requirements.txt
# no .env needed: embedded Postgres boots itself, Ecobank runs in mock mode
uvicorn app.main:app --reload --port 8000
```
- OpenAPI docs: `http://localhost:8000/docs` (use this to confirm exact schemas).
- Optional `blazesync/.env` (copy from `.env.example`) — see `DEPLOYMENT.md` for the full variable reference and hosting runbook (Render blueprint included: `render.yaml`).
- Tests: `pytest` (47 passing). Full demo journey: `python scripts/smoke_test.py http://127.0.0.1:8000`.

Key env vars (all optional locally): `DATABASE_URL` (blank = embedded Postgres), `JWT_SECRET` (required non-default in production), `ALLOWED_ORIGINS` (add your frontend origin!), `ECOBANK_*` credentials (blank = mock mode), `MOCK_BALANCE_DRIFT` (set to e.g. `500` to demo the drift flag live).

**Environment summary for deployment**: set `ENVIRONMENT=production`, `JWT_SECRET=<long random>`, `DATABASE_URL=<managed Postgres>`, `ALLOWED_ORIGINS=<frontend URL>`, and Ecobank sandbox credentials when the team has them. The app refuses to boot in production with insecure defaults — that's intentional.
