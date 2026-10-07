# BlazeSync — Deployment Guide

Everything is wired: the frontend talks to the backend in **live mode**, and the
original **demo mode** still works with zero backend (useful for demos and
judge evaluation). This guide gets you from this repo to a running deployment.

---

## 1. Architecture at a glance

| Piece | What it is | Deployed as |
|---|---|---|
| `blazesync/` | FastAPI + PostgreSQL backend (auth, ledger, dues, payouts, receipts, WebSocket) | One server (Railway/Render/Fly/VPS) |
| `blazesync-frontend/` | Next.js (App Router) frontend | Vercel (or same host, static + node) |
| Ecobank Unified API | Sandbox/production bank rails | Credentials via env vars |

The frontend decides mode automatically:

- **Live mode** — user signs up/logs in against the API (tokens stored in
  `localStorage`, refreshed on expiry, WebSocket `?token=` auth).
- **Demo mode** — the login page's "Try the demo" buttons; pure client-side
  seed data. Great for pitching without a server.

---

## 2. What you need before deploying

1. **A PostgreSQL database** — Railway, Neon, Supabase, or a managed instance.
   (Local dev uses an embedded Postgres automatically; production requires
   `DATABASE_URL` or the app refuses to boot.)
2. **Ecobank sandbox credentials** — see **§7** below for the step-by-step of
   getting them; you'll receive:
   - `ECOBANK_USER_ID`, `ECOBANK_PASSWORD`, `ECOBANK_LAB_KEY`,
     `ECOBANK_CLIENT_ID`, `ECOBANK_AFFILIATE_CODE`, `ECOBANK_SOURCE_CODE`,
     `ECOBANK_WEBHOOK_SECRET`
   - The sandbox base URL (`https://sandboxapi.ecobank.com` by default).
   
   > Without these the backend runs in **mock bank mode**: everything works
   > (balances, payments, payouts, reconciliation) but no real money moves.
   > Perfect for the demo; swap in real credentials for go-live.
3. **A Vercel account** (or any Node host) for the frontend.
4. **A domain** (optional but recommended) — needed for Ecobank webhooks to
   reach you in production.
5. **(Optional) An LLM API key** for Ask BlazeSync — any OpenAI-compatible
   endpoint works (`ASK_LLM_API_KEY`, `ASK_LLM_BASE_URL`, `ASK_LLM_MODEL`).
   Without it the Ask endpoint still works: it falls back to deterministic
   ledger queries. No key is needed for anything else.

---

## 3. Deploy the backend

### 3.1 Environment variables

Create these on your host (see `blazesync/.env.example` for the full list):

```env
ENVIRONMENT=production

# Security — GENERATE REAL VALUES, do not reuse
JWT_SECRET=<openssl rand -hex 32>

# Database (from your Postgres provider)
DATABASE_URL=postgresql://user:pass@host:5432/blazesync

# CORS: your frontend's production origin(s), comma-separated
PUBLIC_BASE_URL=https://api.yourdomain.com
ALLOWED_ORIGINS=https://app.yourdomain.com

# Bank — leave blank for mock mode in staging
ECOBANK_USER_ID=
ECOBANK_PASSWORD=
ECOBANK_LAB_KEY=
ECOBANK_CLIENT_ID=
ECOBANK_AFFILIATE_CODE=
ECOBANK_SOURCE_CODE=
ECOBANK_BASE_URL=https://sandboxapi.ecobank.com
ECOBANK_ORIGIN=developer.ecobank.com
ECOBANK_WEBHOOK_SECRET=

# Optional tuning
ACCESS_TOKEN_MINUTES=15
REFRESH_TOKEN_DAYS=7
INVITE_EXPIRY_DAYS=14
AUTO_MIGRATE=true

# Ask BlazeSync — optional; empty key = deterministic rules fallback
ASK_LLM_API_KEY=
ASK_LLM_BASE_URL=https://api.openai.com/v1
ASK_LLM_MODEL=gpt-4o-mini
ASK_LLM_TIMEOUT_SECONDS=20
```

**Notes**

- `ALLOWED_ORIGINS` **must** include your frontend's exact origin (scheme +
  host, no trailing slash). A mismatch = CORS preflight failures. (This bit us
  locally — same rule in prod.)
- `AUTO_MIGRATE=true` runs Alembic migrations on boot (fine for a single
  instance). For multi-instance deployments set `false` and run
  `alembic upgrade head` as a release step instead.

### 3.2 Run it

