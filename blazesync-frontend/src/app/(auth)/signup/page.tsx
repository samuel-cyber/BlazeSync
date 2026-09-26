"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/bits";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { api, ApiError } from "@/lib/api";
import { SIGNUP_KEY } from "@/lib/store";

function strength(pw: string): { label: string; tone: string; width: string } | null {
  if (!pw) return null;
  if (pw.length < 8) return { label: "Too short", tone: "bg-danger", width: "w-1/4" };
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 14 || variety >= 3) return { label: "Strong", tone: "bg-credit", width: "w-full" };
  return { label: "Okay", tone: "bg-warn-fill", width: "w-2/3" };
}

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const intent = params.get("intent");
  const invite = params.get("invite");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const s = strength(pw);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().split(/\s+/).length < 2) errs.name = "Enter your first and last name.";
    const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id.trim());
    if (!isEmail) errs.id = "Enter an email address — the backend registers by email.";
    if (pw.length < 8) errs.pw = "Use at least 8 characters.";
    if (!agree) errs.agree = "You need to agree before we can create your account.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.register({ name: name.trim(), email: id.trim().toLowerCase(), password: pw });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) {
        setErrors({ id: "There's already an account with this email. Log in instead, or reset your password." });
      } else {
        setErrors({ id: "We couldn't create the account. Check your connection and try again." });
      }
      return;
    }
    setBusy(false);
    try {
      sessionStorage.setItem(SIGNUP_KEY, JSON.stringify({ name: name.trim(), contact: id.trim() }));
    } catch {}
    const next = invite ? `/claim/${invite}` : intent === "exco" ? "/setup" : "/welcome";
    router.push(next);
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{intent === "exco" ? "Set up your association" : "Create your account"}</h1>
        <p className="text-ink-2">{intent === "exco" ? "First, an account for you. Then we'll set up the association and link its bank account." : "One account for every association you pay dues to."}</p>
      </div>

      <form onSubmit={submit} noValidate className="space-y-5">
        {errors.id?.startsWith("There's already") && <Callout tone="danger" role="alert" title={errors.id} action={<Link href="/login" className="text-sm font-semibold text-brand hover:underline">Log in</Link>} />}
        <Field label="Full name" error={errors.name}>
          {(a) => <Input {...a} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Email or phone number" error={errors.id?.startsWith("There's already") ? null : errors.id} hint="We'll send a code to check it's yours.">
          {(a) => <Input {...a} autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} />}
        </Field>
        <Field label="Password" error={errors.pw}>
          {(a) => (
            <div className="space-y-2">
              <Input {...a} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              {s && (
                <div className="flex items-center gap-3" aria-live="polite">
                  <div className="h-1.5 flex-1 rounded-full bg-sunken">
                    <div className={`h-full rounded-full ${s.tone} ${s.width}`} />
                  </div>
                  <span className="text-sm text-ink-2">{s.label}</span>
                </div>
              )}
            </div>
          )}
        </Field>
        <div>
          <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} label="I agree to the terms and privacy policy" hint="Your association's exco can see your name, matric number and payments. No one can see your bank balance." />
          {errors.agree && <p className="mt-2 text-sm font-medium text-danger">{errors.agree}</p>}
        </div>
        <Button type="submit" busy={busy} className="w-full">
          Create account
        </Button>
      </form>

      <p className="text-ink-2">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
