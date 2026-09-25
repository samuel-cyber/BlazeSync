"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, PageHeader, Panel } from "@/components/ui/bits";
import { Checkbox, Field, Input, MoneyInput, Switch } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { isPastDay, naira, plural, toKobo } from "@/lib/format";
import { selectAssociation, selectOpenCycle, useDb } from "@/lib/store";
import type { Level } from "@/lib/types";

const LEVELS: Level[] = ["100L", "200L", "300L", "400L"];

export default function NewCycle() {
  const router = useRouter();
  const toast = useToast();
  const { db, session, openCycle } = useDb();
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const open = selectOpenCycle(db, assocId);
  const roster = db.roster.filter((r) => r.associationId === assocId);

  const [title, setTitle] = useState("2026/27 second semester dues");
  const [amount, setAmount] = useState("2000");
  const [deadline, setDeadline] = useState("");
  const [split, setSplit] = useState(false);
  const [perLevel, setPerLevel] = useState<Record<Level, string>>({ "100L": "3000", "200L": "", "300L": "", "400L": "", "500L": "" });
  const [notify, setNotify] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const base = toKobo(amount);
  const levelAmount = (l: Level) => (split && perLevel[l] ? toKobo(perLevel[l]) : null) ?? base ?? 0;
  const total = roster.reduce((s, r) => s + levelAmount(r.level), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Give the cycle a name members will recognise, like “2026/27 second semester dues”.";
    if (!base || base <= 0) errs.amount = "Enter an amount in naira, like 2000.";
    if (!deadline) errs.deadline = "Pick the last day to pay.";
    else if (isPastDay(deadline)) errs.deadline = "The deadline has to be in the future.";
    if (split) for (const l of LEVELS) if (perLevel[l] && !toKobo(perLevel[l])) errs[l] = "Not a valid amount.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const pl = split ? Object.fromEntries(LEVELS.filter((l) => perLevel[l]).map((l) => [l, toKobo(perLevel[l])!])) : null;
    const r = await openCycle({ associationId: assocId, title: title.trim(), amount: base!, perLevel: pl && Object.keys(pl).length ? pl : null, deadline: new Date(`${deadline}T23:59:00+01:00`).toISOString() });
    setBusy(false);
    if (!r.ok) {
      setServerError(r.error === "already_open" ? "Another cycle is already open. Close it first, so members only ever owe one thing at a time." : "That didn't save. Try again.");
      return;
    }
    toast(notify ? `Opened ${title.trim()}. Members are being notified.` : `Opened ${title.trim()}.`);
    router.push(`/exco/dues/${r.value}`);
  };

  if (open) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Open a dues cycle" back={{ href: "/exco/dues", label: "Dues" }} />
        <Callout tone="warn" title={`${open.title} is still open`} action={<ButtonLink href={`/exco/dues/${open.id}`} size="sm" variant="secondary">Go to that cycle</ButtonLink>}>
          Close it before opening the next one, so members only ever owe one thing at a time.
        </Callout>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Open a dues cycle" lead={`Everyone on the ${assoc.shortName} roster will owe this, whether or not they've joined the app.`} back={{ href: "/exco/dues", label: "Dues" }} />
      <form onSubmit={submit} noValidate className="space-y-6">
        {serverError && <Callout tone="danger" role="alert" title={serverError} />}
        <Field label="Name" error={errors.title} hint="Members see this on their receipt.">
          {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Amount" error={errors.amount}>
            {(a) => <MoneyInput {...a} value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label="Last day to pay" error={errors.deadline} hint="Payments close at 11:59pm that day.">
            {(a) => <Input {...a} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}
          </Field>
        </div>

        <Panel className="px-4">
          <Switch checked={split} onChange={setSplit} label="Charge some levels a different amount" hint="For example, freshers pay more because it includes a welcome pack." />
          {split && (
            <div className="grid grid-cols-2 gap-4 border-t border-rule py-4 sm:grid-cols-4">
              {LEVELS.map((l) => (
                <Field key={l} label={l} error={errors[l]}>
                  {(a) => <MoneyInput {...a} value={perLevel[l]} placeholder={amount} onChange={(e) => setPerLevel((p) => ({ ...p, [l]: e.target.value }))} />}
                </Field>
              ))}
              <p className="col-span-full text-sm text-ink-3">Leave a level blank to use {base ? naira(base) : "the main amount"}.</p>
            </div>
          )}
        </Panel>

        <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} label="Tell members now" hint="In-app for people who've joined, SMS for everyone else on the roster." />

        <div className="rounded-md bg-sunken px-4 py-4">
          <p className="text-sm text-ink-2">If everyone pays</p>
          <p className="figure text-2xl font-bold">{naira(total)}</p>
          <p className="text-sm text-ink-2">from {plural(roster.length, "member")} on the roster</p>
        </div>

        <Button type="submit" busy={busy} className="w-full sm:w-auto">
          Open dues cycle
        </Button>
      </form>
    </div>
  );
}
