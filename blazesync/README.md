# BlazeSync — Backend

**Transparent treasury platform for Nigerian university student associations.**

Associations link their existing Ecobank business account, collect dues from
members through Ecobank's Collection API, and disburse funds only after a
multi-signature approval. Every payment produces a tamper-evident receipt and
appends to a shared, real-time ledger visible to all members. A separate
roster tracks who owes dues — independent of whether they've ever opened the
app.

FastAPI · PostgreSQL · SQLModel · JWT (access + refresh) · WebSockets ·
Ecobank Unified API (mock-mode aware)

**Hosting, testing & the full environment-variable reference:** see
[DEPLOYMENT.md](DEPLOYMENT.md).

---

## The five guarantees (and where each one is enforced)

| Guarantee | Enforced at | Where to look |
|---|---|---|
| No single person can move money | The database + service layer: a disbursement only transitions to `approved` when **distinct recorded approvals ≥ threshold**, checked on every approval insert inside a locked transaction | `app/services/disbursements.py::record_decision` |
| No fake or tampered receipts | Deterministic SHA-256 over (payer, amount, timestamp, association, Ecobank ref) — recomputed and compared on every receipt read | `app/services/receipts.py` |
| The ledger cannot lie about the past | Append-only: a **Postgres trigger** rejects `UPDATE`/`DELETE` on `ledger_entry` — even raw SQL fails | `migrations/versions/0001_initial.py`, `app/services/ledger.py` |
| No double charges / double payouts | Client-supplied idempotency keys on every payment and disbursement; retries return the original result | `app/services/payments.py`, `app/services/disbursements.py` |
| No blind trust in ourselves | Periodic + on-demand reconciliation of our ledger balance against Ecobank's Account Enquiry; drift is flagged and audit-logged | `app/services/reconciliation.py` |

Every state-changing human action (roster upload, invite claim, approval,
rejection, manual payment…) is written to an immutable `audit_log` — separate
from the money ledger. That's the compliance trail.

---

## Quickstart

Requires Python 3.11+. **No Docker and no Postgres install needed** — with no
`DATABASE_URL` set, the app boots an embedded real PostgreSQL cluster
(`pgembed`) stored in `.pgserver/`.

```bash
# from this folder (the repo root, once cut from the parent checkout)
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env               # everything works with the defaults

uvicorn app.main:app --port 8000
```

Then:

| What | URL |
|---|---|
| OpenAPI docs (auto-generated, judge-friendly) | http://localhost:8000/docs |
| Health | http://localhost:8000/api/health |

Run the end-to-end demo journey (13 steps over real HTTP, including the live
WebSocket ledger):

```bash
# in a second terminal
python scripts/smoke_test.py http://127.0.0.1:8000
```

Run the test suite (each run migrates an isolated fresh schema on the same
Postgres engine, so triggers/constraints/advisory locks are genuinely tested):

```bash
pytest -q
```

### Using a real Postgres instead

Set `DATABASE_URL` (Render-style `postgresql://…` URLs are normalized to the
psycopg driver automatically), or use the shipped compose file:

```bash
docker compose up -d db
export DATABASE_URL=postgresql://blazesync:blazesync@localhost:5433/blazesync
```

### Production guardrails

The app refuses to boot with `ENVIRONMENT=production` unless `JWT_SECRET` is a
real value and `DATABASE_URL` points at Postgres. Schema changes go through
Alembic (`AUTO_MIGRATE=true` runs `upgrade head` on boot for demo hosts;
disable it and run migrations explicitly if you prefer).

---

## Ecobank integration

All Ecobank traffic goes through one module — `app/ecobank/client.py` — so
endpoint or signing changes are one-place fixes.

- **Hashing service** (`app/ecobank/hashing.py`): pure functions implementing
  the documented SHA-512 formulas — `requestToken` over
  `clientId + affiliateCode + sourceCode + requestId + requestType + ip +
  secret`, and per-service `secureHash` payload orders. Zero I/O, fully
  unit-testable in isolation (the onboarding step Ecobank warns about).
- **Authentication**: bearer token via `userId`/`password`, `Origin` header
  attached, in-process token cache.
- **Collection / Account Enquiry / Local Bank Payment**: wrapped with retries
  + exponential backoff (sandbox is flaky) and timeouts.
- **Webhooks**: HMAC-SHA512 signature verification over the raw body with a
  constant-time compare — unverified notifications never touch the ledger.

### Mock mode (demo superpower)

With no sandbox credentials set, the client runs in deterministic mock mode:
collections and transfers succeed with refs derived from the idempotency key,
and the mock Account Enquiry returns a stable balance derived from the account
reference. The entire product flow works offline for development and demos.
Set `MOCK_BALANCE_DRIFT` (e.g. `500`) to make the balance drift and watch the
reconciliation endpoint flag it live.

To go live: register at the Ecobank developer portal, receive `userId`,
`password`, `lab_key` by email, fill the `ECOBANK_*` variables in `.env`, and
set `ECOBANK_WEBHOOK_SECRET` to the shared webhook signing secret.

---

## Architecture

