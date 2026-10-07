"use client";

import Link from "next/link";
import { CheckCircle2, Link2, Loader2, Printer, SearchX, Share2, XCircle } from "lucide-react";
import { use, useEffect, useState } from "react";
import { Logo } from "@/components/shell/Logo";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { channelLabel, fmtDateTime, naira, toKobo } from "@/lib/format";
import { canonicalString, groupHash, recomputeHash } from "@/lib/receipt-hash";
import { useStore } from "@/lib/store";
import type { Receipt } from "@/lib/types";

type Check = "checking" | "match" | "mismatch";

/**
 * A receipt anyone can open from a shared link, and check without trusting us:
 * the fingerprint is recomputed in this browser from the fields printed on it.
 */
export default function ReceiptPage({ params }: PageProps<"/receipt/[id]">) {
  const { id } = use(params);
  const { ready, db, session, mode, loadReceipt } = useStore();
  const toast = useToast();
  const [liveReceipt, setLiveReceipt] = useState<Receipt | null>(null);
  useEffect(() => {
    if (mode !== "live") return;
    let live = true;
    loadReceipt(id).then((r) => live && setLiveReceipt(r));
    return () => {
      live = false;
    };
  }, [id, mode, loadReceipt]);
  const receipt = (mode === "live" ? liveReceipt : db?.receipts.find((r) => r.id === id)) ?? null;
  const [check, setCheck] = useState<Check>("checking");
  const [tryAmount, setTryAmount] = useState("");
  const [tryHash, setTryHash] = useState<string | null>(null);

  useEffect(() => {
    if (!receipt) return;
    let live = true;
    recomputeHash({ payerId: receipt.payerId, amount: receipt.amount, issuedAt: receipt.issuedAt, associationId: receipt.associationId, txRef: receipt.txRef }).then((h) => {
      // A short pause so the check is seen to happen, not assumed.
      setTimeout(() => live && setCheck(h === receipt.hash ? "match" : "mismatch"), 700);
    });
    return () => {
      live = false;
    };
  }, [receipt]);

  useEffect(() => {
    if (!receipt || !tryAmount) return;
    const k = toKobo(tryAmount);
    if (k === null) return;
    let live = true;
    recomputeHash({ payerId: receipt.payerId, amount: k, issuedAt: receipt.issuedAt, associationId: receipt.associationId, txRef: receipt.txRef }).then((h) => live && setTryHash(h));
    return () => {
      live = false;
    };
  }, [tryAmount, receipt]);

  if (!ready) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-ink-2">
          <Loader2 aria-hidden className="size-4 spin" /> Opening receipt
        </p>
      </Shell>
    );
  }

  if (!receipt || (mode === "demo" && !db)) {
    return (
      <Shell>
        <EmptyState icon={<SearchX className="size-5" />} title="We can't find this receipt" action={<ButtonLink href="/">Go to BlazeSync</ButtonLink>}>
          Check the link is complete, or ask whoever sent it to share it again. Receipt links look like blazesync.app/receipt/r_12.
        </EmptyState>
      </Shell>
    );
  }

  const record = db ? db.roster.find((r) => r.id === receipt.payerId) : null;
  const isMe = !!session && record?.userId === session.userId;
  const entry = db?.ledger.find((l) => l.paymentId === receipt.paymentId) ?? null;
  const payment = db?.payments.find((p) => p.id === receipt.paymentId) ?? null;
  const home = session ? (session.role === "exco" ? "/exco" : "/member") : "/";

  const share = async () => {
    const url = window.location.href;
    const text = `${receipt.payerName} paid ${naira(receipt.amount)} to ${receipt.associationName}. Receipt:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "BlazeSync receipt", text, url });
        return;
      } catch {
        /* cancelled: fall back to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied. Anyone with it can check this receipt.");
    } catch {
      toast("Couldn't copy. Copy the address from your browser's address bar.", "danger");
    }
  };

  const tampered = tryHash !== null && tryAmount !== "" && tryHash !== receipt.hash;

  return (
    <Shell home={home}>
      <article className="overflow-hidden rounded-lg border border-rule bg-surface shadow-[var(--shadow-lift)]" aria-labelledby="receipt-title">
        <div className="space-y-1 border-b border-dashed border-edge/60 px-6 py-6 sm:px-8">
          <p className="text-sm font-semibold text-ink-2">{receipt.associationName} dues receipt</p>
          <h1 id="receipt-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {isMe ? "You" : receipt.payerName} paid {naira(receipt.amount)}
          </h1>
          <p className="text-ink-2">for {receipt.cycleTitle}</p>
        </div>

        <dl className="divide-y divide-rule px-6 text-sm sm:px-8">
          {[
            ["Paid by", `${receipt.payerName || "A member"}${record ? `, ${record.matric}` : ""}`],
            ["Paid to", receipt.associationName || "Your association"],
            ["When", fmtDateTime(receipt.issuedAt)],
            ["Paid with", channelLabel[receipt.channel]],
            ["Fee", receipt.fee ? naira(receipt.fee) : "None"],
            ...(payment?.recordedBy && db ? [["Recorded by", db.users.find((u) => u.id === payment.recordedBy)?.name ?? "An exco"]] : []),
            ["Reference", receipt.txRef],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3">
              <dt className="text-ink-3">{k}</dt>
              <dd className="break-words font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        {receipt.expectationStatement && (
          <div className="border-t border-dashed border-edge/60 px-6 py-5 sm:px-8">
            <p className="text-sm font-semibold">What this money funds</p>
            <p className="mt-1 text-ink-2">{receipt.expectationStatement}</p>
            <p className="mt-1 text-xs text-ink-3">Frozen at payment time — it can&apos;t be changed without breaking the fingerprint.</p>
          </div>
        )}

        <div className="space-y-4 border-t border-dashed border-edge/60 bg-paper/60 px-6 py-6 sm:px-8">
          <div aria-live="polite">
            {check === "checking" && (
              <p className="flex items-center gap-2 font-semibold text-ink-2">
                <Loader2 aria-hidden className="size-5 spin" /> Checking this receipt
              </p>
            )}
            {check === "match" && (
              <p className="land flex items-start gap-2">
                <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-credit" />
                <span>
                  <span className="block font-bold text-credit">Verified</span>
                  <span className="text-sm text-ink-2">
                    Your browser recomputed the fingerprint from the details above and it matches the one issued with the payment
                    {entry ? ", which is on the ledger" : ""}.
                  </span>
                </span>
              </p>
            )}
            {check === "mismatch" && (
              <p className="land flex items-start gap-2">
                <XCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
                <span>
                  <span className="block font-bold text-danger">Doesn&apos;t match</span>
                  <span className="text-sm text-ink-2">These details have changed since the receipt was issued. Don&apos;t accept it as proof of payment.</span>
                </span>
              </p>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Fingerprint</p>
            <p className="font-mono text-sm leading-relaxed text-ink-2 [word-spacing:0.3em]">{groupHash(receipt.hash).join(" ")}</p>
          </div>
        </div>
      </article>

      <div className="no-print mt-5 flex flex-col gap-2 sm:flex-row">
        <Button onClick={share}>
          <Share2 aria-hidden className="size-4" /> Share receipt
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" /> Save as PDF
        </Button>
      </div>

      <details className="no-print group mt-8 rounded-md border border-rule bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold">
          Check it yourself
          <span aria-hidden className="text-ink-3 transition-transform group-open:rotate-90">›</span>
        </summary>
        <div className="space-y-5 border-t border-rule px-5 py-5">
          <p className="text-ink-2">
            The fingerprint is a SHA-256 hash of five things joined with a bar: who paid, the amount in kobo, the exact time, the association, and the bank&apos;s
            reference. Run the same text through any SHA-256 tool and you get the same fingerprint.
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-sunken px-3 py-2.5 font-mono text-xs text-ink">
            {canonicalString({ payerId: receipt.payerId, amount: receipt.amount, issuedAt: receipt.issuedAt, associationId: receipt.associationId, txRef: receipt.txRef })}
          </pre>
          <div className="space-y-2">
            <label htmlFor="try" className="block text-sm font-semibold">
              Change the amount and watch the fingerprint break
            </label>
            <div className="relative max-w-48">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-semibold text-ink-2">
                ₦
              </span>
              <input
                id="try"
                inputMode="decimal"
                value={tryAmount}
                placeholder={String(receipt.amount / 100)}
                onChange={(e) => setTryAmount(e.target.value)}
                className="h-11 w-full rounded-sm border border-edge bg-surface pl-7 pr-3 font-semibold"
              />
            </div>
            {tryAmount && tryHash && (
              <div aria-live="polite" className="land space-y-1.5">
                <p className="font-mono text-xs leading-relaxed text-ink-2 [word-spacing:0.3em]">{groupHash(tryHash).join(" ")}</p>
                <p className={`flex items-center gap-1.5 text-sm font-semibold ${tampered ? "text-danger" : "text-credit"}`}>
                  {tampered ? <XCircle aria-hidden className="size-4" /> : <CheckCircle2 aria-hidden className="size-4" />}
                  {tampered ? "Different fingerprint. A receipt edited to say this would fail the check." : "Same fingerprint: that's the real amount."}
                </p>
              </div>
            )}
          </div>
        </div>
      </details>
    </Shell>
  );
}

function Shell({ children, home = "/" }: { children: React.ReactNode; home?: string }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="no-print mx-auto flex max-w-xl items-center justify-between px-5 pt-6">
        <Logo href={home} />
        {home !== "/" && (
          <Link href={home} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
            <Link2 aria-hidden className="size-4" /> Back to your ledger
          </Link>
        )}
      </header>
      <main id="main" className="view mx-auto max-w-xl px-5 pb-16 pt-8">
        {children}
      </main>
    </div>
  );
}
