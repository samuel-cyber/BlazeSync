/**
 * Demo data. Everything is generated relative to `now` so the demo never goes
 * stale: the open dues cycle always has weeks left, and the latest payment
 * always landed a few minutes ago. A seeded PRNG keeps it identical between
 * runs.
 *
 * This file is the only place mock data lives. When the FastAPI backend is
 * ready, the store swaps these for real responses (see docs/API-CONTRACT.md).
 */
/** The Expectation Statement shown on receipts for each seeded cycle (spec 2). */
const DEMO_STATEMENTS = new Map<string, string | null>([
  ["c_cssa_2627_1", "Funds the departmental freshers' welcome pack, tutorial folders and the inter-level football tournament."],
  ["c_cssa_2526_2", "Funded the 2025/26 second-semester project printing support and departmental welfare."],
  ["c_fssa_2627_1", "Funds the faculty week registration subsidies and inter-departmental sports gear."],
  ["c_fssa_2526_2", "Funded the faculty week welfare packs and transport grants."],
]);
import { issueHash } from "../receipt-hash";
import type {
  Association,
  AuditEvent,
  Channel,
  Disbursement,
  DuesCycle,
  ExcoMember,
  LedgerCategory,
  LedgerEntry,
  Level,
  MemberRecord,
  Payment,
  Receipt,
  ReconciliationRun,
  User,
} from "../types";

export interface DbState {
  users: User[];
  associations: Association[];
  exco: ExcoMember[];
  roster: MemberRecord[];
  cycles: DuesCycle[];
  payments: Payment[];
  receipts: Receipt[];
  ledger: LedgerEntry[];
  disbursements: Disbursement[];
  reconciliation: ReconciliationRun[];
  audit: AuditEvent[];
  /** Ecobank's view of the account balance, per association, in kobo. */
  bankBalance: Record<string, number>;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function inviteCode(rand: () => number): string {
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]).join("");
  return `${part()}-${part()}-${part()}`;
}

export function txRef(rand: () => number, prefix = "BSY"): string {
  return `${prefix}-${Math.floor(rand() * 36 ** 6)
    .toString(36)
    .toUpperCase()
    .padStart(6, "0")}${Math.floor(rand() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0")}`;
}

export const DEMO = {
  exco: "u_tunde",
  member: "u_adaeze",
  association: "a_cssa",
  claimCode: "K7QX-M2PA-9RTD",
  usedCode: "H4ND-Y2ZK-QP7C",
  expiredCode: "W9XE-P7RS-4TNV",
  joinCode: "CSSA-4821",
};

const CSSA_NAMES: [string, Level][] = [
  ["Adaeze Okafor", "300L"],
  ["Tunde Bakare", "400L"],
  ["Chiamaka Eze", "400L"],
  ["Fatima Bello", "400L"],
  ["Ibrahim Musa", "300L"],
  ["Oluwaseun Adeyemi", "300L"],
  ["Emeka Nwosu", "200L"],
  ["Zainab Abdullahi", "200L"],
  ["Kelechi Obi", "300L"],
  ["Temitope Ajayi", "200L"],
  ["Ngozi Uche", "400L"],
  ["Yusuf Garba", "100L"],
  ["Funmilayo Adebayo", "300L"],
  ["Chinedu Okeke", "200L"],
  ["Aisha Mohammed", "100L"],
  ["Babajide Ogunleye", "400L"],
  ["Ifeoma Nnamdi", "300L"],
  ["Segun Oladipo", "200L"],
  ["Halima Sani", "100L"],
  ["Obinna Chukwu", "400L"],
  ["Blessing Etim", "300L"],
  ["Damilola Ogundipe", "200L"],
  ["Nkechi Agu", "100L"],
  ["Abubakar Umar", "300L"],
  ["Toluwani Fashola", "200L"],
  ["Ebuka Anozie", "400L"],
  ["Kemi Adewale", "100L"],
  ["Musa Danjuma", "200L"],
  ["Precious Okon", "300L"],
  ["Uchenna Ibe", "400L"],
  ["Bukola Olatunji", "100L"],
  ["Samuel Akpan", "200L"],
  ["Hauwa Yakubu", "300L"],
  ["Chidera Onyeka", "100L"],
  ["Adebola Ogunbiyi", "400L"],
  ["Esther Bassey", "200L"],
  ["Ikenna Okonkwo", "300L"],
  ["Amina Lawal", "100L"],
  ["Victor Edet", "200L"],
  ["Ronke Salami", "400L"],
  ["Godwin Effiong", "300L"],
  ["Maryam Idris", "100L"],
  ["Tobi Adegoke", "200L"],
  ["Chioma Azubuike", "300L"],
  ["Sadiq Aliyu", "100L"],
  ["Folake Odukoya", "400L"],
  ["Nnamdi Ekwueme", "200L"],
  ["Rukayat Balogun", "100L"],
  ["David Oyelaran", "300L"],
  ["Ijeoma Madu", "200L"],
  ["Kabir Shehu", "100L"],
  ["Tolani Ayodele", "400L"],
];

