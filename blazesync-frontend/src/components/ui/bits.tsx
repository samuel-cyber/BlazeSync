"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { initials, naira } from "@/lib/format";

/* ------------------------------------------------------------------ money */

export function Money({ kobo, sign = false, className = "" }: { kobo: number; sign?: boolean; className?: string }) {
  return <span className={`whitespace-nowrap ${className}`}>{naira(kobo, { sign })}</span>;
}

/* ------------------------------------------------------------------ callout */

type Tone = "info" | "success" | "warn" | "danger";

const toneStyle: Record<Tone, { box: string; icon: ReactNode }> = {
  info: { box: "bg-brand-wash text-ink", icon: <Info aria-hidden className="size-5 text-brand" /> },
  success: { box: "bg-credit-wash text-ink", icon: <CheckCircle2 aria-hidden className="size-5 text-credit" /> },
  warn: { box: "bg-warn-wash text-ink", icon: <AlertTriangle aria-hidden className="size-5 text-warn" /> },
  danger: { box: "bg-danger-wash text-ink", icon: <XCircle aria-hidden className="size-5 text-danger" /> },
};

/** A message with a job: what happened, and what to do next. */
export function Callout({ tone = "info", title, children, action, className = "", role }: { tone?: Tone; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; role?: "alert" | "status" }) {
  const t = toneStyle[tone];
  return (
    <div role={role} className={`flex gap-3 rounded-md px-4 py-3.5 ${t.box} ${className}`}>
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold leading-snug">{title}</p>
        {children && <div className="text-sm leading-relaxed text-ink-2">{children}</div>}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ empty */

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-edge/60 px-5 py-8 sm:px-8">
      <span aria-hidden className="grid size-11 place-items-center rounded-full bg-sunken text-ink-2">
        {icon}
      </span>
      <div className="max-w-md space-y-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        {children && <p className="text-ink-2">{children}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ meter */

/** A single ratio against a whole. The track is a lighter step of the fill. */
export function Meter({ value, max, label, detail, tone = "brand" }: { value: number; max: number; label: ReactNode; detail?: ReactNode; tone?: "brand" | "credit" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const fill = tone === "credit" ? "bg-credit" : "bg-brand";
  const track = tone === "credit" ? "bg-credit-wash" : "bg-brand-wash";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-ink">{label}</span>
        {detail && <span className="text-sm text-ink-2">{detail}</span>}
      </div>
      <div role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={typeof label === "string" ? label : undefined} className={`h-2.5 overflow-hidden rounded-full ${track}`}>
        <div className={`meter-fill h-full rounded-full ${fill}`} style={{ "--w": `${pct}%` } as React.CSSProperties} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tag */

const tagTone = {
  neutral: "bg-sunken text-ink-2",
  brand: "bg-brand-wash text-brand",
  credit: "bg-credit-wash text-credit",
  warn: "bg-warn-wash text-warn",
  danger: "bg-danger-wash text-danger",
  ember: "bg-ember-wash text-ember-ink",
} as const;

export function Tag({ tone = "neutral", icon, children, className = "" }: { tone?: keyof typeof tagTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${tagTone[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ avatar */

export function Avatar({ name, size = "md", ring = false }: { name: string; size?: "sm" | "md" | "lg"; ring?: boolean }) {
  const s = size === "sm" ? "size-7 text-[11px]" : size === "lg" ? "size-12 text-base" : "size-9 text-xs";
  return (
    <span aria-hidden className={`inline-grid shrink-0 place-items-center rounded-full bg-brand-wash font-bold text-brand ${s} ${ring ? "ring-2 ring-surface" : ""}`}>
      {initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ segmented */

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex max-w-full gap-1 overflow-x-auto rounded-sm bg-sunken p-1 [scrollbar-width:none]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[4px] px-3 text-sm font-semibold ${on ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
          >
            {o.label}
            {o.count !== undefined && <span className={`text-xs ${on ? "text-ink-2" : "text-ink-3"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ steps */

/** Used only where the content really is a sequence: wizards and flows. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "now" : "next";
        return (
          <li key={s} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={state === "now" ? "step" : undefined}>
            <span className={`step-bar h-1 rounded-full ${state === "next" ? "bg-rule" : "bg-brand"}`} />
            <span className={`truncate text-xs font-semibold ${state === "next" ? "text-ink-3" : "text-ink"}`}>
              <span className="sr-only">{state === "done" ? "Done: " : state === "now" ? "Current step: " : "Next: "}</span>
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ dialog */

/** Native <dialog>: focus is trapped and Escape closes it, for free. */
export function Dialog({ open, onClose, title, children, footer, wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto mb-0 max-h-[92dvh] w-full max-w-none rounded-t-lg bg-surface p-0 text-ink shadow-[var(--shadow-float)] sm:mb-auto sm:rounded-lg ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <h2 className="text-lg font-bold leading-snug">{title}</h2>
            <button type="button" onClick={onClose} className="-m-2 grid size-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-sunken" aria-label="Close">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-rule px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/* ------------------------------------------------------------------ page header */

export function PageHeader({ title, lead, actions, back }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6 space-y-2 sm:mb-8">
      {back && (
        <Link href={back.href} className="-ml-1 inline-flex items-center gap-1 rounded px-1 text-sm font-semibold text-brand hover:underline">
          <span aria-hidden>‹</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-2xl space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {lead && <p className="text-base text-ink-2">{lead}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ section */

export function Section({ title, aside, children, className = "", id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={className} aria-labelledby={id}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-lg font-bold">
          {title}
        </h2>
        {aside && <div className="text-sm">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ panel */

export function Panel({ children, className = "", as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <As className={`rounded-md border border-rule bg-surface ${className}`}>{children}</As>;
}
