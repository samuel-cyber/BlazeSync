"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/bits";
import { maskEmail, maskPhone } from "@/lib/format";

/** Six boxes, one digit each; paste a whole code into any box. */
function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const to = params.get("to") ?? "";
  // Same-site paths only: "/setup" yes, "https://elsewhere" or "//elsewhere" no.
  const rawNext = params.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/welcome";
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(45);
  const [resent, setResent] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const masked = to.includes("@") ? maskEmail(to) : maskPhone(to.replace(/^0/, "+234"));

  const set = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      const all = clean.slice(0, 6).split("");
      setDigits((d) => d.map((_, j) => all[j] ?? ""));
      refs.current[Math.min(5, all.length)]?.focus();
      return;
    }
    setDigits((d) => d.map((x, j) => (j === i ? clean : x)));
    if (clean && i < 5) refs.current[i + 1]?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join("");
    if (code.length < 6) return setErr("Enter all 6 digits.");
    setBusy(true);
    await new Promise((r) => setTimeout(r, 700));
    setBusy(false);
    if (code === "000000") {
      setErr("That code has expired. We've sent you a new one.");
      setDigits(["", "", "", "", "", ""]);
      setWait(45);
      refs.current[0]?.focus();
      return;
    }
    router.push(next);
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Check your {to.includes("@") ? "email" : "messages"}</h1>
        <p className="text-ink-2">We sent a 6-digit code to {masked || "you"}. It expires in 10 minutes.</p>
      </div>
      <form onSubmit={submit} noValidate className="space-y-6">
        {err && <Callout tone="danger" role="alert" title={err} />}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Verification code</legend>
          <div className="flex gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={d}
                onChange={(e) => set(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !d && i > 0) refs.current[i - 1]?.focus();
                }}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                aria-label={`Digit ${i + 1}`}
                className="h-14 w-full min-w-0 rounded-sm border border-edge bg-surface text-center text-2xl font-bold"
              />
            ))}
          </div>
        </fieldset>
        <Button type="submit" busy={busy} className="w-full">
          Verify
        </Button>
      </form>
      <p className="text-ink-2" aria-live="polite">
        {wait > 0 ? (
          `Didn't get it? You can ask for a new code in ${wait}s.`
        ) : (
          <button
            type="button"
            className="font-semibold text-brand hover:underline"
            onClick={() => {
              setWait(45);
              setResent(true);
            }}
          >
            Send a new code
          </button>
        )}
        {resent && wait > 0 && " New code sent."}
      </p>
      <p className="text-sm text-ink-3">Demo: any 6 digits work. 000000 shows the expired-code message.</p>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
