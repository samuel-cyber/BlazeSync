"use client";

import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileUp, MailPlus } from "lucide-react";
import { useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, PageHeader, Panel, Steps } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { download, parseCsv, SAMPLE_ROSTER, toCsv, validateRoster } from "@/lib/csv";
import { plural } from "@/lib/format";
import { selectAssociation, useDb } from "@/lib/store";

type Checked = ReturnType<typeof validateRoster> & { fileName: string };

export default function ImportRoster() {
  const { db, session, importRoster } = useDb();
  const toast = useToast();
  const assocId = session!.associationId;
  const assoc = selectAssociation(db, assocId)!;
  const input = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const existing = new Set(db.roster.filter((r) => r.associationId === assocId).map((r) => r.matric.toUpperCase()));

  const read = (text: string, fileName: string) => {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      setFileError(`${fileName} has no rows under the header. Check you exported the sheet with the names in it.`);
      return;
    }
    const result = validateRoster(rows, existing);
    if (result.missing.length) {
      setFileError(
        `We couldn't find a column for ${result.missing.map((m) => (m === "email" ? "email or phone" : m === "matric" ? "matric number" : m)).join(" and ")}. Rename the header in your sheet, or start from our template.`,
      );
      return;
    }
    setFileError(null);
    setChecked({ ...result, fileName });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) {
      setFileError("That's an Excel file. In Excel or Google Sheets choose File, then Save as (or Download) CSV, and upload that.");
      return;
    }
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      setFileError(`${f.name} isn't a CSV file. Export your member list as CSV and try again.`);
      return;
    }
    read(await f.text(), f.name);
  };

  const step = done !== null ? 2 : checked ? 1 : 0;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Upload your member list" lead={`Everyone you add is tracked for ${assoc.shortName} dues straight away, before they ever open the app.`} back={{ href: "/exco/members", label: "Members" }} />

      <div className="mb-8">
        <Steps steps={["Choose file", "Check rows", "Done"]} current={step} />
      </div>

      {step === 0 && (
        <div className="space-y-6">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onFile(e.dataTransfer.files[0]);
            }}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${dragging ? "border-brand bg-brand-wash" : "border-edge/60 bg-surface hover:border-brand"}`}
          >
            <FileUp aria-hidden className="size-8 text-brand" />
            <span className="text-lg font-semibold">Choose a CSV file</span>
            <span className="text-sm text-ink-2">or drop it here</span>
            <input ref={input} type="file" accept=".csv,text/csv,.xlsx,.xls" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {fileError && <Callout tone="danger" role="alert" title="We couldn't read that file">{fileError}</Callout>}

          <Panel className="space-y-3 p-5">
            <h2 className="font-semibold">What the file needs</h2>
            <ul className="space-y-1.5 text-ink-2">
              <li>A header row, then one row per member.</li>
              <li>Name, matric number and level for everyone.</li>
              <li>An email or phone number for everyone, so their invite has somewhere to go.</li>
            </ul>
            <p className="text-sm text-ink-3">Column names don&apos;t need to match exactly: &ldquo;Matric No&rdquo;, &ldquo;Reg number&rdquo; and &ldquo;GSM&rdquo; all work.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => download("blazesync-roster-template.csv", toCsv([["Full name", "Matric number", "Email", "Phone", "Level"], ["Adaeze Okafor", "240805010", "adaeze.okafor@gmail.com", "08145678901", "300L"]]))}>
                <FileSpreadsheet aria-hidden className="size-4" /> Download the template
              </Button>
              <Button variant="ghost" size="sm" onClick={() => read(SAMPLE_ROSTER, "sample-100L-list.csv")}>
                Try a sample file
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {step === 1 && checked && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-md bg-credit-wash px-4 py-3">
              <CheckCircle2 aria-hidden className="mt-0.5 size-5 text-credit" />
              <p>
                <span className="block text-2xl font-bold">{checked.ok.length}</span>
                <span className="text-sm text-ink-2">{checked.ok.length === 1 ? "row is" : "rows are"} ready to add</span>
              </p>
            </div>
            <div className={`flex items-start gap-3 rounded-md px-4 py-3 ${checked.issues.length ? "bg-warn-wash" : "bg-sunken"}`}>
              <AlertTriangle aria-hidden className={`mt-0.5 size-5 ${checked.issues.length ? "text-warn" : "text-ink-3"}`} />
              <p>
                <span className="block text-2xl font-bold">{checked.issues.length}</span>
                <span className="text-sm text-ink-2">{checked.issues.length === 1 ? "row needs" : "rows need"} fixing, and won&apos;t be added</span>
              </p>
            </div>
          </div>

          {checked.issues.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold">Fix these in your sheet and upload again, or add them later</h2>
              <ul className="divide-y divide-rule rounded-md border border-rule bg-surface">
                {checked.issues.map((i) => (
                  <li key={i.line} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm">
                    <span className="text-ink-3">Row {i.line}</span>
                    <span>
                      <span className="font-semibold">{i.name}:</span> {i.problem}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {checked.ok.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold">Ready to add, from {checked.fileName}</h2>
              <div className="overflow-x-auto rounded-md border border-rule bg-surface">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="bg-sunken/60 text-left text-xs text-ink-2">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-semibold">Name</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Matric</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Level</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Invite goes to</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {checked.ok.slice(0, 8).map((r) => (
                      <tr key={r.line}>
                        <td className="px-4 py-2 font-medium">{r.name}</td>
                        <td className="px-4 py-2">{r.matric}</td>
                        <td className="px-4 py-2">{r.level}</td>
                        <td className="truncate px-4 py-2 text-ink-2">{[r.email, r.phone].filter(Boolean).join(" and ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {checked.ok.length > 8 && <p className="text-sm text-ink-3">And {plural(checked.ok.length - 8, "more")}.</p>}
            </section>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => setChecked(null)}>
              Choose a different file
            </Button>
            <Button
              disabled={!checked.ok.length}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                const r = await importRoster(assocId, checked.ok.map((r) => ({ name: r.name, matric: r.matric, email: r.email, phone: r.phone, level: r.level })), checked.fileName);
                setBusy(false);
                if (r.ok) {
                  setDone(r.value);
                  toast(`Added ${plural(r.value, "member")} to ${assoc.shortName}.`);
                }
              }}
            >
              Add {plural(checked.ok.length, "member")}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && done !== null && (
        <div className="space-y-5">
          <Callout tone="success" title={`${plural(done, "member")} added to ${assoc.shortName}`}>
            They&apos;re on the roster and will owe dues in any cycle you open. They haven&apos;t been invited yet.
          </Callout>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ButtonLink href="/exco/members?filter=not_joined">
              <MailPlus aria-hidden className="size-4" /> Send their invites
            </ButtonLink>
            <ButtonLink href="/exco/members" variant="secondary">
              Back to members
            </ButtonLink>
          </div>
        </div>
      )}
    </div>
  );
}
