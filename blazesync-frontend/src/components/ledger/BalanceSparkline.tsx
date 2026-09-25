"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dayKey, fmtDate, naira } from "@/lib/format";
import type { LedgerEntry } from "@/lib/types";

const H = 64;
const PAD = 6;

/** Closing balance for each of the last `days` days, oldest first. */
export function dailyBalances(entries: LedgerEntry[], now: number, days = 30) {
  const asc = [...entries].sort((a, b) => a.at.localeCompare(b.at));
  const out: { day: string; at: string; balance: number }[] = [];
  let i = 0;
  let bal = 0;
  for (let d = days - 1; d >= 0; d--) {
    const t = now - d * 86_400_000;
    const key = dayKey(new Date(t).toISOString());
    while (i < asc.length && dayKey(asc[i].at) <= key) {
      bal = asc[i].balanceAfter;
      i++;
    }
    out.push({ day: key, at: new Date(t).toISOString(), balance: bal });
  }
  return out;
}

/**
 * The balance over the last 30 days. One series, so no legend: the caption
 * names it. The line is quiet; today's point wears ember because it is live.
 * Pointer and arrow keys both move the readout.
 */
export function BalanceSparkline({ entries, now }: { entries: LedgerEntry[]; now: number }) {
  const data = useMemo(() => dailyBalances(entries, now), [entries, now]);
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const min = Math.min(...data.map((d) => d.balance));
  const max = Math.max(...data.map((d) => d.balance));
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (data.length - 1)) * (w - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join("");
  const area = `${line}L${x(data.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const last = data.length - 1;
  const shown = active ?? last;

  const pick = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - PAD) / (r.width - PAD * 2)) * (data.length - 1));
    setActive(Math.max(0, Math.min(last, i)));
  };

  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between gap-3 text-sm text-on-slab-2">
        <span>Balance, last 30 days</span>
        <span aria-live="polite" className="font-semibold text-on-slab">
          {active === null ? "Today" : fmtDate(data[shown].at)}: {naira(data[shown].balance)}
        </span>
      </figcaption>
      <div
        ref={wrap}
        tabIndex={0}
        role="img"
        aria-label={`Balance over the last 30 days, from ${naira(data[0].balance)} to ${naira(data[last].balance)}. Use left and right arrow keys to read each day.`}
        className="relative h-16 cursor-crosshair touch-pan-y rounded-sm"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? last) - 1));
          else if (e.key === "ArrowRight") setActive((a) => Math.min(last, (a ?? last) + 1));
          else if (e.key === "Escape") setActive(null);
          else return;
          e.preventDefault();
        }}
      >
        {w > 0 && (
          <svg width={w} height={H} className="block overflow-visible" aria-hidden>
            <path className="spark-path" d={area} fill="var(--on-slab-2)" opacity={0.1} />
            <path className="spark-path" d={line} fill="none" stroke="var(--on-slab-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {active !== null && <line x1={x(active)} x2={x(active)} y1={0} y2={H} stroke="var(--on-slab-2)" strokeOpacity={0.5} strokeWidth={1} />}
            {active !== null && active !== last && <circle cx={x(active)} cy={y(data[active].balance)} r={4} fill="var(--on-slab)" stroke="var(--slab)" strokeWidth={2} />}
            <circle className="spark-end" cx={x(last)} cy={y(data[last].balance)} r={4.5} fill="var(--ember)" stroke="var(--on-slab)" strokeWidth={2} />
          </svg>
        )}
      </div>
    </figure>
  );
}
