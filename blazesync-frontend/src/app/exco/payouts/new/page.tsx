"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, PageHeader, Panel } from "@/components/ui/bits";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { lookupAccountName, NIGERIAN_BANKS } from "@/lib/banks";
import { firstName, naira, newIdempotencyKey, toKobo } from "@/lib/format";
import { availableFor, reservedFor, selectAssociation, selectUser, useDb } from "@/lib/store";
import type { LedgerCategory } from "@/lib/types";

const CATEGORIES: LedgerCategory[] = ["Event", "Welfare", "Printing", "Transport", "Logistics", "Refund"];

export default function NewPayout() {
  const router = useRouter();
  const toast = useToast();
  const { db, session, requestPayout } = useDb();
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  // Money already promised to payouts still waiting or sending isn't available again.
  const available = availableFor(db, assocId);
  const reserved = reservedFor(db, assocId);
  const iSign = db.exco.some((e) => e.associationId === assocId && e.userId === session!.userId && e.isSignatory);
  const others = db.exco.filter((e) => e.associationId === assocId && e.isSignatory && e.userId !== session!.userId).map((e) => firstName(selectUser(db, e.userId)?.name ?? "?"));
  const stillNeeded = assoc.approvalRule.required - (iSign ? 1 : 0);

  // One key per form: a double-tap or a retried request creates one payout, not two.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<LedgerCategory>("Event");
  const [reason, setReason] = useState("");
  const [bank, setBank] = useState("");
  const [acct, setAcct] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(null);
    setLookupFailed(false);
    if (acct.length === 10 && bank) {
      setLooking(true);
      lookupAccountName(bank, acct).then((n) => {
        if (!live) return;
        setLooking(false);
        setName(n);
        setLookupFailed(!n);
      });
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      live = false;
    };
  }, [acct, bank]);

  if (!assoc.linkedAccount) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Request a payout" back={{ href: "/exco/payouts", label: "Payouts" }} />
        <Callout tone="warn" title="Link the association's bank account first" action={<ButtonLink href="/exco/settings#account" size="sm">Link account</ButtonLink>}>
          Payouts are sent from the linked Ecobank account, so there&apos;s nowhere to send from yet.
        </Callout>
      </div>
    );
  }

  const kobo = toKobo(amount);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!kobo || kobo <= 0) errs.amount = "Enter an amount in naira, like 48000.";
    else if (kobo > available) errs.amount = `The account has ${naira(available)} available. Lower the amount, or wait for more dues to come in.`;
    if (reason.trim().length < 8) errs.reason = "Say what it's for in a few words. Members will read this on the ledger.";
    if (!bank) errs.bank = "Choose the recipient's bank.";
    if (!/^\d{10}$/.test(acct)) errs.acct = "Account numbers are 10 digits.";
    else if (!name) errs.acct = "We couldn't confirm this account. Check the number and bank.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError(null);
    const r = await requestPayout({ associationId: assocId, amount: kobo!, category, reason: reason.trim(), recipient: { accountName: name!, bank, accountNumber: acct }, idempotencyKey });
    setBusy(false);
    if (!r.ok) {
      setServerError(
        r.error === "insufficient"
          ? `Only ${naira(availableFor(db, assocId))} is available now. Lower the amount and send it again.`
          : r.error === "not_exco"
            ? "Only this association's exco can request payouts."
            : r.error === "no_account"
              ? "The bank account was disconnected. Link it again in Settings first."
              : "The request didn't go through. Nothing was sent. Try again.",
      );
      return;
    }
    toast(`Payout requested. ${others.join(iSign ? " or " : " and ")} will be asked to sign.`);
    router.push(`/exco/payouts/${r.value}`);
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Request a payout"
        lead={
          reserved > 0
            ? `Available: ${naira(available)}. That's the ${assoc.shortName} account less ${naira(reserved)} already promised to payouts waiting for signatures.`
            : `Available in the ${assoc.shortName} account: ${naira(available)}.`
        }
        back={{ href: "/exco/payouts", label: "Payouts" }}
      />
      <form onSubmit={submit} noValidate className="space-y-6">
        {serverError && <Callout tone="danger" role="alert" title={serverError} />}
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Amount" error={errors.amount}>
            {(a) => <MoneyInput {...a} value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label="Category">
            {(a) => (
              <Select {...a} value={category} onChange={(e) => setCategory(e.target.value as LedgerCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="What it's for" error={errors.reason} hint="Every member sees this on the ledger once it's paid, so be specific.">
          {(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Freshers' welcome: branded T-shirts for 100L, 60 pieces" />}
        </Field>

        <fieldset className="space-y-4">
          <legend className="mb-1 font-semibold">Who gets paid</legend>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Bank" error={errors.bank}>
              {(a) => (
                <Select {...a} value={bank} onChange={(e) => setBank(e.target.value)}>
                  <option value="">Choose a bank</option>
                  {NIGERIAN_BANKS.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Account number" error={errors.acct}>
              {(a) => <Input {...a} inputMode="numeric" maxLength={10} value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ""))} placeholder="10 digits" />}
            </Field>
          </div>
          <div aria-live="polite" className="min-h-6 text-sm">
            {looking && (
              <span className="inline-flex items-center gap-2 text-ink-2">
                <Loader2 aria-hidden className="size-4 spin" /> Checking the account name with the bank
              </span>
            )}
            {name && (
              <span className="inline-flex items-center gap-2 font-semibold">
                <CheckCircle2 aria-hidden className="size-4 text-credit" /> {name}
              </span>
            )}
            {lookupFailed && <span className="text-danger">The bank has no account {acct} at {bank}. Check both and try again.</span>}
          </div>
        </fieldset>

        <Field label="Invoice or quote" optional hint="A photo is fine. The other signatories see it before they sign.">
          {(a) => <input {...a} type="file" accept="image/*,.pdf" className="block w-full text-sm text-ink-2 file:mr-3 file:h-10 file:rounded-sm file:border file:border-edge file:bg-surface file:px-3 file:font-semibold file:text-ink" />}
        </Field>

        <Panel className="flex gap-3 p-4">
          <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
          <p className="text-sm text-ink-2">
            {iSign
              ? `Sending this request counts as your signature. It then needs ${stillNeeded} more from ${others.join(" or ")} before any money moves.`
              : `You're not a signatory, so this needs ${stillNeeded} signatures from ${others.join(", ")} before any money moves.`}{" "}
            If anyone rejects it, nothing is sent.
          </p>
        </Panel>

        <Button type="submit" busy={busy} className="w-full sm:w-auto">
          {iSign ? "Sign and request" : "Request"} {kobo ? naira(kobo) : "payout"}
        </Button>
      </form>
    </div>
  );
}
