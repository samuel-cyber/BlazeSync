"use client";

import Link from "next/link";
import { use, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, Dialog, EmptyState, Meter, PageHeader, Panel, Section, Tag } from "@/components/ui/bits";
import { Field, Input } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { daysUntil, fmtDate, fmtDateYear, isPastDay, naira, plural } from "@/lib/format";
import { selectCycleProgress, useDb, useNow } from "@/lib/store";
import { CalendarX } from "lucide-react";

export default function CyclePage({ params }: PageProps<"/exco/dues/[id]">) {
  const { id } = use(params);
  const { db, closeCycle, extendCycle } = useDb();
  const now = useNow();
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState("");
  const [dateErr, setDateErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cycle = db.cycles.find((c) => c.id === id);

  if (!cycle) {
    return (
      <EmptyState icon={<CalendarX className="size-5" />} title="This dues cycle doesn't exist" action={<ButtonLink href="/exco/dues">See all dues cycles</ButtonLink>}>
        The link may be from another association, or mistyped.
      </EmptyState>
    );
  }

  const p = selectCycleProgress(db, cycle);
  const unpaid = p.total - p.paid;
  const pays = db.payments.filter((x) => x.cycleId === cycle.id);
  const byHow = [
    { label: "Blaze account", n: pays.filter((x) => x.channel === "blaze").length },
    { label: "Bank transfer", n: pays.filter((x) => x.channel === "bank_transfer").length },
    { label: "Card", n: pays.filter((x) => x.channel === "card").length },
    { label: "Recorded by exco", n: pays.filter((x) => x.recordedBy).length },
  ];
  const maxN = Math.max(1, ...byHow.map((b) => b.n));
  const left = daysUntil(cycle.deadline, now);

  return (
    <>
      <PageHeader
        title={cycle.title}
        back={{ href: "/exco/dues", label: "Dues" }}
        lead={
          cycle.status === "open"
            ? `Open since ${fmtDateYear(cycle.openedAt)}. Due ${fmtDate(cycle.deadline)}${left > 0 ? `, ${plural(left, "day")} left` : ", deadline passed"}.`
            : `Closed ${fmtDateYear(cycle.closedAt!)}.`
        }
        actions={
          cycle.status === "open" && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setMoving(true)}>
                Move deadline
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setClosing(true)}>
                Close cycle
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-8">
          <Panel className="space-y-6 p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <p>
                <span className="figure block text-4xl font-bold tracking-tight">{naira(p.collected)}</span>
                <span className="text-ink-2">collected of {naira(p.expected)} expected</span>
              </p>
              <Tag tone={cycle.status === "open" ? "brand" : "neutral"}>{cycle.status === "open" ? "Open" : "Closed"}</Tag>
            </div>
            <Meter label="Paid" value={p.paid} max={p.total} detail={`${p.paid} of ${p.total}`} tone="credit" />
            <Meter label="Joined the app" value={p.joined} max={p.total} detail={`${p.joined} of ${p.total}`} />
          </Panel>

          <Section title="How people paid">
            <figure>
              <figcaption className="sr-only">Number of payments by method</figcaption>
              <ul className="space-y-3">
                {byHow.map((b) => (
                  <li key={b.label} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
                    <span className="text-ink-2">{b.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="h-3 rounded-r-[4px] bg-brand" style={{ width: `${(b.n / maxN) * 80}%`, minWidth: b.n ? 4 : 0 }} />
                      <span className="font-semibold">{b.n}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </figure>
          </Section>
        </div>

        <aside className="space-y-6">
          <Section title="Amounts">
            <Panel>
              <dl className="divide-y divide-rule text-sm">
                <div className="flex justify-between px-4 py-2.5">
                  <dt className="text-ink-2">Everyone</dt>
                  <dd className="font-semibold">{naira(cycle.amount)}</dd>
                </div>
                {cycle.perLevel &&
                  Object.entries(cycle.perLevel).map(([l, a]) => (
                    <div key={l} className="flex justify-between px-4 py-2.5">
                      <dt className="text-ink-2">{l}</dt>
                      <dd className="font-semibold">{naira(a!)}</dd>
                    </div>
                  ))}
              </dl>
            </Panel>
          </Section>
          {unpaid > 0 && (
            <Link href="/exco/members?filter=unpaid" className="block rounded-md border border-rule bg-surface px-4 py-3 font-semibold text-brand hover:bg-paper">
              See the {plural(unpaid, "member")} who haven&apos;t paid
            </Link>
          )}
        </aside>
      </div>

      <Dialog
        open={closing}
        onClose={() => setClosing(false)}
        title={`Close ${cycle.title}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setClosing(false)}>
              Keep it open
            </Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                await closeCycle(cycle.id);
                setBusy(false);
                setClosing(false);
                toast(`Closed ${cycle.title}.`);
              }}
            >
              Close cycle
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-ink-2">Members won&apos;t be able to pay this cycle in the app any more. Everything already paid stays on the ledger.</p>
          {unpaid > 0 && (
            <Callout tone="warn" title={`${plural(unpaid, "member")} haven't paid`}>
              They stay marked as unpaid for this cycle. You can still record cash from them afterwards.
            </Callout>
          )}
        </div>
      </Dialog>

      <Dialog
        open={moving}
        onClose={() => setMoving(false)}
        title="Move the deadline"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button
              busy={busy}
              onClick={async () => {
                const t = new Date(`${date}T23:59:00+01:00`).getTime();
                if (!date || isPastDay(date)) {
                  setDateErr("Pick a date in the future.");
                  return;
                }
                setBusy(true);
                await extendCycle(cycle.id, new Date(t).toISOString());
                setBusy(false);
                setMoving(false);
                toast(`Moved the deadline to ${fmtDate(new Date(t).toISOString())}. Members have been told.`);
              }}
            >
              Move deadline
            </Button>
          </>
        }
      >
        <Field label="New last day to pay" error={dateErr} hint={`Currently ${fmtDateYear(cycle.deadline)}. Members who haven't paid get a message.`}>
          {(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
      </Dialog>
    </>
  );
}
