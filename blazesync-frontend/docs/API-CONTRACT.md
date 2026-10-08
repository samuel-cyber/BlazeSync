# API contract the frontend expects

> **⚠️ SUPERSEDED — historical document.** This file describes the *original*
> planned contract (virtual accounts, `/me/associations`, `/cycles/{id}/payments`,
> the `Idempotency-Key` header, integer-kobo ids, `PUT`/`DELETE`). The backend has
> since moved to **Account Opening + Direct Debit** and a real `api.ts`.
> The current, authoritative contract is **`BLAZESYNC_FRONTEND_HANDOFF.md`**
> (repo root). Keep this file only for historical context.

What each screen needs from the FastAPI backend. Shapes are the types in
`src/lib/types.ts`. Money is always integer **kobo**. Times are ISO 8601 UTC.
Every call is scoped by `association_id`, and every state-changing call writes
an audit event server-side.

Errors return `{ "error": "<code>" }` with a proper HTTP status. The codes
below are the ones the UI already has copy for.

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email_or_phone, password }` | 409 `exists` |
| POST | `/auth/verify` | `{ email_or_phone, code }` | 400 `expired` |
| POST | `/auth/login` | `{ email_or_phone, password }` | Returns access token; refresh token as httpOnly cookie. 401 `mismatch`, 429 `too_many` |
| POST | `/auth/refresh` | | |
| POST | `/auth/forgot` | `{ email_or_phone }` | Always 202, never reveals whether the account exists |

## Associations

| Method | Path | Body / returns |
|---|---|---|
| GET | `/me/associations` | `Association[]` plus the caller's role in each |
| POST | `/associations` | Setup wizard: `{ name, short_name, institution, faculty, department, cosignatories[], required }` |
| POST | `/associations/{id}/account-link/start` | `{ account_number }`: Ecobank sends the OTP. 400 `not_business_account` |
| POST | `/associations/{id}/account-link/confirm` | `{ otp }`: 400 `wrong_code` with `tries_left` |
| DELETE | `/associations/{id}/account-link` | Revokes consent |
| GET | `/associations/by-code/{join_code}` | Public summary for `/join`. 404 `not_found` |
| PUT | `/associations/{id}/approval-rule` | `{ required }`: min 2 |
| POST | `/associations/{id}/exco` | `{ name, contact, title, is_signatory }` |

## Roster and invites

| Method | Path | Body / returns |
|---|---|---|
| GET | `/associations/{id}/roster` | `MemberRecord[]` |
| POST | `/associations/{id}/roster/import` | `{ file_name, rows[] }` (already validated client-side; the server re-validates) |
| POST | `/associations/{id}/invites` | `{ record_ids[], channels: ["email","sms"] }` |
| GET | `/invites/{code}` | The record, association, and payment history for the claim page. 404, 410 `claimed`, 410 `expired` |
| POST | `/invites/{code}/claim` | `{ contact, password }`: 403 `mismatch` if contact isn't what the invite was sent to |
| POST | `/associations/{id}/join` | `{ name, matric, level }`: 409 `matric_taken` |

## Dues

| Method | Path | Body / returns |
|---|---|---|
| GET | `/associations/{id}/cycles` | `DuesCycle[]` with progress `{ total, paid, joined, expected, collected }` |
| POST | `/associations/{id}/cycles` | `{ title, amount, per_level, deadline, notify }`: 409 `already_open` |
| PATCH | `/cycles/{id}` | `{ deadline }` |
| POST | `/cycles/{id}/close` | |

## Payments

| Method | Path | Body / returns |
|---|---|---|
| POST | `/cycles/{id}/payments` | `{ record_id, channel }` + `Idempotency-Key` header. Returns `{ receipt_id, entry_id }` or 402 `insufficient_funds`, 409 `already_paid`. For `bank_transfer`, returns a one-time account number and expiry first |
| POST | `/cycles/{id}/manual-payments` | Exco only. `{ record_id, channel: "cash" or "direct_transfer", note }` |
| GET | `/receipts/{id}` | Public. `Receipt`, including `hash` and the fields it's computed from |

## Ledger and reconciliation

| Method | Path | Body / returns |
|---|---|---|
| GET | `/associations/{id}/ledger` | `LedgerEntry[]`, newest first, with `balance_after` |
| GET | `/associations/{id}/balance` | `{ ledger, cash_in_hand, bank, drift, checked_at }` |
| GET | `/associations/{id}/reconciliation` | Recent `ReconciliationRun[]` |
| WS | `/associations/{id}/live` | Pushes `{ type: "ledger_entry", entry }` and `{ type: "balance", ... }` |

## Payouts

| Method | Path | Body / returns |
|---|---|---|
| GET | `/associations/{id}/disbursements` | `Disbursement[]` with approvals |
| POST | `/associations/{id}/disbursements` | `{ amount, category, reason, recipient }` + `Idempotency-Key`. The requester's signature is recorded with the request. 422 `insufficient` |
| POST | `/disbursements/{id}/decision` | `{ decision: "approve" or "reject", note, pin }`: 403 `not_signatory`, 409 `already_signed`, 409 `not_pending` |
| GET | `/banks/resolve?bank=&account=` | `{ account_name }` (name enquiry) |

The server moves a disbursement to `processing` only when the count of
distinct `approve` decisions reaches `required`, then calls Ecobank's Local
Bank Payment Service exactly once per idempotency key.

## Records

| Method | Path | Returns |
|---|---|---|
| GET | `/associations/{id}/audit` | `AuditEvent[]`, filterable by `actor` and `action` |
| GET | `/associations/{id}/export?what=ledger|roster|audit&from=&to=` | CSV |
