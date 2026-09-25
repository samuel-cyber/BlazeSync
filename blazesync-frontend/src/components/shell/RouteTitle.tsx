"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Most screens are client components (they read the demo store), so they
// can't export `metadata`. One table keeps every tab title distinct instead.
const TITLES: [RegExp, string][] = [
  [/^\/$/, "BlazeSync: association dues, in the open"],
  [/^\/login/, "Log in"],
  [/^\/signup/, "Create your account"],
  [/^\/forgot-password/, "Reset your password"],
  [/^\/verify/, "Check your code"],
  [/^\/welcome/, "How will you use BlazeSync?"],
  [/^\/setup/, "Set up your association"],
  [/^\/join/, "Join an association"],
  [/^\/claim\//, "Claim your invite"],
  [/^\/receipt\//, "Receipt"],
  [/^\/exco\/ledger/, "Ledger"],
  [/^\/exco\/members\/import/, "Upload your member list"],
  [/^\/exco\/members/, "Members"],
  [/^\/exco\/dues\/new/, "Open a dues cycle"],
  [/^\/exco\/dues\/.+/, "Dues cycle"],
  [/^\/exco\/dues/, "Dues"],
  [/^\/exco\/payouts\/new/, "Request a payout"],
  [/^\/exco\/payouts\/.+/, "Payout"],
  [/^\/exco\/payouts/, "Payouts"],
  [/^\/exco\/records/, "Records"],
  [/^\/exco\/settings/, "Settings"],
  [/^\/exco\/more/, "More"],
  [/^\/exco/, "Ledger"],
  [/^\/member\/pay/, "Pay dues"],
  [/^\/member\/ledger/, "Ledger"],
  [/^\/member\/history/, "Your payments"],
  [/^\/member\/account/, "Account"],
  [/^\/member/, "Home"],
];

export function RouteTitle() {
  const path = usePathname();
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(path))?.[1];
    if (t) document.title = path === "/" ? t : `${t} | BlazeSync`;
  }, [path]);
  return null;
}