```bash
cd blazesync
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Check `GET /api/health` → `{"status":"ok",...}` and `/docs` (interactive API
docs — good for judges).

### 3.3 Local development (already set up)

```bash
cd blazesync
py -3 scripts/_run_dev.py 8000          # embedded Postgres + API in one process
DEV_ORIGIN=http://localhost:3000 py -3 scripts/_run_dev.py 8000   # if frontend runs on :3000
```

Tests: `py -3 scripts/_run_tests.py -q` (embedded Postgres, 45 tests).

---

## 4. Deploy the frontend

1. Push the repo to GitHub.
2. In Vercel: **New Project → import** → root directory `blazesync-frontend`.
3. Environment variable:

   ```env
   NEXT_PUBLIC_API_URL=https://api.yourdomain.com
   ```

   (No trailing slash. Locally the default `http://localhost:8000` is used.)
4. Deploy. Build command is `next build`, output is the default.

Verify the flow: sign up → create association → link bank account (mock OTP:
any 6 digits except `000000`) → upload roster (sample file button) → open a
dues cycle (with an expectation statement — it prints on the receipt) → pay as
a member → watch the ledger update live → ask the ledger a question in the
"Ask BlazeSync" box.

---

## 5. Go-live checklist (your side)

**Staging first (mock bank):**

- [ ] Backend deployed, `/api/health` returns ok
- [ ] Frontend deployed, `NEXT_PUBLIC_API_URL` points at it
- [ ] CORS verified: sign-up works from the deployed frontend
- [ ] Full flow works: setup → roster → cycle → pay → receipt verifies
- [ ] Payout flow: request → second signatory approves → processing → completed
- [ ] WebSocket live updates work (second browser tab sees payments instantly)
- [ ] Roster provisioning works: `POST .../roster/provision-accounts` issues
      mock VAs and re-running skips the already-provisioned
- [ ] Ask BlazeSync answers from real data (LLM or rules fallback; check
      `grounded_via` in the response)
- [ ] JWT_SECRET is a fresh random value; ENVIRONMENT=production

**Production (real Ecobank):**

- [ ] Ecobank production credentials received and configured
- [ ] `ECOBANK_BASE_URL` switched from sandbox to production
- [ ] Webhook URL registered with Ecobank:
      `https://api.yourdomain.com/api/v1/webhooks/ecobank/notification`
      with the webhook secret set
- [ ] Provision real VAs for the roster, then test the full happy path:
      transfer a small amount into one member's VA → webhook fires → payment
      auto-attributed → ledger updates live → receipt shows the expectation
      statement and verifies
- [ ] Ask BlazeSync: confirm the LLM path is grounded (`grounded_via: "llm"`)
      and refuses questions outside the data
- [ ] Test with a small real disbursement you control
- [ ] Database backups enabled (managed Postgres usually does this)
- [ ] Monitor: application logs + `audit_log` table (every sensitive action
      lands there)

**Association onboarding (real treasurers):**

1. Treasurer signs up → "I manage my association's money".
2. Links the association's **Ecobank business account** (bank sends an OTP to
   the phone registered on that account — BlazeSync never asks for banking
   PINs/passwords).
3. Uploads the member roster CSV (name, matric, level, email/phone).
4. **Provisions virtual accounts** — one per roster member (see §6.1 below).
5. Invites co-signatories; sets the signature rule (min 2 — a payout can never
   move on one person's approval alone).
6. Opens a dues cycle (flat amount, or per-level pricing) **and writes the
   expectation statement** — the plain-language promise of what the money funds,
   printed on every receipt.
7. Members claim their invite links (the contact in the claim form must match
   what the roster has) and pay; every payment gets a tamper-evident receipt
   with the expectation statement frozen onto it.

---

## 6. The spec features, in production terms

### 6.1 Virtual accounts & provisioning

`POST /api/v1/associations/{id}/roster/provision-accounts` issues one Ecobank
virtual account per roster member. Key properties:

- **Idempotent** — already-provisioned members are skipped, so it's safe to
  re-run (e.g. after adding roster rows). Re-upload a CSV with new members,
  then provision again.
- **Partial failures don't abort the run** — the response reports
  `issued` / `skipped_previously_provisioned` / `failed` (with `failed_ids`),
  and re-running retries only the failures.
- **Mock mode** provisions deterministic fake accounts (11 + 8 hex digits,
  derived from the association + member), so the full flow demos without bank
  credentials.
- Once provisioned, the member's VA ref shows on the roster, and any credit
  that lands in it is auto-attributed (see 6.2).

> **Frontend note:** the API client method (`provisionAccounts`) exists, but
> there's no UI button yet. Trigger provisioning from the API docs UI at
> `/docs` for now — a "Provision accounts" button on the roster page is an easy
> follow-up.

### 6.2 Webhook auto-attribution

Ecobank calls `POST /api/v1/webhooks/ecobank/notification` when money lands in
any provisioned VA. The handler verifies the HMAC signature first, then:

1. Finds the member whose VA was credited (unmatched refs are logged to
   `audit_log`, never guessed).
2. Matches them to the association's open dues cycle and records the payment
   (idempotent by transaction ref — redeliveries are safe).
3. Writes the ledger entry and pushes a live WebSocket update — the treasurer's
   screen updates the moment Ecobank confirms.

Register this URL with Ecobank (staging + production):
`https://api.yourdomain.com/api/v1/webhooks/ecobank/notification`

### 6.3 Expectation statements

Set when a cycle is created (or patched later) as `expectation_statement`. It's
snapshotted onto each receipt at payment time, so what the money was owed *for*
is frozen alongside the cryptographic proof — editing the cycle afterwards
can't rewrite old receipts. Receipts display it as "What this money funds".

### 6.4 Ask BlazeSync

`POST /api/v1/associations/{id}/ask` — read-only, available to any member of
the association. It builds a compact context from the association's real data
(balance, category totals, active cycle, roster payment status, recent entries)
and either:

- calls the LLM with a strict system prompt (answer only from the context,
  say "I don't have that information" rather than guess), or
- falls back to deterministic ledger queries when `ASK_LLM_API_KEY` is unset.

The response's `grounded_via` field says which path answered (`llm` or
`rules`). The endpoint can never mutate anything. LLM traffic is outbound-only
from your server; the key never reaches the browser.

