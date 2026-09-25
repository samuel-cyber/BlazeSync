"use client";

import Link from "next/link";
import { ArrowUpRight, Undo2, Landmark, Gift, ReceiptText, ShieldCheck } from "lucide-react";
import { Fragment, useState } from "react";
import { channelLabel, dayKey, dayLabel, fmtDateTime, fmtTime, naira } from "@/lib/format";
import { selectUser, useDb, useNow } from "@/lib/store";
import type { LedgerEntry } from "@/lib/types";
import { Avatar, Dialog, Tag } from "@/components/ui/bits";
import { groupHash } from "@/lib/receipt-hash";

/**
 * The statement. Every row shows the amount and the balance after it, so the
 * arithmetic is on the page: anyone can check that each line follows from the
 * one below it.
 */
export function LedgerFeed({ entries, emptyState, audience }: { entries: LedgerEntry[]; emptyState?: React.ReactNode; audience: "exco" | "member" }) {
  const { fresh, arrived } = useDb();
  const now = useNow(60_000);
  const [open, setOpen] = useState<LedgerEntry | null>(null);

  if (!entries.length) return <>{emptyState}</>;

  const rows = entries.map((e, i) => ({ e, header: i === 0 || dayKey(entries[i - 1].at) !== dayKey(e.at) }));
  return (
    <>
      <div className="overflow-hidden rounded-md border border-rule bg-surface">
        <div className="hidden grid-cols-[minmax(0,1fr)_8.5rem_8.5rem] gap-4 border-b border-rule bg-sunken/60 px-4 py-2 text-xs font-semibold text-ink-2 sm:grid">
          <span>Entry</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Balance after</span>
        </div>
        <ul className="stagger">
          {rows.map(({ e, header }) => {
            const isNew = fresh.includes(e.id);
            return (
              <Fragment key={e.id}>
                {header && (
                  <li aria-hidden className="border-b border-rule bg-paper/70 px-4 py-1.5 text-xs font-semibold text-ink-2">
                    {dayLabel(e.at, now)}
                  </li>
                )}
                <li className={isNew ? "entry-new" : arrived.includes(e.id) ? "entry-arrived" : undefined}>
                  <div>
                    <button type="button" onClick={() => setOpen(e)} className="entry-body grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-rule px-4 py-3 text-left transition-colors hover:bg-paper/70 sm:grid-cols-[auto_minmax(0,1fr)_8.5rem_8.5rem] sm:gap-4">
                      <EntryGlyph e={e} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{e.direction === "in" && e.category !== "Opening balance" && e.category !== "Sponsorship" ? e.counterparty : e.description}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
                          <span className="truncate">{secondLine(e)}</span>
                          <span className="text-ink-3">{fmtTime(e.at)}</span>
                          {isNew && <Tag tone="ember">Just now</Tag>}
                          {e.cashInHand && e.category !== "Correction" && <Tag tone="warn">Cash, not banked</Tag>}
                          {e.correctsEntryId && <Tag>Correction</Tag>}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className={`block font-bold ${e.direction === "in" ? "text-credit" : "text-ink"}`}>
                          <span className="sr-only">{e.direction === "in" ? "Money in: " : "Money out: "}</span>
                          {naira(e.direction === "in" ? e.amount : -e.amount, { sign: true })}
                        </span>
                        <span className="mt-0.5 block text-sm text-ink-3 sm:hidden">
                          <span className="sr-only">Balance after: </span>
                          {naira(e.balanceAfter)}
                        </span>
                      </span>
                      <span className="hidden text-right text-ink-2 sm:block">
                        <span className="sr-only">Balance after: </span>
                        {naira(e.balanceAfter)}
                      </span>
                    </button>
                  </div>
                </li>
              </Fragment>
            );
          })}
        </ul>
      </div>
      <EntryDetail entry={open} onClose={() => setOpen(null)} audience={audience} />
    </>
  );
}

function secondLine(e: LedgerEntry) {
  if (e.correctsEntryId) return "Fixes an entry made twice";
  if (e.category === "Dues") return e.description.replace(", recorded by exco", "").replace(" (entered twice)", "");
  if (e.direction === "out") return `To ${e.counterparty}`;
  if (e.category === "Opening balance") return "Handover";
  return e.counterparty;
}

