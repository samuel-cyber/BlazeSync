"use client";

import { Check, Landmark, Lock, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/bits";
import { Field, Input } from "@/components/ui/Field";

const CAN = [
  "See this account's balance, so members can check the ledger against it",
  "Receive dues into it",
  "Send payouts from it, only after your signature rule is met",
];
const CANNOT = ["See any other account, including your personal one", "Move money without the required signatures", "Keep access after you disconnect"];

/**
 * Ecobank's account-linking consent (spec 5.1). BlazeSync never asks for the
 * account's banking password: the bank sends a one-time code to the phone
 * registered on the account, which proves the treasurer controls it.
 */
export function LinkAccountFlow({ associationName, onLinked, compact = false }: { associationName: string; onLinked: (last4: string) => Promise<void> | void; compact?: boolean }) {
  const [step, setStep] = useState<"consent" | "account" | "otp">("consent");
  const [acct, setAcct] = useState("");
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [tries, setTries] = useState(3);
  const [busy, setBusy] = useState(false);

  if (step === "consent") {
    return (
      <div className="space-y-5">
        {!compact && <p className="text-ink-2">Link the Ecobank business account {associationName} collects dues into. You do this once.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-rule bg-surface p-4">
            <h3 className="mb-2 font-semibold">BlazeSync will be able to</h3>
            <ul className="space-y-2 text-sm">
              {CAN.map((c) => (
                <li key={c} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-credit" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-rule bg-surface p-4">
            <h3 className="mb-2 font-semibold">BlazeSync can&apos;t</h3>
            <ul className="space-y-2 text-sm">
              {CANNOT.map((c) => (
                <li key={c} className="flex gap-2">
                  <X aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Button onClick={() => setStep("account")}>
          <Landmark aria-hidden className="size-4" /> I agree, link the account
        </Button>
      </div>
    );
  }

  if (step === "account") {
    return (
      <form
        className="space-y-5"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!/^\d{10}$/.test(acct)) return setErr("Ecobank account numbers are 10 digits.");
          setBusy(true);
          await new Promise((r) => setTimeout(r, 900));
          setBusy(false);
          if (acct.startsWith("0000")) return setErr("Ecobank says this isn't a business account. Dues need to go into the association's own account, not a personal one.");
          setErr(null);
          // A new code means a fresh set of tries.
          setTries(3);
          setOtp("");
          setStep("otp");
        }}
      >
        <Field label="Association's Ecobank account number" error={err} hint="The business account in the association's name.">
          {(a) => <Input {...a} inputMode="numeric" maxLength={10} value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ""))} placeholder="10 digits" className="max-w-xs" />}
        </Field>
        <p className="flex items-start gap-2 text-sm text-ink-3">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          We never ask for the account&apos;s banking password or PIN.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setStep("consent")}>
            Back
          </Button>
          <Button type="submit" busy={busy}>
            Send me a code
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!/^\d{6}$/.test(otp)) return setErr("Enter the 6-digit code from the text message.");
        setBusy(true);
        await new Promise((r) => setTimeout(r, 1000));
        if (otp === "000000") {
          setBusy(false);
          setTries((t) => t - 1);
          return setErr(tries - 1 > 0 ? `That code is wrong. ${tries - 1} ${tries - 1 === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Choose \u201cUse a different account\u201d, then send a new code.");
        }
        await onLinked(acct.slice(-4));
        setBusy(false);
      }}
    >
      <Callout title="Ecobank sent a code">To the phone number registered on the account ending {acct.slice(-4)}. It expires in 10 minutes.</Callout>
      <Field label="6-digit code" error={err}>
        {(a) => <Input {...a} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} className="max-w-48 text-center text-xl tracking-[0.4em]" />}
      </Field>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => setStep("account")}>
          Use a different account
        </Button>
        <Button type="submit" busy={busy} disabled={tries <= 0}>
          Link account
        </Button>
      </div>
    </form>
  );
}
