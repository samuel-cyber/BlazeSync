"use client";

import { RotateCcw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";

/** Something broke on our side. Say so plainly, and say that money is safe. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto min-h-dvh max-w-2xl space-y-5 bg-paper px-5 pt-24">
      <h1 className="text-3xl font-bold tracking-tight">This page didn&apos;t load</h1>
      <p className="text-lg text-ink-2">
        Something went wrong on our side while showing it. No payment or payout was affected: money only moves when the bank confirms it, and the ledger
        records that separately.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={reset}>
          <RotateCcw aria-hidden className="size-4" /> Try again
        </Button>
        <ButtonLink href="/" variant="secondary">
          BlazeSync home
        </ButtonLink>
      </div>
    </main>
  );
}
