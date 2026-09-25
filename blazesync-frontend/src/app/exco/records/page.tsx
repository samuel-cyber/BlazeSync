"use client";

import { FileDown, FolderArchive, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Avatar, PageHeader, Panel, Section } from "@/components/ui/bits";
import { Field, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { download, toCsv } from "@/lib/csv";
import { channelLabel, fmtDateTime } from "@/lib/format";
import { selectAssociation, selectOpenCycle, selectUser, useDb } from "@/lib/store";
import type { AuditAction } from "@/lib/types";

const ACTION_GROUPS: Record<string, AuditAction[]> = {
  "Money": ["payment_recorded", "payment_received", "payout_requested", "payout_approved", "payout_rejected", "payout_completed"],
  "Members": ["roster_uploaded", "invites_sent", "invite_claimed"],
  "Dues": ["cycle_opened", "cycle_closed"],
  "Access and rules": ["signed_in", "account_linked", "rule_changed", "exco_invited"],
};

export default function RecordsPage() {
  const { db, session } = useDb();
  const toast = useToast();
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const cycle = selectOpenCycle(db, assocId);
  const [range, setRange] = useState<"all" | "cycle" | "90">("all");
  const [who, setWho] = useState("all");
  const [kind, setKind] = useState("all");
  const slug = assoc.shortName.toLowerCase().replace(/\s+/g, "-");
  const today = new Date().toISOString().slice(0, 10);
  const name = (id: string) => (id === "system" ? "BlazeSync" : (selectUser(db, id)?.name ?? "Unknown"));

  const ledgerCsv = (period: typeof range) => {
    const rows = db.ledger
      .filter((l) => l.associationId === assocId)
      .filter((l) => (period === "cycle" && cycle ? l.at >= cycle.openedAt : period === "90" ? Date.now() - new Date(l.at).getTime() < 90 * 86_400_000 : true));
    return toCsv([
      ["Date", "Direction", "Category", "Who", "Description", "Amount (NGN)", "Balance after (NGN)", "Paid with", "Cash not banked", "Receipt hash", "Corrects entry"],
      ...rows.map((l) => {
        const p = l.paymentId ? db.payments.find((x) => x.id === l.paymentId) : null;
        const r = p ? db.receipts.find((x) => x.id === p.receiptId) : null;
        return [l.at, l.direction === "in" ? "In" : "Out", l.category, l.counterparty, l.description, (l.amount / 100).toFixed(2), (l.balanceAfter / 100).toFixed(2), p ? channelLabel[p.channel] : "", l.cashInHand ? "Yes" : "", r?.hash ?? "", l.correctsEntryId ?? ""];
      }),
    ]);
  };
  const auditCsv = () => toCsv([["When", "Who", "Action", "What happened", "IP address"], ...db.audit.filter((a) => a.associationId === assocId).map((a) => [a.at, name(a.actor), a.action, a.summary, a.ip ?? ""])]);
  const rosterCsv = () =>
    toCsv([["Name", "Matric", "Level", "Email", "Phone", "Joined app", "Paid current cycle"], ...db.roster.filter((r) => r.associationId === assocId).map((r) => [r.name, r.matric, r.level, r.email, r.phone, r.userId ? "Yes" : "No", cycle && db.payments.some((p) => p.memberRecordId === r.id && p.cycleId === cycle.id) ? "Yes" : "No"])]);

  const events = db.audit
    .filter((a) => a.associationId === assocId)
    .filter((a) => who === "all" || a.actor === who)
    .filter((a) => kind === "all" || ACTION_GROUPS[kind].includes(a.action));
  const actors = Array.from(new Set(db.audit.filter((a) => a.associationId === assocId).map((a) => a.actor)));

  return (
    <>
      <PageHeader title="Records" lead="Everything the next exco, an auditor, or a suspicious member needs, as files you can keep." />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Section title="Activity log" className="order-2 lg:order-1">
          <p className="mb-4 flex max-w-2xl items-start gap-2 text-sm text-ink-2">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-credit" />
            Every action that changes something is recorded here, separately from the money: who did it and when. No one, including the treasurer, can edit or delete it.
          </p>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:max-w-md">
            <label>
              <span className="sr-only">Person</span>
              <Select value={who} onChange={(e) => setWho(e.target.value)} className="h-11 text-sm">
                <option value="all">Everyone</option>
                {actors.map((a) => (
                  <option key={a} value={a}>
                    {name(a)}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span className="sr-only">Kind of action</span>
              <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-11 text-sm">
                <option value="all">All actions</option>
                {Object.keys(ACTION_GROUPS).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </Select>
            </label>
          </div>
          <Panel>
            <ol className="stagger divide-y divide-rule">
              {events.slice(0, 40).map((a) => (
                <li key={a.id} className="flex gap-3 px-4 py-3">
                  {a.actor === "system" ? (
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken">
                      <span className="size-2.5 rounded-full bg-ember" />
                    </span>
                  ) : (
                    <Avatar name={name(a.actor)} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p>
                      <span className="font-semibold">{name(a.actor)}</span> <span className="text-ink-2">{a.summary.charAt(0).toLowerCase() + a.summary.slice(1)}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-ink-3">
                      {fmtDateTime(a.at)}
                      {a.ip && <span className="ml-3">from {a.ip}</span>}
                    </p>
                  </div>
                </li>
              ))}
              {events.length === 0 && <li className="px-4 py-6 text-ink-2">Nothing matches. Try &ldquo;Everyone&rdquo; and &ldquo;All actions&rdquo;.</li>}
            </ol>
          </Panel>
          {events.length > 40 && <p className="mt-2 text-sm text-ink-3">Showing the latest 40. The download has all {events.length}.</p>}
        </Section>

        <aside className="order-1 space-y-8 lg:order-2">
          <Section title="Download the ledger">
            <Panel className="space-y-4 p-4">
              <Field label="Period">
                {(a) => (
                  <Select {...a} value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
                    <option value="all">Everything since this exco took over</option>
                    {cycle && <option value="cycle">This dues cycle</option>}
                    <option value="90">Last 90 days</option>
                  </Select>
                )}
              </Field>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  download(`${slug}-ledger-${today}.csv`, ledgerCsv(range));
                  toast("Downloaded the ledger. It opens in Excel or Google Sheets.");
                }}
              >
                <FileDown aria-hidden className="size-4" /> Download spreadsheet
              </Button>
              <p className="text-sm text-ink-3">Includes each receipt&apos;s hash, so anyone can re-check a payment later.</p>
            </Panel>
          </Section>

          <Section title="Handing over">
            <Panel className="space-y-3 p-4">
              <p className="text-sm text-ink-2">At the end of your term, give the next exco the full ledger, the roster, and the activity log, so nothing starts from zero.</p>
              <Button
                className="w-full"
                onClick={() => {
                  // Always the full history, whatever period is picked above.
                  download(`${slug}-handover-ledger-${today}.csv`, ledgerCsv("all"));
                  setTimeout(() => download(`${slug}-handover-roster-${today}.csv`, rosterCsv()), 300);
                  setTimeout(() => download(`${slug}-handover-activity-${today}.csv`, auditCsv()), 600);
                  toast("Downloaded 3 files: ledger, roster, and activity log.");
                }}
              >
                <FolderArchive aria-hidden className="size-4" /> Download handover pack
              </Button>
            </Panel>
          </Section>
        </aside>
      </div>
    </>
  );
}
