"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, Clock, Loader2, ShieldAlert, UserCheck } from "lucide-react";
import { use, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, EmptyState, Panel, Steps } from "@/components/ui/bits";
import { Field, Input } from "@/components/ui/Field";
import { amountDueFor, contactMatches, useStore } from "@/lib/store";
import { firstName, fmtDate, maskEmail, maskPhone, naira } from "@/lib/format";

/**
 * Claiming a roster invite (spec 3.2 step 4 and 3.3). The code finds the
 * roster record; the contact it was sent to proves it's the right person.
 * Whatever the treasurer already recorded, including cash, comes along.
 */
export default function ClaimPage({ params }: PageProps<"/claim/[code]">) {
  const { code } = use(params);
  const router = useRouter();
  const { ready, db, claimInvite } = useStore();
  const [step, setStep] = useState(0);
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready || !db) {
    return (
      <p className="flex items-center gap-2 text-ink-2">
        <Loader2 aria-hidden className="size-4 spin" /> Checking your invite
      </p>
    );
  }

  const record = db.roster.find((r) => r.invite.code === decodeURIComponent(code).toUpperCase());
  const assoc = record ? db.associations.find((a) => a.id === record.associationId) : null;
  const treasurer = assoc ? db.exco.find((e) => e.associationId === assoc.id && e.title === "Treasurer") : null;
  const treasurerName = treasurer ? (db.users.find((u) => u.id === treasurer.userId)?.name ?? "your treasurer") : "your treasurer";

  if (!record || !assoc) {
    return (
      <EmptyState icon={<ShieldAlert className="size-5" />} title="This invite link doesn't work" action={<ButtonLink href="/join">Join with an association code instead</ButtonLink>}>
        The code may be incomplete. Open the link straight from your email or SMS, or ask your treasurer to send it again.
      </EmptyState>
    );
  }
  if (record.invite.status === "claimed" && step < 3) {
    return (
      <EmptyState icon={<UserCheck className="size-5" />} title="This invite has already been used" action={<ButtonLink href="/login">Log in</ButtonLink>}>
        Each invite works once. If you claimed it, log in. If you didn&apos;t, tell {treasurerName} ({assoc.shortName} treasurer) so they can check who did.
      </EmptyState>
    );
  }
  if (record.invite.status === "expired") {
    return (
      <EmptyState icon={<Clock className="size-5" />} title="This invite has expired">
        Invites stop working after 30 days so old links can&apos;t be misused. Ask {treasurerName} to send you a new one; you&apos;ll keep your place on the roster and any payments.
      </EmptyState>
    );
  }

  const cycles = db.cycles.filter((c) => c.associationId === assoc.id).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const history = cycles.map((c) => ({ c, p: db.payments.find((p) => p.cycleId === c.id && p.memberRecordId === record.id) }));
  const who = (id: string) => db.users.find((u) => u.id === id)?.name ?? "an exco";

  const checkContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactMatches(record, contact)) {
      setErr(`That isn't the email or phone number this invite was sent to. If yours has changed, ask ${treasurerName} to update the roster and resend.`);
      return;
    }
    setErr(null);
    setStep(2);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setErr("Use at least 8 characters.");
    setBusy(true);
    const r = await claimInvite(record.invite.code, contact);
    setBusy(false);
    if (!r.ok) return setErr(r.error === "claimed" ? "Someone claimed this invite a moment ago. Tell your treasurer." : "That didn't go through. Try again.");
    setErr(null);
    setStep(3);
  };

  return (
    <div className="space-y-8">
      <Steps steps={["Your invite", "Confirm it's you", "Set a password", "Done"]} current={step} />

      {step === 0 && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {firstName(record.name)}, you&apos;re on the {assoc.shortName} roster
            </h1>
            <p className="text-ink-2">
              {assoc.name}, {assoc.institution}. Claim your place to see the live balance, pay dues, and keep your receipts.
            </p>
          </div>
          <Panel className="grid grid-cols-3 gap-3 p-4 text-sm">
            <div>
              <p className="text-ink-3">Name</p>
              <p className="font-semibold">{record.name}</p>
            </div>
            <div>
              <p className="text-ink-3">Matric</p>
              <p className="font-semibold">
                {record.matric.slice(0, 4)}•••{record.matric.slice(-2)}
              </p>
            </div>
            <div>
              <p className="text-ink-3">Level</p>
              <p className="font-semibold">{record.level}</p>
            </div>
          </Panel>
          {history.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold">Already on your record</h2>
              <ul className="divide-y divide-rule rounded-md border border-rule bg-surface">
                {history.map(({ c, p }) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                    {p ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-credit" /> : <CircleDashed aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-3" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{c.title}</p>
                      <p className="text-sm text-ink-2">
                        {p
                          ? `Paid ${naira(p.amount)} on ${fmtDate(p.paidAt)}${p.recordedBy ? `, recorded by ${who(p.recordedBy)}` : ""}`
                          : c.status === "open"
                            ? `${naira(amountDueFor(record, c))} to pay by ${fmtDate(c.deadline)}`
                            : "Not paid"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-ink-3">This comes with you when you claim. Nothing you&apos;ve paid is lost, even if you paid in cash.</p>
            </section>
          )}
          <Button onClick={() => setStep(1)}>This is me, continue</Button>
          <p className="text-sm text-ink-3">Not {record.name}? Close this page. The invite only works for them.</p>
        </div>
      )}

      {step === 1 && (
        <form onSubmit={checkContact} noValidate className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Confirm it&apos;s you</h1>
            <p className="text-ink-2">
              This invite was sent to {[record.email && maskEmail(record.email), record.phone && maskPhone(record.phone)].filter(Boolean).join(" and ")}.{" "}
              {record.email && record.phone ? "Type either one in full." : "Type it in full."}
            </p>
          </div>
          <Field label="Email or phone number" error={err}>
            {(a) => <Input {...a} value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="email" />}
          </Field>
          <Button type="submit">Continue</Button>
          <p className="text-sm text-ink-3">
            Demo: this invite was sent to <span className="font-mono text-ink">{record.email || record.phone}</span>
          </p>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={create} noValidate className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Set a password</h1>
            <p className="text-ink-2">You&apos;ll log in with {contact.trim()} and this password.</p>
          </div>
          <Field label="Password" error={err} hint="At least 8 characters. A short phrase is easier to remember than a jumble.">
            {(a) => <Input {...a} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Button type="submit" busy={busy}>
            Claim my place
          </Button>
          <p className="text-sm text-ink-2">
            Already have a BlazeSync account?{" "}
            <button type="button" className="font-semibold text-brand hover:underline" onClick={() => router.push(`/login?next=${encodeURIComponent(`/claim/${code}`)}`)}>
              Log in instead
            </button>
          </p>
        </form>
      )}

      {step === 3 && (
        <div className="success space-y-6">
          <CheckCircle2 aria-hidden className="size-10 text-credit" />
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">You&apos;ve claimed your place in {assoc.shortName}</h1>
          <p className="text-lg text-ink-2">Your payment history came with you. {treasurerName}&apos;s roster now shows you&apos;ve joined.</p>
          <Callout tone="success" title="This invite link now can't be used again" />
          <ButtonLink href="/member">Go to {assoc.shortName}</ButtonLink>
        </div>
      )}
    </div>
  );
}
