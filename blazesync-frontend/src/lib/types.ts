/**
 * Domain types. These mirror the backend models in the build spec (sections
 * 2 and 3) so the FastAPI team and this frontend agree on shape. Money is
 * always an integer number of kobo, never a float of naira.
 */

export type Kobo = number;
export type ISODate = string;

export type Role = "exco" | "member";

export type ExcoTitle =
  | "Treasurer"
  | "Financial Secretary"
  | "President"
  | "Vice President"
  | "General Secretary"
  | "Other";

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface Association {
  id: string;
  name: string;
  shortName: string;
  institution: string;
  faculty: string;
  department: string;
  joinCode: string;
  /** Ecobank business account linked through the consent flow (spec 5.1). */
  linkedAccount: LinkedAccount | null;
  approvalRule: { required: number; of: number };
  createdAt: ISODate;
}

export interface LinkedAccount {
  bank: "Ecobank";
  accountName: string;
  last4: string;
  linkedAt: ISODate;
  linkedBy: string;
  /** What the consent grants. Shown to members as well as exco. */
  scopes: ("balance" | "collect" | "payout")[];
}

export interface ExcoMember {
  userId: string;
  associationId: string;
  title: ExcoTitle;
  isSignatory: boolean;
  status: "active" | "invited";
}

export type Level = "100L" | "200L" | "300L" | "400L" | "500L";

/** A roster entry: who is expected to pay, whether or not they use the app. */
export interface MemberRecord {
  id: string;
  associationId: string;
  name: string;
  matric: string;
  level: Level;
  email: string;
  phone: string;
  /** Null until the person claims their invite (spec 3.1). */
  userId: string | null;
  invite: {
    status: "not_sent" | "sent" | "claimed" | "expired";
    code: string;
    sentAt: ISODate | null;
    claimedAt: ISODate | null;
  };
  source: "roster" | "join_code";
  /** Ecobank account-opening lifecycle (spec: open account, then mandate). */
  accountStatus: "none" | "opening_pending" | "opened";
  /** The member's Ecobank account number, set once account opening completes. */
  linkedAccountRef: string | null;
  /** Direct-debit mandate status — "active" enables automatic dues pulls. */
  mandateStatus: "pending" | "active" | "revoked" | null;
}

export interface DuesCycle {
  id: string;
  associationId: string;
  title: string;
  amount: Kobo;
  /** What the money funds — printed on every receipt (spec 2). */
  expectationStatement: string | null;
  /** Optional per-level amounts; falls back to `amount`. */
  perLevel: Partial<Record<Level, Kobo>> | null;
  deadline: ISODate;
  openedAt: ISODate;
  status: "open" | "closed";
  closedAt: ISODate | null;
}

export type Channel = "blaze" | "bank_transfer" | "card" | "cash" | "direct_transfer";

export interface Payment {
  id: string;
  associationId: string;
  cycleId: string;
  memberRecordId: string;
  amount: Kobo;
  fee: Kobo;
  channel: Channel;
  /** Present when an exco marked it paid outside the app (spec 3.2, step 6). */
  recordedBy: string | null;
  note: string | null;
  txRef: string;
  paidAt: ISODate;
  receiptId: string;
}

export type LedgerCategory =
  | "Dues"
  | "Opening balance"
  | "Sponsorship"
  | "Event"
  | "Welfare"
  | "Printing"
  | "Transport"
  | "Logistics"
  | "Refund"
  | "Correction";

/** Append-only (spec 6.3). A correction is a new entry that points at the old one. */
export interface LedgerEntry {
  id: string;
  associationId: string;
  direction: "in" | "out";
  amount: Kobo;
  category: LedgerCategory;
  description: string;
  counterparty: string;
  at: ISODate;
  balanceAfter: Kobo;
  /** Cash recorded by an exco that has not reached the bank yet. */
  cashInHand: boolean;
  paymentId: string | null;
  disbursementId: string | null;
  correctsEntryId: string | null;
}

export interface Receipt {
  id: string;
  paymentId: string;
  payerName: string;
  payerId: string;
  associationId: string;
  associationName: string;
  cycleTitle: string;
  amount: Kobo;
  fee: Kobo;
  channel: Channel;
  txRef: string;
  issuedAt: ISODate;
  /** sha256(payerId|amount|issuedAt|associationId|txRef), hex. */
  hash: string;
  /** What the money funds, frozen at payment time on the receipt. */
  expectationStatement: string | null;
}

export type DisbursementStatus =
  | "pending"
  | "approved"
  | "processing"
  | "completed"
  | "rejected"
  | "failed";

export interface Approval {
  userId: string;
  decision: "approve" | "reject";
  at: ISODate;
  note: string | null;
}

export interface Disbursement {
  id: string;
  associationId: string;
  amount: Kobo;
  category: LedgerCategory;
  reason: string;
  recipient: { accountName: string; bank: string; accountNumber: string };
  requestedBy: string;
  requestedAt: ISODate;
  approvals: Approval[];
  required: number;
  status: DisbursementStatus;
  completedAt: ISODate | null;
  idempotencyKey: string;
  failureReason: string | null;
}

export interface ReconciliationRun {
  id: string;
  associationId: string;
  at: ISODate;
  ledgerBalance: Kobo;
  cashInHand: Kobo;
  bankBalance: Kobo;
  result: "match" | "drift";
}

export type AuditAction =
  | "signed_in"
  | "roster_uploaded"
  | "invites_sent"
  | "invite_claimed"
  | "cycle_opened"
  | "cycle_closed"
  | "payment_recorded"
  | "payment_received"
  | "payout_requested"
  | "payout_approved"
  | "payout_rejected"
  | "payout_completed"
  | "account_linked"
  | "rule_changed"
  | "exco_invited";

export interface AuditEvent {
  id: string;
  associationId: string;
  actor: string;
  action: AuditAction;
  summary: string;
  at: ISODate;
  ip: string | null;
}

export interface Session {
  userId: string;
  role: Role;
  associationId: string;
}
