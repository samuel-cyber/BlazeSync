"use client";

import { Check, X } from "lucide-react";
import { initials } from "@/lib/format";
import { selectUser, useDb } from "@/lib/store";
import type { Disbursement } from "@/lib/types";

/**
 * Multi-signature at a glance: one slot per signature the rule needs. A slot
 * fills with the signer's initials; a rejection shows as a cross. Counting
 * slots, not people, is the point: a payout moves when the slots are full.
 */
export function SignatureTrack({ d, size = "md" }: { d: Disbursement; size?: "md" | "lg" }) {
  const { db } = useDb();
  const approvals = d.approvals.filter((a) => a.decision === "approve");
  const rejection = d.approvals.find((a) => a.decision === "reject");
  const slot = size === "lg" ? "size-11 text-sm" : "size-8 text-[11px]";
  const slots = Array.from({ length: d.required }, (_, i) => approvals[i] ?? null);
  const label = rejection
    ? `Rejected by ${selectUser(db, rejection.userId)?.name ?? "an exco"}`
    : `${approvals.length} of ${d.required} signatures`;
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-1.5" aria-hidden>
        {slots.map((a, i) =>
          a ? (
            <span key={i} style={{ "--i": i } as React.CSSProperties} className={`slot-land relative grid place-items-center rounded-full bg-brand font-bold text-on-brand ring-2 ring-surface ${slot}`}>
              {initials(selectUser(db, a.userId)?.name ?? "?")}
              <span className="absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-credit text-white ring-2 ring-surface">
                <Check className="size-2.5" strokeWidth={3} />
              </span>
            </span>
          ) : rejection && i === approvals.length ? (
            <span key={i} style={{ "--i": i } as React.CSSProperties} className={`slot-land grid place-items-center rounded-full bg-danger text-on-danger ring-2 ring-surface ${slot}`}>
              <X className="size-4" />
            </span>
          ) : (
            <span key={i} className={`rounded-full border-2 border-dashed border-edge bg-surface ring-2 ring-surface ${slot}`} />
          ),
        )}
      </div>
      <span className={`text-sm font-semibold ${rejection ? "text-danger" : approvals.length >= d.required ? "text-credit" : "text-ink-2"}`}>{label}</span>
    </div>
  );
}
