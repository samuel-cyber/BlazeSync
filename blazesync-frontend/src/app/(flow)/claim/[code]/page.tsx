"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, Clock, Loader2, ShieldAlert, UserCheck } from "lucide-react";
import { use, useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, EmptyState, Panel, Steps } from "@/components/ui/bits";
import { Field, Input } from "@/components/ui/Field";
import { amountDueFor, contactMatches, useStore } from "@/lib/store";
import { api, type InvitePreview } from "@/lib/api";
import { firstName, fmtDate, maskEmail, maskPhone, naira } from "@/lib/format";

/**
 * Claiming a roster invite (spec 3.2 step 4 and 3.3). The code finds the
 * roster record; the contact it was sent to proves it's the right person.
 * Whatever the treasurer already recorded, including cash, comes along.
 */
export default function ClaimPage({ params }: PageProps<"/claim/[code]">) {
  const { code } = use(params);
  const router = useRouter();
  const { ready, db, session, mode, claimInvite } = useStore();
  const [step, setStep] = useState(0);
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [liveState, setLiveState] = useState<"loading" | "found" | "missing">("loading");
  const [seenCode, setSeenCode] = useState(code);
  // Re-entering with a different link resets the lookup (React's adjust-state-during-render pattern).
  if (seenCode !== code) {
    setSeenCode(code);
    setPreview(null);
    setLiveState("loading");
  }
  const previewState = mode === "live" ? liveState : db ? "found" : "loading";

  // Live mode: the code is looked up server-side; demo mode reads the seed.
  useEffect(() => {
    if (mode !== "live") return;
    let live = true;
    api
      .invitePreview(decodeURIComponent(code))
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setLiveState("found");
      })
      .catch(() => {
        if (live) setLiveState("missing");
      });
    return () => {
      live = false;
    };
  }, [code, mode]);

  if (!ready || previewState === "loading") {
    return (
      <p className="flex items-center gap-2 text-ink-2">
        <Loader2 aria-hidden className="size-4 spin" /> Checking your invite
      </p>
    );
  }

  if (previewState === "missing") {
    return (
      <EmptyState icon={<ShieldAlert className="size-5" />} title="This invite link doesn't work" action={<ButtonLink href="/join">Join with an association code instead</ButtonLink>}>
        The code may be incomplete. Open the link straight from your email or SMS, or ask your treasurer to send it again.
      </EmptyState>
    );
  }

  const record = mode === "live" ? null : db?.roster.find((r) => r.invite.code === decodeURIComponent(code).toUpperCase()) ?? null;
  const assoc = mode === "live" ? (preview ? { shortName: preview.association.name, name: preview.association.name, institution: preview.association.institution } : null) : record ? db?.associations.find((a) => a.id === record.associationId) ?? null : null;
  const treasurerName = "your treasurer";

  if (mode === "demo" && (!record || !assoc)) {
    return (
      <EmptyState icon={<ShieldAlert className="size-5" />} title="This invite link doesn't work" action={<ButtonLink href="/join">Join with an association code instead</ButtonLink>}>
        The code may be incomplete. Open the link straight from your email or SMS, or ask your treasurer to send it again.
      </EmptyState>
    );
  }
  if (mode === "demo" && record && record.invite.status === "claimed" && step < 3) {
    return (
      <EmptyState icon={<UserCheck className="size-5" />} title="This invite has already been used" action={<ButtonLink href="/login">Log in</ButtonLink>}>
        Each invite works once. If you claimed it, log in. If you didn&apos;t, tell {treasurerName} ({assoc!.shortName} treasurer) so they can check who did.
      </EmptyState>
    );
  }
  if (mode === "live" && preview && preview.invite_status === "claimed") {
    return (
      <EmptyState icon={<UserCheck className="size-5" />} title="This invite has already been used" action={<ButtonLink href="/login">Log in</ButtonLink>}>
        Each invite works once. If you claimed it, log in. If you didn&apos;t, tell {treasurerName} ({preview.association.name} treasurer) so they can check who did.
      </EmptyState>
    );
  }
  if (mode === "live" && preview && preview.invite_status === "expired") {
    return (
      <EmptyState icon={<Clock className="size-5" />} title="This invite has expired">
        Invites stop working after a while so old links can&apos;t be misused. Ask {treasurerName} to send you a new one; you&apos;ll keep your place on the roster and any payments.
      </EmptyState>
    );
  }
  if (mode === "demo" && record && record.invite.status === "expired") {
    return (
      <EmptyState icon={<Clock className="size-5" />} title="This invite has expired">
        Invites stop working after 30 days so old links can&apos;t be misused. Ask {treasurerName} to send you a new one; you&apos;ll keep your place on the roster and any payments.
      </EmptyState>
    );
  }

  const displayName = mode === "live" ? preview!.name : record!.name;
  const displayMatric = mode === "live" ? preview!.matric_number ?? "" : record!.matric;
  const displayEmail = mode === "live" ? "" : record!.email;
  const displayPhone = mode === "live" ? "" : record!.phone;
  const assocShort = mode === "live" ? preview!.association.name : assoc!.shortName;

  const cycles = mode === "demo" && db ? db.cycles.filter((c) => c.associationId === record!.associationId).sort((a, b) => b.openedAt.localeCompare(a.openedAt)) : [];
  const history = mode === "demo" && record ? cycles.map((c) => ({ c, p: db!.payments.find((p) => p.cycleId === c.id && p.memberRecordId === record.id) })) : [];
  const who = (id: string) => db!.users.find((u) => u.id === id)?.name ?? "an exco";

  const checkContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "demo" && record && !contactMatches(record, contact)) {
      setErr(`That isn't the email or phone number this invite was sent to. If yours has changed, ask ${treasurerName} to update the roster and resend.`);
      return;
    }
    if (!contact.trim()) {
      setErr("Enter the email this invite was sent to.");
      return;
    }
    setErr(null);
    setStep(2);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session && password.length < 8) {
      setErr("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    const r = await claimInvite(decodeURIComponent(code), contact.trim());
    setBusy(false);
    if (!r.ok) {
      setErr(r.error === "claimed" ? "Someone claimed this invite a moment ago. Tell your treasurer." : r.error === "mismatch" ? `That isn't the contact this invite was sent to. Ask ${treasurerName} if it has changed.` : r.error === "not_found" ? "This invite code doesn't exist." : "That didn't go through. Try again.");
      return;
    }
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
              {firstName(displayName)}, you&apos;re on the {assocShort} roster
            </h1>
            <p className="text-ink-2">
              {mode === "live" ? preview!.association.name : assoc!.name}, {mode === "live" ? preview!.association.institution : assoc!.institution}. Claim your place to see the live balance, pay dues, and keep your receipts.
            </p>
          </div>
          <Panel className="grid grid-cols-3 gap-3 p-4 text-sm">
            <div>
              <p className="text-ink-3">Name</p>
              <p className="font-semibold">{displayName}</p>
            </div>
            <div>
              <p className="text-ink-3">Matric</p>
              <p className="font-semibold">{displayMatric ? `${displayMatric.slice(0, 4)}•••${displayMatric.slice(-2)}` : "—"}</p>
            </div>
            <div>
              <p className="text-ink-3">Level</p>
              <p className="font-semibold">{mode === "demo" ? record!.level : "—"}</p>
            </div>
          </Panel>
          {mode === "live" && preview?.paid_amount && (
            <Panel className="flex items-start gap-3 p-4">
              <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-credit" />
              <div>
                <p className="font-semibold">You&apos;ve already paid {naira(Math.round(parseFloat(preview.paid_amount) * 100))}</p>
                <p className="text-sm text-ink-2">{preview.cycle?.title ?? "This cycle"}. It stays on your record.</p>
              </div>
            </Panel>
          )}
          {mode === "demo" && history.length > 0 && (
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
                            ? `${naira(amountDueFor(record!, c))} to pay by ${fmtDate(c.deadline)}`
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
          <p className="text-sm text-ink-3">Not {displayName}? Close this page. The invite only works for them.</p>
        </div>
      )}

      {step === 1 && (
        <form onSubmit={checkContact} noValidate className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Confirm it&apos;s you</h1>
            <p className="text-ink-2">
              {mode === "live"
                ? "This invite was sent to an email address only you should have. Type it in full."
                : `This invite was sent to ${[displayEmail && maskEmail(displayEmail), displayPhone && maskPhone(displayPhone)].filter(Boolean).join(" and ")}. Type it in full.`}
            </p>
          </div>
          <Field label="Email or phone number" error={err}>
            {(a) => <Input {...a} value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="email" />}
          </Field>
          <Button type="submit">Continue</Button>
          {mode === "demo" && (displayEmail || displayPhone) && (
            <p className="text-sm text-ink-3">
              Demo: this invite was sent to <span className="font-mono text-ink">{displayEmail || displayPhone}</span>
            </p>
          )}
        </form>
      )}

      {step === 2 && (
        <form onSubmit={create} noValidate className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">{session ? "Claim your place" : "Set a password"}</h1>
            <p className="text-ink-2">{session ? "You're logged in, so this claims straight onto your account." : `You'll log in with ${contact.trim()} and this password. First create the account:`}</p>
          </div>
          {!session && (
            <Field label="Email" hint="The backend registers accounts by email.">
              {(a) => <Input {...a} type="email" value={contact.includes("@") ? contact : ""} onChange={(e) => setContact(e.target.value)} autoComplete="email" />}
            </Field>
          )}
          {!session && (
            <Field label="Password" error={err} hint="At least 8 characters. A short phrase is easier to remember than a jumble.">
              {(a) => <Input {...a} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
          )}
          <Button type="submit" busy={busy}>
            {session ? "Claim my place" : "Create account and claim"}
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
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">You&apos;ve claimed your place in {assocShort}</h1>
          <p className="text-lg text-ink-2">Your payment history came with you. The roster now shows you&apos;ve joined.</p>
          <Callout tone="success" title="This invite link now can't be used again" />
          <ButtonLink href="/member">Go to {assocShort}</ButtonLink>
        </div>
      )}
    </div>
  );
}
