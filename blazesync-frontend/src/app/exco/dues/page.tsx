"use client";

import Link from "next/link";
import { CalendarClock, Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, Meter, PageHeader, Panel, Section, Tag } from "@/components/ui/bits";
import { daysUntil, fmtDate, fmtDateYear, naira, plural } from "@/lib/format";
import { selectAssociation, selectCycleProgress, useDb, useNow } from "@/lib/store";

export default function DuesPage() {
  const { db, session } = useDb();
  const now = useNow();
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const cycles = db.cycles.filter((c) => c.associationId === assocId).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const open = cycles.find((c) => c.status === "open");
  const closed = cycles.filter((c) => c.status === "closed");
  const hasRoster = db.roster.some((r) => r.associationId === assocId);

  return (
    <>
      <PageHeader
        title="Dues"
        lead={`What ${assoc.shortName} members owe, and by when.`}
        actions={
          !open && (
            <ButtonLink href="/exco/dues/new" size="sm">
              <Plus aria-hidden className="size-4" /> Open a dues cycle
            </ButtonLink>
          )
        }
      />

      {cycles.length === 0 && (
        <EmptyState
          icon={<CalendarClock className="size-5" />}
          title="No dues cycles yet"
          action={
            <ButtonLink href={hasRoster ? "/exco/dues/new" : "/exco/members/import"}>{hasRoster ? "Open your first dues cycle" : "Upload your member list first"}</ButtonLink>
          }
        >
          A dues cycle is one round of collection: an amount, a deadline, and everyone on the roster who owes it.
          {!hasRoster && " You'll need members on the roster before anyone can owe anything."}
        </EmptyState>
      )}

      {open && (
        <Section title="Open now" className="mb-10">
          {(() => {
            const p = selectCycleProgress(db, open);
            const left = daysUntil(open.deadline, now);
            return (
              <Link href={`/exco/dues/${open.id}`} className="press block rounded-md border border-rule bg-surface p-5 hover:border-edge">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">{open.title}</p>
                    <p className="text-ink-2">
                      {naira(open.amount)}
                      {open.perLevel && Object.entries(open.perLevel).map(([l, a]) => `, ${naira(a!)} for ${l}`)}
                    </p>
                  </div>
                  <Tag tone={left <= 7 ? "warn" : "brand"}>{left > 0 ? `Due ${fmtDate(open.deadline)}, ${plural(left, "day")} left` : "Deadline passed"}</Tag>
                </div>
                <div className="mt-5 grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end sm:gap-10">
                  <p>
                    <span className="figure block text-3xl font-bold tracking-tight">{naira(p.collected)}</span>
                    <span className="text-sm text-ink-2">of {naira(p.expected)} expected</span>
                  </p>
                  <Meter label="Paid" value={p.paid} max={p.total} detail={`${p.paid} of ${p.total}`} tone="credit" />
                </div>
              </Link>
            );
          })()}
          <p className="mt-3 text-sm text-ink-3">One cycle can be open at a time. Close this one before opening the next.</p>
        </Section>
      )}

      {closed.length > 0 && (
        <Section title="Closed">
          <Panel>
            <ul className="stagger divide-y divide-rule">
              {closed.map((c) => {
                const p = selectCycleProgress(db, c);
                return (
                  <li key={c.id}>
                    <Link href={`/exco/dues/${c.id}`} className="grid gap-1 px-4 py-3 hover:bg-paper sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6">
                      <span>
                        <span className="block font-semibold">{c.title}</span>
                        <span className="text-sm text-ink-2">Closed {fmtDateYear(c.closedAt!)}</span>
                      </span>
                      <span className="text-sm text-ink-2">
                        {p.paid} of {p.total} paid
                      </span>
                      <span className="font-bold">{naira(p.collected)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </Section>
      )}
    </>
  );
}
