"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/bits";
import { Field, Input } from "@/components/ui/Field";
import { useStore } from "@/lib/store";

const DEMO_ACCOUNTS: Record<string, "exco" | "member"> = {
  "tunde.bakare@live.unilag.edu.ng": "exco",
  "adaeze.okafor@gmail.com": "member",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const { signInDemo } = useStore();
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  const go = (role: "exco" | "member") => {
    signInDemo(role);
    router.push(next && next.startsWith(`/${role}`) ? next : role === "exco" ? "/exco" : "/member");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!id.trim() || !pw) {
      setError("Enter your email or phone number and your password.");
      return;
    }
    if (tries >= 4) {
      setError("Too many attempts. For your security, wait 5 minutes or reset your password.");
      return;
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 700));
    setBusy(false);
    const role = DEMO_ACCOUNTS[id.trim().toLowerCase()];
    if (role && pw === "blazesync") return go(role);
    setTries((t) => t + 1);
    setError("That email or phone and password don't match. Check for typos, or reset your password.");
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Log in</h1>
        <p className="text-ink-2">See your association&apos;s balance, pay dues, and get your receipts.</p>
      </div>

      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Callout tone="danger" role="alert" title={error} />}
        <Field label="Email or phone number">
          {(a) => <Input {...a} autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} placeholder="you@live.unilag.edu.ng" />}
        </Field>
        <Field label="Password">
          {(a) => (
            <div className="relative">
              <Input {...a} type={show ? "text" : "password"} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className="pr-12" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-2 hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
              </button>
            </div>
          )}
        </Field>
        <div className="flex items-center justify-between">
          <Link href="/forgot-password" className="text-sm font-semibold text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" busy={busy} className="w-full">
          Log in
        </Button>
      </form>

      <p className="text-ink-2">
        New to BlazeSync?{" "}
        <Link href="/signup" className="font-semibold text-brand hover:underline">
          Create an account
        </Link>
      </p>

      <section aria-labelledby="demo" className="space-y-3 rounded-md border border-dashed border-edge/70 p-4">
        <h2 id="demo" className="text-sm font-semibold">
          Demo accounts
        </h2>
        <p className="text-sm text-ink-2">No backend needed. Both use the password <span className="font-mono font-semibold text-ink">blazesync</span>, or skip straight in:</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" size="sm" onClick={() => go("exco")} type="button">
            Treasurer (Tunde)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => go("member")} type="button">
            Member (Adaeze)
          </Button>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
