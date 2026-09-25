export const NIGERIAN_BANKS = [
  "Access Bank",
  "Ecobank",
  "Fidelity Bank",
  "First Bank",
  "FCMB",
  "GTBank",
  "Kuda MFB",
  "Moniepoint MFB",
  "OPay",
  "PalmPay",
  "Polaris Bank",
  "Stanbic IBTC",
  "Sterling Bank",
  "UBA",
  "Union Bank",
  "Wema Bank",
  "Zenith Bank",
];

const KNOWN: Record<string, string> = {
  "0234567891": "ADIRE THREADS LTD",
  "0123456789": "YABA QUICK PRINTS",
  "5091827364": "MAMA PUT PREMIUM CATERING",
  "2087654321": "LOUD NATION EVENTS",
};

const NAMES = ["AKOKA PRINT HUB", "OLUWASEGUN ADEWALE", "CAMPUS BUS SERVICES", "CHINONSO EZE", "SWEET SENSATION AKOKA", "MUSA ABUBAKAR"];

/**
 * Stand-in for the bank's account-name lookup (NIP name enquiry). The real
 * version goes through the backend, which calls Ecobank; the screen only
 * needs the name back so the exco can confirm they're paying the right person.
 */
export async function lookupAccountName(bank: string, accountNumber: string): Promise<string | null> {
  await new Promise((r) => setTimeout(r, 800));
  if (!/^\d{10}$/.test(accountNumber) || !bank) return null;
  if (accountNumber === "0000000000") return null;
  if (KNOWN[accountNumber]) return KNOWN[accountNumber];
  const sum = accountNumber.split("").reduce((s, d) => s + Number(d), 0);
  return NAMES[sum % NAMES.length];
}