function EntryGlyph({ e }: { e: LedgerEntry }) {
  const box = "grid size-9 shrink-0 place-items-center rounded-full";
  if (e.correctsEntryId) return <span aria-hidden className={`${box} bg-sunken text-ink-2`}><Undo2 className="size-4" /></span>;
  if (e.direction === "out") return <span aria-hidden className={`${box} bg-sunken text-ink`}><ArrowUpRight className="size-4" /></span>;
  if (e.category === "Opening balance") return <span aria-hidden className={`${box} bg-brand-wash text-brand`}><Landmark className="size-4" /></span>;
  if (e.category === "Sponsorship") return <span aria-hidden className={`${box} bg-brand-wash text-brand`}><Gift className="size-4" /></span>;
  return <Avatar name={e.counterparty} />;
}

function EntryDetail({ entry, onClose, audience }: { entry: LedgerEntry | null; onClose: () => void; audience: "exco" | "member" }) {
  const { db } = useDb();
  if (!entry) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;
  const payment = entry.paymentId ? db.payments.find((p) => p.id === entry.paymentId) : null;
  const receipt = payment ? db.receipts.find((r) => r.id === payment.receiptId) : null;
  const disb = entry.disbursementId ? db.disbursements.find((d) => d.id === entry.disbursementId) : null;
  const corrected = entry.correctsEntryId ? db.ledger.find((l) => l.id === entry.correctsEntryId) : null;
  const who = (id: string) => selectUser(db, id)?.name ?? "An exco member";

  const rows: [string, React.ReactNode][] = [
    ["When", fmtDateTime(entry.at)],
    ["Category", entry.category],
  ];
  if (payment) {
    rows.push(["Paid with", channelLabel[payment.channel]]);
    if (payment.recordedBy) rows.push(["Recorded by", who(payment.recordedBy)]);
    if (payment.note) rows.push(["Note", payment.note]);
    rows.push(["Reference", <span key="r" className="font-mono text-sm">{payment.txRef}</span>]);
  }
  if (disb) {
    rows.push(["Paid to", `${disb.recipient.accountName}, ${disb.recipient.bank} ••${disb.recipient.accountNumber.slice(-4)}`]);
    rows.push(["Requested by", who(disb.requestedBy)]);
  }
  rows.push(["Balance after", naira(entry.balanceAfter)]);

  return (
    <Dialog open={!!entry} onClose={onClose} title={entry.direction === "in" ? `${naira(entry.amount)} in` : `${naira(entry.amount)} out`}>
      <div className="space-y-5">
        <p className="text-base text-ink-2">
          {entry.direction === "in" && entry.category === "Dues" ? `${entry.counterparty} paid ${entry.description.replace(", recorded by exco", "").replace(" (entered twice)", "")}.` : entry.description}
        </p>
        <dl className="divide-y divide-rule rounded-md border border-rule">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm">
              <dt className="text-ink-3">{k}</dt>
              <dd className="min-w-0 break-words font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        {disb && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Signatures ({disb.approvals.filter((a) => a.decision === "approve").length} of {disb.required} needed)</h3>
            <ul className="space-y-2">
              {disb.approvals.map((a) => (
                <li key={a.userId} className="flex items-center gap-3 text-sm">
                  <Avatar name={who(a.userId)} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{who(a.userId)}</span> <span className="text-ink-2">signed {fmtDateTime(a.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {corrected && (
          <p className="rounded-md bg-sunken px-4 py-3 text-sm text-ink-2">
            This entry cancels the {naira(corrected.amount)} entry for {corrected.counterparty} recorded at {fmtTime(corrected.at)}. Ledger entries are never edited or deleted; a mistake is fixed by adding an entry like this one, so the history stays visible.
          </p>
        )}

        {receipt && (
          <div className="space-y-2 rounded-md border border-rule px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck aria-hidden className="size-4 text-credit" /> Receipt fingerprint
            </p>
            <p className="font-mono text-xs leading-relaxed text-ink-2 [word-spacing:0.2em]">{groupHash(receipt.hash).slice(0, 8).join(" ")} …</p>
            <Link href={`/receipt/${receipt.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
              <ReceiptText aria-hidden className="size-4" /> Open and verify the receipt
            </Link>
          </div>
        )}
        {audience === "member" && entry.direction === "out" && <p className="text-sm text-ink-3">Every payout needs signatures from more than one exco before money leaves the account.</p>}
      </div>
    </Dialog>
  );
}
