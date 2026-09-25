"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, CircleDashed, HandCoins, MailPlus, Search, Smartphone, Upload, UserX, Users } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, Dialog, EmptyState, Meter, PageHeader, Panel, Segmented, Tag } from "@/components/ui/bits";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { channelLabel, firstName, fmtDate, naira, plural } from "@/lib/format";
import { amountDueFor, selectAssociation, selectCycleProgress, selectOpenCycle, selectPaymentFor, selectUser, useDb } from "@/lib/store";
import type { Level, MemberRecord } from "@/lib/types";

type Filter = "all" | "unpaid" | "paid" | "not_joined";

function Members() {
  const params = useSearchParams();
  const { db, session, sendInvites } = useDb();
  const toast = useToast();
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const cycle = selectOpenCycle(db, assocId);
  const roster = useMemo(() => db.roster.filter((r) => r.associationId === assocId).sort((a, b) => a.name.localeCompare(b.name)), [db.roster, assocId]);
  const initial = (params.get("filter") as Filter) ?? (params.get("record") ? "unpaid" : "all");
  const [filter, setFilter] = useState<Filter>(initial);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<Level | "all">("all");
  const [paying, setPaying] = useState<MemberRecord | null>(null);
  const [inviting, setInviting] = useState<MemberRecord[] | null>(null);

  const paidOf = (r: MemberRecord) => (cycle ? selectPaymentFor(db, r.id, cycle.id) : null);
  const counts = {
    all: roster.length,
    paid: roster.filter((r) => paidOf(r)).length,
    unpaid: roster.filter((r) => !paidOf(r)).length,
    not_joined: roster.filter((r) => !r.userId).length,
  };
  const rows = roster.filter((r) => {
    if (filter === "paid" && !paidOf(r)) return false;
    if (filter === "unpaid" && paidOf(r)) return false;
    if (filter === "not_joined" && r.userId) return false;
    if (level !== "all" && r.level !== level) return false;
    if (q && !`${r.name} ${r.matric}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const notJoined = roster.filter((r) => !r.userId);
  const progress = cycle ? selectCycleProgress(db, cycle) : null;

  if (roster.length === 0) {
    return (
      <>
        <PageHeader title="Members" lead={`Who is expected to pay dues to ${assoc.shortName}.`} />
        <EmptyState
          icon={<Users className="size-5" />}
          title="No one on the roster yet"
          action={
            <ButtonLink href="/exco/members/import">
              <Upload aria-hidden className="size-4" /> Upload your member list
            </ButtonLink>
          }
        >
          Upload the class list your department already has (a CSV with names and matric numbers). Everyone on it is tracked for dues from day one,
          whether or not they ever open the app.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Members"
        lead={`${plural(roster.length, "person", "people")} on the ${assoc.shortName} roster. Everyone here is expected to pay, whether or not they've joined the app.`}
        actions={
          <>
            <ButtonLink href="/exco/members/import" variant="secondary" size="sm">
              <Upload aria-hidden className="size-4" /> Upload roster
            </ButtonLink>
            {notJoined.length > 0 && (
              <Button size="sm" onClick={() => setInviting(notJoined)}>
                <MailPlus aria-hidden className="size-4" /> Invite {notJoined.length} who haven&apos;t joined
              </Button>
            )}
          </>
        }
      />

      {progress && cycle && (
        <Panel className="mb-6 grid gap-5 p-4 sm:grid-cols-2 sm:p-5">
          <Meter label={`Paid ${cycle.title}`} value={progress.paid} max={progress.total} detail={`${progress.paid} of ${progress.total}`} tone="credit" />
          <Meter label="Joined the app" value={progress.joined} max={progress.total} detail={`${progress.joined} of ${progress.total}`} />
        </Panel>
      )}

      {params.get("record") && (
        <Callout className="mb-5" title="Find the member who paid you, then press Mark paid.">
          It goes on the ledger straight away, with your name on it as the person who recorded it.
        </Callout>
      )}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Everyone", count: counts.all },
            { value: "unpaid", label: "Not paid", count: counts.unpaid },
            { value: "paid", label: "Paid", count: counts.paid },
            { value: "not_joined", label: "Not joined", count: counts.not_joined },
          ]}
        />
        <div className="flex flex-1 gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search by name or matric number</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or matric number" className="h-11 w-full rounded-sm border border-edge bg-surface pl-9 pr-3 text-sm placeholder:text-ink-3" />
          </label>
          <label className="w-28">
            <span className="sr-only">Level</span>
            <Select value={level} onChange={(e) => setLevel(e.target.value as Level | "all")} className="h-11 text-sm">
              <option value="all">All levels</option>
              {(["100L", "200L", "300L", "400L"] as Level[]).map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title="No one matches">
          {filter === "unpaid" && !q ? "Everyone on the roster has paid this cycle." : "Check the spelling, or search by matric number instead."}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-md border border-rule bg-surface">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_4rem_minmax(0,1fr)_minmax(0,1.2fr)_8rem] gap-4 border-b border-rule bg-sunken/60 px-4 py-2 text-xs font-semibold text-ink-2 md:grid">
            <span>Member</span>
            <span>Level</span>
            <span>App</span>
            <span>{cycle ? "This cycle" : "Dues"}</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="stagger divide-y divide-rule">
            {rows.map((r) => {
              const p = paidOf(r);
              return (
                <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_4rem_minmax(0,1fr)_minmax(0,1.2fr)_8rem]">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.name}</p>
                    <p className="text-sm text-ink-3">
                      {r.matric}
                      <span className="md:hidden">, {r.level}</span>
                    </p>
                  </div>
                  <span className="hidden text-sm md:block">{r.level}</span>
                  <span className="col-start-1 flex flex-wrap gap-1.5 md:col-start-auto">
                    {appStatus(r)}
                    <span className="md:hidden">
                      {duesStatus(r)}
                    </span>
                  </span>
                  <span className="hidden md:block">
                    {duesStatus(r)}
                  </span>
                  <span className="col-start-2 row-span-2 row-start-1 flex justify-end md:col-start-auto md:row-span-1 md:row-start-auto">
                    {cycle && !p ? (
                      <Button size="sm" variant="secondary" onClick={() => setPaying(r)}>
                        Mark paid
                      </Button>
                    ) : p ? (
                      <Link href={`/receipt/${p.receiptId}`} className="rounded px-2 py-1 text-sm font-semibold text-brand hover:underline">
                        Receipt
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {cycle && <ManualPayment record={paying} cycleId={cycle.id} onClose={() => setPaying(null)} />}
      <InviteDialog
        records={inviting}
        onClose={() => setInviting(null)}
        onSend={async (ids, channels) => {
          const r = await sendInvites(assocId, ids, channels);
          if (r.ok) toast(`Sent ${plural(r.value, "invite")}. Each link works once, for that person only.`);
          setInviting(null);
        }}
      />
    </>
  );

  function appStatus(r: MemberRecord) {
    if (r.userId) return <Tag tone="brand" icon={<Smartphone aria-hidden className="size-3" />}>Joined</Tag>;
    if (r.invite.status === "sent") return <Tag icon={<MailPlus aria-hidden className="size-3" />}>Invited {r.invite.sentAt ? fmtDate(r.invite.sentAt) : ""}</Tag>;
    if (r.invite.status === "expired") return <Tag tone="warn">Invite expired</Tag>;
    return <Tag icon={<UserX aria-hidden className="size-3" />}>Not invited</Tag>;
  }

  function duesStatus(r: MemberRecord) {
    if (!cycle) return <span className="text-sm text-ink-3">No cycle open</span>;
    const p = paidOf(r);
    if (!p) return <Tag tone="neutral" icon={<CircleDashed aria-hidden className="size-3" />}>Owes {naira(amountDueFor(r, cycle))}</Tag>;
    if (p.recordedBy)
      return (
        <Tag tone="credit" icon={<CheckCircle2 aria-hidden className="size-3" />}>
          Paid, {p.channel === "cash" ? "cash" : "transfer"}, marked by {firstName(selectUser(db, p.recordedBy)?.name ?? "exco")}
        </Tag>
      );
    return <Tag tone="credit" icon={<CheckCircle2 aria-hidden className="size-3" />}>Paid in app</Tag>;
  }
}

function ManualPayment({ record, cycleId, onClose }: { record: MemberRecord | null; cycleId: string; onClose: () => void }) {
  const { db, recordManualPayment } = useDb();
  const toast = useToast();
  const cycle = db.cycles.find((c) => c.id === cycleId)!;
  const [channel, setChannel] = useState<"cash" | "direct_transfer">("cash");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = record ? amountDueFor(record, cycle) : 0;

  const close = () => {
    setChannel("cash");
    setNote("");
    setConfirmed(false);
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!record) return;
    if (!confirmed) {
      setError(`Tick the box to confirm you received ${naira(amount)}.`);
      return;
    }
    setBusy(true);
    const r = await recordManualPayment({ recordId: record.id, cycleId, channel, note });
    setBusy(false);
    if (!r.ok) {
      setError(r.error === "already_paid" ? `${firstName(record.name)} is already marked as paid for this cycle.` : "That didn't save. Check your connection and try again.");
      return;
    }
    toast(`Marked ${record.name} as paid. It's on the ledger now.`);
    close();
  };

  return (
    <Dialog
      open={!!record}
      onClose={close}
      title={record ? `Mark ${firstName(record.name)} as paid` : ""}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} busy={busy}>
            <HandCoins aria-hidden className="size-4" /> Mark as paid
          </Button>
        </>
      }
    >
      {record && (
        <div className="space-y-5">
          <p className="text-ink-2">
            For when {firstName(record.name)} paid you outside the app. The ledger stays the one place that knows who has paid, even while people are still joining.
          </p>
          <dl className="grid grid-cols-2 gap-3 rounded-md bg-sunken px-4 py-3 text-sm">
            <div>
              <dt className="text-ink-3">Member</dt>
              <dd className="font-semibold">{record.name}</dd>
              <dd className="text-ink-2">
                {record.matric}, {record.level}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">{cycle.title}</dt>
              <dd className="text-xl font-bold">{naira(amount)}</dd>
            </div>
          </dl>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">How did they pay?</legend>
            {(["cash", "direct_transfer"] as const).map((c) => (
              <label key={c} className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 ${channel === c ? "border-brand bg-brand-wash/50" : "border-rule"}`}>
                <input type="radio" name="channel" checked={channel === c} onChange={() => setChannel(c)} className="mt-1 size-4 accent-[var(--brand)]" />
                <span>
                  <span className="block font-semibold">{c === "cash" ? "Cash, handed to an exco" : "Transfer straight to the association account"}</span>
                  <span className="block text-sm text-ink-2">
                    {c === "cash"
                      ? "It shows on the ledger as cash not yet banked, so the balance check against Ecobank stays honest until it's deposited."
                      : "It's already in the bank. The next balance check will include it."}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <Field label="Note" optional hint="Members can see this. For example: collected at the 300L class meeting.">
            {(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />}
          </Field>

          <Checkbox
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              setError(null);
            }}
            label={`I confirm I received ${naira(amount)} from ${record.name}.`}
            hint={`Recorded under your name, with the time. ${channelLabel[channel]} payments can't be deleted later, only corrected with a new entry.`}
          />
          {error && <Callout tone="danger" role="alert" title={error} />}
        </div>
      )}
    </Dialog>
  );
}

function InviteDialog({ records, onClose, onSend }: { records: MemberRecord[] | null; onClose: () => void; onSend: (ids: string[], channels: ("email" | "sms")[]) => Promise<void> }) {
  const { db, session } = useDb();
  const assoc = selectAssociation(db, session!.associationId)!;
  const [email, setEmail] = useState(true);
  const [sms, setSms] = useState(true);
  const [busy, setBusy] = useState(false);
  const sample = records?.[0];
  return (
    <Dialog
      open={!!records}
      onClose={onClose}
      title={records ? `Invite ${plural(records.length, "person", "people")}` : ""}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={busy}
            disabled={!email && !sms}
            onClick={async () => {
              setBusy(true);
              await onSend(
                records!.map((r) => r.id),
                [email && "email", sms && "sms"].filter(Boolean) as ("email" | "sms")[],
              );
              setBusy(false);
            }}
          >
            <MailPlus aria-hidden className="size-4" /> Send invites
          </Button>
        </>
      }
    >
      {sample && (
        <div className="space-y-5">
          <p className="text-ink-2">Each person gets their own link. It works once, and only with the email or phone number it was sent to, so nobody can claim someone else&apos;s place.</p>
          <div className="space-y-1">
            <Checkbox checked={email} onChange={(e) => setEmail(e.target.checked)} label="Email" />
            <Checkbox checked={sms} onChange={(e) => setSms(e.target.checked)} label="SMS" hint="Reaches people who never check their school email." />
          </div>
          <figure className="space-y-2">
            <figcaption className="text-sm font-semibold">What {firstName(sample.name)} will get</figcaption>
            <blockquote className="rounded-md border border-rule bg-paper px-4 py-3 text-sm leading-relaxed text-ink-2">
              Hi {firstName(sample.name)}, {assoc.shortName} now keeps its dues on BlazeSync, where every member can see the balance. Claim your place:
              blazesync.app/c/{sample.invite.code}. This link is only for you and works once.
            </blockquote>
          </figure>
        </div>
      )}
    </Dialog>
  );
}

export default function MembersPage() {
  return (
    <Suspense>
      <Members />
    </Suspense>
  );
}
