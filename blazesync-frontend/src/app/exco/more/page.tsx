"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, FileClock, LogOut, Settings, UserRound } from "lucide-react";
import { Avatar, PageHeader } from "@/components/ui/bits";
import { selectUser, useDb } from "@/lib/store";

export default function MorePage() {
  const router = useRouter();
  const { db, session, signOut, signInDemo } = useDb();
  const me = selectUser(db, session!.userId);
  const title = db.exco.find((e) => e.userId === session!.userId && e.associationId === session!.associationId)?.title;
  const items = [
    { href: "/exco/records", label: "Records", hint: "Download the ledger, see the activity log", icon: FileClock },
    { href: "/exco/settings", label: "Settings", hint: "Payout rule, exco, bank account", icon: Settings },
  ];
  return (
    <>
      <PageHeader title="More" />
      <div className="mb-6 flex items-center gap-3">
        <Avatar name={me?.name ?? "?"} size="lg" />
        <div>
          <p className="font-semibold">{me?.name}</p>
          <p className="text-sm text-ink-2">{title}</p>
        </div>
      </div>
      <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule bg-surface">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex items-center gap-3 px-4 py-4 hover:bg-paper">
              <i.icon aria-hidden className="size-5 text-brand" />
              <span className="flex-1">
                <span className="block font-semibold">{i.label}</span>
                <span className="block text-sm text-ink-2">{i.hint}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-ink-3" />
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => {
              signInDemo("member");
              router.push("/member");
            }}
            className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-paper"
          >
            <UserRound aria-hidden className="size-5 text-brand" />
            <span className="flex-1">
              <span className="block font-semibold">Switch to member view</span>
              <span className="block text-sm text-ink-2">Demo only: see what Adaeze sees</span>
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() => {
              signOut();
              router.push("/login");
            }}
            className="flex w-full items-center gap-3 px-4 py-4 text-left font-semibold text-danger hover:bg-paper"
          >
            <LogOut aria-hidden className="size-5" /> Sign out
          </button>
        </li>
      </ul>
    </>
  );
}
