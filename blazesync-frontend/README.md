# BlazeSync: frontend

Association dues on one shared, live ledger. Members see the balance the
treasurer sees, every payment gets a receipt anyone can verify, and no payout
leaves the account without co-signatures.

This folder is the **frontend only** (spec section 1), built with the stack
from spec section 4: Next.js (App Router) and Tailwind CSS. It runs with no
backend: a demo store in the browser stands in for the FastAPI service, with
the same actions and the same rules, so every screen works end to end today.

## Run it

```bash
cd blazesync-frontend
npm install
npm run dev          # http://localhost:3000
```

Production build: `npm run build && npm start`. Deploys to Vercel as is.

### Demo accounts

| Who | How to get in |
|---|---|
| Treasurer (Tunde Bakare, CSSA UNILAG) | `/login` then **Treasurer (Tunde)**, or `tunde.bakare@live.unilag.edu.ng` / `blazesync` |
| Member (Adaeze Okafor, 300L) | `/login` then **Member (Adaeze)**, or `adaeze.okafor@gmail.com` / `blazesync` |

| Try this | Where |
|---|---|
| Claim a roster invite (paid in cash before joining; status carries over) | `/claim/K7QX-M2PA-9RTD`, confirm with `ronke.salami@live.unilag.edu.ng` |
| An invite that was already used | `/claim/H4ND-Y2ZK-QP7C` |
| An expired invite | `/claim/W9XE-P7RS-4TNV` |
| Join by association code | `/join` with `CSSA-4821` |
| A brand-new association (every empty state) | Treasurer view, switch the association picker to **Chess Club UNILAG** |
| Bank balance disagrees with the ledger | Treasurer **Settings**, then **Demo controls** |
| A declined payment | Same place: **Decline the next member payment**, then pay as Adaeze |
| Reset everything | **Settings**, then **Reset demo data** |

A new member payment lands on the ledger every 15 to 25 seconds while you're
signed in, to show the live feed. Pause it under **Demo controls**.

### Demo guide (for presenting)

Every screen has a **Demo guide** button in the bottom-right corner. It opens
an eight-step script for judges, in an order that tells the story:

