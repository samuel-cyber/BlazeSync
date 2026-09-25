import type { Level } from "./types";

/** RFC 4180-ish: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/**
 * Spreadsheet-safe CSV. A cell starting with = + - @ (or a tab or return) is
 * run as a formula by Excel and Sheets, so a member named "=HYPERLINK(...)"
 * would execute on the treasurer's laptop. Prefixing ' makes it plain text,
 * which also stops +234 phone numbers turning into 2.34E+12.
 */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let t = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export function download(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Col = "name" | "matric" | "email" | "phone" | "level";

const HEADERS: Record<Col, RegExp> = {
  name: /^(full\s*)?name$|^student(\s*name)?$|^surname.*first/i,
  matric: /matric|reg(istration)?\s*(no|number)?|student\s*id/i,
  email: /e-?mail/i,
  phone: /phone|mobile|gsm|whatsapp/i,
  level: /^level$|^year$|^class$/i,
};

export function mapColumns(header: string[]): Partial<Record<Col, number>> {
  const out: Partial<Record<Col, number>> = {};
  header.forEach((h, i) => {
    for (const [col, re] of Object.entries(HEADERS) as [Col, RegExp][]) {
      if (out[col] === undefined && re.test(h.trim())) out[col] = i;
    }
  });
  return out;
}

export interface RosterRow {
  line: number;
  name: string;
  matric: string;
  email: string;
  phone: string;
  level: Level;
}

export interface RowIssue {
  line: number;
  name: string;
  problem: string;
}

export function normalisePhone(raw: string): string | null {
  const d = raw.replace(/[\s()-]/g, "");
  if (/^0[789][01]\d{8}$/.test(d)) return `+234${d.slice(1)}`;
  if (/^\+?234[789][01]\d{8}$/.test(d)) return `+${d.replace(/^\+/, "")}`;
  return null;
}

function normaliseLevel(raw: string): Level | null {
  const m = raw.trim().match(/^([1-5])00\s*l?(evel)?$/i);
  return m ? (`${m[1]}00L` as Level) : null;
}

/** Validates every row and says, per row, what to fix. Nothing is silently dropped. */
export function validateRoster(rows: string[][], existingMatrics: Set<string>) {
  const [header, ...body] = rows;
  const cols = mapColumns(header ?? []);
  const missing = (["name", "matric"] as Col[]).filter((c) => cols[c] === undefined);
  if (cols.email === undefined && cols.phone === undefined) missing.push("email");
  const ok: RosterRow[] = [];
  const issues: RowIssue[] = [];
  const seen = new Set<string>();
  body.forEach((r, i) => {
    const line = i + 2;
    const get = (c: Col) => (cols[c] !== undefined ? (r[cols[c]!] ?? "").trim() : "");
    const name = get("name");
    const matric = get("matric").toUpperCase();
    const email = get("email").toLowerCase();
    const phoneRaw = get("phone");
    const phone = phoneRaw ? normalisePhone(phoneRaw) : "";
    const level = normaliseLevel(get("level"));
    const who = name || `Row ${line}`;
    if (!name) return issues.push({ line, name: who, problem: "No name." });
    if (!matric) return issues.push({ line, name: who, problem: "No matric number." });
    if (seen.has(matric)) return issues.push({ line, name: who, problem: `Matric ${matric} appears twice in this file.` });
    if (existingMatrics.has(matric)) return issues.push({ line, name: who, problem: `Matric ${matric} is already on the roster. Skipped so they aren't billed twice.` });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return issues.push({ line, name: who, problem: `"${email}" isn't a valid email address.` });
    if (phoneRaw && !phone) return issues.push({ line, name: who, problem: `"${phoneRaw}" isn't a Nigerian mobile number.` });
    if (!email && !phone) return issues.push({ line, name: who, problem: "No email or phone, so there's nowhere to send their invite." });
    if (!level) return issues.push({ line, name: who, problem: `Level "${get("level")}" should look like 100L, 200L, 300L or 400L.` });
    seen.add(matric);
    ok.push({ line, name, matric, email, phone: phone || "", level });
  });
  return { ok, issues, missing, cols };
}

export const SAMPLE_ROSTER = `Full name,Matric number,Email,Phone,Level
Oreoluwa Adekunle,260805301,oreoluwa.adekunle@live.unilag.edu.ng,08031112233,100L
Chukwuemeka Obi,260805304,,0805 444 5566,100L
Aminat Olawale,260805307,aminat.olawale@live.unilag.edu.ng,,100L
Daniel Effiong,260805310,daniel.effiong@live.unilag.edu.ng,07062223344,100L
Hafsat Sule,260805313,hafsat.sule@live.unilag.edu.ng,09012345678,100L
Ifeanyi Nwankwo,260805316,,,100L
Jumoke Bankole,260805319,jumoke.bankole@gmail,08123456789,100L
Adaeze Okafor,240805010,adaeze.okafor@gmail.com,08145678901,300L
Kingsley Udo,260805322,kingsley.udo@live.unilag.edu.ng,08167778899,100L
Lara Ogunsanya,260805325,lara.ogunsanya@live.unilag.edu.ng,08029990011,100L
Mubarak Ibrahim,260805328,mubarak.ibrahim@live.unilag.edu.ng,07031231234,100L
Nneoma Chukwu,260805331,nneoma.chukwu@live.unilag.edu.ng,08094564567,100L
`;
