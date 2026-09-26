"use client";

import { usePathname, useRouter } from "next/navigation";
import { Check, Map as MapIcon, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Meter } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { DEMO } from "@/lib/mock/seed";
import { useStore, type Store } from "@/lib/store";

const DONE_KEY = "blazesync.demo.guide.v1";
const EXIT = 180; // --t-ui

interface Step {
  id: string;
  title: string;
  say: string;
  role: "exco" | "member" | null;
  path: (s: Store) => string;
  extra?: (s: Store) => { label: string; run: () => string | void } | null;
}

/**
 * A presenter's script for judges: eight stops, in an order that tells the
 * story (money arrives, everyone is tracked, no one signs alone, the bank
 * checks us, a student pays, the receipt proves it, an invite carries history,
 * the next exco inherits everything). Demo-only: none of this ships.
 */
const STEPS: Step[] = [
  {
    id: "live",
    title: "Watch money arrive",
    say: "The balance is the first thing on screen. Land a payment and watch the row open, glow, and the balance count up. Members see it at the same moment.",
    role: "exco",
    path: () => "/exco",
    extra: (s) => ({
      label: "Land a payment now",
      run: () => (s.landPaymentNow() ? undefined : "Everyone who has joined has already paid. Reset the demo to start again."),
    }),
  },
  {
    id: "roster",
    title: "Everyone owes, app or not",
    say: "Joined and paid are tracked separately. Press Mark paid on anyone except Adaeze Okafor (she pays for herself in step 5): cash goes on the ledger with your name on it.",
    role: "exco",
    path: () => "/exco/members?filter=unpaid",
  },
  {
    id: "sign",
    title: "No one moves money alone",
    say: "Chiamaka asked for ₦48,000 and signed. Approve with any 4-digit PIN: yours is the second signature, so it sends and lands on the ledger.",
    role: "exco",
    path: () => "/exco/payouts/d_6",
  },
  {
    id: "bank",
    title: "The bank checks our numbers",
    say: "Show what happens when a bank notification goes missing: the balance panel says Ecobank disagrees, for exco and members alike.",
    role: "exco",
    path: () => "/exco",
    extra: (s) => ({
      label: s.driftOn ? "Clear the mismatch" : "Show a mismatch",
      run: () => s.simulateDrift(!s.driftOn, DEMO.association),
    }),
  },
  {
    id: "pay",
    title: "Pay dues as a student",
    say: "Adaeze pays ₦2,000 from her Blaze account with no fee. Any 4-digit PIN works. Tapping twice can't charge her twice.",
    role: "member",
    path: () => "/member/pay/c_cssa_2627_1",
  },
  {
    id: "receipt",
    title: "A receipt nobody can fake",
    say: "The browser recomputes the receipt's fingerprint. Open Check it yourself and change the amount: the check fails.",
    role: null,
    path: (s) => {
      const mine = s.db?.roster.find((r) => r.userId === DEMO.member && r.associationId === DEMO.association);
      const paid = mine && s.db?.payments.filter((p) => p.memberRecordId === mine.id).at(-1);
      return `/receipt/${paid?.receiptId ?? "r_60"}`;
    },
  },
  {
    id: "claim",
    title: "Claim an invite",
    say: "Ronke paid by transfer before she ever opened the app. Claiming keeps that. Confirm with ronke.salami@live.unilag.edu.ng.",
    role: null,
    path: () => `/claim/${DEMO.claimCode}`,
  },
  {
    id: "records",
    title: "Hand over to the next exco",
    say: "Every action is in the activity log, separate from the money. Download the handover pack: ledger, roster and log as spreadsheets.",
    role: "exco",
    path: () => "/exco/records",
  },
];

