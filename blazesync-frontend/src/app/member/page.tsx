"use client";

import Link from "next/link";
import { CalendarCheck2, CheckCircle2 } from "lucide-react";
import { LedgerHead } from "@/components/ledger/LedgerHead";
import { LedgerFeed } from "@/components/ledger/LedgerFeed";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, Section, Tag } from "@/components/ui/bits";
import { daysUntil, fmtDate, naira, plural } from "@/lib/format";
import { amountDueFor, selectAssociation, selectLedger, selectMyAssociations, selectMyRecord, selectPaymentFor, useDb, useNow } from "@/lib/store";

export default function MemberHome() {
  const { db, session } = useDb();
  const now = useNow();
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const mine = selectMyAssociations(db, session!);

  // Open cycles across every association this member belongs to.
  const dues = mine.flatMap((a) => {
    const rec = selectMyRecord(db, session!.userId, a.id);
    if (!rec) return [];
    return db.cycles
      .filter((c) => c.associationId === a.id && c.status === "open")
      .map((c) => ({ a, c, rec, amount: amountDueFor(rec, c), paid: selectPaymentFor(db, rec.id, c.id) }));
  });
  const owing = dues.filter((d) => !d.paid);

  return (
    // Phone: balance, then what you owe, then the feed. Desktop: dues sit beside the ledger.
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-x-10">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <h1 className="sr-only">Home</h1>
        <LedgerHead associationId={assocId} audience="member" />
      </div>

      <aside className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <Section title="Your dues" aside={owing.length > 0 && <span className="text-ink-3">{plural(owing.length, "to pay", "to pay")}</span>}>
          {dues.length === 0 ? (
            <EmptyState icon={<CalendarCheck2 className="size-5" />} title="No dues open right now">
              When your treasurer opens a dues cycle, it shows up here and we&apos;ll text you.
            </EmptyState>
          ) : (
            <ul className="stagger space-y-3">
              {dues.map(({ a, c, amount, paid }) => {
                const left = daysUntil(c.deadline, now);
                return (
                  <li key={c.id} className={`rounded-md border bg-surface p-4 ${paid ? "border-rule" : "border-brand/40"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-2">{a.shortName}</p>
                        <p className="font-semibold">{c.title}</p>
                      </div>
                      <p className="figure text-2xl font-bold">{naira(amount)}</p>
                    </div>
                    {paid ? (
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <Tag tone="credit" icon={<CheckCircle2 aria-hidden className="size-3" />}>
                          Paid {fmtDate(paid.paidAt)}
                        </Tag>
                        <Link href={`/receipt/${paid.receiptId}`} className="text-sm font-semibold text-brand hover:underline">
                          Receipt
                        </Link>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <p className={`text-sm ${left <= 3 ? "font-semibold text-warn" : "text-ink-2"}`}>
                          {left > 0 ? `Due ${fmtDate(c.deadline)}, ${plural(left, "day")} left` : "The deadline has passed. You can still pay."}
                        </p>
                        <ButtonLink href={`/member/pay/${c.id}`} className="w-full">
                          Pay {naira(amount)}
                        </ButtonLink>
                        <p className="flex items-center justify-center gap-1.5 text-sm text-ink-2">
                          <span aria-hidden className="size-2 rounded-full bg-ember" /> No fee from your Blaze account
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </aside>

      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <Section
          title={`Latest in ${assoc.shortName}`}
          aside={
            <Link href="/member/ledger" className="font-semibold text-brand hover:underline">
              Full ledger
            </Link>
          }
        >
          <LedgerFeed
            audience="member"
            entries={selectLedger(db, assocId).slice(0, 8)}
            emptyState={<EmptyState icon={<CalendarCheck2 className="size-5" />} title="Nothing on the ledger yet">The first payment shows up here the moment the bank confirms it.</EmptyState>}
          />
        </Section>
      </div>
    </div>
  );
}
