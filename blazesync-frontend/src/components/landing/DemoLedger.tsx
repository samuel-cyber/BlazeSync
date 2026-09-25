"use client";

import { CheckCircle2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/bits";
import { naira, nairaDigits } from "@/lib/format";

type Row = { id: number; who: string; what: string; amount: number; bal: number; out?: boolean; fresh?: boolean };

const QUEUE: [string, string, number, boolean?][] = [
  ["Kelechi Obi", "First semester dues", 200_000],
  ["Aisha Mohammed", "First semester dues, 100L", 300_000],
  ["Yaba Quick Prints", "Course guide printing, 2 of 3 signed", 1_500_000, true],
  ["Oluwaseun Adeyemi", "First semester dues", 200_000],
  ["Halima Sani", "First semester dues, 100L", 300_000],
  ["Emeka Nwosu", "First semester dues", 200_000],
];

const START: Row[] = [
  { id: 3, who: "Ebuka Anozie", what: "First semester dues", amount: 200_000, bal: 19_175_000 },
  { id: 2, who: "Toluwani Fashola", what: "First semester dues", amount: 200_000, bal: 18_975_000 },
  { id: 1, who: "Abubakar Umar", what: "First semester dues", amount: 200_000, bal: 18_775_000 },
];

/**
 * The landing page's one moving part, because it is the product's whole
 * argument: money arrives, everyone sees it at once. Pausable (WCAG 2.2.2).
 */
export function DemoLedger() {
  const [rows, setRows] = useState<Row[]>(START);
  const [playing, setPlaying] = useState(true);
  const [shown, setShown] = useState(START[0].bal);
  const i = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setRows((rs) => {
        const [who, what, amount, out] = QUEUE[i.current % QUEUE.length];
        i.current += 1;
        const bal = rs[0].bal + (out ? -amount : amount);
        return [{ id: rs[0].id + 1, who, what, amount, bal, out, fresh: true }, ...rs.map((r) => ({ ...r, fresh: false }))].slice(0, 4);
      });
    }, 4200);
    return () => clearInterval(t);
  }, [playing]);

  const target = rows[0].bal;
  useEffect(() => {
    if (shown === target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const t = setTimeout(() => setShown(target), 0);
      return () => clearTimeout(t);
    }
    const from = shown;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      setShown(Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return (
    <figure aria-label="Example: a live association ledger" className="overflow-hidden rounded-lg bg-surface shadow-[var(--shadow-float)] ring-1 ring-rule">
      <div className="on-slab space-y-4 bg-slab px-5 py-5 text-on-slab sm:px-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-on-slab-2">CSSA UNILAG</span>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-sm font-semibold hover:bg-slab-2"
            aria-label={playing ? "Pause the example" : "Play the example"}
          >
            <span aria-hidden className={`size-2.5 rounded-full outline-2 outline-white ${playing ? "live-dot bg-ember" : "bg-on-slab-2"}`} />
            {playing ? "Live" : "Paused"}
            {playing ? <Pause aria-hidden className="size-3.5 text-on-slab-2" /> : <Play aria-hidden className="size-3.5 text-on-slab-2" />}
          </button>
        </div>
        <div>
          <p className="text-sm text-on-slab-2">Association balance</p>
          <p className="balance text-[clamp(3rem,11vw,4.5rem)]">
            <span className="naira">₦</span>
            {nairaDigits(shown)}
          </p>
        </div>
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 aria-hidden className="size-4 text-[#7ee2ae]" />
          <span className="font-semibold">Matches the Ecobank balance.</span>
        </p>
      </div>
      <ul aria-live="off">
        {rows.map((r) => (
          <li key={r.id} className={r.fresh ? "entry-new" : undefined}>
            <div>
              <div className="entry-body flex items-center gap-3 border-t border-rule px-5 py-3 sm:px-6">
                <Avatar name={r.who} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.who}</p>
                  <p className="truncate text-xs text-ink-2">{r.what}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${r.out ? "text-ink" : "text-credit"}`}>{naira(r.out ? -r.amount : r.amount, { sign: true })}</p>
                  <p className="text-xs text-ink-3">{naira(r.bal)}</p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
