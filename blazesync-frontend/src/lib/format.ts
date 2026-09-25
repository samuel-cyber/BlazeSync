import type { Channel, Kobo } from "./types";

const TZ = "Africa/Lagos";

/** ₦2,000 — whole naira drop the kobo; anything else shows it. */
export function naira(kobo: Kobo, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(kobo);
  const whole = abs % 100 === 0;
  const body = (abs / 100).toLocaleString("en-NG", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const sign = kobo < 0 ? "−" : opts.sign ? "+" : "";
  return `${sign}₦${body}`;
}

/** Digits only, for the big balance where ₦ is set separately. */
export function nairaDigits(kobo: Kobo): string {
  return Math.round(kobo / 100).toLocaleString("en-NG");
}

export function toKobo(nairaInput: string): Kobo | null {
  const clean = nairaInput.replace(/[₦,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ });
const dateYearFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});
const weekdayFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: TZ,
});
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

export const fmtDate = (iso: string) => dateFmt.format(new Date(iso));
export const fmtDateYear = (iso: string) => dateYearFmt.format(new Date(iso));
export const fmtWeekday = (iso: string) => weekdayFmt.format(new Date(iso));
export const fmtTime = (iso: string) => timeFmt.format(new Date(iso)).replace(" ", "").toLowerCase();
export const fmtDateTime = (iso: string) => `${fmtDateYear(iso)}, ${fmtTime(iso)}`;
export const dayKey = (iso: string) => dayKeyFmt.format(new Date(iso));

/** "Today", "Yesterday", or "Mon 21 Sep". Needs a client clock, so callers pass `now`. */
export function dayLabel(iso: string, now: number): string {
  const k = dayKey(iso);
  if (k === dayKeyFmt.format(new Date(now))) return "Today";
  if (k === dayKeyFmt.format(new Date(now - 86_400_000))) return "Yesterday";
  return fmtWeekday(iso);
}

export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return fmtDate(iso);
}

export function daysUntil(iso: string, now: number): number {
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

export const channelLabel: Record<Channel, string> = {
  blaze: "Blaze account",
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash to exco",
  direct_transfer: "Direct transfer to association account",
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 2)}•••@${domain}`;
}

export function maskPhone(phone: string): string {
  return phone.replace(/^(\+?\d{3,4})\d+(\d{3})$/, "$1 ••• ••$2");
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-NG")} ${n === 1 ? one : many}`;
}

/** A fresh idempotency key. randomUUID needs a secure context, so fall back on plain http. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** True if the last minute of a yyyy-mm-dd day (Lagos time) has already gone. */
export function isPastDay(yyyyMmDd: string): boolean {
  return new Date(`${yyyyMmDd}T23:59:00+01:00`).getTime() < Date.now();
}
