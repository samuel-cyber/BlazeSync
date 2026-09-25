import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

// `press` (globals.css) gives every button the same press feedback: a 120ms settle to 98.5%.
const base = "press inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-55";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-press",
  secondary: "bg-surface text-ink border border-edge hover:bg-sunken",
  ghost: "text-brand hover:bg-brand-wash",
  danger: "bg-danger text-on-danger hover:opacity-90",
};

const sizes: Record<Size, string> = {
  md: "h-12 px-5 rounded-sm text-base",
  sm: "h-10 px-3.5 rounded-sm text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  className = "",
  children,
  disabled,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; busy?: boolean }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <Loader2 aria-hidden className="size-4 spin" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
