"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Landmark } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ago, nairaDigits, naira } from "@/lib/format";
import { selectAssociation, selectLedger, selectReconciliation, useDb, useNow } from "@/lib/store";
import { BalanceSparkline } from "./BalanceSparkline";
import { LiveIndicator } from "./LiveIndicator";

/** Counts from the old balance to the new one when an entry lands. */
function useTicker(value: number) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    const dur = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

/**
 * The first thing on every dashboard (spec section 8): the balance, whether
 * the bank agrees with it, and whether it is live. Members and exco see the
 * same numbers; only the links differ.
 */
export function LedgerHead({ associationId, audience }: { associationId: string; audience: "exco" | "member" }) {
  const { db } = useDb();
  const now = useNow(20_000);
  const assoc = selectAssociation(db, associationId);
  const rec = selectReconciliation(db, associationId);
  const entries = selectLedger(db, associationId);
  const shown = useTicker(rec.balance);
  if (!assoc) return null;

  const checksHref = audience === "exco" ? "/exco/ledger#checks" : "/member/ledger#checks";

  return (
    <section aria-labelledby="balance-label" className="on-slab relative overflow-hidden rounded-lg bg-slab text-on-slab">
      <div className="space-y-5 px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
        <div className="flex items-center justify-between gap-4">
          <p className="truncate text-sm font-semibold text-on-slab-2">{assoc.shortName}</p>
          {assoc.linkedAccount ? <LiveIndicator onSlab /> : <span className="text-sm font-semibold text-on-slab-2">Not connected</span>}
        </div>

        <div className="space-y-2">
          <h2 id="balance-label" className="text-base font-medium text-on-slab-2">
            Association balance
          </h2>
          <p className="balance text-[clamp(3.4rem,15vw,5.75rem)]" aria-live="polite" aria-atomic>
            <span className="naira">₦</span>
            {nairaDigits(shown)}
          </p>
        </div>

        <Reconciliation assocLinked={!!assoc.linkedAccount} rec={rec} now={now} audience={audience} checksHref={checksHref} />

        {entries.length > 1 && (
          <div className="border-t border-slab-rule pt-4">
            <BalanceSparkline entries={entries} now={now} />
          </div>
        )}
      </div>
    </section>
  );
}

function Reconciliation({
  assocLinked,
  rec,
  now,
  audience,
  checksHref,
}: {
  assocLinked: boolean;
  rec: ReturnType<typeof selectReconciliation>;
  now: number;
  audience: "exco" | "member";
  checksHref: string;
}) {
  if (!assocLinked) {
    return (
      <p className="flex items-start gap-2 text-sm text-on-slab-2">
        <Landmark aria-hidden className="mt-0.5 size-4 shrink-0" />
        No bank account linked yet, so there is nothing to check this balance against.
      </p>
    );
  }
  const checked = rec.last ? ago(rec.last.at, now) : "not yet";
  const drift = rec.drift;
  return (
    <div className="space-y-1.5 text-sm">
      {drift === 0 ? (
        <p className="flex items-start gap-2">
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-[#7ee2ae]" />
          <span>
            <span className="font-semibold">Matches the Ecobank balance.</span>{" "}
            <span className="text-on-slab-2">Checked {checked}.</span>{" "}
            <Link href={checksHref} className="text-on-slab-2 underline decoration-slab-rule underline-offset-4 hover:text-on-slab">
              How we check
            </Link>
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2" role="alert">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warn-fill" />
          <span>
            <span className="font-semibold">
              Ecobank shows {naira(Math.abs(drift))} {drift > 0 ? "more" : "less"} than this ledger.
            </span>{" "}
            <span className="text-on-slab-2">
              {audience === "exco"
                ? "Usually a payment whose confirmation hasn't reached us yet. We're re-checking the last 24 hours."
                : "The exco has been alerted and it is being checked. Nothing has been changed."}
            </span>{" "}
            <Link href={checksHref} className="font-semibold underline decoration-warn-fill underline-offset-4">
              See the check
            </Link>
          </span>
        </p>
      )}
      {rec.cash > 0 && (
        <p className="pl-6 text-on-slab-2">Includes {naira(rec.cash)} cash an exco collected, not yet banked.</p>
      )}
    </div>
  );
}
