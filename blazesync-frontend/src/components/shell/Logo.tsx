import Link from "next/link";

/** The ember dot is the same dot that means "live" on the ledger. */
export function Logo({ href = "/", size = "md" }: { href?: string; size?: "md" | "lg" }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-sm" aria-label="BlazeSync home">
      <span aria-hidden className={`rounded-full bg-ember ${size === "lg" ? "size-3.5" : "size-2.5"}`} />
      <span className={`condensed font-extrabold tracking-tight text-ink ${size === "lg" ? "text-2xl" : "text-lg"}`}>BlazeSync</span>
    </Link>
  );
}
