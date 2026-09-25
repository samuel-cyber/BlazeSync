"use client";

import Link from "next/link";
import { CheckCircle2, CreditCard, Landmark, Loader2, SearchX, ShieldCheck, Wallet } from "lucide-react";
import { use, useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, EmptyState, PageHeader, Panel, Steps, Tag } from "@/components/ui/bits";
import { Field, Input } from "@/components/ui/Field";
import { daysUntil, fmtDate, naira, newIdempotencyKey, plural } from "@/lib/format";
import { groupHash } from "@/lib/receipt-hash";
import { amountDueFor, feeFor, selectAssociation, selectMyRecord, selectPaymentFor, useDb, useNow } from "@/lib/store";
import type { Channel } from "@/lib/types";

type Method = Extract<Channel, "blaze" | "bank_transfer" | "card">;
type Phase = "choose" | "confirm" | "paying" | "done" | "failed";

const METHODS: { id: Method; label: string; detail: string; icon: typeof Wallet }[] = [
  { id: "blaze", label: "Blaze account ••7710", detail: "Straight from your Ecobank Blaze account.", icon: Wallet },
  { id: "bank_transfer", label: "Bank transfer", detail: "From any Nigerian bank, to a one-time account number.", icon: Landmark },
  { id: "card", label: "Debit card", detail: "Verve, Mastercard or Visa, on Ecobank's secure card page.", icon: CreditCard },
];

