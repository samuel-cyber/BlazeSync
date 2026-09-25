"use client";

import Link from "next/link";
import { BookOpenText, ChevronRight, Wallet } from "lucide-react";

/** First login without an invite: which side of the ledger are you on? */
export default function WelcomePage() {
  const options = [
    {
      href: "/setup",
      icon: BookOpenText,
      title: "I manage my association's money",
      body: "Treasurer, financial secretary, or another exco. Set up the association, upload the roster, and open dues.",
    },
    {
      href: "/join",
      icon: Wallet,
      title: "I pay dues to an association",
      body: "Join with the code your treasurer shared, see the live balance, and pay.",
    },
  ];
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">How will you use BlazeSync?</h1>
        <p className="text-ink-2">You can do both later. Excos pay dues too.</p>
      </div>
      <ul className="stagger space-y-3">
        {options.map((o) => (
          <li key={o.href}>
            <Link href={o.href} className="press flex items-start gap-4 rounded-md border border-rule bg-surface p-5 hover:border-brand">
              <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-wash text-brand">
                <o.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold">{o.title}</span>
                <span className="mt-1 block text-ink-2">{o.body}</span>
              </span>
              <ChevronRight aria-hidden className="mt-3 size-5 shrink-0 text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-3">Got a personal invite link from your treasurer? Open that instead. It sets all of this up for you.</p>
    </div>
  );
}
