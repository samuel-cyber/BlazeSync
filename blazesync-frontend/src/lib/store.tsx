"use client";

/**
 * The demo backend. Every action here corresponds to one endpoint in
 * docs/API-CONTRACT.md, returns a promise, and simulates network latency, so
 * screens are already written against an async API. Swapping in the FastAPI
 * backend means replacing the bodies of these actions, not the screens.
 *
 * The rules that matter for trust are enforced here the way the server must
 * enforce them: payouts need distinct signatures up to the threshold, the
 * ledger is append-only, repeated requests with the same idempotency key run
 * once, and a member can only claim an invite with the contact it was sent to.
 */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { issueHash } from "./receipt-hash";
import { cashInHandFor, createSeed, DEMO, inviteCode, txRef, type DbState } from "./mock/seed";
import type {
  Association,
  Channel,
  Disbursement,
  DuesCycle,
  ExcoTitle,
  LedgerCategory,
  LedgerEntry,
  Level,
  MemberRecord,
  Payment,
  Role,
  Session,
} from "./types";

const DB_KEY = "blazesync.demo.db.v1";
const SESSION_KEY = "blazesync.demo.session.v1";
const STALE_AFTER = 12 * 3_600_000;
/** Name and contact typed at sign-up, kept for the setup wizard until there's a real account. */
export const SIGNUP_KEY = "blazesync.demo.signup.v1";

export type LiveStatus = "live" | "reconnecting" | "offline" | "paused";

interface Persisted {
  seededAt: number;
  db: DbState;
}

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const rnd = () => Math.random();

export function amountDueFor(record: Pick<MemberRecord, "level">, cycle: DuesCycle): number {
  return cycle.perLevel?.[record.level] ?? cycle.amount;
}

/**
 * Does `contact` match where this invite was sent? Blank never matches, and a
 * blank field on the record is never compared, so a phone-only record can't
 * be claimed by leaving the box empty (spec 3.3).
 */
export function contactMatches(record: Pick<MemberRecord, "email" | "phone">, contact: string): boolean {
  const c = contact.trim().toLowerCase().replace(/[\s()-]/g, "");
  if (!c) return false;
  if (record.email && c === record.email.toLowerCase()) return true;
  const phone = record.phone.replace(/\s+/g, "");
  if (!phone) return false;
  const asIntl = c.startsWith("0") ? `+234${c.slice(1)}` : c.startsWith("234") ? `+${c}` : c;
  return asIntl === phone;
}

/** Money already promised to payouts that haven't finished. */
export function reservedFor(db: DbState, associationId: string): number {
  return db.disbursements
    .filter((d) => d.associationId === associationId && (d.status === "pending" || d.status === "approved" || d.status === "processing"))
    .reduce((s, d) => s + d.amount, 0);
}

/** What a new payout can draw on: the bank balance less everything already promised. */
export function availableFor(db: DbState, associationId: string): number {
  return (db.bankBalance[associationId] ?? 0) - reservedFor(db, associationId);
}

export function feeFor(channel: Channel, amount: number): number {
  if (channel === "bank_transfer") return 5_000;
  if (channel === "card") return Math.round(amount * 0.015) + 3_500;
  return 0;
}

