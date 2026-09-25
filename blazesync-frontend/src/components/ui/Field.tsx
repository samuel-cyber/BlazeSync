import { useId, type ComponentProps, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

const control =
  "block w-full rounded-sm border border-edge bg-surface px-3.5 text-base text-ink placeholder:text-ink-3 transition-colors hover:border-ink-3 focus-visible:outline-3 focus-visible:outline-offset-0 aria-invalid:border-danger aria-invalid:bg-danger-wash/40";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: (a11y: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

/** Label, control, then hint or error, wired together for screen readers. */
export function Field({ label, hint, error, optional, className = "", children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-sm font-semibold text-ink">
        <span>{label}</span>
        {optional && <span className="font-normal text-ink-3">Optional</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <p id={hintId} className="text-sm text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className = "", ...rest }: ComponentProps<"input">) {
  return <input className={`${control} h-12 ${className}`} {...rest} />;
}

export function Select({ className = "", children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={`${control} h-12 appearance-none bg-[length:16px] bg-[right_0.9rem_center] bg-no-repeat pr-10 ${className}`} style={{ backgroundImage: "var(--chevron)" }} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...rest }: ComponentProps<"textarea">) {
  return <textarea className={`${control} min-h-24 py-3 ${className}`} {...rest} />;
}

/** ₦-prefixed amount input. Accepts "2000", "2,000" or "2000.50". */
export function MoneyInput({ className = "", ...rest }: ComponentProps<"input">) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-base font-semibold text-ink-2">
        ₦
      </span>
      <input inputMode="decimal" autoComplete="off" className={`${control} h-12 pl-8 font-semibold ${className}`} {...rest} />
    </div>
  );
}

export function Checkbox({ label, hint, className = "", ...rest }: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]" {...rest} />
      <label htmlFor={id} className="text-base leading-snug text-ink">
        {label}
        {hint && <span className="mt-0.5 block text-sm text-ink-3">{hint}</span>}
      </label>
    </div>
  );
}

/** A switch is a checkbox with role="switch": same keyboard, clearer meaning. */
export function Switch({ label, hint, checked, onChange, disabled, lockedReason }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; lockedReason?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="min-w-0 text-base text-ink">
        {label}
        {(hint || lockedReason) && <span className="mt-0.5 block text-sm text-ink-3">{lockedReason ?? hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${checked ? "border-brand bg-brand" : "border-edge bg-sunken"}`}
      >
        <span aria-hidden className={`inline-block size-5 rounded-full bg-surface shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}
