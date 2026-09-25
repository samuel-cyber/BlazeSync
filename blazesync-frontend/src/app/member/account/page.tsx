"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Avatar, PageHeader, Panel, Section, Tag } from "@/components/ui/bits";
import { Switch } from "@/components/ui/Field";
import { maskPhone } from "@/lib/format";
import { selectMyAssociations, selectMyRecord, selectUser, useDb } from "@/lib/store";

export default function AccountPage() {
  const router = useRouter();
  const { db, session, signOut, signInDemo, switchAssociation } = useDb();
  const me = selectUser(db, session!.userId);
  const mine = selectMyAssociations(db, session!);
  const [n, setN] = useState({ opened: true, remind: true, payouts: false, sms: true });

  return (
    <div className="max-w-2xl space-y-10">
      <PageHeader title="Account" />

      <div className="flex items-center gap-4">
        <Avatar name={me?.name ?? "?"} size="lg" />
        <div>
          <p className="text-lg font-semibold">{me?.name}</p>
          <p className="text-ink-2">{me?.email}</p>
          {me?.phone && <p className="text-ink-2">{maskPhone(me.phone)}</p>}
        </div>
      </div>

      <Section
        title="Your associations"
        aside={
          <Link href="/join" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
            <Plus aria-hidden className="size-4" /> Join another
          </Link>
        }
      >
        <Panel>
          <ul className="divide-y divide-rule">
            {mine.map((a) => {
              const rec = selectMyRecord(db, session!.userId, a.id);
              const current = a.id === session!.associationId;
              return (
                <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{a.shortName}</p>
                    <p className="text-sm text-ink-2">
                      {rec ? `${rec.matric}, ${rec.level}` : a.institution}
                    </p>
                  </div>
                  {current ? (
                    <Tag tone="brand">Showing now</Tag>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        switchAssociation(a.id);
                        router.push("/member");
                      }}
                    >
                      Show
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      </Section>

      <Section title="Tell me when">
        <Panel className="divide-y divide-rule px-4">
          <Switch checked={n.opened} onChange={(v) => setN({ ...n, opened: v })} label="New dues are opened" />
          <Switch checked={n.remind} onChange={(v) => setN({ ...n, remind: v })} label="Dues are 3 days from the deadline" hint="Only if you haven't paid." />
          <Switch checked={n.payouts} onChange={(v) => setN({ ...n, payouts: v })} label="The exco pays money out" hint="Every payout, with who signed it." />
          <Switch checked={n.sms} onChange={(v) => setN({ ...n, sms: v })} label="Also by SMS" />
        </Panel>
      </Section>

      <Section title="Demo">
        <Panel className="flex flex-wrap gap-2 p-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              signInDemo("exco");
              router.push("/exco");
            }}
          >
            Switch to treasurer view
          </Button>
        </Panel>
      </Section>

      <Button
        variant="secondary"
        onClick={() => {
          signOut();
          router.push("/login");
        }}
      >
        <LogOut aria-hidden className="size-4" /> Sign out
      </Button>
    </div>
  );
}
