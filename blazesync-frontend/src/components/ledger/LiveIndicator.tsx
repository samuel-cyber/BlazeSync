"use client";

import { fmtTime } from "@/lib/format";
import { useStore, type LiveStatus } from "@/lib/store";

const copy: Record<LiveStatus, string> = {
  live: "Live",
  paused: "Paused",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

/** The ember dot is the product's promise: this number is not a screenshot. */
export function LiveIndicator({ onSlab = false }: { onSlab?: boolean }) {
  const { liveStatus, lastEventAt } = useStore();
  const live = liveStatus === "live";
  const text = onSlab ? "text-on-slab" : "text-ink";
  const muted = onSlab ? "text-on-slab-2" : "text-ink-3";
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-semibold ${text}`} role="status" aria-live="polite">
      <span aria-hidden className={`size-2.5 rounded-full ${onSlab ? "outline-2 outline-white" : ""} ${live ? "live-dot bg-ember" : liveStatus === "offline" ? "bg-danger" : "bg-warn-fill"}`} />
      {copy[liveStatus]}
      {liveStatus === "offline" && lastEventAt > 0 && <span className={`font-normal ${muted}`}>as of {fmtTime(new Date(lastEventAt).toISOString())}</span>}
    </span>
  );
}
