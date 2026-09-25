"use client";

import Link from "next/link";
import { ChevronRight, ReceiptText } from "lucide-react";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, PageHeader, Section, Segmented, Tag } from "@/components/ui/bits";
import { channelLabel, fmtDateYear, naira, plural } from "@/lib/format";
import { amountDueFor, selectMyAssociations, useDb } from "@/lib/store";

export default function HistoryPage() {
  const { db, session } = useDb();
  const mine = selectMyAssociations(db, session!);
  const [only, setOnly] = useState<string>("all");
  const records = db.roster.filter((r) => r.userId === session!.userId && (only === "all" || r.associationId === only));
  const recIds = new Set(records.map((r) => r.id));
  const payments = db.payments.filter((p) => recIds.has(p.memberRecordId)).sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const outstanding = records.flatMap((r) =>
    db.cycles.filter((c) => c.associationId === r.associationId && c.status === "open" && !db.payments.some((p) => p.cycleId === c.id && p.memberRecordId === r.id)).map((c) => ({ r, c })),
  );
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const assocName = (id: string) => db.associations.find((a) => a.id === id)?.shortName ?? "";

  // Group by academic session, taken from the cycle title ("2026/27 ...").
  const groups = new Map<string, typeof payments>();
  for (const p of payments) {
    const title = db.cycles.find((c) => c.id === p.cycleId)?.title ?? "";
    const key = title.match(/^\d{4}\/\d{2}/)?.[0] ?? "Earlier";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <>
      <PageHeader
        title="Your payments"
        lead={payments.length ? `${naira(total)} paid across ${plural(new Set(payments.map((p) => p.associationId)).size, "association")}. Every one has a receipt you can check.` : undefined}
      />

      {mine.length > 1 && (
        <div className="mb-6">
          <Segmented label="Association" value={only} onChange={setOnly} options={[{ value: "all", label: "All" }, ...mine.map((a) => ({ value: a.id, label: a.shortName }))]} />
        </div>
      )}

      {outstanding.length > 0 && (
        <Section title="Still to pay" className="mb-10">
          <ul className="space-y-2">
            {outstanding.map(({ r, c }) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-brand/40 bg-surface px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm text-ink-2">{assocName(c.associationId)}</span>
                  <span className="block font-semibold">{c.title}</span>
                </span>
                <ButtonLink href={`/member/pay/${c.id}`} size="sm">
                  Pay {naira(amountDueFor(r, c))}
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {payments.length === 0 ? (
        <EmptyState icon={<ReceiptText className="size-5" />} title="No payments yet">
          When you pay dues, the receipt lands here and stays here, across semesters and associations.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {[...groups.entries()].map(([sessionKey, items]) => (
            <Section key={sessionKey} title={sessionKey === "Earlier" ? "Earlier" : `${sessionKey} session`} aside={<span className="text-ink-3">{naira(items.reduce((s, p) => s + p.amount, 0))}</span>}>
              <ul className="stagger divide-y divide-rule overflow-hidden rounded-md border border-rule bg-surface">
                {items.map((p) => {
                  const c = db.cycles.find((x) => x.id === p.cycleId);
                  return (
                    <li key={p.id}>
                      <Link href={`/receipt/${p.receiptId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink-2">{assocName(p.associationId)}</span>
                          <span className="block font-semibold">{c?.title}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-3">
                            {fmtDateYear(p.paidAt)}
                            {p.recordedBy ? <Tag>Recorded by exco</Tag> : <span>{channelLabel[p.channel]}</span>}
                          </span>
                        </span>
                        <span className="font-bold">{naira(p.amount)}</span>
                        <ChevronRight aria-hidden className="size-5 text-ink-3" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
