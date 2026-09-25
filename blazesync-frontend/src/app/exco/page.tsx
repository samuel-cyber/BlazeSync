"use client";

import Link from "next/link";
import { BookOpenText, Check, FileDown, HandCoins, Landmark, MailPlus, Send, Upload, Users } from "lucide-react";
import { LedgerHead } from "@/components/ledger/LedgerHead";
import { LedgerFeed } from "@/components/ledger/LedgerFeed";
import { Avatar, EmptyState, Meter, Panel, Section } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/Button";
import { ago, daysUntil, fmtDate, firstName, naira, plural } from "@/lib/format";
import { selectAssociation, selectCycleProgress, selectLedger, selectOpenCycle, selectUser, useDb, useNow } from "@/lib/store";

export default function ExcoDashboard() {
  const { db, session } = useDb();
  const now = useNow();
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const ledger = selectLedger(db, assocId);
  const cycle = selectOpenCycle(db, assocId);
  const roster = db.roster.filter((r) => r.associationId === assocId);
  const amSignatory = db.exco.some((e) => e.associationId === assocId && e.userId === session!.userId && e.isSignatory);
  const needsMe = amSignatory ? db.disbursements.filter((d) => d.associationId === assocId && d.status === "pending" && !d.approvals.some((a) => a.userId === session!.userId)) : [];
  const setupLeft = !assoc.linkedAccount || roster.length === 0 || !cycle;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
      <div className="min-w-0 space-y-6">
        <h1 className="sr-only">{assoc.shortName} ledger</h1>
        <LedgerHead associationId={assocId} audience="exco" />

        {needsMe.length > 0 && (
          <section aria-labelledby="needs-you" className="rounded-md border border-brand/30 bg-brand-wash px-4 py-4 sm:px-5">
            <h2 id="needs-you" className="flex items-center gap-2 font-bold">
              <Send aria-hidden className="size-4 text-brand" />
              {needsMe.length === 1 ? "A payout is waiting for your signature" : `${needsMe.length} payouts are waiting for your signature`}
            </h2>
            <ul className="mt-3 space-y-2">
              {needsMe.map((d) => (
                <li key={d.id}>
                  <Link href={`/exco/payouts/${d.id}`} className="press flex items-center gap-3 rounded-sm bg-surface px-3 py-2.5 hover:bg-paper">
                    <Avatar name={selectUser(db, d.requestedBy)?.name ?? "?"} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {naira(d.amount)} for {d.reason.charAt(0).toLowerCase() + d.reason.slice(1)}
                      </span>
                      <span className="block text-sm text-ink-2">
                        {firstName(selectUser(db, d.requestedBy)?.name ?? "An exco")} asked {ago(d.requestedAt, now)}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-brand">Review</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Section
          title="Latest entries"
          aside={
            ledger.length > 0 && (
              <Link href="/exco/ledger" className="font-semibold text-brand hover:underline">
                Full ledger
              </Link>
            )
          }
        >
          <LedgerFeed
            audience="exco"
            entries={ledger.slice(0, 10)}
            emptyState={
              <EmptyState icon={<BookOpenText className="size-5" />} title="No money has moved yet">
                The first dues payment appears here the moment Ecobank confirms it, and every member sees it at the same time you do.
              </EmptyState>
            }
          />
        </Section>
      </div>

      <aside className="space-y-8">
        {setupLeft && <SetupChecklist linked={!!assoc.linkedAccount} hasRoster={roster.length > 0} hasCycle={!!cycle} />}

        {cycle && (
          <CycleSummary cycleId={cycle.id} />
        )}

        {!setupLeft && (
        <Section title="Do something">
          <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule bg-surface">
            {[
              { href: "/exco/members?record=1", icon: HandCoins, label: "Record a cash payment" },
              { href: "/exco/payouts/new", icon: Send, label: "Request a payout" },
              { href: "/exco/members?filter=not_joined", icon: MailPlus, label: "Chase members who haven't joined" },
              { href: "/exco/records", icon: FileDown, label: "Download the ledger" },
            ].map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="flex items-center gap-3 px-4 py-3 font-semibold hover:bg-paper">
                  <a.icon aria-hidden className="size-5 text-brand" />
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
        )}
      </aside>
    </div>
  );
}

function CycleSummary({ cycleId }: { cycleId: string }) {
  const { db } = useDb();
  const now = useNow();
  const c = db.cycles.find((x) => x.id === cycleId)!;
  const p = selectCycleProgress(db, c);
  const left = daysUntil(c.deadline, now);
  return (
    <Section
      title="This dues cycle"
      aside={
        <Link href={`/exco/dues/${c.id}`} className="font-semibold text-brand hover:underline">
          Manage
        </Link>
      }
    >
      <Panel className="space-y-5 p-4 sm:p-5">
        <div>
          <p className="font-semibold">{c.title}</p>
          <p className="text-sm text-ink-2">
            Due {fmtDate(c.deadline)}, {left > 0 ? `${plural(left, "day")} left` : "deadline passed"}
          </p>
        </div>
        <div>
          <p className="figure text-3xl font-bold tracking-tight">{naira(p.collected)}</p>
          <p className="text-sm text-ink-2">collected of {naira(p.expected)} expected</p>
        </div>
        <Meter label="Paid" value={p.paid} max={p.total} detail={`${p.paid} of ${p.total}`} tone="credit" />
        <Meter label="Joined the app" value={p.joined} max={p.total} detail={`${p.joined} of ${p.total}`} />
        <p className="text-sm text-ink-3">These are separate on purpose. Someone can pay in cash without ever joining, and still counts as paid.</p>
        <ButtonLink href="/exco/members?filter=unpaid" variant="secondary" size="sm" className="w-full">
          <Users aria-hidden className="size-4" /> See who hasn&apos;t paid
        </ButtonLink>
      </Panel>
    </Section>
  );
}

function SetupChecklist({ linked, hasRoster, hasCycle }: { linked: boolean; hasRoster: boolean; hasCycle: boolean }) {
  const steps = [
    { done: linked, label: "Link the association's Ecobank account", href: "/exco/settings#account", icon: Landmark },
    { done: hasRoster, label: "Upload your member list", href: "/exco/members/import", icon: Upload },
    { done: hasCycle, label: "Open your first dues cycle", href: "/exco/dues/new", icon: BookOpenText },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <Section title="Finish setting up">
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Link
              href={s.href}
              className={`flex items-center gap-3 rounded-md border px-4 py-3 ${i === next ? "border-brand bg-surface" : "border-rule bg-surface/60"} hover:bg-paper`}
            >
              <span
                aria-hidden
                className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${s.done ? "bg-credit text-white" : i === next ? "bg-brand text-on-brand" : "bg-sunken text-ink-3"}`}
              >
                {s.done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={`font-semibold ${s.done ? "text-ink-3 line-through" : ""}`}>
                <span className="sr-only">{s.done ? "Done: " : "To do: "}</span>
                {s.label}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}
