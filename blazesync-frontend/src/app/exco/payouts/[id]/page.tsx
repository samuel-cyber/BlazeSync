"use client";

import Link from "next/link";
import { Check, CircleDashed, Loader2, SearchX, ShieldCheck, X } from "lucide-react";
import { use, useState } from "react";
import { SignatureTrack } from "@/components/payouts/SignatureTrack";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Avatar, Callout, Dialog, EmptyState, PageHeader, Panel, Section, Tag } from "@/components/ui/bits";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { firstName, fmtDateTime, naira } from "@/lib/format";
import { selectUser, useDb } from "@/lib/store";

export default function PayoutDetail({ params }: PageProps<"/exco/payouts/[id]">) {
  const { id } = use(params);
  const { db, session, decidePayout } = useDb();
  const toast = useToast();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = db.disbursements.find((x) => x.id === id);

  if (!d) {
    return (
      <EmptyState icon={<SearchX className="size-5" />} title="This payout request doesn't exist" action={<ButtonLink href="/exco/payouts">See all payouts</ButtonLink>}>
        It may belong to another association, or the link was mistyped.
      </EmptyState>
    );
  }

  const me = session!.userId;
  const name = (uid: string) => selectUser(db, uid)?.name ?? "An exco";
  const signatories = db.exco.filter((e) => e.associationId === d.associationId && e.isSignatory);
  const amSignatory = signatories.some((s) => s.userId === me);
  const mine = d.approvals.find((a) => a.userId === me);
  const canDecide = d.status === "pending" && amSignatory && !mine;
  const approvals = d.approvals.filter((a) => a.decision === "approve").length;
  const waitingOn = signatories.filter((s) => !d.approvals.some((a) => a.userId === s.userId)).map((s) => firstName(name(s.userId)));
  const entry = db.ledger.find((l) => l.disbursementId === d.id);

  const close = () => {
    setMode(null);
    setPin("");
    setNote("");
    setErr(null);
  };

  const decide = async () => {
    if (mode === "approve" && !/^\d{4}$/.test(pin)) {
      setErr("Enter your 4-digit BlazeSync PIN to sign.");
      return;
    }
    if (mode === "reject" && note.trim().length < 5) {
      setErr("Say why, so whoever asked can fix it and ask again.");
      return;
    }
    setBusy(true);
    const r = await decidePayout(d.id, mode!, note.trim() || null);
    setBusy(false);
    if (!r.ok) {
      setErr(
        r.error === "already_signed"
          ? "You've already signed this one. Each person can only sign once."
          : r.error === "not_pending"
            ? "Someone else finished this request while you were looking at it."
            : r.error === "no_account"
              ? "The bank account is disconnected, so nothing can be sent. Link it again in Settings first."
              : "That didn't go through. Nothing was signed. Try again.",
      );
      return;
    }
    close();
    toast(
      mode === "reject"
        ? "Rejected. Nothing will be sent."
        : r.value === "processing"
          ? `Signed. That's ${d.required} of ${d.required}, so the ${naira(d.amount)} is on its way.`
          : "Signed. Waiting for the next signature.",
    );
  };

  const steps = [
    { label: "Requested", done: true, at: d.requestedAt, who: name(d.requestedBy) },
    { label: `${d.required} signatures`, done: approvals >= d.required, failed: d.status === "rejected" },
    { label: "Sent through Ecobank", done: d.status === "completed", active: d.status === "processing", failed: d.status === "failed" },
    { label: "On the ledger", done: !!entry },
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader title={`${naira(d.amount)} to ${d.recipient.accountName}`} lead={d.reason} back={{ href: "/exco/payouts", label: "Payouts" }} />

      <div className="space-y-8">
        {d.status === "rejected" && (
          <Callout tone="danger" title={`Rejected by ${name(d.approvals.find((a) => a.decision === "reject")!.userId)}`}>
            &ldquo;{d.approvals.find((a) => a.decision === "reject")!.note}&rdquo; Nothing was sent. Whoever asked can make a new request.
          </Callout>
        )}
        {d.status === "failed" && (
          <Callout tone="danger" title="This payout failed. Nothing was sent.">
            {d.failureReason} Whoever asked can make a new request once it&apos;s sorted.
          </Callout>
        )}
        {d.status === "processing" && (
          <Callout title="Sending through Ecobank now" action={<span className="inline-flex items-center gap-2 text-sm text-ink-2"><Loader2 aria-hidden className="size-4 spin" /> Usually under a minute</span>}>
            It gets exactly one attempt per request. If the connection drops, retrying can&apos;t send the money twice.
          </Callout>
        )}
        {d.status === "completed" && entry && (
          <Callout tone="success" title={`Paid ${fmtDateTime(d.completedAt!)}`} action={<Link href="/exco/ledger" className="text-sm font-semibold text-brand hover:underline">See it on the ledger</Link>}>
            Every member can now see this payout, who asked for it, and who signed it.
          </Callout>
        )}

        <ol className="grid grid-cols-4 gap-2" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s.label} className="space-y-2">
              <span className={`block h-1 rounded-full ${s.failed ? "bg-danger" : s.done ? "bg-credit" : s.active ? "bg-brand" : "bg-rule"}`} />
              <span className="flex items-center gap-1.5 text-xs font-semibold sm:text-sm">
                <span className="sr-only">Step {i + 1}: </span>
                {s.label}
                <span className="sr-only">{s.failed ? " (rejected)" : s.done ? " (done)" : s.active ? " (in progress)" : " (not yet)"}</span>
              </span>
            </li>
          ))}
        </ol>

        <Section title="Signatures" aside={<SignatureTrack d={d} />}>
          <Panel>
            <ul className="divide-y divide-rule">
              {signatories.map((s) => {
                const a = d.approvals.find((x) => x.userId === s.userId);
                return (
                  <li key={s.userId} className="flex items-start gap-3 px-4 py-3">
                    <Avatar name={name(s.userId)} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {name(s.userId)}
                        {s.userId === me && <span className="font-normal text-ink-3"> (you)</span>}
                      </p>
                      <p className="text-sm text-ink-2">{s.title}</p>
                      {a?.note && <p className="mt-1 text-sm text-ink-2">&ldquo;{a.note}&rdquo;</p>}
                    </div>
                    <div className="text-right text-sm">
                      {a ? (
                        a.decision === "approve" ? (
                          <>
                            <Tag tone="credit" icon={<Check aria-hidden className="size-3" />}>
                              {a.userId === d.requestedBy ? "Signed when asking" : "Signed"}
                            </Tag>
                            <p className="mt-1 text-ink-3">{fmtDateTime(a.at)}</p>
                          </>
                        ) : (
                          <>
                            <Tag tone="danger" icon={<X aria-hidden className="size-3" />}>
                              Rejected
                            </Tag>
                            <p className="mt-1 text-ink-3">{fmtDateTime(a.at)}</p>
                          </>
                        )
                      ) : d.status === "pending" ? (
                        <Tag icon={<CircleDashed aria-hidden className="size-3" />}>Not yet</Tag>
                      ) : (
                        <span className="text-ink-3">Not needed</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <p className="mt-3 flex items-start gap-2 text-sm text-ink-3">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            Signatures are stored on the server with the signer and the time, and can&apos;t be edited or withdrawn.
          </p>
        </Section>

        <Section title="Details">
          <Panel>
            <dl className="divide-y divide-rule text-sm">
              {[
                ["Category", d.category],
                ["Paid to", `${d.recipient.accountName}, ${d.recipient.bank}, ${d.recipient.accountNumber}`],
                ["Asked by", `${name(d.requestedBy)}, ${fmtDateTime(d.requestedAt)}`],
                ["Request ID", <span key="k" className="font-mono text-xs">{d.idempotencyKey}</span>],
              ].map(([k, v]) => (
                <div key={k as string} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-4 py-2.5">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="break-words font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </Section>

        {canDecide && (
          <div className="sticky bottom-20 z-10 flex flex-col gap-2 rounded-md border border-rule bg-surface p-3 shadow-[var(--shadow-lift)] sm:flex-row sm:justify-end lg:bottom-4">
            <p className="flex-1 self-center px-1 text-sm text-ink-2">
              {approvals + 1 >= d.required ? `Yours is the last signature needed. Signing sends ${naira(d.amount)}.` : `After you, it needs ${d.required - approvals - 1} more.`}
            </p>
            <Button variant="secondary" onClick={() => setMode("reject")}>
              Reject
            </Button>
            <Button onClick={() => setMode("approve")}>Approve and sign</Button>
          </div>
        )}
        {d.status === "pending" && mine && <Callout title="You've signed this">Waiting on {waitingOn.join(" or ")}. They&apos;ve been notified.</Callout>}
        {d.status === "pending" && !amSignatory && <Callout title="You're not a signatory">Only signatories can approve payouts. You can still see every request.</Callout>}
      </div>

      <Dialog
        open={mode !== null}
        onClose={close}
        title={mode === "approve" ? `Sign the ${naira(d.amount)} payout?` : "Reject this payout?"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant={mode === "reject" ? "danger" : "primary"} busy={busy} onClick={decide}>
              {mode === "approve" ? "Approve and sign" : "Reject payout"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {mode === "approve" ? (
            <>
              <p className="text-ink-2">
                {naira(d.amount)} to {d.recipient.accountName} ({d.recipient.bank}, {d.recipient.accountNumber}) for {d.reason.charAt(0).toLowerCase() + d.reason.slice(1)}.
              </p>
              <Field label="Your BlazeSync PIN" error={err} hint="The PIN you set when you became a signatory. Demo: any 4 digits.">
                {(a) => <Input {...a} type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="max-w-40 text-center text-xl tracking-[0.5em]" />}
              </Field>
            </>
          ) : (
            <Field label="Why are you rejecting it?" error={err} hint={`${firstName(name(d.requestedBy))} sees this and can ask again with changes.`}>
              {(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="The quote is double last year's. Get a second one." />}
            </Field>
          )}
        </div>
      </Dialog>
    </div>
  );
}
