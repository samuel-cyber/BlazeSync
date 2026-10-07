/**
 * BlazeSync API client (per the backend handoff §3–§9).
 *
 * Every response is mapped into the frontend domain types so screens keep
 * working unchanged. Money arrives as a string ("2500.00") and is converted
 * to kobo immediately; timestamps arrive ISO-8601 and pass through.
 */

import type {
  Association,
  Channel,
  Disbursement,
  DuesCycle,
  LedgerEntry,
  Level,
  MemberRecord,
  Payment,
  Role,
} from "./types";

export const API_URL: string = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

// ---------------------------------------------------------------- tokens

const TOKEN_KEY = "blazesync.tokens.v1";

export interface Tokens {
  access: string;
  refresh: string;
  /** ISO instant when the access token expires (expires_in seconds). */
  accessExpiresAt: number;
}

/** In-memory copy + localStorage for session continuity across reloads. */
const memory: { tokens: Tokens | null } = { tokens: null };

export function loadTokens(): Tokens | null {
  if (memory.tokens) return memory.tokens;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    memory.tokens = JSON.parse(raw) as Tokens;
  } catch {}
  return memory.tokens;
}

export function saveTokens(t: { access_token: string; refresh_token: string; expires_in: number }) {
  const tokens: Tokens = {
    access: t.access_token,
    refresh: t.refresh_token,
    accessExpiresAt: Date.now() + (t.expires_in - 30) * 1000,
  };
  memory.tokens = tokens;
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  } catch {}
}

export function clearTokens() {
  memory.tokens = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function hasTokens(): boolean {
  return !!loadTokens();
}

// ---------------------------------------------------------------- errors

export class ApiError extends Error {
  status: number;
  /** Machine-readable buckets the screens already know how to explain. */
  code: string;
  constructor(status: number, message: string, code = "http_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function bucket(status: number, detail: string): string {
  if (status === 401) return "unauthenticated";
  if (status === 403) {
    if (/claim your invite/i.test(detail)) return "not_claimed";
    if (/password/i.test(detail)) return "bad_password";
    return "forbidden";
  }
  if (status === 402) return "payment_declined";
  if (status === 404) return "not_found";
  if (status === 409) {
    if (/already.*member|already claimed|already voted|already a member/i.test(detail)) return "already";
    if (/closed/i.test(detail)) return "cycle_closed";
    return "conflict";
  }
  if (status === 502 || status === 503) return "provider_unavailable";
  return "http_error";
}

// ---------------------------------------------------------------- core

interface Opts {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  formData?: FormData;
  /** Skip the Authorization header + refresh logic (auth endpoints). */
  raw?: boolean;
  /** Return the parsed body even on non-2xx. */
  ok?: boolean;
  headers?: Record<string, string>;
  idemKey?: string;
  signal?: AbortSignal;
}

let refreshing: Promise<void> | null = null;

/**
 * Mint a fresh token pair from the refresh token (rotated server-side).
 * Exported for the live socket, which must refresh before reconnecting.
 */
export async function refreshTokens(): Promise<boolean> {
  if (refreshing) return refreshing.then(() => true).catch(() => false);
  refreshing = (async () => {
    const t = loadTokens();
    if (!t?.refresh) throw new Error("no refresh token");
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: t.refresh }),
    });
    if (!res.ok) {
      clearTokens();
      throw new Error("refresh failed");
    }
    saveTokens(await res.json());
  })();
  try {
    await refreshing;
    return true;
  } catch {
    return false;
  } finally {
    refreshing = null;
  }
}

function toKobo(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  return Math.round(parseFloat(String(s)) * 100);
}

// ---------------------------------------------------------------- endpoints