export function DemoGuide() {
  const store = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // The script walks seeded demo data; it makes no sense against a live backend.
  const demoOnly = store.mode === "demo";
  const [closing, setClosing] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DONE_KEY);
      // Read saved progress after mount so server and client render alike.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setDone(JSON.parse(raw));
    } catch {}
  }, []);

  const save = (next: string[]) => {
    setDone(next);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(next));
    } catch {}
  };

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      trigger.current?.focus();
    }, EXIT);
  }, []);

  useEffect(() => {
    if (!open) return;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const go = (step: Step) => {
    const path = step.path(store);
    if (step.role && store.session?.role !== step.role) store.signInDemo(step.role, DEMO.association, path);
    else if (step.role && store.session?.associationId !== DEMO.association) store.switchAssociation(DEMO.association);
    router.push(path);
    if (!done.includes(step.id)) save([...done, step.id]);
    // On a phone the guide covers the screen it just opened, so step aside.
    if (window.matchMedia("(max-width: 1023px)").matches) close();
  };

  // Sit above the phone tab bar in the portals, and above the payout sign bar.
  const inPortal = pathname.startsWith("/exco") || pathname.startsWith("/member");
  const onSignBar = /^\/exco\/payouts\/(?!new)[^/]+$/.test(pathname);
  const lift = onSignBar ? "bottom-[15.5rem] lg:bottom-24" : inPortal ? "bottom-[5.25rem] lg:bottom-6" : "bottom-5 lg:bottom-6";

  if (!demoOnly) return null;

  return (
    <div className="no-print">
      {!open && (
        <button
          ref={trigger}
          type="button"
          onClick={() => setOpen(true)}
          className={`press fixed right-4 z-40 inline-flex h-11 items-center gap-2 rounded-full border border-rule bg-surface pl-3.5 pr-4 text-sm font-semibold text-ink shadow-[var(--shadow-lift)] hover:border-brand lg:right-6 ${lift}`}
          aria-haspopup="dialog"
        >
          <MapIcon aria-hidden className="size-4 text-brand" />
          Demo guide
          {done.length > 0 && done.length < STEPS.length && <span className="text-ink-3">{done.length}/{STEPS.length}</span>}
        </button>
      )}

      {open && (
        <aside
          role="dialog"
          aria-modal="false"
          aria-labelledby="demo-guide-title"
          className={`guide-panel fixed inset-x-2 bottom-2 z-50 flex max-h-[78dvh] flex-col overflow-hidden rounded-lg border border-rule bg-surface text-ink shadow-[var(--shadow-float)] lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[24rem] ${closing ? "is-leaving" : ""}`}
        >
          <div className="space-y-3 border-b border-rule px-5 pb-4 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 id="demo-guide-title" ref={heading} tabIndex={-1} className="text-lg font-bold outline-none">
                  Demo guide
                </h2>
                <p className="text-sm text-ink-2">Eight stops, about three minutes. Go takes you to the right screen as the right person.</p>
              </div>
              <button type="button" onClick={close} className="-m-1.5 grid size-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-sunken" aria-label="Close demo guide">
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <Meter label="Shown" value={done.length} max={STEPS.length} detail={`${done.length} of ${STEPS.length}`} />
          </div>

          <ol className="stagger flex-1 divide-y divide-rule overflow-y-auto">
            {STEPS.map((step, i) => {
              const isDone = done.includes(step.id);
              const extra = step.extra?.(store);
              return (
                <li key={step.id} className="flex gap-3 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => save(isDone ? done.filter((d) => d !== step.id) : [...done, step.id])}
                    className={`press grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${isDone ? "bg-credit text-white" : "bg-sunken text-ink-2"}`}
                    aria-label={isDone ? `Step ${i + 1} shown. Mark as not shown` : `Step ${i + 1}. Mark as shown`}
                  >
                    {isDone ? <Check aria-hidden className="land size-4" strokeWidth={3} /> : i + 1}
                  </button>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-semibold leading-snug">{step.title}</p>
                    <p className="text-sm text-ink-2">{step.say}</p>
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <Button size="sm" onClick={() => go(step)}>
                        Go
                      </Button>
                      {extra && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const problem = extra.run();
                            if (problem) toast(problem, "danger");
                          }}
                        >
                          {extra.label}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="flex items-center justify-between gap-2 border-t border-rule px-5 py-3">
            <p className="text-xs text-ink-3">Demo only. Nothing here ships.</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                store.resetDemo();
                save([]);
                toast("Demo reset. Every step works from the start again.");
              }}
            >
              <RotateCcw aria-hidden className="size-4" /> Reset demo
            </Button>
          </div>
        </aside>
      )}
    </div>
  );
}
