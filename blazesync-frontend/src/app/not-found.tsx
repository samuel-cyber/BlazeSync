import { SearchX } from "lucide-react";
import { Logo } from "@/components/shell/Logo";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto max-w-2xl px-5 pt-6">
        <Logo />
      </header>
      <main id="main" className="view mx-auto max-w-2xl space-y-5 px-5 pt-16">
        <SearchX aria-hidden className="size-10 text-ink-3" />
        <h1 className="text-3xl font-bold tracking-tight">There&apos;s no page here</h1>
        <p className="text-lg text-ink-2">The link may be mistyped or out of date. Your ledger, dues and receipts are all still where you left them.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <ButtonLink href="/login">Go to your ledger</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            BlazeSync home
          </ButtonLink>
        </div>
      </main>
    </div>
  );
}