const FSSA_EXTRA = [
  "Grace Umoh", "Peter Ogbu", "Hadiza Bala", "Femi Oyebanji", "Joy Nwachukwu", "Ahmed Tijani",
  "Sola Adeleke", "Onyinye Mbah", "Rasheed Lawal", "Patience Udo", "Dayo Ilesanmi", "Ebere Nwafor",
  "Zara Ahmadu", "Lekan Oyewole", "Chinonso Ude", "Mariam Ajibola", "Uduak Essien", "Wale Adisa",
  "Nneka Obiora", "Yemi Alade", "Kunle Afolabi", "Adanna Nwoye",
];

const LEVEL_YEAR: Record<Level, string> = { "100L": "26", "200L": "25", "300L": "24", "400L": "23", "500L": "22" };

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
}

export function createSeed(now: number): DbState {
  const rand = mulberry32(20260924);
  const iso = (t: number) => new Date(Math.round(t / 1000) * 1000).toISOString();

  // ------------------------------------------------------------ people
  const named: Record<string, User> = {
    u_tunde: { id: "u_tunde", name: "Tunde Bakare", email: "tunde.bakare@live.unilag.edu.ng", phone: "+2348031234567" },
    u_chiamaka: { id: "u_chiamaka", name: "Chiamaka Eze", email: "chiamaka.eze@live.unilag.edu.ng", phone: "+2348062345678" },
    u_fatima: { id: "u_fatima", name: "Fatima Bello", email: "fatima.bello@live.unilag.edu.ng", phone: "+2348093456789" },
    u_ibrahim: { id: "u_ibrahim", name: "Ibrahim Musa", email: "ibrahim.musa@live.unilag.edu.ng", phone: "+2348024567890" },
    u_adaeze: { id: "u_adaeze", name: "Adaeze Okafor", email: "adaeze.okafor@gmail.com", phone: "+2348145678901" },
  };
  const users: User[] = Object.values(named);
  const userIdFor = (name: string) => users.find((u) => u.name === name)?.id;

  // ------------------------------------------------------------ associations
  const termStart = now - 150 * DAY;
  const associations: Association[] = [
    {
      id: "a_cssa",
      name: "Computer Science Students' Association",
      shortName: "CSSA UNILAG",
      institution: "University of Lagos",
      faculty: "Faculty of Science",
      department: "Computer Sciences",
      joinCode: DEMO.joinCode,
      linkedAccount: {
        bank: "Ecobank",
        accountName: "CSSA UNILAG",
        last4: "3107",
        linkedAt: iso(termStart - 2 * DAY),
        linkedBy: "u_tunde",
        scopes: ["balance", "collect", "payout"],
      },
      approvalRule: { required: 2, of: 3 },
      createdAt: iso(termStart - 3 * DAY),
    },
    {
      id: "a_fssa",
      name: "Faculty of Science Students' Association",
      shortName: "FSSA UNILAG",
      institution: "University of Lagos",
      faculty: "Faculty of Science",
      department: "All departments",
      joinCode: "FSSA-1960",
      linkedAccount: {
        bank: "Ecobank",
        accountName: "FSSA UNILAG",
        last4: "8842",
        linkedAt: iso(termStart - 10 * DAY),
        linkedBy: "u_other",
        scopes: ["balance", "collect", "payout"],
      },
      approvalRule: { required: 3, of: 4 },
      createdAt: iso(termStart - 11 * DAY),
    },
    {
      id: "a_chess",
      name: "UNILAG Chess Club",
      shortName: "Chess Club UNILAG",
      institution: "University of Lagos",
      faculty: "Student Affairs",
      department: "Clubs and societies",
      joinCode: "CHESS-2207",
      linkedAccount: null,
      approvalRule: { required: 2, of: 2 },
      createdAt: iso(now - 2 * DAY),
    },
  ];

  const exco: ExcoMember[] = [
    { userId: "u_tunde", associationId: "a_cssa", title: "Treasurer", isSignatory: true, status: "active" },
    { userId: "u_chiamaka", associationId: "a_cssa", title: "Financial Secretary", isSignatory: true, status: "active" },
    { userId: "u_fatima", associationId: "a_cssa", title: "President", isSignatory: true, status: "active" },
    { userId: "u_ibrahim", associationId: "a_cssa", title: "Vice President", isSignatory: false, status: "active" },
    { userId: "u_tunde", associationId: "a_chess", title: "Treasurer", isSignatory: true, status: "active" },
  ];

  // ------------------------------------------------------------ roster
  const roster: MemberRecord[] = [];
  CSSA_NAMES.forEach(([name, level], i) => {
    const serial = String(10 + i * 3).padStart(3, "0");
    const known = userIdFor(name);
    // 38 of 52 have claimed their invite; 9 were sent but not claimed; 5 not sent.
    const claimed = i < 38;
    const sent = i < 47;
    let userId: string | null = null;
    if (claimed) {
      userId = known ?? `u_${slug(name).replace(/\./g, "_")}`;
      if (!known) users.push({ id: userId, name, email: `${slug(name)}@live.unilag.edu.ng`, phone: `+23480${String(30000000 + i * 7919).slice(0, 8)}` });
    }
    roster.push({
      id: `m_cssa_${i + 1}`,
      associationId: "a_cssa",
      name,
      matric: `${LEVEL_YEAR[level]}0805${serial}`,
      level,
      accountStatus: "none",
      linkedAccountRef: null,
      mandateStatus: null,
      mandateRef: null,
      email: known ? named[known].email : `${slug(name)}@live.unilag.edu.ng`,
      phone: known ? named[known].phone : `+23480${String(30000000 + i * 7919).slice(0, 8)}`,
      userId,
      invite: {
        status: claimed ? "claimed" : sent ? "sent" : "not_sent",
        code: name === "Adaeze Okafor" ? DEMO.usedCode : inviteCode(rand),
        sentAt: sent ? iso(termStart + 4 * DAY + i * 17 * MIN) : null,
        claimedAt: claimed ? iso(termStart + 4 * DAY + (i + 1) * 5 * HOUR) : null,
      },
      source: "roster",
    });
  });

  // The claim-flow demo: Ronke has never opened the app, but the treasurer
  // already marked her paid. That status has to carry over when she claims.
  roster.find((m) => m.name === "Ronke Salami")!.invite.code = DEMO.claimCode;
  const expired = roster.find((m) => m.name === "Nnamdi Ekwueme")!;
  expired.invite.code = DEMO.expiredCode;
  expired.invite.status = "expired";

  const fssaMembers = [...CSSA_NAMES.slice(0, 8).map(([n, l]) => [n, l] as [string, Level]), ...FSSA_EXTRA.map((n, i) => [n, (["100L", "200L", "300L", "400L"] as Level[])[i % 4]] as [string, Level])];
  fssaMembers.forEach(([name, level], i) => {
    const known = users.find((u) => u.name === name);
    roster.push({
      id: `m_fssa_${i + 1}`,
      associationId: "a_fssa",
      name,
      accountStatus: "none",
      linkedAccountRef: null,
      mandateStatus: null,
      mandateRef: null,
      matric: `${LEVEL_YEAR[level]}08${String(10 + (i % 6)).padStart(2, "0")}${String(100 + i * 7).slice(-3)}`,
      level,
      email: known ? known.email : `${slug(name)}@live.unilag.edu.ng`,
      phone: known ? known.phone : `+23481${String(40000000 + i * 6007).slice(0, 8)}`,
      userId: known?.id ?? null,
      invite: { status: known ? "claimed" : "sent", code: inviteCode(rand), sentAt: iso(termStart), claimedAt: known ? iso(termStart + DAY) : null },
      source: "roster",
    });
  });

  // ------------------------------------------------------------ cycles
  const cycles: DuesCycle[] = [
    {
      id: "c_cssa_2627_1",
      associationId: "a_cssa",
      expectationStatement: "Funds the departmental freshers' welcome pack, tutorial folders and the inter-level football tournament.",
      title: "2026/27 first semester dues",
      amount: 200_000,
      perLevel: { "100L": 300_000 },
      openedAt: iso(now - 18 * DAY),
      deadline: iso(startOfLagosDay(now + 37 * DAY) + 23 * HOUR + 59 * MIN),
      status: "open",
      closedAt: null,
    },
    {
      id: "c_cssa_2526_2",
      associationId: "a_cssa",
      expectationStatement: "Funded the 2025/26 second-semester project printing support and departmental welfare.",
      title: "2025/26 second semester dues",
      amount: 200_000,
      perLevel: null,
      openedAt: iso(termStart + 5 * DAY),
      deadline: iso(termStart + 45 * DAY),
      status: "closed",
      closedAt: iso(termStart + 46 * DAY),
    },
    {
      id: "c_fssa_2627_1",
      associationId: "a_fssa",
      expectationStatement: "Funds the faculty week registration subsidies and inter-departmental sports gear.",
      title: "2026/27 faculty dues",
      amount: 150_000,
      perLevel: null,
      openedAt: iso(now - 12 * DAY),
      deadline: iso(startOfLagosDay(now + 20 * DAY) + 23 * HOUR + 59 * MIN),
      status: "open",
      closedAt: null,
    },
    {
      id: "c_fssa_2526_2",
      associationId: "a_fssa",
      expectationStatement: "Funded the faculty week welfare packs and transport grants.",
      title: "2025/26 second semester faculty dues",
      amount: 150_000,
      perLevel: null,
      openedAt: iso(termStart + 8 * DAY),
      deadline: iso(termStart + 50 * DAY),
      status: "closed",
      closedAt: iso(termStart + 51 * DAY),
    },
  ];

  // ------------------------------------------------------------ money
  type Draft = Omit<LedgerEntry, "balanceAfter">;
  const drafts: Draft[] = [];
  const payments: Payment[] = [];
  const receipts: Receipt[] = [];
  const assocName = (id: string) => associations.find((a) => a.id === id)!.shortName;
  const cycleTitle = (id: string) => cycles.find((c) => c.id === id)!.title;

  const pay = (m: MemberRecord, cycleId: string, amount: number, channel: Channel, at: number, recordedBy: string | null = null, note: string | null = null) => {
    const ref = txRef(rand);
    const id = `p_${payments.length + 1}`;
    const receiptId = `r_${payments.length + 1}`;
    const issuedAt = iso(at);
    const payerId = m.id;
    const fee = channel === "bank_transfer" ? 5_000 : channel === "card" ? Math.round(amount * 0.015) + 3_500 : 0;
    payments.push({ id, associationId: m.associationId, cycleId, memberRecordId: m.id, amount, fee, channel, recordedBy, note, txRef: ref, paidAt: issuedAt, receiptId });
    receipts.push({
      id: receiptId,
      paymentId: id,
      payerName: m.name,
      payerId,
      associationId: m.associationId,
      associationName: assocName(m.associationId),
      cycleTitle: cycleTitle(cycleId),
      amount,
      fee,
      channel,
      txRef: ref,
      issuedAt,
      hash: issueHash({ payerId, amount, issuedAt, associationId: m.associationId, txRef: ref }),
      expectationStatement: cycleTitle(cycleId) ? DEMO_STATEMENTS.get(cycleId) ?? null : null,
    });
    drafts.push({
      id: `l_${drafts.length + 1}`,
      associationId: m.associationId,
      direction: "in",
      amount,
      category: "Dues",
      description: recordedBy ? `${cycleTitle(cycleId)}, recorded by exco` : cycleTitle(cycleId),
      counterparty: m.name,
      at: issuedAt,
      cashInHand: channel === "cash",
      paymentId: id,
      disbursementId: null,
      correctsEntryId: null,
    });
    return id;
  };

  const other = (associationId: string, direction: "in" | "out", amount: number, category: LedgerCategory, counterparty: string, description: string, at: number, disbursementId: string | null = null) => {
    const entry: Draft = {
      id: `l_${drafts.length + 1}`,
      associationId,
      direction,
      amount,
      category,
      description,
      counterparty,
      at: iso(at),
      cashInHand: false,
      paymentId: null,
      disbursementId,
      correctsEntryId: null,
    };
    drafts.push(entry);
    return entry;
  };

  // CSSA: handover, last cycle, spending, this cycle.
  other("a_cssa", "in", 14_125_000, "Opening balance", "2025/26 exco (outgoing)", "Balance handed over by the outgoing exco", termStart + 2 * HOUR);

  const cssa = roster.filter((r) => r.associationId === "a_cssa");
  const channelPick = (): Channel => {
    const x = rand();
    return x < 0.72 ? "blaze" : x < 0.9 ? "bank_transfer" : "card";
  };
  cssa.slice(0, 44).forEach((m, i) => {
    const t = termStart + 5 * DAY + Math.floor((i / 44) * 38 * DAY) + Math.floor(rand() * 9 * HOUR);
    pay(m, "c_cssa_2526_2", 200_000, m.userId ? channelPick() : "direct_transfer", t, m.userId ? null : "u_tunde", m.userId ? null : "Transferred straight to the association account");
  });

  const disbursements: Disbursement[] = [];
  const addDisb = (d: Omit<Disbursement, "id" | "associationId" | "idempotencyKey" | "failureReason" | "completedAt"> & { completedAt?: number | null }) => {
    const id = `d_${disbursements.length + 1}`;
    const full: Disbursement = {
      ...d,
      id,
      associationId: "a_cssa",
      idempotencyKey: `idem_${Math.floor(rand() * 1e12).toString(36)}`,
      failureReason: null,
      completedAt: d.completedAt ? iso(d.completedAt) : null,
    };
    disbursements.push(full);
    if (full.status === "completed" && d.completedAt) {
      other("a_cssa", "out", full.amount, full.category, full.recipient.accountName, full.reason, d.completedAt, id);
    }
    return full;
  };

  const signed = (userId: string, at: number, note: string | null = null) => ({ userId, decision: "approve" as const, at: iso(at), note });

  addDisb({
    amount: 3_850_000,
    category: "Printing",
    reason: "Past questions booklet, 300 copies",
    recipient: { accountName: "Yaba Quick Prints", bank: "Access Bank", accountNumber: "0123456789" },
    requestedBy: "u_tunde",
    requestedAt: iso(termStart + 20 * DAY),
    approvals: [signed("u_tunde", termStart + 20 * DAY), signed("u_chiamaka", termStart + 20 * DAY + 3 * HOUR)],
    required: 2,
    status: "completed",
    completedAt: termStart + 20 * DAY + 3 * HOUR + 4 * MIN,
  });

  other("a_cssa", "in", 10_000_000, "Sponsorship", "Lagos Tech Alumni Network", "CS Week sponsorship", termStart + 50 * DAY);

  addDisb({
    amount: 6_000_000,
    category: "Event",
    reason: "CS Week: Main Auditorium booking, 2 days",
    recipient: { accountName: "University of Lagos Works Dept", bank: "Ecobank", accountNumber: "2041188730" },
    requestedBy: "u_fatima",
    requestedAt: iso(termStart + 53 * DAY),
    approvals: [signed("u_fatima", termStart + 53 * DAY), signed("u_tunde", termStart + 53 * DAY + 5 * HOUR)],
    required: 2,
    status: "completed",
    completedAt: termStart + 53 * DAY + 5 * HOUR + 2 * MIN,
  });
  addDisb({
    amount: 4_500_000,
    category: "Event",
    reason: "CS Week: refreshments for 120 guests",
    recipient: { accountName: "Mama Put Premium Catering", bank: "Moniepoint MFB", accountNumber: "5091827364" },
    requestedBy: "u_chiamaka",
    requestedAt: iso(termStart + 55 * DAY),
    approvals: [signed("u_chiamaka", termStart + 55 * DAY), signed("u_fatima", termStart + 55 * DAY + 1 * HOUR)],
    required: 2,
    status: "completed",
    completedAt: termStart + 55 * DAY + 1 * HOUR + 3 * MIN,
  });
  addDisb({
    amount: 2_500_000,
    category: "Welfare",
    reason: "Hospital bill support for a 200L member (name withheld)",
    recipient: { accountName: "LUTH Cashier", bank: "First Bank", accountNumber: "3012345678" },
    requestedBy: "u_tunde",
    requestedAt: iso(termStart + 92 * DAY),
    approvals: [signed("u_tunde", termStart + 92 * DAY), signed("u_fatima", termStart + 92 * DAY + 40 * MIN)],
    required: 2,
    status: "completed",
    completedAt: termStart + 92 * DAY + 42 * MIN,
  });
  addDisb({
    amount: 3_200_000,
    category: "Transport",
    reason: "Quiz team bus to UNIBEN inter-varsity competition",
    recipient: { accountName: "GIGM Charter", bank: "Zenith Bank", accountNumber: "1019283746" },
    requestedBy: "u_chiamaka",
    requestedAt: iso(now - 22 * DAY),
    approvals: [signed("u_chiamaka", now - 22 * DAY), signed("u_tunde", now - 22 * DAY + 2 * HOUR)],
    required: 2,
    status: "completed",
    completedAt: now - 22 * DAY + 2 * HOUR + 5 * MIN,
  });

  // This cycle: 29 of 52 paid. Four of those are cash payments recorded by an
  // exco for people who have not joined the app; two of those are still cash
  // in hand. Adaeze has not paid yet (she pays in the demo).
  const cycleOpen = now - 18 * DAY;
  const payers = cssa.filter((m) => m.name !== "Adaeze Okafor");
  const appPayers = payers.filter((m) => m.userId).slice(0, 25);
  const cashPayers = payers.filter((m) => !m.userId).slice(0, 4);
  const amountFor = (m: MemberRecord) => (m.level === "100L" ? 300_000 : 200_000);
  const schedule: [MemberRecord, Channel, number][] = [];
  appPayers.forEach((m, i) => {
    const t = cycleOpen + Math.floor(Math.pow(i / 25, 0.8) * 17.6 * DAY) + Math.floor(rand() * 3 * HOUR);
    schedule.push([m, channelPick(), t]);
  });
  cashPayers.forEach((m, i) => schedule.push([m, i < 2 ? "direct_transfer" : "cash", now - (9 - i * 2) * DAY - 3 * HOUR]));
  schedule.sort((a, b) => a[2] - b[2]);
  // The newest payment lands a few minutes before the demo opens.
  schedule[schedule.length - 1][2] = now - 6 * MIN;
  schedule.forEach(([m, ch, t]) =>
    pay(m, "c_cssa_2627_1", amountFor(m), ch, Math.min(t, now - 6 * MIN), ch === "cash" || ch === "direct_transfer" ? "u_tunde" : null, ch === "cash" ? "Collected at the 300L class meeting" : ch === "direct_transfer" ? "Transferred straight to the association account" : null),
  );

  // An append-only correction: a cash payment was entered twice by hand.
  const dupSource = payments.find((p) => p.cycleId === "c_cssa_2627_1" && p.channel === "cash")!;
  const dupEntry = other("a_cssa", "in", dupSource.amount, "Dues", roster.find((r) => r.id === dupSource.memberRecordId)!.name, "2026/27 first semester dues, recorded by exco (entered twice)", new Date(dupSource.paidAt).getTime() + 4 * MIN);
  dupEntry.cashInHand = true;
  const corr = other("a_cssa", "out", dupSource.amount, "Correction", dupEntry.counterparty, "Reverses a duplicate cash entry", new Date(dupSource.paidAt).getTime() + 2 * HOUR);
  corr.correctsEntryId = dupEntry.id;
  corr.cashInHand = true;

  // FSSA: a smaller ledger for the member's second association.
  other("a_fssa", "in", 31_240_000, "Opening balance", "2025/26 exco (outgoing)", "Balance handed over by the outgoing exco", termStart - 9 * DAY);
  const fssa = roster.filter((r) => r.associationId === "a_fssa");
  fssa.forEach((m, i) => {
    if (i % 5 === 4) return;
    pay(m, "c_fssa_2526_2", 150_000, m.userId ? "blaze" : "bank_transfer", termStart + 9 * DAY + i * 31 * HOUR);
  });
  other("a_fssa", "out", 12_000_000, "Event", "Faculty Games Committee", "Faculty games: jerseys and medals", termStart + 70 * DAY);
  fssa.forEach((m, i) => {
    if (i % 3 === 2) return;
    pay(m, "c_fssa_2627_1", 150_000, m.userId ? "blaze" : "bank_transfer", now - 12 * DAY + i * 11 * HOUR);
  });

  // Stamp running balances, oldest first.
  drafts.sort((a, b) => a.at.localeCompare(b.at));
  const running: Record<string, number> = {};
  const ledger: LedgerEntry[] = drafts.map((d) => {
    running[d.associationId] = (running[d.associationId] ?? 0) + (d.direction === "in" ? d.amount : -d.amount);
    return { ...d, balanceAfter: running[d.associationId] };
  });

  // ------------------------------------------------------------ open payouts
  addDisb({
    amount: 4_800_000,
    category: "Event",
    reason: "Freshers' welcome: branded T-shirts for 100L, 60 pieces",
    recipient: { accountName: "Adire Threads Ltd", bank: "GTBank", accountNumber: "0234567891" },
    requestedBy: "u_chiamaka",
    requestedAt: iso(now - 3 * HOUR - 12 * MIN),
    approvals: [signed("u_chiamaka", now - 3 * HOUR - 12 * MIN, "Quote attached in the exco group. Cheapest of three.")],
    required: 2,
    status: "pending",
  });
  addDisb({
    amount: 1_500_000,
    category: "Printing",
    reason: "2026/27 course registration guide, 150 copies",
    recipient: { accountName: "Yaba Quick Prints", bank: "Access Bank", accountNumber: "0123456789" },
    requestedBy: "u_tunde",
    requestedAt: iso(now - 26 * HOUR),
    approvals: [signed("u_tunde", now - 26 * HOUR)],
    required: 2,
    status: "pending",
  });
  addDisb({
    amount: 12_000_000,
    category: "Event",
    reason: "Sound system rental for Freshers' night",
    recipient: { accountName: "Loud Nation Events", bank: "UBA", accountNumber: "2087654321" },
    requestedBy: "u_ibrahim",
    requestedAt: iso(now - 4 * DAY),
    approvals: [
      { userId: "u_fatima", decision: "reject", at: iso(now - 3 * DAY - 20 * HOUR), note: "This quote is double what we paid last year. Get a second quote and resubmit." },
    ],
    required: 2,
    status: "rejected",
  });

  // ------------------------------------------------------------ reconciliation
  const bankBalance: Record<string, number> = {};
  for (const a of associations) {
    const entries = ledger.filter((l) => l.associationId === a.id);
    const bal = entries.length ? entries[entries.length - 1].balanceAfter : 0;
    const cash = cashInHandFor(ledger, a.id);
    bankBalance[a.id] = bal - cash;
  }
  const reconciliation: ReconciliationRun[] = [];
  for (let i = 0; i < 12; i++) {
    const at = now - (2 * MIN + i * 15 * MIN);
    const bal = balanceAt(ledger, "a_cssa", at);
    const cash = cashInHandFor(ledger.filter((l) => l.at <= iso(at)), "a_cssa");
    reconciliation.push({ id: `rc_${i}`, associationId: "a_cssa", at: iso(at), ledgerBalance: bal, cashInHand: cash, bankBalance: bal - cash, result: "match" });
  }
  {
    const at = now - 2 * DAY - 5 * HOUR;
    const bal = balanceAt(ledger, "a_cssa", at);
    const cash = cashInHandFor(ledger.filter((l) => l.at <= iso(at)), "a_cssa");
    reconciliation.push({ id: "rc_drift", associationId: "a_cssa", at: iso(at), ledgerBalance: bal, cashInHand: cash, bankBalance: bal - cash + 200_000, result: "drift" });
  }

  // ------------------------------------------------------------ audit trail
  const audit: AuditEvent[] = [];
  const log = (actor: string, action: AuditEvent["action"], summary: string, at: number, ip: string | null = "102.89.34.12") =>
    audit.push({ id: `au_${audit.length + 1}`, associationId: "a_cssa", actor, action, summary, at: iso(at), ip });
  log("u_tunde", "account_linked", "Linked the Ecobank business account ending 3107", termStart - 2 * DAY);
  log("u_tunde", "rule_changed", "Set payouts to need 2 of 3 signatures", termStart - 2 * DAY + 10 * MIN);
  log("u_tunde", "exco_invited", "Added Chiamaka Eze and Fatima Bello as signatories", termStart - 2 * DAY + 14 * MIN);
  log("u_tunde", "roster_uploaded", "Uploaded a roster of 52 members from cssa-2025-26.csv", termStart + 4 * DAY - 30 * MIN);
  log("u_tunde", "invites_sent", "Sent 47 invites by email and SMS", termStart + 4 * DAY);
  for (const d of disbursements) {
    log(d.requestedBy, "payout_requested", `Requested ${fmtK(d.amount)} for ${d.reason}`, new Date(d.requestedAt).getTime());
    for (const a of d.approvals.slice(d.approvals[0]?.userId === d.requestedBy ? 1 : 0)) {
      log(a.userId, a.decision === "approve" ? "payout_approved" : "payout_rejected", `${a.decision === "approve" ? "Signed" : "Rejected"} the ${fmtK(d.amount)} payout for ${d.reason}`, new Date(a.at).getTime());
    }
    if (d.completedAt) log("system", "payout_completed", `Ecobank confirmed the ${fmtK(d.amount)} payout to ${d.recipient.accountName}`, new Date(d.completedAt).getTime(), null);
  }
  log("u_tunde", "cycle_opened", "Opened 2026/27 first semester dues: ₦2,000, ₦3,000 for 100L", now - 18 * DAY);
  for (const p of payments.filter((p) => p.recordedBy && p.associationId === "a_cssa" && p.cycleId === "c_cssa_2627_1")) {
    log(p.recordedBy!, "payment_recorded", `Marked ${roster.find((r) => r.id === p.memberRecordId)!.name} as paid (${p.channel === "cash" ? "cash" : "direct transfer"})`, new Date(p.paidAt).getTime());
  }
  log("u_chiamaka", "signed_in", "Signed in on a new device (Tecno Spark 20, Chrome)", now - 3 * HOUR - 20 * MIN, "105.112.45.201");
  log("u_tunde", "signed_in", "Signed in", now - 25 * MIN);
  audit.sort((a, b) => b.at.localeCompare(a.at));

  return { users, associations, exco, roster, cycles, payments, receipts, ledger, disbursements, reconciliation: reconciliation.sort((a, b) => b.at.localeCompare(a.at)), audit, bankBalance };
}

function fmtK(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG")}`;
}

export function cashInHandFor(ledger: LedgerEntry[], associationId: string): number {
  return ledger
    .filter((l) => l.associationId === associationId && l.cashInHand)
    .reduce((s, l) => s + (l.direction === "in" ? l.amount : -l.amount), 0);
}

function balanceAt(ledger: LedgerEntry[], associationId: string, at: number): number {
  const iso = new Date(at).toISOString();
  const entries = ledger.filter((l) => l.associationId === associationId && l.at <= iso);
  return entries.length ? entries[entries.length - 1].balanceAfter : 0;
}

/** Midnight in Lagos (UTC+1, no DST). */
function startOfLagosDay(t: number): number {
  const lagos = t + HOUR;
  return lagos - (lagos % DAY) - HOUR;
}