export const api = {
  async request<T>(path: string, opts: Opts = {}): Promise<T> {
    const doFetch = () => {
      const headers: Record<string, string> = { ...opts.headers };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.idemKey) headers["Idempotency-Key"] = opts.idemKey;
      const token = loadTokens()?.access;
      if (token && !opts.raw) headers.Authorization = `Bearer ${token}`;
      return fetch(`${API_URL}${path}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        signal: opts.signal,
      });
    };

    let res = await doFetch();
    if (res.status === 401 && !opts.raw) {
      const ok = await refreshTokens();
      if (ok) res = await doFetch();
      else throw new ApiError(401, "Your session has expired. Log in again.", "unauthenticated");
    }

    if (!res.ok && opts.ok) {
      // Caller opted out of throwing; they ignore the body (logout uses this).
      return { ok: false as const } as T;
    }

    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try {
        const data = await res.json();
        detail =
          typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data.detail)
              ? data.detail.map((d: { msg?: string }) => d.msg).join("; ")
              : detail;
      } catch {}
      throw new ApiError(res.status, detail, bucket(res.status, detail));
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  },

  // ---------------- auth
  async register(input: { name: string; email: string; phone?: string; password: string }) {
    const pair = await api.request<{ access_token: string; refresh_token: string; expires_in: number }>(
      "/api/v1/auth/register",
      { method: "POST", body: input, raw: true },
    );
    saveTokens(pair);
  },
  async login(email: string, password: string) {
    const pair = await api.request<{ access_token: string; refresh_token: string; expires_in: number }>(
      "/api/v1/auth/login",
      { method: "POST", body: { email, password }, raw: true },
    );
    saveTokens(pair);
  },
  async logout() {
    const t = loadTokens();
    if (t?.refresh) {
      await api.request("/api/v1/auth/logout", { method: "POST", body: { refresh_token: t.refresh }, raw: true, ok: true }).catch(() => {});
    }
    clearTokens();
  },

  // ---------------- memberships
  memberships(): Promise<MembershipsResponse> {
    return api.request("/api/v1/auth/me/memberships");
  },

  // ---------------- associations
  createAssociation(input: { name: string; institution: string; department_or_faculty: string; approval_threshold: number }): Promise<ApiAssociation> {
    return api.request("/api/v1/associations", { method: "POST", body: input });
  },
  association(id: string): Promise<ApiAssociation> {
    return api.request(`/api/v1/associations/${id}`);
  },
  associationByCode(code: string): Promise<ApiAssociation> {
    return api.request(`/api/v1/associations/by-code/${encodeURIComponent(code)}`);
  },
  patchAssociation(id: string, patch: { approval_threshold: number }): Promise<ApiAssociation> {
    return api.request(`/api/v1/associations/${id}`, { method: "PATCH", body: patch });
  },
  audit(assocId: string, limit = 100): Promise<AuditResponse> {
    return api.request(`/api/v1/associations/${assocId}/audit?limit=${limit}`);
  },
  invitePreview(code: string): Promise<InvitePreview> {
    return api.request(`/api/v1/invites/${encodeURIComponent(code)}`);
  },
  join(assocId: string, input: { full_name: string; matric_number: string; level: string }) {
    return api.request<{ ok: boolean; member_record_id: string }>(`/api/v1/associations/${assocId}/join`, { method: "POST", body: input });
  },
  linkAccount(assocId: string, account_ref: string) {
    return api.request<{ ok: boolean; account_ref: string; verified_balance: string }>(
      `/api/v1/associations/${assocId}/link-account`,
      { method: "POST", body: { account_ref } },
    );
  },
  inviteExco(assocId: string, input: { name: string; email: string }) {
    return api.request<{ ok: boolean; user_id: string; temporary_password: string | null; note: string }>(
      `/api/v1/associations/${assocId}/invite-exco`,
      { method: "POST", body: input },
    );
  },

  // ---------------- roster
  uploadRoster(assocId: string, file: File): Promise<RosterUploadResponse> {
    const fd = new FormData();
    fd.append("file", file);
    return api.request(`/api/v1/associations/${assocId}/roster/upload`, { method: "POST", formData: fd });
  },
  sendInvites(assocId: string): Promise<{ sent: number }> {
    return api.request(`/api/v1/associations/${assocId}/roster/send-invites`, { method: "POST", body: {} });
  },
  roster(assocId: string): Promise<RosterResponse> {
    return api.request(`/api/v1/associations/${assocId}/roster`);
  },
  claim(invite_code: string, email: string) {
    return api.request<{ ok: boolean; association_id: string; member_record_id: string }>("/api/v1/roster/claim", {
      method: "POST",
      body: { invite_code, email },
    });
  },
  markPaid(assocId: string, recordId: string, amount?: number, note?: string) {
    return api.request<{ ok: boolean; payment_id: string; amount: string }>(
      `/api/v1/associations/${assocId}/roster/${recordId}/mark-paid`,
      { method: "POST", body: { amount, note } },
    );
  },

  // ---------------- dues + payments
  createCycle(assocId: string, input: { title: string; amount: number; deadline: string; expectation_statement?: string | null; per_level?: Record<string, number> }): Promise<ApiCycle> {
    return api.request(`/api/v1/associations/${assocId}/dues-cycles`, { method: "POST", body: input });
  },
  cycles(assocId: string): Promise<{ items: ApiCycle[] }> {
    return api.request(`/api/v1/associations/${assocId}/dues-cycles`);
  },
  patchCycle(cycleId: string, patch: { title?: string; deadline?: string; status?: "active" | "closed"; expectation_statement?: string | null }): Promise<ApiCycle> {
    return api.request(`/api/v1/dues-cycles/${cycleId}`, { method: "PATCH", body: patch });
  },
  pay(cycleId: string, paid_via: string, idempotency_key: string): Promise<ApiPayment> {
    return api.request(`/api/v1/dues-cycles/${cycleId}/pay`, { method: "POST", body: { paid_via, idempotency_key } });
  },
  receipt(paymentId: string): Promise<ApiReceipt> {
    return api.request(`/api/v1/payments/${paymentId}/receipt`);
  },
  myPayments(): Promise<{ items: ApiPayment[] }> {
    return api.request("/api/v1/users/me/payments");
  },
  askQuestion(assocId: string, question: string): Promise<{ answer: string; grounded_via: string }> {
    return api.request(`/api/v1/associations/${assocId}/ask`, { method: "POST", body: { question } });
  },
  provisionAccounts(assocId: string): Promise<{ ok: boolean; issued: number; skipped_previously_provisioned: number; failed: number; failed_ids?: string[]; total_on_roster: number }> {
    return api.request(`/api/v1/associations/${assocId}/roster/provision-accounts`, { method: "POST", body: {} });
  },

  // ---------------- ledger
  ledger(assocId: string, limit = 50, offset = 0): Promise<LedgerResponse> {
    return api.request(`/api/v1/associations/${assocId}/ledger?limit=${limit}&offset=${offset}`);
  },
  reconcile(assocId: string): Promise<ReconcileResponse> {
    return api.request(`/api/v1/associations/${assocId}/balance/reconcile`);
  },

  // ---------------- disbursements
  createDisbursement(
    assocId: string,
    input: { amount: number; reason: string; recipient_name: string; recipient_account_number: string; recipient_bank_code: string; idempotency_key: string },
  ): Promise<ApiDisbursement> {
    return api.request(`/api/v1/associations/${assocId}/disbursements`, { method: "POST", body: input });
  },
  disbursements(assocId: string, status?: string): Promise<{ items: ApiDisbursement[] }> {
    return api.request(`/api/v1/associations/${assocId}/disbursements${status ? `?status=${status}` : ""}`);
  },
  approveDisbursement(id: string): Promise<ApiDisbursement> {
    return api.request(`/api/v1/disbursements/${id}/approve`, { method: "POST", body: {} });
  },
  rejectDisbursement(id: string, password: string): Promise<ApiDisbursement> {
    return api.request(`/api/v1/disbursements/${id}/reject`, { method: "POST", body: { password } });
  },
};

// ---------------------------------------------------------------- wire types

export interface ApiAssociation {
  id: string;
  name: string;
  institution: string;
  department_or_faculty: string;
  approval_threshold: number;
  account_linked: boolean;
  treasury_account_ref: string | null;
  your_role: Role;
  created_at: string;
}

export interface ApiCycle {
  id: string;
  association_id: string;
  title: string;
  amount: string;
  /** What the money funds — shown on every receipt. */
  expectation_statement: string | null;
  per_level: Record<string, string> | null;
  deadline: string;
  status: "active" | "closed";
  created_at: string;
}

export interface ApiPayment {
  id: string;
  dues_cycle_id: string;
  member_record_id?: string;
  amount: string;
  paid_via: Channel;
  status: "pending" | "success" | "failed";
  ecobank_transaction_ref: string | null;
  timestamp: string;
  receipt_hash: string | null;
  expectation_statement: string | null;
}

export interface ApiReceipt {
  payment_id: string;
  amount: string;
  paid_via: Channel;
  status: string;
  ecobank_transaction_ref: string | null;
  timestamp: string;
  receipt_hash: string | null;
  recomputed_hash: string | null;
  verified: boolean;
  /** What the money funds, as written on the payer's receipt. */
  expectation_statement: string | null;
}

export interface ApiDisbursement {
  id: string;
  association_id: string;
  requested_by: string;
  requested_by_name?: string | null;
  amount: string;
  reason: string;
  recipient: { name?: string; account_number?: string; bank_code?: string };
  status: "pending" | "approved" | "rejected" | "completed";
  ecobank_transaction_ref: string | null;
  approvals: { approved_by: string; name?: string | null; decision: "approved" | "rejected"; timestamp: string }[];
  approval_threshold: number | null;
  created_at: string;
}

export interface LedgerResponse {
  balance: string;
  total: number;
  items: {
    id: string;
    type: "inflow" | "outflow";
    amount: string;
    reason_or_category: string;
    linked_payment_id: string | null;
    linked_disbursement_id: string | null;
    linked_entry_id: string | null;
    running_balance: string;
    created_at: string;
  }[];
}

export interface ReconcileResponse {
  association_id: string;
  ledger_balance: string;
  ecobank_balance: string | null;
  drift: string | null;
  status: "in_sync" | "drifted" | "not_linked" | "unavailable";
  message?: string;
  checked_at?: string;
}

export interface MembershipsResponse {
  user: { id: string; name: string; email: string; phone: string | null };
  items: {
    association_id: string;
    role: "treasurer" | "exco" | "member";
    name: string;
    institution: string;
    department_or_faculty: string;
    approval_threshold: number;
    account_linked: boolean;
    created_at: string;
  }[];
}

export interface RosterResponse {
  cycle: { id: string; title: string; amount: string } | null;
  summary: { total: number; claimed: number; unclaimed: number };
  items: {
    id: string;
    name: string;
    matric_number: string | null;
    email: string;
    phone: string | null;
    claimed: boolean;
    claimed_by: string | null;
    claimed_by_id: string | null;
    invite_status: "pending" | "sent" | "claimed" | "expired";
    paid: boolean | null;
  }[];
}

export interface AuditResponse {
  total: number;
  items: {
    id: string;
    actor_id: string | null;
    actor_name: string;
    action: string;
    summary: string;
    metadata: Record<string, unknown>;
    timestamp: string;
  }[];
}

export interface InvitePreview {
  name: string;
  matric_number: string | null;
  invite_status: "pending" | "sent" | "claimed" | "expired";
  created_at: string;
  association: { id: string; name: string; institution: string; department_or_faculty: string };
  cycle: { id: string; title: string; amount: string } | null;
  paid_amount: string | null;
}

export interface RosterUploadResponse {
  created: number;
  invites: { name: string; email: string; invite_code: string }[];
  note: string;
}
