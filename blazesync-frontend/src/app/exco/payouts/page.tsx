"use client";

import Link from "next/link";
import { Loader2, Plus, Send, ShieldCheck } from "lucide-react";
import { SignatureTrack } from "@/components/payouts/SignatureTrack";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, PageHeader, Section, Tag } from "@/components/ui/bits";
import { ago, firstName, fmtDate, naira } from "@/lib/format";
import { selectAssociation, selectUser, useDb, useNow } from "@/lib/store";
import type { Disbursement } from "@/lib/types";

export default function PayoutsPage() {
  const { db, session } = useDb();
  const now = useNow();
  const me = session!.userId;
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const all = db.disbursements.filter((d) => d.associationId === assocId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const signatories = db.exco.filter((e) => e.associationId === assocId && e.isSignatory);
  const amSignatory = signatories.some((s) => s.userId === me);

  const groups: { title: string; items: Disbursement[] }[] = [
    { title: "Waiting for your signature", items: all.filter((d) => d.status === "pending" && amSignatory && !d.approvals.some((a) => a.userId === me)) },
    { title: "Waiting for other signatures", items: all.filter((d) => d.status === "pending" && (!amSignatory || d.approvals.some((a) => a.userId === me))) },
    { title: "Sending now", items: all.filter((d) => d.status === "processing" || d.status === "approved") },
    { title: "Paid out", items: all.filter((d) => d.status === "completed") },
    { title: "Rejected or failed", items: all.filter((d) => d.status === "rejected" || d.status === "failed") },
  ];

  return (
    <>
      <PageHeader
        title="Payouts"
        lead={`Money leaves ${assoc.shortName}'s account only after ${assoc.approvalRule.required} of ${assoc.approvalRule.of} signatories approve.`}
        actions={
          assoc.linkedAccount && (
            <ButtonLink href="/exco/payouts/new" size="sm">
              <Plus aria-hidden className="size-4" /> Request a payout
            </ButtonLink>
          )
        }
      />

      <p className="mb-8 flex max-w-2xl items-start gap-2 text-sm text-ink-2">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-credit" />
        The server enforces this rule, not this screen. Even a request sent straight to our API is refused until enough different signatories have approved it.
      </p>

      {all.length === 0 ? (
        <EmptyState
          icon={<Send className="size-5" />}
          title="No payout requests yet"
          action={assoc.linkedAccount ? <ButtonLink href="/exco/payouts/new">Request a payout</ButtonLink> : <ButtonLink href="/exco/settings#account">Link the bank account first</ButtonLink>}
        >
          When an exco needs to pay for something, the request waits here until {assoc.approvalRule.required} of you sign it. Members see every completed payout on the ledger.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <Section key={g.title} title={g.title} aside={<span className="text-ink-3">{g.items.length}</span>}>
                <ul className="stagger space-y-3">
                  {g.items.map((d) => {
                    const by = selectUser(db, d.requestedBy)?.name ?? "An exco";
                    return (
                      <li key={d.id}>
                        <Link href={`/exco/payouts/${d.id}`} className="press grid gap-3 rounded-md border border-rule bg-surface p-4 hover:border-edge sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:p-5">
                          <div className="min-w-0 space-y-1">
                            <p className="flex flex-wrap items-baseline gap-x-3">
                              <span className="figure text-xl font-bold">{naira(d.amount)}</span>
                              <span className="text-sm text-ink-2">to {d.recipient.accountName}</span>
                            </p>
                            <p className="font-semibold">{d.reason}</p>
                            <p className="text-sm text-ink-3">
                              {d.requestedBy === me ? "You" : firstName(by)} asked {now - new Date(d.requestedAt).getTime() < 7 * 86_400_000 ? ago(d.requestedAt, now) : `on ${fmtDate(d.requestedAt)}`}
                            </p>
                          </div>
                          <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
                            {d.status === "processing" ? (
                              <Tag tone="brand" icon={<Loader2 aria-hidden className="size-3 spin" />}>
                                Sending through Ecobank
                              </Tag>
                            ) : d.status === "completed" ? (
                              <Tag tone="credit">Paid {fmtDate(d.completedAt!)}</Tag>
                            ) : d.status === "failed" ? (
                              <Tag tone="danger">Failed, nothing sent</Tag>
                            ) : (
                              <SignatureTrack d={d} />
                            )}
                            {g.title === "Waiting for your signature" && <span className="text-sm font-semibold text-brand">Review and sign</span>}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            ))}
        </div>
      )}
    </>
  );
}
