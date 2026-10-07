"use client";

import { AlertTriangle, CheckCircle2, FileDown, Search, SearchX, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel, Section, Segmented } from "@/components/ui/bits";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmtDateTime, fmtTime, naira } from "@/lib/format";
import { selectAssociation, selectLedger, selectOpenCycle, useDb, useNow, useStore } from "@/lib/store";
import type { LedgerCategory } from "@/lib/types";
import { LedgerHead } from "./LedgerHead";
import { LedgerFeed } from "./LedgerFeed";

type Period = "all" | "cycle" | "7" | "30";
type Direction = "all" | "in" | "out";

/** Ask BlazeSync: a read-only question over the association's real ledger. */
function AskBlazeSync() {
  const { ask } = useStore();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ answer: string; groundedVia: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    const r = await ask(q);
    setBusy(false);
    if (!r.ok) {
      toast(r.error === "rate_limited" ? "Too many questions just now — try again in a moment." : "Couldn't answer that. Try again.", "danger");
      return;
    }
    setResult(r.value);
  };

  return (
    <Panel className="px-4">
      <Section title="Ask BlazeSync" aside={<span className="text-xs text-ink-3">Read-only</span>}>
        <form onSubmit={submit} className="space-y-3">
          <Textarea
            rows={2}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. How much did 300L pay this cycle?"
            aria-label="Ask a question about the ledger"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" busy={busy} disabled={!q.trim()}>
              <Sparkles aria-hidden className="size-4" /> Ask
            </Button>
            <p className="text-xs text-ink-3">Answers come only from this association&apos;s real ledger — BlazeSync says so when it doesn&apos;t know.</p>
          </div>
        </form>
        {result && (
          <div className="mt-3 rounded-md bg-sunken px-4 py-3 text-sm" aria-live="polite">
            <p>{result.answer}</p>
            <p className="mt-1 text-xs text-ink-3">{result.groundedVia === "llm" ? "Answered from the ledger by the AI, read-only." : result.groundedVia === "demo" ? "Demo answer — limited to totals." : "Answered with exact ledger queries."}</p>
          </div>
        )}
      </Section>
    </Panel>
  );
}

/** The full statement, the same for exco and members; one filter row scopes everything below it. */
export function LedgerPage({ audience }: { audience: "exco" | "member" }) {
  const { db, session } = useDb();
  const now = useNow();
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const all = selectLedger(db, assocId);
  const cycle = selectOpenCycle(db, assocId);
  const [period, setPeriod] = useState<Period>("all");
  const [dir, setDir] = useState<Direction>("all");
  const [cat, setCat] = useState<LedgerCategory | "all">("all");
  const [q, setQ] = useState("");

  const categories = useMemo(() => Array.from(new Set(all.map((e) => e.category))).sort(), [all]);

  const rows = all.filter((e) => {
    if (period === "cycle" && cycle && e.at < cycle.openedAt) return false;
    if ((period === "7" || period === "30") && now - new Date(e.at).getTime() > Number(period) * 86_400_000) return false;
    if (dir !== "all" && e.direction !== dir) return false;
    if (cat !== "all" && e.category !== cat) return false;
    if (q && !`${e.counterparty} ${e.description}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const inflow = rows.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0);
  const outflow = rows.filter((e) => e.direction === "out").reduce((s, e) => s + e.amount, 0);
  const filtered = period !== "all" || dir !== "all" || cat !== "all" || q !== "";

  const runs = db.reconciliation.filter((r) => r.associationId === assocId).slice(0, 8);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Ledger"
        lead={
          audience === "exco"
            ? `Every naira in and out of ${assoc.shortName}. Members see exactly this page.`
            : `Every naira in and out of ${assoc.shortName}. The exco sees exactly this page.`
        }
        actions={
          audience === "exco" && (
            <ButtonLink href="/exco/records" variant="secondary" size="sm">
              <FileDown aria-hidden className="size-4" /> Download
            </ButtonLink>
          )
        }
      />

      <LedgerHead associationId={assocId} audience={audience} />

      <AskBlazeSync />

      <section aria-label="Statement" className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <Segmented<Period>
            label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "all", label: "All time" },
              ...(cycle ? [{ value: "cycle" as const, label: "This cycle" }] : []),
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
            ]}
          />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-1">
            <label className="sm:w-40">
              <span className="sr-only">Direction</span>
              <Select value={dir} onChange={(e) => setDir(e.target.value as Direction)} className="h-11 text-sm">
                <option value="all">In and out</option>
                <option value="in">Money in</option>
                <option value="out">Money out</option>
              </Select>
            </label>
            <label className="sm:w-44">
              <span className="sr-only">Category</span>
              <Select value={cat} onChange={(e) => setCat(e.target.value as LedgerCategory | "all")} className="h-11 text-sm">
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </label>
            <label className="relative col-span-2 sm:flex-1">
              <span className="sr-only">Search by name or description</span>
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search names or descriptions"
                className="h-11 w-full rounded-sm border border-edge bg-surface pl-9 pr-3 text-sm placeholder:text-ink-3"
              />
            </label>
          </div>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm" aria-live="polite">
          <div className="flex gap-2">
            <dt className="text-ink-2">Money in</dt>
            <dd className="font-bold text-credit">{naira(inflow)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-2">Money out</dt>
            <dd className="font-bold">{naira(outflow)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-2">Entries</dt>
            <dd className="font-bold">{rows.length}</dd>
          </div>
        </dl>

        <LedgerFeed
          audience={audience}
          entries={rows}
          emptyState={
            filtered ? (
              <EmptyState icon={<SearchX className="size-5" />} title="Nothing matches these filters">
                Try a longer period or clear the search. Nothing is hidden: every entry ever made is in &ldquo;All time&rdquo;.
              </EmptyState>
            ) : (
              <EmptyState icon={<SearchX className="size-5" />} title="No money has moved yet">
                The first dues payment appears here the moment Ecobank confirms it.
              </EmptyState>
            )
          }
        />
      </section>

      <Section title="Balance checks" id="checks">
        <div className="space-y-4">
          <p className="max-w-2xl text-ink-2">
            Every 15 minutes, and after every payment, we ask Ecobank for the account&apos;s real balance and compare it with this ledger. Cash an exco
            is holding isn&apos;t in the bank yet, so it is set aside before comparing. If the two ever disagree, the exco is alerted and this page says so.
          </p>
          {runs.length === 0 ? (
            <p className="text-ink-3">No checks yet. They start once a bank account is linked.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-rule bg-surface">
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">Recent balance checks against Ecobank</caption>
                <thead className="bg-sunken/60 text-left text-xs text-ink-2">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-semibold">Checked</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Ledger</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Cash not banked</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Ecobank</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">{now - new Date(r.at).getTime() < 86_400_000 ? `Today, ${fmtTime(r.at)}` : fmtDateTime(r.at)}</td>
                      <td className="px-4 py-2.5 text-right">{naira(r.ledgerBalance)}</td>
                      <td className="px-4 py-2.5 text-right text-ink-2">{naira(r.cashInHand)}</td>
                      <td className="px-4 py-2.5 text-right">{naira(r.bankBalance)}</td>
                      <td className="px-4 py-2.5">
                        {r.result === "match" ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-credit">
                            <CheckCircle2 aria-hidden className="size-4" /> Matches
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-warn">
                            <AlertTriangle aria-hidden className="size-4" /> Off by {naira(Math.abs(r.bankBalance - (r.ledgerBalance - r.cashInHand)))}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