export default function PayPage({ params }: PageProps<"/member/pay/[cycleId]">) {
  const { cycleId } = use(params);
  const { db, session, payDues } = useDb();
  const now = useNow();
  const [method, setMethod] = useState<Method>("blaze");
  const [phase, setPhase] = useState<Phase>("choose");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  // A new key per attempt: a double-tap reuses it, a deliberate retry after a decline gets a fresh one.
  const [key, setKey] = useState(newIdempotencyKey);

  const cycle = db.cycles.find((c) => c.id === cycleId);
  const record = cycle ? selectMyRecord(db, session!.userId, cycle.associationId) : null;
  const existing = cycle && record ? selectPaymentFor(db, record.id, cycle.id) : null;

  if (!cycle || !record) {
    return (
      <EmptyState icon={<SearchX className="size-5" />} title="We can't find these dues" action={<ButtonLink href="/member">Back to home</ButtonLink>}>
        This link may be for an association you&apos;re not in. Your dues are all listed on your home page.
      </EmptyState>
    );
  }

  const assoc = selectAssociation(db, cycle.associationId)!;
  const amount = amountDueFor(record, cycle);
  const fee = feeFor(method, amount);
  const left = daysUntil(cycle.deadline, now);

  if (existing && phase !== "done") {
    return (
      <div className="max-w-xl space-y-5">
        <PageHeader title="You've already paid this" back={{ href: "/member", label: "Home" }} />
        <Callout tone="success" title={`You paid ${naira(existing.amount)} on ${fmtDate(existing.paidAt)}`} action={<ButtonLink href={`/receipt/${existing.receiptId}`} size="sm">See your receipt</ButtonLink>}>
          Nothing more to do for {cycle.title}.
        </Callout>
      </div>
    );
  }

  if (cycle.status !== "open" && phase !== "done") {
    return (
      <div className="max-w-xl">
        <PageHeader title={`Pay ${assoc.shortName}`} back={{ href: "/member", label: "Home" }} />
        <Callout tone="warn" title={`${cycle.title} is closed`}>
          The exco closed it, so it can&apos;t be paid in the app any more. If you still owe it, ask your treasurer how to settle it; they can record a cash or transfer
          payment for you.
        </Callout>
      </div>
    );
  }

  if (!assoc.linkedAccount) {
    return (
      <div className="max-w-xl">
        <PageHeader title={`Pay ${assoc.shortName}`} back={{ href: "/member", label: "Home" }} />
        <Callout tone="warn" title="Payments are paused for this association">
          Its bank account was disconnected, so there&apos;s nowhere safe to send your money. Nothing is due from you until it&apos;s reconnected. Your treasurer has been told.
        </Callout>
      </div>
    );
  }

  const pay = async () => {
    if (method === "blaze" && !/^\d{4}$/.test(pin)) {
      setErr("Enter your 4-digit Blaze PIN.");
      return;
    }
    setErr(null);
    setPhase("paying");
    const r = await payDues({ cycleId: cycle.id, recordId: record.id, channel: method, idempotencyKey: key });
    if (r.ok) {
      setReceiptId(r.value.receiptId);
      setPhase("done");
    } else if (r.error === "already_paid" || r.error === "cycle_closed" || r.error === "no_account") {
      // The page re-renders into the matching explanation (paid, closed, or paused).
      setPhase("choose");
    } else {
      setFailure(r.error);
      setPhase("failed");
    }
  };

  const stepIndex = phase === "choose" ? 0 : phase === "done" ? 2 : 1;

  return (
    <div className="max-w-xl">
      {phase !== "done" && <PageHeader title={`Pay ${assoc.shortName}`} back={{ href: "/member", label: "Home" }} />}
      {phase !== "done" && (
        <div className="mb-6">
          <Steps steps={["Choose how", "Confirm", "Receipt"]} current={stepIndex} />
        </div>
      )}

      {phase !== "done" && (
        <Panel className="mb-6 flex items-end justify-between gap-4 p-4">
          <div>
            <p className="font-semibold">{cycle.title}</p>
            <p className="text-sm text-ink-2">{left > 0 ? `Due ${fmtDate(cycle.deadline)}, ${plural(left, "day")} left` : "Deadline passed"}</p>
          </div>
          <p className="figure text-3xl font-bold">{naira(amount)}</p>
        </Panel>
      )}

      {phase === "choose" && (
        <div className="space-y-6">
          <fieldset className="space-y-3">
            <legend className="mb-3 font-semibold">How do you want to pay?</legend>
            {METHODS.map((m) => {
              const f = feeFor(m.id, amount);
              const on = method === m.id;
              return (
                <label key={m.id} className={`press flex cursor-pointer items-start gap-3 rounded-md border bg-surface px-4 py-4 ${on ? "border-brand ring-1 ring-brand" : "border-rule hover:border-edge"}`}>
                  <input type="radio" name="method" checked={on} onChange={() => setMethod(m.id)} className="mt-1 size-4 accent-[var(--brand)]" />
                  <m.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{m.label}</span>
                      {f === 0 ? <Tag tone="ember">No fee</Tag> : <span className="text-sm text-ink-2">+{naira(f)} fee</span>}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-2">{m.detail}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div className="flex items-baseline justify-between border-t border-rule pt-4">
            <span className="text-ink-2">You pay</span>
            <span className="text-right">
              <span className="figure block text-2xl font-bold">{naira(amount + fee)}</span>
              {fee > 0 && (
                <span className="text-sm text-ink-2">
                  {naira(amount)} dues + {naira(fee)} fee
                </span>
              )}
            </span>
          </div>
          <p className="text-sm text-ink-3">{assoc.shortName} receives {naira(amount)} whichever way you pay.</p>
          <Button className="w-full" onClick={() => setPhase("confirm")}>
            Continue
          </Button>
        </div>
      )}

      {phase === "confirm" && renderConfirm()}

      {phase === "paying" && (
        <div role="status" className="flex flex-col items-center gap-4 py-12 text-center">
          <Loader2 aria-hidden className="size-8 spin text-brand" />
          <p className="text-lg font-semibold">Waiting for Ecobank to confirm</p>
          <p className="max-w-sm text-ink-2">Usually a few seconds. If you close this page, your receipt still arrives when the payment confirms.</p>
        </div>
      )}

      {phase === "failed" && (
        <div className="space-y-5">
          <Callout tone="danger" role="alert" title="Ecobank declined the payment. Nothing was taken from you.">
            {failure === "insufficient_funds"
              ? `Your Blaze account doesn't have ${naira(amount + fee)} available. Top it up, or pay another way.`
              : "The bank didn't say why. Try again in a minute, or pay another way."}
          </Callout>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => {
                setKey(newIdempotencyKey());
                setPin("");
                setPhase("confirm");
              }}
            >
              Try again
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setKey(newIdempotencyKey());
                setPhase("choose");
              }}
            >
              Pay another way
            </Button>
          </div>
        </div>
      )}

      {phase === "done" && receiptId && renderDone(receiptId)}
    </div>
  );

  function renderConfirm() {
    return (
      <div className="space-y-6">
        {method === "blaze" && (
          <Field label="Blaze PIN" error={err} hint="The PIN for your Ecobank Blaze account. Demo: any 4 digits.">
            {(a) => (
              <Input
                {...a}
                autoFocus
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="max-w-40 text-center text-xl tracking-[0.5em]"
              />
            )}
          </Field>
        )}
        {method === "bank_transfer" && <TransferDetails total={amount + fee} />}
        {method === "card" && <p className="text-ink-2">You&apos;ll enter your card on Ecobank&apos;s card page, then come straight back here. BlazeSync never sees your card number.</p>}

        <Button className="w-full" onClick={pay}>
          {method === "bank_transfer" ? "I've sent it" : method === "card" ? `Continue to pay ${naira(amount + fee)}` : `Pay ${naira(amount)}`}
        </Button>
        <p className="flex items-start justify-center gap-2 text-center text-sm text-ink-3">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          Tapping twice won&apos;t charge you twice.
        </p>
        <button type="button" onClick={() => setPhase("choose")} className="mx-auto block text-sm font-semibold text-brand hover:underline">
          Change how you pay
        </button>
      </div>
    );
  }

  function renderDone(receiptId: string) {
    const receipt = db.receipts.find((r) => r.id === receiptId)!;
    return (
      <div className="success space-y-6">
        <CheckCircle2 aria-hidden className="size-10 text-credit" />
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">You paid {naira(receipt.amount)}</h1>
          <p className="text-lg text-ink-2">
            to {assoc.shortName} for {cycle!.title}. Here&apos;s your receipt.
          </p>
        </div>
        <Panel className="space-y-3 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck aria-hidden className="size-4 text-credit" /> Receipt fingerprint
          </p>
          <p className="font-mono text-sm leading-relaxed text-ink-2 [word-spacing:0.25em]">{groupHash(receipt.hash).slice(0, 8).join(" ")} …</p>
          <p className="text-sm text-ink-3">Anyone can recompute this from the receipt&apos;s details. If one digit of the receipt changes, the fingerprint no longer matches.</p>
        </Panel>
        <p className="flex items-center gap-2 text-ink-2">
          <span aria-hidden className="size-2.5 rounded-full bg-ember live-dot" />
          It&apos;s on the {assoc.shortName} ledger now, for every member to see.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <ButtonLink href={`/receipt/${receiptId}`}>View and share receipt</ButtonLink>
          <ButtonLink href="/member/ledger" variant="secondary">
            See it on the ledger
          </ButtonLink>
        </div>
        <Link href="/member" className="block text-sm font-semibold text-brand hover:underline">
          Back to home
        </Link>
      </div>
    );
  }
}

function TransferDetails({ total }: { total: number }) {
  const [secs, setSecs] = useState(30 * 60);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <div className="space-y-3">
      <p className="text-ink-2">From your banking app, transfer exactly:</p>
      <Panel className="divide-y divide-rule">
        {[
          ["Amount", naira(total)],
          ["Bank", "Ecobank"],
          ["Account number", "5610 2247 83"],
          ["Account name", "BLAZESYNC / CSSA UNILAG"],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-ink-2">{k}</span>
            <span className="text-lg font-bold">{v}</span>
          </div>
        ))}
      </Panel>
      <p className="text-sm text-ink-2">
        This account number is only for this payment. It expires in{" "}
        <span className="font-semibold text-ink" aria-live="off">
          {mm}:{ss}
        </span>
        .
      </p>
    </div>
  );
}
