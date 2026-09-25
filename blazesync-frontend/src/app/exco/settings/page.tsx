"use client";

import { useRouter } from "next/navigation";
import { Landmark, RotateCcw, UserPlus } from "lucide-react";
import { useState } from "react";
import { LinkAccountFlow } from "@/components/LinkAccountFlow";
import { Button } from "@/components/ui/Button";
import { Avatar, Callout, Dialog, PageHeader, Panel, Section, Tag } from "@/components/ui/bits";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmtDateYear } from "@/lib/format";
import { selectAssociation, selectUser, useDb } from "@/lib/store";
import type { ExcoTitle } from "@/lib/types";

const TITLES: ExcoTitle[] = ["Treasurer", "Financial Secretary", "President", "Vice President", "General Secretary", "Other"];

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const store = useDb();
  const { db, session } = store;
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const team = db.exco.filter((e) => e.associationId === assocId);
  const signatories = team.filter((e) => e.isSignatory);
  const [required, setRequired] = useState(assoc.approvalRule.required);
  const [savingRule, setSavingRule] = useState(false);
  const [adding, setAdding] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [notif, setNotif] = useState({ each: false, digest: true, sign: true, sms: true });

  return (
    <div className="max-w-3xl space-y-12">
      <PageHeader title="Settings" lead={assoc.name} />

      <Section title="Payout rule" id="rule">
        <Panel className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3 text-lg">
            <span>Payouts need</span>
            <label>
              <span className="sr-only">Signatures required</span>
              <Select value={required} onChange={(e) => setRequired(Number(e.target.value))} className="h-11 w-20 text-lg font-bold">
                {Array.from({ length: Math.max(1, signatories.length - 1) }, (_, i) => i + 2)
                  .filter((n) => n <= Math.max(2, signatories.length))
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </Select>
            </label>
            <span>of {signatories.length} signatures</span>
          </div>
          <p className="text-sm text-ink-2">The minimum is 2, so no one can ever move money alone. Changing this is logged and every signatory is told.</p>
          {signatories.length < 2 && <Callout tone="warn" title="Add a second signatory">Until there are two, no payout can be approved.</Callout>}
          <Button
            size="sm"
            disabled={required === assoc.approvalRule.required}
            busy={savingRule}
            onClick={async () => {
              setSavingRule(true);
              await store.setApprovalRule(assocId, required);
              setSavingRule(false);
              toast(`Saved. Payouts now need ${required} of ${signatories.length} signatures.`);
            }}
          >
            Save rule
          </Button>
        </Panel>
      </Section>

      <Section
        title="Exco"
        id="team"
        aside={
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden className="size-4" /> Add
          </Button>
        }
      >
        <Panel>
          <ul className="divide-y divide-rule">
            {team.map((e) => {
              const u = selectUser(db, e.userId);
              return (
                <li key={e.userId} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={u?.name ?? "?"} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {u?.name}
                      {e.userId === session!.userId && <span className="font-normal text-ink-3"> (you)</span>}
                    </p>
                    <p className="text-sm text-ink-2">{e.title}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {e.isSignatory && <Tag tone="brand">Signatory</Tag>}
                    {e.status === "invited" && <Tag tone="warn">Invite sent</Tag>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
        <p className="mt-3 text-sm text-ink-3">Removing a signatory needs the same number of signatures as a payout, so nobody can quietly remove the people checking them.</p>
      </Section>

      <Section title="Bank account" id="account">
        {assoc.linkedAccount ? (
          <Panel className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid size-11 place-items-center rounded-full bg-brand-wash text-brand">
                <Landmark className="size-5" />
              </span>
              <div>
                <p className="font-semibold">
                  Ecobank business account ending {assoc.linkedAccount.last4}
                </p>
                <p className="text-sm text-ink-2">
                  {assoc.linkedAccount.accountName}. Linked {fmtDateYear(assoc.linkedAccount.linkedAt)} by {selectUser(db, assoc.linkedAccount.linkedBy)?.name ?? "an exco"}.
                </p>
              </div>
            </div>
            <ul className="space-y-1 text-sm text-ink-2">
              <li>BlazeSync can read the balance, receive dues, and send payouts that meet your rule.</li>
              <li>It can&apos;t see any other account, or move money without the signatures.</li>
            </ul>
            <Button variant="secondary" size="sm" onClick={() => setDisconnecting(true)}>
              Disconnect
            </Button>
          </Panel>
        ) : (
          <Panel className="p-5">
            <LinkAccountFlow
              associationName={assoc.shortName}
              onLinked={async (last4) => {
                await store.linkAccount(assocId, last4);
                toast(`Linked the Ecobank account ending ${last4}.`);
              }}
            />
          </Panel>
        )}
      </Section>

      <Section title="Notifications">
        <Panel className="divide-y divide-rule px-4">
          <Switch checked={notif.each} onChange={(v) => setNotif((n) => ({ ...n, each: v }))} label="Every payment that comes in" hint="Can be a lot during the first week of a cycle." />
          <Switch checked={notif.digest} onChange={(v) => setNotif((n) => ({ ...n, digest: v }))} label="A daily summary at 8pm" />
          <Switch checked={notif.sign} onChange={(v) => setNotif((n) => ({ ...n, sign: v }))} label="A payout needs my signature" />
          <Switch checked={notif.sms} onChange={(v) => setNotif((n) => ({ ...n, sms: v }))} label="Also by SMS" hint="For signatures and balance alerts only." />
          <Switch checked onChange={() => {}} disabled label="The balance doesn't match the bank" lockedReason="Always on for every exco. This is the alert that catches mistakes and fraud." />
        </Panel>
      </Section>

      <Section title="Demo controls" id="demo">
        <Panel className="divide-y divide-rule px-4">
          <p className="py-3 text-sm text-ink-2">For showing BlazeSync off. None of this exists in the real product.</p>
          <Switch checked={store.liveStatus === "live"} onChange={(v) => store.setLiveEnabled(v)} label="Live payments" hint="A new member payment lands every 15 to 25 seconds." />
          <Switch checked={store.driftOn} onChange={(v) => store.simulateDrift(v)} label="Simulate a missed bank notification" hint="Ecobank's balance runs ₦2,000 ahead of the ledger, and the ledger head says so." />
          <Switch checked={store.declineNext} onChange={(v) => store.setDeclineNext(v)} label="Decline the next member payment" hint="Shows what a member sees when Ecobank refuses a payment." />
          <div className="flex flex-wrap gap-2 py-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                store.signInDemo("member");
                router.push("/member");
              }}
            >
              Switch to member view
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                store.resetDemo();
                toast("Demo data reset.");
              }}
            >
              <RotateCcw aria-hidden className="size-4" /> Reset demo data
            </Button>
          </div>
        </Panel>
      </Section>

      <AddExco open={adding} onClose={() => setAdding(false)} />

      <Dialog
        open={disconnecting}
        onClose={() => setDisconnecting(false)}
        title="Disconnect the bank account?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisconnecting(false)}>
              Keep it linked
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await store.disconnectAccount(assocId);
                setDisconnecting(false);
                toast("Disconnected. BlazeSync can no longer read or move money in that account.");
              }}
            >
              Disconnect
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-ink-2">
          <p>BlazeSync&apos;s access ends immediately. After that:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Members can&apos;t pay dues in the app.</li>
            <li>No payouts can be sent, including ones already approved.</li>
            <li>The balance can&apos;t be checked against the bank, and members will see that.</li>
          </ul>
          <p>The ledger and every receipt stay exactly as they are.</p>
        </div>
      </Dialog>
    </div>
  );
}