## 7. Getting Ecobank sandbox credentials

Per Ecobank's own [Unified API getting-started guide](https://apimuat-developer.ecobank.com/documentation/getting-started),
the credentials arrive **by email after you register** — there's no key you
generate yourself:

1. **Register on the developer portal** — [developer.ecobank.com](https://developer.ecobank.com)
   → the sandbox-access / Register flow. Fill in your details and submit.
   (On the newer API-management portal you instead click **Sign In → Continue
   as Partner → Sign up now**, verify your email with the code they send, and
   complete the form.)
2. **Wait for the confirmation email.** It contains exactly the pieces
   BlazeSync needs:
   | Email item | BlazeSync env var |
   |---|---|
   | **UserID** | `ECOBANK_USER_ID` — used for token generation |
   | **Password** | `ECOBANK_PASSWORD` — used for token generation |
   | **Lab key** | `ECOBANK_LAB_KEY` — used to compute the `secureHash` |
   | Documentation link + test-case file | (for the go-live request later) |
   Keep the registration username/password safe — they're what you log in with
   when requesting go-live.
3. **Subscribe to the services you use.** On the portal (or the newer "Sign in
   → Products" flow), subscribe to the products BlazeSync touches: token
   generation / authentication, **Collection & Payments**, **Account Services
   (Account Enquiry)**, **Local Bank Payments**, and virtual accounts if
   offered. Each subscription has primary/secondary keys — if the portal
   issues per-product keys, put the relevant one into `ECOBANK_CLIENT_ID`,
   and set `ECOBANK_AFFILIATE_CODE` / `ECOBANK_SOURCE_CODE` to the values the
   sandbox docs/examples use.
4. **Don't change sandbox request bodies** — for sandbox testing Ecobank
   expects the predefined test data; only auth headers/origin vary.
   BlazeSync already sends `Origin: developer.ecobank.com` (the
   `ECOBANK_ORIGIN` var).
5. **Test the two primitives in isolation first** (Token generation and the
   Hashing Service) before wiring flows — BlazeSync's client already does
   token-caching + retry/backoff, so once those two work the rest follows.
6. **Go-live is a separate request** — complete the test-case document they
   emailed, re-login on the portal, and submit it with basic KYC. Production
   credentials follow after their review.

If you can't get registered quickly (deadline!), skip this entirely:
**leaving every `ECOBANK_*` variable blank runs the whole app in mock bank
mode** — real flows, real pages, deterministic fake money. Ideal for the
demo/judging; swap in sandbox creds whenever the email arrives.

## 8. Where things live (for future maintenance)

| Area | Path |
|---|---|
| API client / token refresh | `blazesync-frontend/src/lib/api.ts` |
| Live WebSocket hook | `blazesync-frontend/src/lib/live.ts` |
| Store (demo + live modes) | `blazesync-frontend/src/lib/store.tsx` |
| Backend routers | `blazesync/app/routers/` |
| Bank client (mock-aware) | `blazesync/app/ecobank/client.py` |
| Receipt hash (tamper evidence) | `blazesync/app/services/receipts.py` ↔ `blazesync-frontend/src/lib/receipt-hash.ts` |
| Virtual account provisioning | `blazesync/app/services/roster.py` (`provision_accounts`) |
| VA issuance (bank side) | `blazesync/app/ecobank/client.py` (`create_virtual_account`) |
| Webhook credit attribution | `blazesync/app/routers/webhooks.py` |
| Ask BlazeSync | `blazesync/app/services/ask.py` + `blazesync/app/routers/ask.py` |
| Migrations | `blazesync/migrations/versions/` |
| Integration tests | `blazesync/tests/test_integration_wire.py` |
| Spec-gap tests | `blazesync/tests/test_spec_gaps.py` |
