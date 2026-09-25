"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, Landmark, Users } from "lucide-react";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, Panel } from "@/components/ui/bits";
import { Field, Input, Select } from "@/components/ui/Field";
import { useStore } from "@/lib/store";
import type { Association, Level } from "@/lib/types";
import { DEMO } from "@/lib/mock/seed";

export default function JoinPage() {
  const router = useRouter();
  const { ready, db, findAssociationByCode, joinByCode } = useStore();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Association | null>(null);
  const [name, setName] = useState("");
  const [matric, setMatric] = useState("");
  const [level, setLevel] = useState<Level>("100L");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = code.trim();
    const invite = raw.match(/\/(?:c|claim)\/([A-Z0-9-]+)/i) ?? raw.match(/^([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})$/i);
    if (invite) {
      router.push(`/claim/${invite[1].toUpperCase()}`);
      return;
    }
    if (!raw) return setErrors({ code: "Enter the code your association shared, like CSSA-4821." });
    setBusy(true);
    const r = await findAssociationByCode(raw);
    setBusy(false);
    if (!r.ok) return setErrors({ code: `No association uses the code ${raw.toUpperCase()}. Check it with your treasurer; codes look like CSSA-4821.` });
    setErrors({});
    setFound(r.value);
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().split(/\s+/).length < 2) errs.name = "Enter your full name as it is on the school's records.";
    if (!/^[A-Z0-9/]{6,12}$/i.test(matric.trim())) errs.matric = "Enter your matric number, like 260805301.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const r = await joinByCode({ associationId: found!.id, name, matric, level });
    setBusy(false);
    if (!r.ok) {
      setErrors({
        matric:
          r.error === "matric_taken"
            ? `Matric ${matric.trim()} is already on the ${found!.shortName} roster. If that's you, use the invite link your treasurer sent, or ask them to resend it.`
            : "That didn't go through. Try again.",
      });
      return;
    }
    setJoined(true);
  };

  if (joined && found) {
    return (
      <div className="success space-y-6">
        <CheckCircle2 aria-hidden className="size-10 text-credit" />
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">You&apos;re in {found.shortName}</h1>
        <p className="text-lg text-ink-2">You can see its live balance and every payment in and out. When dues open, they&apos;ll be on your home page.</p>
        <ButtonLink href="/member">Go to {found.shortName}</ButtonLink>
      </div>
    );
  }

  const members = found && db ? db.roster.filter((r) => r.associationId === found.id).length : 0;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Join an association</h1>
        <p className="text-ink-2">Use the code your treasurer shared, or paste your personal invite link.</p>
      </div>

      {!found ? (
        <form onSubmit={find} noValidate className="space-y-5">
          <Field label="Association code or invite link" error={errors.code}>
            {(a) => <Input {...a} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" placeholder="CSSA-4821" />}
          </Field>
          <Button type="submit" busy={busy} disabled={!ready}>
            Find association
          </Button>
          <p className="text-sm text-ink-3">
            Demo: try <span className="font-mono font-semibold text-ink">{DEMO.joinCode}</span>, or the invite <span className="font-mono font-semibold text-ink">{DEMO.claimCode}</span>.
          </p>
        </form>
      ) : (
        <form onSubmit={join} noValidate className="space-y-6">
          <Panel className="space-y-3 p-5">
            <p className="text-lg font-bold">{found.name}</p>
            <p className="text-ink-2">
              {found.institution}, {found.faculty}
            </p>
            <ul className="space-y-1.5 text-sm text-ink-2">
              <li className="flex items-center gap-2">
                <Users aria-hidden className="size-4" /> {members} members on the roster
              </li>
              <li className="flex items-center gap-2">
                <Landmark aria-hidden className="size-4" />
                {found.linkedAccount ? `Dues go to its Ecobank account ending ${found.linkedAccount.last4}` : "No bank account linked yet"}
              </li>
            </ul>
          </Panel>
          <Callout title="Were you sent a personal invite?">Use that link instead. It already has your payment history on it, including anything you paid in cash.</Callout>
          <Field label="Full name" error={errors.name}>
            {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
          </Field>
          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Field label="Matric number" error={errors.matric}>
              {(a) => <Input {...a} value={matric} onChange={(e) => setMatric(e.target.value)} inputMode="numeric" />}
            </Field>
            <Field label="Level">
              {(a) => (
                <Select {...a} value={level} onChange={(e) => setLevel(e.target.value as Level)}>
                  {(["100L", "200L", "300L", "400L", "500L"] as Level[]).map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setFound(null)}>
              Back
            </Button>
            <Button type="submit" busy={busy}>
              Join {found.shortName}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
