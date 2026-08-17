/**
 * Pure formatting/validation helpers (spec §10).
 *
 * No React, no storage, no locale data — everything here is deterministic so it
 * renders identically on the server, in the browser, and inside the PDF.
 */

const GSTIN_PATTERN =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

/** Round to 2 decimals (paise) via integer paise, avoiding float drift (§12). */
export function round2(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * Indian digit grouping: last three digits, then groups of two.
 * 1234567.5 -> "12,34,567.50"; 1250 -> "1,250.00".
 */
export function formatINR(x: number): string {
  const value = Number.isFinite(x) ? round2(x) : 0;
  const sign = value < 0 ? "-" : "";
  const [intPart, decPart] = Math.abs(value).toFixed(2).split(".");
  return `${sign}${groupIndian(intPart)}.${decPart}`;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  // Insert a comma every two digits across the remaining (higher) digits.
  return `${rest.replace(/\B(?=(?:\d{2})+$)/g, ",")},${last3}`;
}

/**
 * Indian-system amount in words (lakh/crore), e.g.
 * 123456.50 -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only".
 * Paise are included only when non-zero.
 */
export function amountInWords(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const negative = safe < 0;

  // Work in integer paise so 0.1 + 0.2 style drift can never shift a rupee.
  const totalPaise = Math.round(Math.abs(safe) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  const rupeeWords = rupees === 0 ? "Zero" : indianWords(rupees);
  const paiseWords = paise > 0 ? ` and ${indianWords(paise)} Paise` : "";

  return `${negative ? "Minus " : ""}Rupees ${rupeeWords}${paiseWords} Only`;
}

/** Breakpoints: crore = // 1,00,00,000; lakh = // 1,00,000; thousand = // 1,000; then hundreds. */
function indianWords(n: number): string {
  const parts: string[] = [];

  const crore = Math.floor(n / 10000000);
  let rest = n % 10000000;
  if (crore > 0) {
    // Recurse so values above 999 crore still read correctly ("One Thousand Crore").
    parts.push(`${indianWords(crore)} Crore`);
  }

  const lakh = Math.floor(rest / 100000);
  rest %= 100000;
  if (lakh > 0) parts.push(`${belowThousand(lakh)} Lakh`);

  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand > 0) parts.push(`${belowThousand(thousand)} Thousand`);

  if (rest > 0) parts.push(belowThousand(rest));

  return parts.join(" ");
}

function belowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) parts.push(belowHundred(rest));
  return parts.join(" ");
}

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const unit = n % 10;
  return unit > 0 ? `${tens} ${ONES[unit]}` : tens;
}

/**
 * ISO date (`YYYY-MM-DD`) to the DD/MM/YYYY an Indian invoice is read in.
 *
 * Split from the string rather than parsed into a Date on purpose: `new Date()`
 * would apply the runtime's time zone, so an invoice dated the 1st could render
 * as the 31st on a server in a different zone. Anything that is not an ISO date
 * is passed through untouched, and a blank date renders as an em dash.
 */
export function formatDisplayDate(iso: string): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/**
 * GSTIN format check: 15 chars — 2-digit state code, 5 letters (PAN), 4 digits,
 * 1 letter, 1 entity char, literal "Z", 1 checksum char. Surfaced as a Zod
 * refinement in lib/validation.ts.
 */
export function isValidGstin(g: string): boolean {
  if (typeof g !== "string") return false;
  return GSTIN_PATTERN.test(g.trim());
}

/** First two digits of a GSTIN encode the state code — used for the §4 mismatch warning. */
export function gstinStateCode(g: string): string | null {
  const trimmed = typeof g === "string" ? g.trim() : "";
  return isValidGstin(trimmed) ? trimmed.slice(0, 2) : null;
}
