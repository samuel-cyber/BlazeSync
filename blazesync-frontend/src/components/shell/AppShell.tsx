"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpenText,
  CalendarClock,
  FileClock,
  Home,
  LogOut,
  MoreHorizontal,
  ReceiptText,
  Send,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { selectMyAssociations, selectUser, sessionIsValid, useStore } from "@/lib/store";
import { Avatar } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/Button";
import { Logo } from "./Logo";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
  badge?: number;
  mobile?: boolean;
  desktop?: boolean;
}

export function AppShell({ role, children }: { role: "exco" | "member"; children: ReactNode }) {
  const store = useStore();
  const { ready, session, db } = store;
  const router = useRouter();
  const pathname = usePathname();

  const valid = !!db && !!session && sessionIsValid(db, session);

  useEffect(() => {
    if (!ready || !db) return;
    if (!session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (session.role !== role) router.replace(store.roleSwitchTo ?? (session.role === "exco" ? "/exco" : "/member"));
    else if (!valid) {
      // The session points at an association this person no longer belongs to
      // (removed by a reset, or never theirs): move them to one they do, or out.
      const fallback = selectMyAssociations(db, session)[0];
      if (fallback) store.switchAssociation(fallback.id);
      else {
        store.signOut();
        router.replace("/login");
      }
    }
  }, [ready, db, session, valid, role, router, pathname, store]);

  if (!ready || !db || !session || session.role !== role || !valid) {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-6">
        <p className="flex items-center gap-2 text-ink-2">
          <span aria-hidden className="size-2.5 rounded-full bg-ember live-dot" />
          Opening your ledger
        </p>
      </div>
    );
  }

  const me = selectUser(db, session.userId);
  const mine = selectMyAssociations(db, session);
  const title = db.exco.find((e) => e.userId === session.userId && e.associationId === session.associationId)?.title;
  const amSignatory = db.exco.some((e) => e.associationId === session.associationId && e.userId === session.userId && e.isSignatory);
  const needsMe = amSignatory
    ? db.disbursements.filter((d) => d.associationId === session.associationId && d.status === "pending" && !d.approvals.some((a) => a.userId === session.userId)).length
    : 0;

  const nav: NavItem[] =
    role === "exco"
      ? [
          { href: "/exco", label: "Ledger", icon: BookOpenText, match: (p) => p === "/exco" || p.startsWith("/exco/ledger") },
          { href: "/exco/members", label: "Members", icon: Users, match: (p) => p.startsWith("/exco/members") },
          { href: "/exco/dues", label: "Dues", icon: CalendarClock, match: (p) => p.startsWith("/exco/dues") },
          { href: "/exco/payouts", label: "Payouts", icon: Send, match: (p) => p.startsWith("/exco/payouts"), badge: needsMe },
          { href: "/exco/records", label: "Records", icon: FileClock, match: (p) => p.startsWith("/exco/records"), mobile: false },
          { href: "/exco/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/exco/settings"), mobile: false },
          { href: "/exco/more", label: "More", icon: MoreHorizontal, match: (p) => p.startsWith("/exco/more"), desktop: false },
        ]
      : [
          { href: "/member", label: "Home", icon: Home, match: (p) => p === "/member" || p.startsWith("/member/pay") },
          { href: "/member/ledger", label: "Ledger", icon: BookOpenText, match: (p) => p.startsWith("/member/ledger") },
          { href: "/member/history", label: "Payments", icon: ReceiptText, match: (p) => p.startsWith("/member/history") },
          { href: "/member/account", label: "Account", icon: UserRound, match: (p) => p.startsWith("/member/account") || p.startsWith("/member/join") },
        ];

  const switcher = mine.length > 1 && (
    <label className="block min-w-0">
      <span className="sr-only">Association</span>
      <select
        value={session.associationId}
        onChange={(e) => store.switchAssociation(e.target.value)}
        className="h-10 w-full min-w-0 appearance-none truncate rounded-sm border border-rule bg-surface bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pl-3 pr-9 text-sm font-semibold text-ink hover:border-edge"
        style={{ backgroundImage: "var(--chevron)" }}
      >
        {mine.map((a) => (
          <option key={a.id} value={a.id}>
            {a.shortName}
          </option>
        ))}
      </select>
    </label>
  );
  const single = mine.length === 1 && <p className="truncate text-sm font-semibold">{mine[0].shortName}</p>;

  return (
    <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a href="#main" className={buttonClass("primary", "sm", "sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50")}>
        Skip to content
      </a>

      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-rule bg-surface lg:flex">
        <div className="space-y-4 px-5 pb-4 pt-6">
          <Logo href={role === "exco" ? "/exco" : "/member"} />
          {switcher || single}
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 px-3">
          {nav
            .filter((n) => n.desktop !== false)
            .map((n) => {
              const on = n.match(pathname);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={on ? "page" : undefined}
                  className={`press flex h-11 items-center gap-3 rounded-sm px-3 font-semibold ${on ? "bg-brand-wash text-brand" : "text-ink-2 hover:bg-sunken hover:text-ink"}`}
                >
                  <n.icon aria-hidden className="size-5" />
                  <span className="flex-1">{n.label}</span>
                  <NavBadge count={n.badge} className="grid h-5 min-w-5 place-items-center rounded-full bg-ember px-1.5 text-xs font-bold text-white" />
                </Link>
              );
            })}
        </nav>
        <div className="border-t border-rule px-5 py-4">
          <div className="flex items-center gap-3">
            <Avatar name={me?.name ?? "You"} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{me?.name}</p>
              <p className="truncate text-xs text-ink-3">{role === "exco" ? title ?? "Exco" : "Member"}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                store.signOut();
                router.push("/login");
              }}
              className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-sunken hover:text-ink"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Phone top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-rule bg-surface/95 px-4 backdrop-blur lg:hidden">
          <Logo href={role === "exco" ? "/exco" : "/member"} />
          <div className="ml-auto min-w-0 max-w-[11rem]">{switcher || single}</div>
        </header>

        <main id="main" className="view mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 sm:pt-8 lg:px-10 lg:pb-16">
          {children}
        </main>

        {/* Phone tab bar */}
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          <ul className="flex">
            {nav
              .filter((n) => n.mobile !== false)
              .map((n) => {
                const on = n.match(pathname);
                return (
                  <li key={n.href} className="flex-1">
                    <Link href={n.href} aria-current={on ? "page" : undefined} className={`press relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${on ? "text-brand" : "text-ink-3"}`}>
                      <n.icon aria-hidden className="size-5" />
                      {n.label}
                      <NavBadge count={n.badge} className="absolute left-1/2 top-2 ml-2 grid h-4 min-w-4 place-items-center rounded-full bg-ember px-1 text-[10px] font-bold text-white" />
                    </Link>
                  </li>
                );
              })}
          </ul>
        </nav>
      </div>
    </div>
  );
}

/** Counts changes to `value` after first paint: 0 until it changes, then 1, 2, ... */
function useChangeCount(value: number) {
  const [prev, setPrev] = useState(value);
  const [changes, setChanges] = useState(0);
  if (prev !== value) {
    // Adjusting state while rendering is React's pattern for "react to a prop change".
    setPrev(value);
    setChanges((c) => c + 1);
  }
  return changes;
}

/** The waiting-for-you count. It bumps once when it changes, never on first paint. */
function NavBadge({ count, className }: { count?: number; className: string }) {
  const changes = useChangeCount(count ?? 0);
  if (!count) return null;
  return (
    // A new key remounts the badge, which replays the bump.
    <span key={changes} className={`${className} ${changes ? "bump" : ""}`} aria-label={`${count} waiting for you`}>
      {count}
    </span>
  );
}