```
blazesync/
├── app/
│   ├── main.py               # FastAPI assembly, CORS, lifespan
│   ├── config.py             # env-driven settings + prod guardrails
│   ├── db.py                 # Postgres engine; embedded pgembed for dev
│   ├── models.py             # SQLModel tables (UUID PKs, Numeric money)
│   ├── security.py           # bcrypt + JWT (access/refresh, rotation)
│   ├── deps.py               # get_current_user, association-scoped RBAC
│   ├── audit.py              # immutable action log (decisions, not money)
│   ├── live.py               # WebSocket hub — per-association rooms
│   ├── jobs.py               # background reconciliation loop
│   ├── ecobank/
│   │   ├── hashing.py        # requestToken / secureHash (pure functions)
│   │   └── client.py         # all Ecobank calls + mock mode + retries
│   ├── services/             # business logic (routers stay thin)
│   │   ├── ledger.py         # append-only entries + advisory-locked balances
│   │   ├── receipts.py       # hash generation + live verification
│   │   ├── payments.py       # collection orchestration (idempotent)
│   │   ├── disbursements.py  # multi-sig state machine + payout
│   │   ├── roster.py         # CSV/XLSX import, invites, claims
│   │   └── reconciliation.py # ledger vs bank, drift audit
│   └── routers/              # auth, associations, roster, dues,
│                             # ledger (+WS), disbursements, webhooks
├── migrations/versions/0001_initial.py   # schema + append-only trigger
├── scripts/smoke_test.py     # full demo journey over HTTP
└── tests/                    # pytest against real Postgres
```

### Design decisions worth being able to defend

- **RBAC is association-scoped, never a global claim.** `require_role(...)`
  resolves the caller's membership *in the association addressed by the
  request*; roles in one association confer nothing elsewhere. Endpoints whose
  paths don't carry the association id (e.g. approve/reject) resolve the
  resource first and check the role against the resource's own association.
- **The threshold gate runs on every approval insert**, inside a transaction
  serialized by a per-disbursement advisory lock, so two simultaneous
  approvals cannot both drive the state machine. The requester cannot approve
  their own request; each exco member has exactly one vote (DB unique
  constraint); rejection requires password re-entry.
- **Running balances are computed at insert time** under a per-association
  advisory lock — O(1) reads, no aggregate scans, no interleave races.
- **Money is `Numeric(18,2)`** everywhere; never floats in the database.
- **Refresh tokens are database rows** (JTI-indexed, revocable) and rotate on
  every use; logout revokes immediately. Access tokens are short-lived.
- **Everything is multi-tenant by construction**: every row that matters is
  scoped by `association_id`, with indexes on it.

---

## Security notes

- Secrets come from the environment only; `.env` is gitignored (`.env.example`
  is the committed template). Production refuses insecure defaults.
- CORS is an explicit allow-list; security headers (`nosniff`, `DENY`,
  strict referrer policy) are applied to every response.
- Invite codes are `secrets`-generated, single-use, expiring, and identity-
  checked (the claimer's email/phone must match the roster record).
- Webhook payloads are verified (HMAC-SHA512, constant-time) before any
  processing; invalid signatures get a 401 with no enumeration hints.
- See the repo-root `SECURITY.md` for the broader pre-launch review posture.

---

## Demo script (what to show judges)

1. `POST /auth/register` + `POST /associations` — treasurer onboards, threshold 2.
2. `POST /associations/{id}/link-account` — Ecobank consent → scoped account ref.
3. Upload the class roster CSV → invite codes generated for all 52 students.
4. A member claims her invite (identity-checked, single-use) and pays dues →
   **watch the WebSocket ledger push the entry live** — the transparency moment.
5. `GET /payments/{id}/receipt` — `verified: true` recomputed live.
6. Treasurer requests a disbursement; two exco approve → transfer executes,
   outflow hits the ledger. Ask: "what if only one had approved?" → funds stay
   frozen, enforced by the database, not the UI.
7. `GET .../balance/reconcile` — our ledger vs Ecobank's own number.
8. POST an unsigned fake webhook → 401. "We never trust an unverified payload."

---

## API surface (summary)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` |
| Associations | `POST /associations`, `GET /associations/{id}`, `POST .../link-account`, `POST .../invite-exco` |
| Roster | `POST .../roster/upload` (CSV/XLSX), `POST .../roster/send-invites`, `GET .../roster`, `POST /roster/claim`, `POST .../roster/{id}/mark-paid` |
| Dues | `POST/GET .../dues-cycles`, `PATCH /dues-cycles/{id}`, `POST /dues-cycles/{id}/pay`, `GET /payments/{id}/receipt`, `GET /users/me/payments` |
| Ledger | `GET .../ledger`, `WS .../ledger/live`, `GET .../balance/reconcile` |
| Disbursements | `POST/GET .../disbursements`, `POST /disbursements/{id}/approve`, `POST /disbursements/{id}/reject` |
| Webhooks | `POST /webhooks/ecobank/notification` |

All endpoints are under `/api/v1`. Full request/response schemas at `/docs`.

## Roadmap (deliberately out of MVP scope)

- Celery + Redis workers adopting the existing job functions verbatim
  (`docker-compose.yml` already ships a Redis service).
- Notification delivery adapter (SendGrid/Termii) behind `roster._deliver`.
- Correction-entry workflow (new ledger entries linked via `linked_entry_id`)
  and CSV ledger export for exco handover.