1. Watch money arrive (with **Land a payment now**, so you don't wait for the feed)
2. Everyone owes, app or not (mark a cash payment)
3. No one moves money alone (sign the ₦48,000 payout with any PIN)
4. The bank checks our numbers (**Show a mismatch** / **Clear the mismatch**)
5. Pay dues as a student (Adaeze, Blaze, any PIN)
6. A receipt nobody can fake (change the amount and watch the check fail)
7. Claim an invite (Ronke's history comes with her)
8. Hand over to the next exco (download the handover pack)

**Go** signs you in as the right person and opens the right screen. Steps tick
off as you go, and progress survives a reload. **Reset demo** at the bottom
puts all the data back so every step works again. The guide lives in
`src/components/DemoGuide.tsx`; delete that file and its line in
`src/app/layout.tsx` to remove it before a real launch.

Demo data is generated relative to the current time, so "due in 37 days" and
"paid 6 min ago" stay true whenever you demo it. It's saved in the browser's
localStorage and refreshes itself after 12 hours.

## Spec to screen

| Spec | Screen | Route |
|---|---|---|
| 1.1 Landing | Live example ledger, two CTAs | `/` |
| 1.1 Auth | Log in, sign up, forgot password, verify code | `/login` `/signup` `/forgot-password` `/verify` |
| 1.1 Role selection | "How will you use BlazeSync?" | `/welcome` |
| 1.2 Setup wizard + Ecobank consent + co-signatories | Four steps | `/setup` |
| 1.2 Roster upload | CSV, row-by-row validation | `/exco/members/import` |
| 1.2 Roster dashboard + manual payment | Joined and paid tracked separately; **Mark paid** | `/exco/members` |
| 1.2 Dues cycle manager | List, open, move deadline, close | `/exco/dues` `/exco/dues/new` `/exco/dues/[id]` |
| 1.2 Live ledger + reconciliation | Balance head, statement, filters, balance checks | `/exco` `/exco/ledger` |
| 1.2 Disbursement request | With account-name lookup | `/exco/payouts/new` |
| 1.2 Approval queue | Grouped by who has to act; PIN to sign | `/exco/payouts` `/exco/payouts/[id]` |
| 1.2 Audit and export | Activity log, CSV ledger, handover pack | `/exco/records` |
| 1.2 Settings | Signature rule, exco, bank account, notifications | `/exco/settings` |
| 1.3 Member home | Balance first, then your dues across associations | `/member` |
| 1.3 Claim invite | Invite, confirm contact, password, done. The short link in invite messages redirects here | `/claim/[code]` (`/c/[code]`) |
| 1.3 Pay dues | Blaze (no fee) vs transfer or card (fee shown) | `/member/pay/[cycleId]` |
| 1.3 Receipt + verify | Recomputed in the browser; tamper test | `/receipt/[id]` |
| 1.3 Shared ledger | Same component the exco sees | `/member/ledger` |
| 1.3 Payment history | By session, across associations | `/member/history` |
| 1.3 Join association | By code or invite link | `/join` |

## How it's built

```
src/
  app/                 routes (see table above)
    (auth)/            log in, sign up, verify, welcome
    (flow)/            setup, join, claim: focused, no navigation
    exco/  member/     the two portals, each wrapped in AppShell
    receipt/[id]/      public, shareable
  components/
    ledger/            LedgerHead (the balance), LedgerFeed (the statement),
                       BalanceSparkline, LiveIndicator, LedgerPage
    payouts/           SignatureTrack
    shell/             AppShell (rail on desktop, tab bar on phones), Logo
    ui/                Button, Field, Dialog, Callout, Meter, Tag, Toast...
  lib/
    types.ts           domain types, mirroring the spec's backend models
    store.tsx          the demo backend: actions + selectors
    mock/seed.ts       all demo data, in one place
    receipt-hash.ts    the receipt fingerprint (sha256), issue + verify
    format.ts csv.ts banks.ts
```

**Connecting the real backend.** Screens only talk to `useDb()` / `useStore()`
in `src/lib/store.tsx`. Every action there (`payDues`, `decidePayout`,
`recordManualPayment`, ...) is async and returns `{ ok, value | error }`.
Replace each body with a `fetch` to the matching endpoint in
[`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) and the screens don't change.
Replace the fake live feed with a WebSocket or SSE subscription that appends
ledger entries through the same path the fake feed uses (`markFresh` in the store), so they animate in.

**The rules the store enforces are the ones the server must enforce:**

- Payouts need distinct signatures up to the threshold (minimum 2). Asking
  counts as a signature only if the asker is a signatory.
- A payout can't exceed the bank balance less what's already promised to
  payouts still waiting or sending, and is re-checked when it's sent.
- A disconnected bank account stops everything: no payments, no approvals,
  and payouts already approved fail instead of sending.
- The ledger is append-only. Corrections are new entries that point at the
  old one.
- Payments and payouts carry an idempotency key and run once per key; a
  failed attempt can be corrected and retried.
- An invite can only be claimed with the email or phone it was sent to. A
  blank field never matches, and resending an invite issues a new code.
- Exco actions check that the caller is exco of that association. Joining by
  code only ever makes you a member.
- Exported CSVs neutralise cells that spreadsheets would run as formulas.

The UI shows these rules; it must never be the only thing enforcing them.

**Design.** See [`docs/DESIGN.md`](docs/DESIGN.md) for the palette, type,
layout and the reasoning behind them.

## Known gaps

- Roster upload reads CSV only. Excel files get a clear "save as CSV" message.
  Direct `.xlsx` support needs a parser library (SheetJS).
- Card payment hands off to "Ecobank's card page"; the real redirect URL comes
  from the Collection API.
- PINs and OTPs accept any digits in the demo (`000000` shows the error path).
- Notification switches are local UI only; they need a preferences endpoint.
