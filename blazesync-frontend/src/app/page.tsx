import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { DemoLedger } from "@/components/landing/DemoLedger";
import { Logo } from "@/components/shell/Logo";
import { ButtonLink } from "@/components/ui/Button";

const PROOFS = [
  {
    title: "Members see what the treasurer sees",
    body: "The balance on a 100L student's phone is the balance on the treasurer's. We check it against the bank every 15 minutes, and if the two ever disagree, everyone is told.",
    artifact: (
      <p className="flex items-center gap-2 rounded-md bg-slab px-4 py-3 text-sm text-on-slab">
        <CheckCircle2 aria-hidden className="size-4 shrink-0 text-[#7ee2ae]" />
        <span>
          <span className="font-semibold">Matches the Ecobank balance.</span> <span className="text-on-slab-2">Checked 2 min ago.</span>
        </span>
      </p>
    ),
  },
  {
    title: "No one moves money alone",
    body: "A payout needs two of three exco signatures before a naira leaves the account. The server enforces it, so there is no screen, button or shortcut around it.",
    artifact: (
      <div className="flex items-center gap-3 rounded-md border border-rule bg-surface px-4 py-3">
        <div className="flex -space-x-1.5" aria-hidden>
          {["TB", "CE"].map((i) => (
            <span key={i} className="grid size-8 place-items-center rounded-full bg-brand text-[11px] font-bold text-on-brand ring-2 ring-surface">
              {i}
            </span>
          ))}
        </div>
        <span className="text-sm font-semibold text-credit">2 of 2 signatures</span>
        <span className="ml-auto text-sm font-bold">₦48,000</span>
      </div>
    ),
  },
  {
    title: "Receipts that check themselves",
    body: "Every payment gets a fingerprint anyone can recompute from the receipt. Change one digit on a doctored screenshot and the check fails.",
    artifact: (
      <div className="space-y-1.5 rounded-md border border-rule bg-surface px-4 py-3">
        <p className="font-mono text-xs text-ink-2 [word-spacing:0.25em]">3f9a 12bc 7e04 d1a8 5c62 90fe …</p>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-credit">
          <CheckCircle2 aria-hidden className="size-4" /> Verified
        </p>
      </div>
    ),
  },
];

const STEPS = [
  { title: "Link the association's Ecobank account", body: "Once, with a code sent to the account's phone. BlazeSync can see that account and nothing else, and you can disconnect it any time." },
  { title: "Upload the class list", body: "The CSV your department already has. Everyone on it owes dues from day one, whether or not they ever open the app." },
  { title: "Members claim their invite and pay", body: "Each gets a personal link. Paying from an Ecobank Blaze account costs nothing extra, and the payment lands on the ledger for everyone at once." },
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Logo />
        <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
          <ButtonLink href="/join" variant="ghost" size="sm">
            Join with a code
          </ButtonLink>
          <ButtonLink href="/login" variant="secondary" size="sm">
            Log in
          </ButtonLink>
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 lg:pt-16">
          <div className="hero-seq space-y-7">
            <h1 className="condensed max-w-xl text-[clamp(2.6rem,7vw,4.4rem)] font-extrabold leading-[0.98] tracking-[-0.025em]">
              Every naira your association collects, in the open.
            </h1>
            <p className="max-w-lg text-lg text-ink-2">
              BlazeSync puts your department&apos;s dues on one live ledger. Members see the same balance the treasurer sees, and no payout leaves the account
              without two exco signatures.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/signup?intent=exco">Set up your association</ButtonLink>
              <ButtonLink href="/join" variant="secondary">
                Join an association
              </ButtonLink>
            </div>
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <span aria-hidden className="size-2 rounded-full bg-ember" />
              Built on Ecobank. Paying from a Blaze account has no fee.
            </p>
          </div>
          <div className="hero-land">
            <DemoLedger />
          </div>
        </section>

        <section aria-labelledby="proofs" className="border-y border-rule bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 id="proofs" className="mb-10 max-w-xl text-2xl font-bold tracking-tight sm:text-3xl">
              Why members can trust the number
            </h2>
            <ul className="divide-y divide-rule">
              {PROOFS.map((p) => (
                <li key={p.title} className="grid gap-5 py-8 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center md:gap-16">
                  <div className="max-w-xl space-y-2">
                    <h3 className="text-xl font-bold">{p.title}</h3>
                    <p className="text-ink-2">{p.body}</p>
                  </div>
                  <div aria-hidden>{p.artifact}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="how" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <h2 id="how" className="mb-10 max-w-xl text-2xl font-bold tracking-tight sm:text-3xl">
            Getting your association on it
          </h2>
          <ol className="grid gap-8 md:grid-cols-3 md:gap-10">
            {STEPS.map((s, i) => (
              <li key={s.title} className="space-y-3">
                <span aria-hidden className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold text-on-brand">
                  {i + 1}
                </span>
                <h3 className="text-lg font-bold">{s.title}</h3>
                <p className="text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex flex-col gap-4 rounded-lg bg-slab px-6 py-8 text-on-slab sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="space-y-1">
              <p className="text-xl font-bold">Treasurer or financial secretary?</p>
              <p className="text-on-slab-2">Setup takes about five minutes. You&apos;ll need the association&apos;s Ecobank account number.</p>
            </div>
            <Link href="/signup?intent=exco" className="inline-flex h-12 shrink-0 items-center justify-center rounded-sm bg-on-slab px-5 font-semibold text-slab hover:bg-on-slab-2">
              Set up your association
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>BlazeSync. Dues for Nigerian student associations, on Ecobank.</p>
          <ul className="flex gap-5">
            <li>
              <Link href="/login" className="font-semibold text-brand hover:underline">
                Try the demo
              </Link>
            </li>
            <li>
              <Link href="/join" className="font-semibold text-brand hover:underline">
                Join with a code
              </Link>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