function useStoreValue() {
  const [db, setDb] = useState<DbState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [online, setOnline] = useState(true);
  const [driftOn, setDriftOn] = useState(false);
  const [declineNext, setDeclineNext] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);
  const [roleSwitchTo, setRoleSwitchTo] = useState<string | null>(null);
  // Every entry that arrived live this visit, so lists never replay their entrance for it.
  const [arrived, setArrived] = useState<string[]>([]);
  const [lastEventAt, setLastEventAt] = useState<number>(0);
  const idem = useRef(new Map<string, Promise<unknown>>());
  const dbRef = useRef<DbState | null>(null);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    let loaded: DbState | null = null;
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Persisted;
        if (Date.now() - p.seededAt < STALE_AFTER) loaded = p.db;
      }
    } catch {
      /* storage blocked: fall through to a fresh seed */
    }
    let sess: Session | null = null;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) sess = JSON.parse(raw) as Session;
    } catch {}
    const seeded = loaded ?? createSeed(Date.now());
    if (sess && !sessionIsValid(seeded, sess)) sess = null;
    if (!loaded) {
      try {
        localStorage.setItem(DB_KEY, JSON.stringify({ seededAt: Date.now(), db: seeded } satisfies Persisted));
      } catch {}
    }
    // Hydrate from storage after mount, so server and client render the same first frame.
    /* eslint-disable react-hooks/set-state-in-effect */
    setDb(seeded);
    setSession(sess);
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    setLastEventAt(Date.now());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Saved on every change, before the browser paints it: whatever the screen
  // shows has already been written, so even an instant reload can't lose it.
  const seededAt = useRef(0);
  useLayoutEffect(() => {
    if (!db) return;
    try {
      if (!seededAt.current) {
        const raw = localStorage.getItem(DB_KEY);
        seededAt.current = raw ? (JSON.parse(raw) as Persisted).seededAt : Date.now();
      }
      localStorage.setItem(DB_KEY, JSON.stringify({ seededAt: seededAt.current, db } satisfies Persisted));
    } catch {}
  }, [db]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  }, [session, ready]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const update = useCallback((fn: (d: DbState) => void) => {
    setDb((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  const markFresh = useCallback((id: string) => {
    setFresh((f) => [...f, id]);
    setArrived((a) => [...a, id]);
    setLastEventAt(Date.now());
    setTimeout(() => setFresh((f) => f.filter((x) => x !== id)), 6000);
  }, []);

  /** Append to the ledger. There is deliberately no edit or delete. */
  const appendLedger = (d: DbState, e: Omit<LedgerEntry, "balanceAfter">) => {
    const prev = d.ledger.filter((l) => l.associationId === e.associationId).at(-1);
    const bal = (prev?.balanceAfter ?? 0) + (e.direction === "in" ? e.amount : -e.amount);
    d.ledger.push({ ...e, balanceAfter: bal });
    if (!e.cashInHand) d.bankBalance[e.associationId] = (d.bankBalance[e.associationId] ?? 0) + (e.direction === "in" ? e.amount : -e.amount);
  };

  const writePayment = (
    d: DbState,
    p: { record: MemberRecord; cycle: DuesCycle; channel: Channel; at: string; recordedBy: string | null; note: string | null; ids: { payment: string; receipt: string; entry: string; ref: string } },
  ) => {
    const amount = amountDueFor(p.record, p.cycle);
    const fee = feeFor(p.channel, amount);
    const assoc = d.associations.find((a) => a.id === p.record.associationId)!;
    const payment: Payment = {
      id: p.ids.payment,
      associationId: assoc.id,
      cycleId: p.cycle.id,
      memberRecordId: p.record.id,
      amount,
      fee,
      channel: p.channel,
      recordedBy: p.recordedBy,
      note: p.note,
      txRef: p.ids.ref,
      paidAt: p.at,
      receiptId: p.ids.receipt,
    };
    d.payments.push(payment);
    d.receipts.push({
      id: p.ids.receipt,
      paymentId: payment.id,
      payerName: p.record.name,
      payerId: p.record.id,
      associationId: assoc.id,
      associationName: assoc.shortName,
      cycleTitle: p.cycle.title,
      amount,
      fee,
      channel: p.channel,
      txRef: p.ids.ref,
      issuedAt: p.at,
      hash: issueHash({ payerId: p.record.id, amount, issuedAt: p.at, associationId: assoc.id, txRef: p.ids.ref }),
    });
    appendLedger(d, {
      id: p.ids.entry,
      associationId: assoc.id,
      direction: "in",
      amount,
      category: "Dues",
      description: p.recordedBy ? `${p.cycle.title}, recorded by exco` : p.cycle.title,
      counterparty: p.record.name,
      at: p.at,
      cashInHand: p.channel === "cash",
      paymentId: payment.id,
      disbursementId: null,
      correctsEntryId: null,
    });
    const ledgerBalance = d.ledger.filter((l) => l.associationId === assoc.id).at(-1)!.balanceAfter;
    const cashInHand = cashInHandFor(d.ledger, assoc.id);
    const bankBalance = d.bankBalance[assoc.id];
    d.reconciliation.unshift({
      id: rid("rc"),
      associationId: assoc.id,
      at: p.at,
      ledgerBalance,
      cashInHand,
      bankBalance,
      result: bankBalance === ledgerBalance - cashInHand ? "match" : "drift",
    });
    return payment;
  };

  const audit = (d: DbState, associationId: string, actor: string, action: DbState["audit"][number]["action"], summary: string) => {
    d.audit.unshift({ id: rid("au"), associationId, actor, action, summary, at: new Date().toISOString(), ip: actor === "system" ? null : "102.89.34.12" });
  };

  /**
   * Runs an operation once per key: a double-tap or a network retry gets the
   * first result back instead of running it again. A failure is forgotten, so
   * correcting the input and trying again isn't stuck replaying the error.
   */
  function once<T>(key: string, op: () => Promise<Result<T>>): Promise<Result<T>> {
    const hit = idem.current.get(key);
    if (hit) return hit as Promise<Result<T>>;
    const p = op();
    idem.current.set(key, p);
    p.then((r) => {
      if (!r.ok) idem.current.delete(key);
    });
    return p;
  }

  /** Exco-only actions check membership here, the way the server's permission layer must. */
  const isExco = (associationId: string) => !!session && dbRef.current!.exco.some((e) => e.associationId === associationId && e.userId === session.userId);
  const isSignatory = (associationId: string) =>
    !!session && dbRef.current!.exco.some((e) => e.associationId === associationId && e.userId === session.userId && e.isSignatory);
  const linked = (associationId: string) => !!dbRef.current!.associations.find((a) => a.id === associationId)?.linkedAccount;

  // ---------------------------------------------------------------- live feed
  const liveStatus: LiveStatus = !online ? "offline" : !liveEnabled ? "paused" : "live";

  /**
   * One member payment arriving from the bank: the same path a real webhook
   * takes. The live feed calls it on a timer; the demo guide can call it on
   * demand. Returns false when nobody is left to pay (or payments are off).
   */
  function landPayment(assocId: string, excludeUserId: string | null): boolean {
    const d = dbRef.current;
    if (!d) return false;
    const cycle = linked(assocId) ? d.cycles.find((c) => c.associationId === assocId && c.status === "open") : undefined;
    const unpaid = cycle
      ? d.roster.filter(
          // Never the demo member: her own payment is part of the demo script.
          (r) =>
            r.associationId === assocId &&
            r.userId &&
            r.userId !== excludeUserId &&
            r.userId !== DEMO.member &&
            !d.payments.some((p) => p.memberRecordId === r.id && p.cycleId === cycle.id),
        )
      : [];
    if (!cycle || !unpaid.length) return false;
    const record = unpaid[Math.floor(rnd() * unpaid.length)];
    const ids = { payment: rid("p"), receipt: rid("r"), entry: rid("l"), ref: txRef(rnd) };
    const x = rnd();
    const channel: Channel = x < 0.75 ? "blaze" : x < 0.92 ? "bank_transfer" : "card";
    update((draft) => {
      const r = draft.roster.find((m) => m.id === record.id)!;
      const c = draft.cycles.find((m) => m.id === cycle.id)!;
      if (draft.payments.some((p) => p.memberRecordId === r.id && p.cycleId === c.id)) return;
      writePayment(draft, { record: r, cycle: c, channel, at: new Date().toISOString(), recordedBy: null, note: null, ids });
      audit(draft, assocId, "system", "payment_received", `Ecobank confirmed ${r.name}'s dues payment`);
    });
    markFresh(ids.entry);
    return true;
  }

  useEffect(() => {
    if (!ready || !session || liveStatus !== "live") return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      landPayment(session.associationId, session.userId);
      timer = setTimeout(tick, 14_000 + rnd() * 9_000);
    };
    timer = setTimeout(tick, 9_000 + rnd() * 4_000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, session?.associationId, session?.userId, liveStatus]);

  /** Demo: land a payment right now instead of waiting for the feed. */
  const landPaymentNow = () => landPayment(session?.associationId ?? DEMO.association, session?.userId ?? null);

  // ---------------------------------------------------------------- session
  /**
   * `next` is where the switch is heading. Without it, the portal still on
   * screen sees the role change and sends you to that role's home, racing the
   * navigation you actually asked for.
   */
  const signInDemo = useCallback((role: Role, associationId: string = DEMO.association, next: string | null = null) => {
    setRoleSwitchTo(next);
    setSession({ role, userId: role === "exco" ? DEMO.exco : DEMO.member, associationId });
  }, []);

  const signOut = useCallback(() => setSession(null), []);

  const switchAssociation = useCallback((associationId: string) => {
    setSession((s) => (s ? { ...s, associationId } : s));
  }, []);

  // ---------------------------------------------------------------- member actions
  async function payDues(input: { cycleId: string; recordId: string; channel: Channel; idempotencyKey: string }): Promise<Result<{ receiptId: string; entryId: string }>> {
    return once(input.idempotencyKey, async () => {
      await wait(1800);
      if (declineNext) {
        setDeclineNext(false);
        return { ok: false as const, error: "insufficient_funds" };
      }
      const d = dbRef.current!;
      const cycle = d.cycles.find((c) => c.id === input.cycleId);
      if (!cycle || cycle.status !== "open") return { ok: false as const, error: "cycle_closed" };
      if (!linked(cycle.associationId)) return { ok: false as const, error: "no_account" };
      if (d.payments.some((p) => p.memberRecordId === input.recordId && p.cycleId === input.cycleId)) {
        return { ok: false as const, error: "already_paid" };
      }
      const ids = { payment: rid("p"), receipt: rid("r"), entry: rid("l"), ref: txRef(rnd) };
      update((draft) => {
        const record = draft.roster.find((r) => r.id === input.recordId)!;
        const cycle = draft.cycles.find((c) => c.id === input.cycleId)!;
        writePayment(draft, { record, cycle, channel: input.channel, at: new Date().toISOString(), recordedBy: null, note: null, ids });
        audit(draft, record.associationId, "system", "payment_received", `Ecobank confirmed ${record.name}'s dues payment`);
      });
      markFresh(ids.entry);
      return { ok: true as const, value: { receiptId: ids.receipt, entryId: ids.entry } };
    });
  }

  async function claimInvite(code: string, contact: string): Promise<Result<{ associationId: string; recordId: string }>> {
    await wait(900);
    const d = dbRef.current!;
    const record = d.roster.find((r) => r.invite.code === code.trim().toUpperCase());
    if (!record) return { ok: false, error: "not_found" };
    if (record.invite.status === "claimed") return { ok: false, error: "claimed" };
    if (record.invite.status === "expired") return { ok: false, error: "expired" };
    if (!contactMatches(record, contact)) return { ok: false, error: "mismatch" };
    const userId = `u_${record.id}`;
    update((draft) => {
      const r = draft.roster.find((m) => m.id === record.id)!;
      if (!draft.users.some((u) => u.id === userId)) draft.users.push({ id: userId, name: r.name, email: r.email, phone: r.phone });
      r.userId = userId;
      r.invite.status = "claimed";
      r.invite.claimedAt = new Date().toISOString();
      audit(draft, r.associationId, userId, "invite_claimed", `${r.name} claimed their roster invite`);
    });
    setSession({ role: "member", userId, associationId: record.associationId });
    return { ok: true, value: { associationId: record.associationId, recordId: record.id } };
  }

  async function findAssociationByCode(code: string): Promise<Result<Association>> {
    await wait(700);
    const a = dbRef.current!.associations.find((x) => x.joinCode.toUpperCase() === code.trim().toUpperCase());
    return a ? { ok: true, value: a } : { ok: false, error: "not_found" };
  }

  async function joinByCode(input: { associationId: string; name: string; matric: string; level: Level }): Promise<Result> {
    await wait(900);
    const d = dbRef.current!;
    if (d.roster.some((r) => r.associationId === input.associationId && r.matric === input.matric.trim())) {
      return { ok: false, error: "matric_taken" };
    }
    // Joining makes you a member of that association, nothing more. An exco
    // elsewhere doesn't carry their role across, and a visitor without a
    // session gets a new account rather than someone else's.
    const userId = session?.userId ?? rid("u");
    const user = d.users.find((u) => u.id === userId);
    update((draft) => {
      if (!user) draft.users.push({ id: userId, name: input.name.trim(), email: "", phone: "" });
      draft.roster.push({
        id: rid("m"),
        associationId: input.associationId,
        name: input.name.trim(),
        matric: input.matric.trim(),
        level: input.level,
        email: user?.email ?? "",
        phone: user?.phone ?? "",
        userId,
        invite: { status: "claimed", code: inviteCode(rnd), sentAt: null, claimedAt: new Date().toISOString() },
        source: "join_code",
      });
      audit(draft, input.associationId, userId, "invite_claimed", `${input.name.trim()} joined with the association code`);
    });
    setSession({ role: "member", userId, associationId: input.associationId });
    return { ok: true, value: undefined };
  }

  // ---------------------------------------------------------------- exco actions
  async function recordManualPayment(input: { recordId: string; cycleId: string; channel: "cash" | "direct_transfer"; note: string }): Promise<Result<{ entryId: string }>> {
    await wait(700);
    const d = dbRef.current!;
    const cycle = d.cycles.find((c) => c.id === input.cycleId);
    if (!cycle || !isExco(cycle.associationId)) return { ok: false, error: "not_exco" };
    if (d.payments.some((p) => p.memberRecordId === input.recordId && p.cycleId === input.cycleId)) return { ok: false, error: "already_paid" };
    const ids = { payment: rid("p"), receipt: rid("r"), entry: rid("l"), ref: txRef(rnd, "MAN") };
    update((draft) => {
      const record = draft.roster.find((r) => r.id === input.recordId)!;
      const cycle = draft.cycles.find((c) => c.id === input.cycleId)!;
      writePayment(draft, { record, cycle, channel: input.channel, at: new Date().toISOString(), recordedBy: session!.userId, note: input.note || null, ids });
      audit(draft, record.associationId, session!.userId, "payment_recorded", `Marked ${record.name} as paid (${input.channel === "cash" ? "cash" : "direct transfer"})`);
    });
    markFresh(ids.entry);
    return { ok: true, value: { entryId: ids.entry } };
  }

  async function importRoster(associationId: string, rows: { name: string; matric: string; email: string; phone: string; level: Level }[], fileName: string): Promise<Result<number>> {
    await wait(1100);
    if (!isExco(associationId)) return { ok: false, error: "not_exco" };
    update((draft) => {
      for (const row of rows) {
        draft.roster.push({
          id: rid("m"),
          associationId,
          ...row,
          userId: null,
          invite: { status: "not_sent", code: inviteCode(rnd), sentAt: null, claimedAt: null },
          source: "roster",
        });
      }
      audit(draft, associationId, session!.userId, "roster_uploaded", `Uploaded ${rows.length} members from ${fileName}`);
    });
    return { ok: true, value: rows.length };
  }

  async function sendInvites(associationId: string, recordIds: string[], channels: ("email" | "sms")[]): Promise<Result<number>> {
    await wait(1200);
    if (!isExco(associationId)) return { ok: false, error: "not_exco" };
    const codes = new Map(recordIds.map((id) => [id, inviteCode(rnd)]));
    update((draft) => {
      for (const r of draft.roster) {
        if (codes.has(r.id) && r.invite.status !== "claimed") {
          // A fresh code on every send: the previous link, expired or not, stops working.
          r.invite.status = "sent";
          r.invite.sentAt = new Date().toISOString();
          r.invite.code = codes.get(r.id)!;
        }
      }
      audit(draft, associationId, session!.userId, "invites_sent", `Sent ${recordIds.length} invites by ${channels.join(" and ").replace("sms", "SMS")}`);
    });
    return { ok: true, value: recordIds.length };
  }

  async function openCycle(input: { associationId: string; title: string; amount: number; perLevel: Partial<Record<Level, number>> | null; deadline: string }): Promise<Result<string>> {
    await wait(900);
    const d = dbRef.current!;
    if (!isExco(input.associationId)) return { ok: false, error: "not_exco" };
    if (d.cycles.some((c) => c.associationId === input.associationId && c.status === "open")) return { ok: false, error: "already_open" };
    const id = rid("c");
    update((draft) => {
      draft.cycles.push({ id, associationId: input.associationId, title: input.title, amount: input.amount, perLevel: input.perLevel, deadline: input.deadline, openedAt: new Date().toISOString(), status: "open", closedAt: null });
      audit(draft, input.associationId, session!.userId, "cycle_opened", `Opened ${input.title}`);
    });
    return { ok: true, value: id };
  }

  async function closeCycle(cycleId: string): Promise<Result> {
    await wait(800);
    const cycle = dbRef.current!.cycles.find((x) => x.id === cycleId);
    if (!cycle || !isExco(cycle.associationId)) return { ok: false, error: "not_exco" };
    update((draft) => {
      const c = draft.cycles.find((x) => x.id === cycleId)!;
      c.status = "closed";
      c.closedAt = new Date().toISOString();
      audit(draft, c.associationId, session!.userId, "cycle_closed", `Closed ${c.title}`);
    });
    return { ok: true, value: undefined };
  }

  async function extendCycle(cycleId: string, deadline: string): Promise<Result> {
    await wait(600);
    const cycle = dbRef.current!.cycles.find((x) => x.id === cycleId);
    if (!cycle || !isExco(cycle.associationId)) return { ok: false, error: "not_exco" };
    update((draft) => {
      const c = draft.cycles.find((x) => x.id === cycleId)!;
      c.deadline = deadline;
      audit(draft, c.associationId, session!.userId, "cycle_opened", `Moved the deadline for ${c.title}`);
    });
    return { ok: true, value: undefined };
  }

  async function requestPayout(input: {
    associationId: string;
    amount: number;
    category: LedgerCategory;
    reason: string;
    recipient: Disbursement["recipient"];
    idempotencyKey: string;
  }): Promise<Result<string>> {
    return once(input.idempotencyKey, async () => {
      await wait(1000);
      const d = dbRef.current!;
      if (!isExco(input.associationId)) return { ok: false as const, error: "not_exco" };
      if (!linked(input.associationId)) return { ok: false as const, error: "no_account" };
      // Payouts still waiting or sending have a claim on the money too.
      if (input.amount > availableFor(d, input.associationId)) return { ok: false as const, error: "insufficient" };
      const assoc = d.associations.find((a) => a.id === input.associationId)!;
      // Asking counts as a signature only if the asker is a signatory.
      const signs = isSignatory(input.associationId);
      const id = rid("d");
      update((draft) => {
        draft.disbursements.unshift({
          id,
          associationId: input.associationId,
          amount: input.amount,
          category: input.category,
          reason: input.reason,
          recipient: input.recipient,
          requestedBy: session!.userId,
          requestedAt: new Date().toISOString(),
          approvals: signs ? [{ userId: session!.userId, decision: "approve", at: new Date().toISOString(), note: null }] : [],
          required: assoc.approvalRule.required,
          status: "pending",
          completedAt: null,
          idempotencyKey: input.idempotencyKey,
          failureReason: null,
        });
        audit(draft, input.associationId, session!.userId, "payout_requested", `Requested ₦${(input.amount / 100).toLocaleString("en-NG")} for ${input.reason}`);
      });
      return { ok: true as const, value: id };
    });
  }

  async function decidePayout(id: string, decision: "approve" | "reject", note: string | null): Promise<Result<Disbursement["status"]>> {
    await wait(900);
    const d = dbRef.current!;
    const disb = d.disbursements.find((x) => x.id === id);
    if (!disb) return { ok: false, error: "not_found" };
    const me = session!.userId;
    if (!isSignatory(disb.associationId)) return { ok: false, error: "not_signatory" };
    if (disb.status !== "pending") return { ok: false, error: "not_pending" };
    if (disb.approvals.some((a) => a.userId === me)) return { ok: false, error: "already_signed" };
    if (decision === "approve" && !linked(disb.associationId)) return { ok: false, error: "no_account" };

    const approvesAfter = disb.approvals.filter((a) => a.decision === "approve").length + (decision === "approve" ? 1 : 0);
    const next: Disbursement["status"] = decision === "reject" ? "rejected" : approvesAfter >= disb.required ? "processing" : "pending";
    update((draft) => {
      const x = draft.disbursements.find((y) => y.id === id)!;
      x.approvals.push({ userId: me, decision, at: new Date().toISOString(), note });
      x.status = next;
      audit(draft, x.associationId, me, decision === "approve" ? "payout_approved" : "payout_rejected", `${decision === "approve" ? "Signed" : "Rejected"} the ₦${(x.amount / 100).toLocaleString("en-NG")} payout for ${x.reason}`);
    });
    if (next === "processing") {
      const entryId = rid("l");
      setTimeout(() => {
        // The bank is the last word: no linked account or not enough money, no payout.
        const cur = dbRef.current!;
        const x0 = cur.disbursements.find((y) => y.id === id);
        if (!x0 || x0.status !== "processing") return;
        const failure = !cur.associations.find((a) => a.id === x0.associationId)?.linkedAccount
          ? "The bank account was disconnected before the payout was sent. Nothing left the account."
          : (cur.bankBalance[x0.associationId] ?? 0) < x0.amount
            ? "The account didn't have enough money when the payout was sent. Nothing left the account."
            : null;
        update((draft) => {
          const x = draft.disbursements.find((y) => y.id === id)!;
          if (x.status !== "processing") return;
          if (failure) {
            x.status = "failed";
            x.failureReason = failure;
            audit(draft, x.associationId, "system", "payout_completed", `The ₦${(x.amount / 100).toLocaleString("en-NG")} payout to ${x.recipient.accountName} failed. Nothing was sent.`);
            return;
          }
          x.status = "completed";
          x.completedAt = new Date().toISOString();
          appendLedger(draft, {
            id: entryId,
            associationId: x.associationId,
            direction: "out",
            amount: x.amount,
            category: x.category,
            description: x.reason,
            counterparty: x.recipient.accountName,
            at: x.completedAt,
            cashInHand: false,
            paymentId: null,
            disbursementId: x.id,
            correctsEntryId: null,
          });
          audit(draft, x.associationId, "system", "payout_completed", `Ecobank confirmed the ₦${(x.amount / 100).toLocaleString("en-NG")} payout to ${x.recipient.accountName}`);
        });
        if (!failure) markFresh(entryId);
      }, 3500);
    }
    return { ok: true, value: next };
  }

  async function setApprovalRule(associationId: string, required: number): Promise<Result> {
    await wait(700);
    if (!isExco(associationId)) return { ok: false, error: "not_exco" };
    if (required < 2) return { ok: false, error: "min_two" };
    update((draft) => {
      const a = draft.associations.find((x) => x.id === associationId)!;
      a.approvalRule.required = required;
      audit(draft, associationId, session!.userId, "rule_changed", `Set payouts to need ${required} of ${a.approvalRule.of} signatures`);
    });
    return { ok: true, value: undefined };
  }

  async function inviteExco(associationId: string, input: { name: string; contact: string; title: ExcoTitle; isSignatory: boolean }): Promise<Result> {
    await wait(800);
    if (!isExco(associationId)) return { ok: false, error: "not_exco" };
    const userId = rid("u");
    update((draft) => {
      draft.users.push({ id: userId, name: input.name, email: input.contact.includes("@") ? input.contact : "", phone: input.contact.includes("@") ? "" : input.contact });
      draft.exco.push({ userId, associationId, title: input.title, isSignatory: input.isSignatory, status: "invited" });
      if (input.isSignatory) {
        const a = draft.associations.find((x) => x.id === associationId)!;
        a.approvalRule.of = draft.exco.filter((e) => e.associationId === associationId && e.isSignatory).length;
      }
      audit(draft, associationId, session!.userId, "exco_invited", `Invited ${input.name} as ${input.title}`);
    });
    return { ok: true, value: undefined };
  }

  async function createAssociation(input: {
    name: string;
    shortName: string;
    institution: string;
    faculty: string;
    department: string;
    accountLast4: string;
    cosignatories: { name: string; contact: string; title: ExcoTitle }[];
    required: number;
  }): Promise<Result<string>> {
    await wait(1200);
    const id = rid("a");
    // A brand-new treasurer arriving from sign-up has no session yet: give them their own account.
    const me = session?.userId ?? rid("u");
    let pending: { name?: string; contact?: string } = {};
    try {
      pending = JSON.parse(sessionStorage.getItem(SIGNUP_KEY) ?? "{}");
    } catch {}
    update((draft) => {
      if (!draft.users.some((u) => u.id === me)) {
        const contact = pending.contact ?? "";
        draft.users.push({ id: me, name: pending.name || "Treasurer", email: contact.includes("@") ? contact : "", phone: contact.includes("@") ? "" : contact });
      }
      draft.associations.push({
        id,
        name: input.name,
        shortName: input.shortName,
        institution: input.institution,
        faculty: input.faculty,
        department: input.department,
        joinCode: `${input.shortName.split(/\s+/)[0].toUpperCase().slice(0, 6)}-${Math.floor(1000 + rnd() * 9000)}`,
        linkedAccount: { bank: "Ecobank", accountName: input.shortName.toUpperCase(), last4: input.accountLast4, linkedAt: new Date().toISOString(), linkedBy: me, scopes: ["balance", "collect", "payout"] },
        approvalRule: { required: input.required, of: input.cosignatories.length + 1 },
        createdAt: new Date().toISOString(),
      });
      draft.exco.push({ userId: me, associationId: id, title: "Treasurer", isSignatory: true, status: "active" });
      for (const c of input.cosignatories) {
        const uid = rid("u");
        draft.users.push({ id: uid, name: c.name, email: c.contact.includes("@") ? c.contact : "", phone: c.contact.includes("@") ? "" : c.contact });
        draft.exco.push({ userId: uid, associationId: id, title: c.title, isSignatory: true, status: "invited" });
      }
      draft.bankBalance[id] = 0;
      audit(draft, id, me, "account_linked", `Linked the Ecobank business account ending ${input.accountLast4}`);
    });
    setSession({ role: "exco", userId: me, associationId: id });
    return { ok: true, value: id };
  }

  async function linkAccount(associationId: string, last4: string): Promise<Result> {
    await wait(900);
    if (!isExco(associationId)) return { ok: false, error: "not_exco" };
    update((draft) => {
      const a = draft.associations.find((x) => x.id === associationId)!;
      a.linkedAccount = { bank: "Ecobank", accountName: a.shortName.toUpperCase(), last4, linkedAt: new Date().toISOString(), linkedBy: session!.userId, scopes: ["balance", "collect", "payout"] };
      draft.bankBalance[associationId] = draft.bankBalance[associationId] ?? 0;
      audit(draft, associationId, session!.userId, "account_linked", `Linked the Ecobank business account ending ${last4}`);
    });
    return { ok: true, value: undefined };
  }

  async function disconnectAccount(associationId: string): Promise<Result> {
    await wait(900);
    if (!isExco(associationId)) return { ok: false, error: "not_exco" };
    update((draft) => {
      const a = draft.associations.find((x) => x.id === associationId)!;
      a.linkedAccount = null;
      audit(draft, associationId, session!.userId, "account_linked", "Disconnected the Ecobank business account");
    });
    return { ok: true, value: undefined };
  }

  // ---------------------------------------------------------------- demo controls
  const resetDemo = useCallback(() => {
    const fresh = createSeed(Date.now());
    seededAt.current = Date.now();
    try {
      localStorage.setItem(DB_KEY, JSON.stringify({ seededAt: Date.now(), db: fresh } satisfies Persisted));
    } catch {}
    idem.current.clear();
    setDb(fresh);
    setDriftOn(false);
    // A session pointing at an association the reset removed would crash every page.
    setSession((s) => (s && sessionIsValid(fresh, s) ? s : s ? { role: s.role, userId: s.role === "exco" ? DEMO.exco : DEMO.member, associationId: DEMO.association } : s));
  }, []);

  const simulateDrift = useCallback(
    (on: boolean, associationId?: string) => {
      setDriftOn(on);
      const assocId = associationId ?? session?.associationId;
      if (!assocId) return;
      update((draft) => {
        const bal = draft.ledger.filter((l) => l.associationId === assocId).at(-1)?.balanceAfter ?? 0;
        const cash = cashInHandFor(draft.ledger, assocId);
        // A payment Ecobank settled whose webhook never reached us.
        draft.bankBalance[assocId] = bal - cash + (on ? 200_000 : 0);
        draft.reconciliation.unshift({
          id: rid("rc"),
          associationId: assocId,
          at: new Date().toISOString(),
          ledgerBalance: bal,
          cashInHand: cash,
          bankBalance: draft.bankBalance[assocId],
          result: on ? "drift" : "match",
        });
      });
    },
    [session, update],
  );

  return {
    ready,
    db,
    session,
    fresh,
    arrived,
    roleSwitchTo,
    liveStatus,
    lastEventAt,
    driftOn,
    declineNext,
    setDeclineNext,
    setLiveEnabled,
    signInDemo,
    signOut,
    switchAssociation,
    payDues,
    claimInvite,
    findAssociationByCode,
    joinByCode,
    recordManualPayment,
    importRoster,
    sendInvites,
    openCycle,
    closeCycle,
    extendCycle,
    requestPayout,
    decidePayout,
    setApprovalRule,
    inviteExco,
    createAssociation,
    linkAccount,
    disconnectAccount,
    resetDemo,
    simulateDrift,
    landPaymentNow,
  };
}

export type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const value = useStoreValue();
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore must be used inside <StoreProvider>");
  return s;
}

/** The store once data has loaded. Only call beneath <Ready>. */
export function useDb() {
  const s = useStore();
  if (!s.db) throw new Error("useDb called before the store was ready");
  return { ...s, db: s.db };
}

// ------------------------------------------------------------------ selectors

/** The session's user exists, its association exists, and the role is one they actually hold there. */
export function sessionIsValid(db: DbState, s: Session): boolean {
  if (!db.users.some((u) => u.id === s.userId)) return false;
  if (!db.associations.some((a) => a.id === s.associationId)) return false;
  if (s.role === "exco") return db.exco.some((e) => e.userId === s.userId && e.associationId === s.associationId);
  return db.roster.some((r) => r.userId === s.userId && r.associationId === s.associationId);
}

export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function selectAssociation(db: DbState, id: string) {
  return db.associations.find((a) => a.id === id) ?? null;
}

export function selectLedger(db: DbState, associationId: string) {
  return db.ledger.filter((l) => l.associationId === associationId).reverse();
}

export function selectBalance(db: DbState, associationId: string) {
  return db.ledger.filter((l) => l.associationId === associationId).at(-1)?.balanceAfter ?? 0;
}

export function selectOpenCycle(db: DbState, associationId: string) {
  return db.cycles.find((c) => c.associationId === associationId && c.status === "open") ?? null;
}

export function selectPaymentFor(db: DbState, recordId: string, cycleId: string) {
  return db.payments.find((p) => p.memberRecordId === recordId && p.cycleId === cycleId) ?? null;
}

export function selectMyRecord(db: DbState, userId: string, associationId: string) {
  return db.roster.find((r) => r.associationId === associationId && r.userId === userId) ?? null;
}

export function selectUser(db: DbState, id: string) {
  return db.users.find((u) => u.id === id) ?? null;
}

export function selectMyAssociations(db: DbState, session: Session) {
  if (session.role === "exco") {
    return db.associations.filter((a) => db.exco.some((e) => e.associationId === a.id && e.userId === session.userId));
  }
  return db.associations.filter((a) => db.roster.some((r) => r.associationId === a.id && r.userId === session.userId));
}

export function selectCycleProgress(db: DbState, cycle: DuesCycle) {
  const roster = db.roster.filter((r) => r.associationId === cycle.associationId);
  const paidIds = new Set(db.payments.filter((p) => p.cycleId === cycle.id).map((p) => p.memberRecordId));
  const expected = roster.reduce((s, r) => s + amountDueFor(r, cycle), 0);
  const collected = db.payments.filter((p) => p.cycleId === cycle.id).reduce((s, p) => s + p.amount, 0);
  return {
    total: roster.length,
    paid: roster.filter((r) => paidIds.has(r.id)).length,
    joined: roster.filter((r) => r.userId).length,
    expected,
    collected,
  };
}

export function selectReconciliation(db: DbState, associationId: string) {
  const balance = selectBalance(db, associationId);
  const cash = cashInHandFor(db.ledger, associationId);
  const bank = db.bankBalance[associationId] ?? 0;
  const last = db.reconciliation.find((r) => r.associationId === associationId) ?? null;
  return { balance, cash, bank, drift: bank - (balance - cash), last };
}
