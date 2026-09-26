"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { LinkAccountFlow } from "@/components/LinkAccountFlow";
import { Button } from "@/components/ui/Button";
import { Callout, Panel, Steps } from "@/components/ui/bits";
import { Field, Input, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useStore } from "@/lib/store";
import type { ExcoTitle } from "@/lib/types";

const INSTITUTIONS = [
  "University of Lagos",
  "Obafemi Awolowo University",
  "University of Ibadan",
  "University of Nigeria, Nsukka",
  "Ahmadu Bello University",
  "University of Benin",
  "Lagos State University",
  "Covenant University",
  "Yaba College of Technology",
  "Federal University of Technology, Akure",
  "Other",
];
const TITLES: ExcoTitle[] = ["Financial Secretary", "President", "Vice President", "General Secretary", "Other"];
const STEPS = ["Association", "Bank account", "Co-signatories", "Payout rule"];

type Cosig = { name: string; contact: string; title: ExcoTitle };

export default function SetupWizard() {
  const router = useRouter();
  const toast = useToast();
  const { createAssociation, ready } = useStore();
  const [step, setStep] = useState(0);
  const [assoc, setAssoc] = useState({ name: "", shortName: "", institution: "University of Lagos", faculty: "", department: "" });
  const [last4, setLast4] = useState<string | null>(null);
  const [accountRef, setAccountRef] = useState<string | null>(null);
  const [cosigs, setCosigs] = useState<Cosig[]>([{ name: "", contact: "", title: "Financial Secretary" }]);
  const [required, setRequired] = useState(2);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const total = cosigs.length + 1;

  const nextFromAssoc = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (assoc.name.trim().length < 4) errs.name = "Enter the association's full name, as members know it.";
    if (!assoc.shortName.trim()) errs.shortName = "A short name for receipts and the top of the ledger, like CSSA UNILAG.";
    if (!assoc.faculty.trim()) errs.faculty = "Enter the faculty, or Student Affairs for clubs.";
    setErrors(errs);
    if (!Object.keys(errs).length) setStep(1);
  };

  const nextFromCosigs = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    cosigs.forEach((c, i) => {
      if (c.name.trim().length < 3) errs[`n${i}`] = "Enter their full name.";
      if (!/@/.test(c.contact) && !/^(\+?234|0)[789][01]\d{8}$/.test(c.contact.replace(/\s/g, ""))) errs[`c${i}`] = "An email or a Nigerian phone number.";
    });
    setErrors(errs);
    if (!Object.keys(errs).length) {
      setRequired(Math.min(2, total));
      setStep(3);
    }
  };

  const finish = async () => {
    setBusy(true);
    const r = await createAssociation({ ...assoc, name: assoc.name.trim(), shortName: assoc.shortName.trim(), accountLast4: last4!, accountRef, cosignatories: cosigs, required });
    setBusy(false);
    if (r.ok) {
      toast(`${assoc.shortName.trim()} is set up. Your co-signatories have been invited.`);
      router.push("/exco/members/import");
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Set up your association</h1>
        <p className="text-ink-2">About five minutes. You&apos;ll need the association&apos;s Ecobank account number and your phone for a code.</p>
      </div>
      <Steps steps={STEPS} current={step} />

      {step === 0 && (
        <form onSubmit={nextFromAssoc} noValidate className="space-y-6">
          <Field label="Full name" error={errors.name}>
            {(a) => <Input {...a} value={assoc.name} onChange={(e) => setAssoc({ ...assoc, name: e.target.value })} placeholder="Computer Science Students' Association" />}
          </Field>
          <Field label="Short name" error={errors.shortName} hint="Shown at the top of the ledger and on every receipt.">
            {(a) => <Input {...a} value={assoc.shortName} maxLength={24} onChange={(e) => setAssoc({ ...assoc, shortName: e.target.value })} placeholder="CSSA UNILAG" />}
          </Field>
          <Field label="Institution">
            {(a) => (
              <Select {...a} value={assoc.institution} onChange={(e) => setAssoc({ ...assoc, institution: e.target.value })}>
                {INSTITUTIONS.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Faculty" error={errors.faculty}>
              {(a) => <Input {...a} value={assoc.faculty} onChange={(e) => setAssoc({ ...assoc, faculty: e.target.value })} placeholder="Faculty of Science" />}
            </Field>
            <Field label="Department" optional>
              {(a) => <Input {...a} value={assoc.department} onChange={(e) => setAssoc({ ...assoc, department: e.target.value })} placeholder="Computer Sciences" />}
            </Field>
          </div>
          <Button type="submit" disabled={!ready}>
            Continue
          </Button>
        </form>
      )}

      {step === 1 && (
        <div className="space-y-6">
          {last4 ? (
            <>
              <Callout tone="success" title={`Linked the Ecobank account ending ${last4}`}>
                Ecobank confirmed you control it. You can disconnect it any time from Settings.
              </Callout>
              <Button onClick={() => setStep(2)}>Continue</Button>
            </>
          ) : (
            <LinkAccountFlow
              associationName={assoc.shortName || "your association"}
              onLinked={(ref) => {
                setAccountRef(ref);
                setLast4(ref.slice(-4));
              }}
            />
          )}
          <button type="button" onClick={() => setStep(0)} className="block text-sm font-semibold text-brand hover:underline">
            Back to association details
          </button>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={nextFromCosigs} noValidate className="space-y-6">
          <p className="text-ink-2">
            Co-signatories approve payouts with you. With at least two of you, no one can move the association&apos;s money alone, including you.
          </p>
          <ul className="space-y-4">
            {cosigs.map((c, i) => (
              <li key={i}>
                <Panel className="space-y-4 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">Co-signatory {i + 1}</p>
                    {cosigs.length > 1 && (
                      <button type="button" onClick={() => setCosigs(cosigs.filter((_, j) => j !== i))} className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-sunken" aria-label={`Remove co-signatory ${i + 1}`}>
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Full name" error={errors[`n${i}`]}>
                      {(a) => <Input {...a} value={c.name} onChange={(e) => setCosigs(cosigs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />}
                    </Field>
                    <Field label="Role">
                      {(a) => (
                        <Select {...a} value={c.title} onChange={(e) => setCosigs(cosigs.map((x, j) => (j === i ? { ...x, title: e.target.value as ExcoTitle } : x)))}>
                          {TITLES.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                  <Field label="Email or phone number" error={errors[`c${i}`]} hint="Their invite goes here.">
                    {(a) => <Input {...a} value={c.contact} onChange={(e) => setCosigs(cosigs.map((x, j) => (j === i ? { ...x, contact: e.target.value } : x)))} />}
                  </Field>
                </Panel>
              </li>
            ))}
          </ul>
          {cosigs.length < 4 && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setCosigs([...cosigs, { name: "", contact: "", title: "President" }])}>
              <Plus aria-hidden className="size-4" /> Add another
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="submit">Continue</Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <Panel className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-3 text-lg">
              <span>Payouts need</span>
              <label>
                <span className="sr-only">Signatures required</span>
                <Select value={required} onChange={(e) => setRequired(Number(e.target.value))} className="h-11 w-20 text-lg font-bold">
                  {Array.from({ length: total - 1 }, (_, i) => i + 2).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </label>
              <span>of {total} signatures</span>
            </div>
            <p className="text-sm text-ink-2">
              You, plus {cosigs.map((c) => c.name.split(" ")[0]).join(" and ")}. The server refuses any payout without this many different people approving it.
            </p>
          </Panel>
          <ul className="space-y-2 text-ink-2">
            {[
              `${assoc.shortName}, ${assoc.institution}`,
              `Ecobank account ending ${last4}`,
              `${cosigs.length} co-signator${cosigs.length === 1 ? "y" : "ies"} to invite`,
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 aria-hidden className="size-4 text-credit" /> {t}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={finish} busy={busy}>
              Create {assoc.shortName}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
