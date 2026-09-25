"use client";

import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { maskEmail, maskPhone } from "@/lib/format";
import { normalisePhone } from "@/lib/csv";

export default function ForgotPasswordPage() {
  const [id, setId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id.trim());
    if (!isEmail && !normalisePhone(id)) return setErr("Enter the email or phone number you signed up with.");
    setErr(null);
    setBusy(true);
    await new Promise((r) => setTimeout(r, 800));
    setBusy(false);
    setSent(true);
  };

  if (sent) {
    const target = id.includes("@") ? maskEmail(id.trim()) : maskPhone(normalisePhone(id) ?? id);
    return (
      <div className="space-y-6">
        <MailCheck aria-hidden className="size-10 text-brand" />
        <h1 className="text-2xl font-bold tracking-tight">Check {id.includes("@") ? "your email" : "your messages"}</h1>
        <p className="text-ink-2">
          If {target} has a BlazeSync account, a reset link is on its way. It works once, for 30 minutes.
        </p>
        <p className="text-sm text-ink-3">We say &ldquo;if&rdquo; on purpose: we never confirm whether an account exists, so no one can use this page to find out who&apos;s signed up.</p>
        <Link href="/login" className="inline-block font-semibold text-brand hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reset your password</h1>
        <p className="text-ink-2">We&apos;ll send a link to set a new one. Your payments and receipts aren&apos;t affected.</p>
      </div>
      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label="Email or phone number" error={err}>
          {(a) => <Input {...a} autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} />}
        </Field>
        <Button type="submit" busy={busy} className="w-full">
          Send reset link
        </Button>
      </form>
      <Link href="/login" className="inline-block font-semibold text-brand hover:underline">
        Back to log in
      </Link>
    </div>
  );
}