function AddExco({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, inviteExco } = useDb();
  const toast = useToast();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [title, setTitle] = useState<ExcoTitle>("Financial Secretary");
  const [sig, setSig] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add an exco member"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={busy}
            onClick={async () => {
              const e: Record<string, string> = {};
              if (name.trim().length < 3) e.name = "Enter their full name.";
              if (!/@/.test(contact) && !/^(\+?234|0)[789][01]\d{8}$/.test(contact.replace(/\s/g, ""))) e.contact = "Enter an email address or a Nigerian phone number.";
              setErrors(e);
              if (Object.keys(e).length) return;
              setBusy(true);
              await inviteExco(session!.associationId, { name: name.trim(), contact: contact.trim(), title, isSignatory: sig });
              setBusy(false);
              toast(`Invited ${name.trim()}. They'll get a link to join as ${title}.`);
              setName("");
              setContact("");
              onClose();
            }}
          >
            Send invite
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Full name" error={errors.name}>
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Email or phone number" error={errors.contact}>
          {(a) => <Input {...a} value={contact} onChange={(e) => setContact(e.target.value)} />}
        </Field>
        <Field label="Role">
          {(a) => (
            <Select {...a} value={title} onChange={(e) => setTitle(e.target.value as ExcoTitle)}>
              {TITLES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox checked={sig} onChange={(e) => setSig(e.target.checked)} label="Make them a signatory" hint="Signatories approve payouts. Adding one is logged, and the other signatories are told." />
      </div>
    </Dialog>
  );
}
