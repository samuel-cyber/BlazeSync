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
2. **Ecobank sandbox credentials** — request access to the *Ecobank Unified
   API* developer sandbox. You'll receive:
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

Tests: `py -3 scripts/_run_tests.py -q` (embedded Postgres, 35 tests).

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
dues cycle → pay as a member → watch the ledger update live.

---

## 5. Go-live checklist (your side)

**Staging first (mock bank):**

- [ ] Backend deployed, `/api/health` returns ok
- [ ] Frontend deployed, `NEXT_PUBLIC_API_URL` points at it
- [ ] CORS verified: sign-up works from the deployed frontend
- [ ] Full flow works: setup → roster → cycle → pay → receipt verifies
- [ ] Payout flow: request → second signatory approves → processing → completed
- [ ] WebSocket live updates work (second browser tab sees payments instantly)
- [ ] JWT_SECRET is a fresh random value; ENVIRONMENT=production

**Production (real Ecobank):**

- [ ] Ecobank production credentials received and configured
- [ ] `ECOBANK_BASE_URL` switched from sandbox to production
- [ ] Webhook URL registered with Ecobank:
      `https://api.yourdomain.com/api/v1/webhooks/ecobank/notification`
      with the webhook secret set
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
4. Invites co-signatories; sets the signature rule (min 2 — a payout can never
   move on one person's approval alone).
5. Opens a dues cycle (flat amount, or per-level pricing).
6. Members claim their invite links (the contact in the claim form must match
   what the roster has) and pay; every payment gets a tamper-evident receipt.

---

## 6. Where things live (for future maintenance)

| Area | Path |
|---|---|
| API client / token refresh | `blazesync-frontend/src/lib/api.ts` |
| Live WebSocket hook | `blazesync-frontend/src/lib/live.ts` |
| Store (demo + live modes) | `blazesync-frontend/src/lib/store.tsx` |
| Backend routers | `blazesync/app/routers/` |
| Bank client (mock-aware) | `blazesync/app/ecobank/client.py` |
| Receipt hash (tamper evidence) | `blazesync/app/services/receipts.py` ↔ `blazesync-frontend/src/lib/receipt-hash.ts` |
| Migrations | `blazesync/migrations/versions/` |
| Integration tests | `blazesync/tests/test_integration_wire.py` |
