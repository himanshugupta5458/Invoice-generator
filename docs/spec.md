# Project System Prompt — Saara Collection Invoice Tool

You are the engineer building **InvoiceGen**, a web app for generating GST-compliant
tax invoices for Indian businesses. You are working inside a codespace. Build the whole
application, keep it deployable to Vercel at every step, and follow this spec precisely.
When something here is ambiguous, prefer the simplest option that keeps the app working
and deployable, and leave a clearly marked `// TODO:` note rather than inventing scope.

---

## 1. Mission

A small-business owner should be able to:
1. Save one or more **business profiles** once (name, address, GSTIN, bank details).
2. Start a new invoice, **pick a business profile from a dropdown**.
3. Enter the **buyer (Bill To)**, optionally a separate **Ship To**, and a list of
   **items** (description, optional HSN, quantity, per-unit price, GST rate).
4. See **totals calculated live** (taxable value, CGST/SGST or IGST, round-off, grand total, amount in words).
5. **Download a clean PDF** of the invoice.
6. Track whether an invoice is **paid or unpaid**.

Everything runs in the browser + Vercel serverless. No login for v1. No database for
v1 — see §7. Only move to a database later, after testing is done, and only if actually
required; do not build it now.

---

## 2. Tech stack (use exactly this unless a hard blocker appears)

- **Next.js (latest stable, App Router) + TypeScript** — Vercel's native framework.
- **Tailwind CSS** for styling.
- **React Hook Form + Zod** for all forms and validation.
- **@react-pdf/renderer** for PDF generation (vector text, selectable, no headless browser — works on Vercel with zero config).
- **Zustand** for app state; **localStorage** for persistence (see §7).
- **Vitest** for unit tests (GST math and helpers must be tested).

Do not add a database, auth provider, or paid service in v1.

---

## 3. Architecture & file structure

app/
layout.tsx
page.tsx # Invoice builder (home)
settings/page.tsx # Business profiles CRUD + Buyers tab + Export/Import
buyers/page.tsx # (or a tab under settings) Saved buyers CRUD
invoices/page.tsx # Saved invoice history (list + re-download + paid/unpaid toggle)
components/
invoice/InvoiceForm.tsx
invoice/ItemsTable.tsx
invoice/CsvImportButton.tsx     # bulk-add items from a CSV (client-side parse)
invoice/BuyerSelect.tsx # searchable combobox of saved buyers + add-new
invoice/ShipToSection.tsx # "same as billing" toggle + Ship To fields
invoice/InvoicePreview.tsx # on-screen HTML preview (accent-themed)
invoice/InvoicePdf.tsx # @react-pdf/renderer document (accent-themed)
settings/BusinessProfileForm.tsx
settings/ColorPicker.tsx # preset swatches + custom hex / native picker
settings/BuyerForm.tsx
ui/ # small shared inputs, buttons
lib/
types.ts # all TypeScript interfaces (§5)
gst.ts # tax calc engine (§6) — pure functions, fully tested
format.ts # currency + amount-in-words (§10) — pure, fully tested
color.ts # accent presets + luminance/contrast helper
repository.ts # Repository interface + LocalStorageRepository (§7)
store.ts # Zustand store wired to the repository
validation.ts # Zod schemas incl. GSTIN check
csv.ts # CSV -> invoice items parser (§4) — pure, fully tested
tests/
gst.test.ts
format.test.ts
csv.test.ts


Keep `lib/gst.ts` and `lib/format.ts` **pure** (no React, no storage) so they are trivially testable.

---

## 4. Core user stories (definition of the flows)

**Business configuration (do once):**
- On `/settings` the user can create, edit, and delete **business profiles**.
- Fields: business name, address, city, state (+ 2-digit state code), GSTIN, phone, email,
  bank {account name, account number, IFSC, bank name, UPI}, optional logo (base64),
  invoice number prefix (e.g. `SC/2026/`), next running number, a default
  **terms and conditions** text block, and an **accent colour** (see below).
- Validate GSTIN format and warn if the GSTIN's first two digits don't match the state code.

**Colour preference (per business profile):**
- In the business-profile form the user picks an **accent colour** for that business's invoices.
- Offer a small preset palette (e.g. warm brown, indigo, teal, maroon, slate, black) **plus a
  custom hex input / native colour picker**. Store it as `accentColor` on the profile.
- The chosen colour drives the invoice heading rule, table header, and grand-total band in
  BOTH the on-screen preview and the PDF. Everything else stays neutral for print legibility.
- Enforce a readable default (`#7a5230`) and guard against unreadable choices (e.g. keep
  header text white on the accent band; if the accent is very light, fall back to dark text).

**Buyer management (buyers are stored and reusable):**
- On `/settings` (a "Buyers" tab) or a dedicated `/buyers` page, the user can create, edit, and
  delete **saved buyers**. A buyer is persisted (see §7), not just typed per invoice.
- Fields: name, address, state (+ state code), optional GSTIN, optional phone.

**Create invoice:**
- On `/` the user selects a saved business profile from a **dropdown** (required before anything else).
- The user then either **picks an existing buyer from a searchable dropdown** (which auto-fills
  the Bill To fields) **or enters a new buyer**. Offer a "Save this buyer for next time" toggle that
  persists a new buyer, and keep saved buyers editable inline without mutating past invoices.
- **Ship To**: optional block below Bill To, with a "Same as Bill To" toggle checked by default.
  When unchecked, the user enters a separate name, address, state, and optional GSTIN for
  the shipping party. Ship To is **display-only** — it never affects the CGST/SGST vs IGST
  decision, which is always based on the Bill To buyer's state (see §6).
- Invoice number auto-fills from the profile's prefix + next number; editable.
- Date defaults to today; editable.
- **Items table** with add/remove rows. Each row: description, HSN/SAC, quantity, rate (pre-tax), GST rate (%). Provide a GST-rate select with the standard slabs: 0, 3, 5, 12, 18, 28.
  **HSN/SAC is optional** — a blank code must never block a save. It is shown in the items
  table, the preview, and the PDF when present, and rendered as "—" when it is not.
- **CSV bulk upload** — a button on the items table takes a `.csv` whose columns match
  `InvoiceItem`: `description, hsn, quantity, rate, gstRate`. Parsing is **pure client-side**
  (`lib/csv.ts`) — no upload, no backend, no new dependency. Header matching is
  case/punctuation-insensitive and accepts the obvious aliases (`qty`, `price`, `gst %`,
  `hsn/sac`); column order does not matter and `hsn` may be absent entirely.
  Every row is validated against the same `invoiceItemFormSchema` the table uses; **valid rows
  are appended and invalid rows are reported**, never silently dropped. A malformed or
  non-CSV file produces a plain error message, never a crash.
- Totals recompute live on every change (§6).
- **Terms & Conditions**: seller-only. The invoice builder has **no** T&C field. Every invoice
  uses its business profile's default `termsAndConditions` verbatim, frozen into the snapshot
  at save time. The text is edited in one place only: the business profile on `/settings`.
- Buttons: **Preview**, **Download PDF**, **Save invoice** (persists to history, defaults
  status to `paid`, and increments the profile's next number). The paid/unpaid flag itself
  stays — only the default at save time is `paid`; anything unpaid is switched from `/invoices`.

**History:**
- `/invoices` lists saved invoices (number, date, buyer, grand total, **status**) with a
  re-download-PDF action and a **Mark as Paid / Unpaid toggle**.
- A saved invoice stores a **snapshot** of the buyer, ship-to, business details, and terms
  used, so editing a saved buyer or profile later never changes an already-issued invoice.

---

## 5. Data models (`lib/types.ts`)

```ts
export interface BankDetails {
  accountName: string; accountNo: string; ifsc: string; bankName: string; upi: string;
}
export interface BusinessProfile {
  id: string;
  name: string; address: string; city: string;
  state: string; stateCode: string;        // stateCode = 2 digits, e.g. "27"
  gstin: string; phone: string; email: string;
  bank: BankDetails;
  logoDataUrl?: string;
  invoicePrefix: string;                    // e.g. "SC/2026/"
  nextInvoiceNumber: number;                // e.g. 1
  accentColor: string;                      // hex, e.g. "#7a5230" — drives invoice theming
  termsAndConditions?: string;               // default T&C text — editable only in /settings
}
export interface Buyer {
  name: string; address: string;
  state: string; stateCode: string;
  gstin?: string; phone?: string;
}
// A Buyer that has been saved/reused. Kept separate so an Invoice can embed a
// plain Buyer snapshot without carrying a store id.
export interface SavedBuyer extends Buyer {
  id: string;
}
// Shipping party. Same shape as Buyer; kept as a distinct type for clarity at
// call sites even though the fields are identical.
export interface ShipTo {
  name: string; address: string;
  state: string; stateCode: string;
  gstin?: string;
}
export interface InvoiceItem {
  description: string;
  hsn?: string;                             // optional — never required to save
  quantity: number; rate: number;           // rate is PER-UNIT, pre-tax
  gstRate: number;                          // total GST %, e.g. 12
}
export type InvoiceStatus = "unpaid" | "paid";

export interface Invoice {
  id: string;
  invoiceNumber: string; date: string;      // ISO date
  businessProfileId: string;                // reference (for history grouping)
  businessSnapshot: BusinessProfile;        // frozen copy at issue time
  buyer: Buyer;                             // frozen copy at issue time (not a live ref)
  shipTo?: ShipTo;                          // frozen copy; omitted if "same as billing"
  accentColor: string;                      // frozen from the profile at issue time
  items: InvoiceItem[];
  termsAndConditions?: string;              // frozen copy of the profile's T&C at issue time
  status: InvoiceStatus;                    // defaults to "paid" on save
  notes?: string;
}
```

**Snapshot rule:** an `Invoice` embeds frozen copies of the business details, buyer, ship-to,
terms, and accent colour used when it was issued. Never render a saved invoice from the
*current* profile/buyer records — later edits to those must not alter past invoices.

---

## 6. GST & invoice domain rules — THIS IS THE CRITICAL LOGIC

Implement in `lib/gst.ts` as pure functions and cover both branches with tests.

**Intra-state vs inter-state** is decided by comparing the **seller's stateCode** to the
**Bill To buyer's stateCode** (Ship To never affects this, even when present and different):
- **Same stateCode → intra-state → CGST + SGST.** For each item, `cgst = sgst = taxable * (gstRate/2) / 100`.
- **Different stateCode → inter-state → IGST.** For each item, `igst = taxable * gstRate / 100`.

Per item:
- `taxable = quantity * rate`
- `gstAmount = taxable * gstRate / 100`
- `lineTotal = taxable + gstAmount`

Invoice totals:
- `subTotal = Σ taxable`
- `totalCgst`, `totalSgst`, `totalIgst`, `totalTax = totalCgst + totalSgst + totalIgst`
- `grandTotalRaw = subTotal + totalTax`
- `grandTotal = round(grandTotalRaw)` to the nearest rupee
- `roundOff = grandTotal - grandTotalRaw` (show as a signed line)

Rounding is applied **once, at the invoice level, on the final grand total** — not per line
and not per tax component. Individual line and tax values are stored rounded to 2 decimals
(paise) for display, but the round-off adjustment itself is a single invoice-level figure.

Other rules:
- **Place of supply** = Bill To buyer's state.
- Round each stored money value to 2 decimals; render with the Indian grouping helper.
- The PDF/preview column set **changes with the branch**: intra-state shows CGST% / CGST / SGST% / SGST columns; inter-state shows IGST% / IGST columns. Do not show empty CGST columns on an inter-state invoice.

Give `gst.ts` a single entry point, e.g.:

```ts
computeInvoice(profile: BusinessProfile, buyer: Buyer, items: InvoiceItem[]): {
  isIntraState: boolean;
  lines: Array<InvoiceItem & { taxable; cgst; sgst; igst; lineTotal }>;
  subTotal; totalCgst; totalSgst; totalIgst; totalTax; roundOff; grandTotal;
}
```

**Required tests:** an intra-state case (verify CGST == SGST == half of GST) and an
inter-state case (verify IGST only, CGST/SGST are zero), plus a multi-item round-off case.
Also test that a differing Ship To state does NOT change the tax branch.

---

## 7. Persistence — where the data lives

**Three record types are persisted: business profiles, saved buyers, and invoices.**

**v1 = browser `localStorage`, and only `localStorage` — no database.** This means data lives
in the user's browser on one device: it survives reloads but is NOT synced across devices and
is lost if the user clears site data. This is deliberate for v1: get the app fully built and
tested first, and only revisit storage if a real need for multi-device sync shows up later.
Do not provision or wire up any database now.

- Put ALL persistence behind a single repository interface in `lib/store.ts`. Components and
  the Zustand store call the repository only — they never touch `localStorage` (or any DB) directly.
- Repository interface (keep these names so a future DB swap is mechanical):
```ts
  getProfiles / saveProfile / deleteProfile
  getBuyers   / saveBuyer   / deleteBuyer
  getInvoices / saveInvoice / deleteInvoice / updateInvoiceStatus
```
- Provide `LocalStorageRepository` as the concrete v1 implementation. Guard every access with
  `typeof window !== "undefined"` (App Router renders on the server first).
- Namespace keys: `invoicegen:profiles`, `invoicegen:buyers`, `invoicegen:invoices`.
- Add an **Export / Import JSON** action in Settings that dumps and restores all three record
  types, so a `localStorage` user can back up and move their data between devices manually.

**Upgrade path (documented, not built in v1).** Because everything goes through the repository
interface, moving to durable multi-device storage later is a contained change: add a
`PostgresRepository` (Vercel Postgres/Neon) or a `SupabaseRepository` implementing the same
interface, read the connection string from an env var, and switch which repository the store
uses. Leave this marker at the repository boundary:
`// TODO: add PostgresRepository/SupabaseRepository implementing Repository for durable, multi-device storage — only do this after v1 is tested and a real need for it is confirmed.`

---

## 8. PDF generation

- Build `components/invoice/InvoicePdf.tsx` with `@react-pdf/renderer` primitives
  (`Document, Page, View, Text, StyleSheet`). Mirror the on-screen preview layout.
- A4 page. Header with business name + GSTIN + logo; Bill-To and Ship-To blocks side by
  side (Ship-To omitted if same as billing); supply-detail block (place of supply, invoice
  number, date); items table with the branch-dependent tax columns; totals block; amount
  in words; **bank/payment details block**; **terms and conditions block**; signature block;
  a **Paid/Unpaid status badge** near the top of the document.
- **Theme the header rule, table-header fill, and grand-total band from the invoice's
  `accentColor`** (snapshot value, not the live profile). Keep header/band text readable —
  white on the accent by default; if the accent is light (luminance check), use dark text.
- **Fonts**: register **Noto Sans** (Regular + Bold, OFL-licensed, free for commercial use)
  as the sole font family for the document. It has native ₹ glyph support, so render the
  actual rupee symbol rather than falling back to "Rs." — appropriate for a document meant
  to look clean and legally presentable. Do not mix additional font families into the PDF.
- Download via `@react-pdf/renderer`'s `pdf(<InvoicePdf .../>).toBlob()` and trigger a
  download named `invoice-{invoiceNumber-sanitised}.pdf`.
- Keep it vector (real `Text`), not a screenshot.

---

## 9. UI / UX guidelines

- Clean, trustworthy, print-like. Neutral background, one restrained accent colour (sourced
  from the selected business profile's `accentColor`), strong table legibility. This is a
  business document tool, not a marketing site — favour clarity and density over decoration.
- The accent colour theming must apply consistently to the preview and the PDF; the rest of the
  UI chrome stays neutral so different business colours don't fight the app's own layout.
- Buyer entry uses a searchable combobox of saved buyers (autofills on select) with a clear
  "add new buyer" path and an optional "save for next time" toggle.
- Ship To defaults to collapsed/"same as billing"; expanding it should feel like a clearly
  optional, secondary step, not equal weight to Bill To.
- The invoice builder is the home screen. Selecting a business profile is the first, required
  step; disable the items/buyer sections until a profile is chosen and show a hint linking to
  `/settings` when no profiles exist yet.
- Live totals panel is always visible while editing items.
- Paid/Unpaid status is shown as a small coloured badge, editable with one click from `/invoices`.
- Responsive down to mobile; visible keyboard focus; respect `prefers-reduced-motion`.
- Empty states are directive ("No business profiles yet — add one in Settings to start.").

---

## 10. Utility functions (`lib/format.ts`) — implement and TEST exactly this behaviour

- `formatINR(x: number): string` — Indian digit grouping, 2 decimals.
  `1234567.5 → "12,34,567.50"`, `1250 → "1,250.00"`.
- `amountInWords(amount: number): string` — Indian system (lakh, crore), returns
  `"Rupees ... Only"`, including paise when non-zero.
  Breakpoints: crore = value // 1,00,00,000; lakh = // 1,00,000; thousand = // 1,000; then hundreds.
  Example: `123456.50 → "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only"`.
- `isValidGstin(g: string): boolean` — 15 chars, pattern
  `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`. Surface as a Zod refinement.

---

## 11. Build milestones (work in this order, keep it deployable after each)

1. Scaffold Next.js + TS + Tailwind; confirm `npm run build` passes and it deploys clean.
2. `lib/types.ts`, `lib/format.ts`, `lib/gst.ts`, `lib/color.ts` + Vitest tests. Get tests green first.
3. `lib/repository.ts` (interface + LocalStorageRepository for profiles/buyers/invoices) + Zustand store.
4. `/settings` — business profile CRUD with validation, **accent-colour picker**, and
   **default terms & conditions field**; Buyers CRUD; Export/Import JSON.
5. `/` — invoice builder: profile dropdown, **saved-buyer combobox + add-new**,
   **Ship To section with "same as billing" toggle**, items table, live totals,
   accent-themed HTML preview. (No T&C field — that lives on the profile.)
6. `components/invoice/InvoicePdf.tsx` (accent-themed, Noto Sans, bank details, T&C,
   paid/unpaid badge) + download.
7. `/invoices` — history list + re-download from snapshots + **paid/unpaid toggle**.
8. Polish, empty states, responsive pass, README with run/deploy steps.

---

## 12. Coding standards & workflow

- TypeScript strict mode on. No `any` in `lib/`.
- Small, focused commits with clear messages; after each milestone run `npm run build`,
  `npm run test`, and `npx tsc --noEmit`, and fix everything before moving on.
- Keep money math in integers-of-paise or `Math.round(x*100)/100` at boundaries to avoid
  float drift; never display a raw float.
- Comment the GST branch logic and the round-off so a non-developer can follow it.
- No secrets, no env vars needed for v1. If you add any, document them in `.env.example`.

---

## 13. Vercel deployment

- Framework preset auto-detects as Next.js; build command `next build`, output default.
- No environment variables required for v1.
- Add a short `README.md`: local dev (`npm i`, `npm run dev`), tests, and "Deploy to Vercel"
  (push to a Git repo and import it, or `vercel` from the CLI).

---

## 14. Definition of done

- [ ] `npm run build`, `npm run test`, and `tsc --noEmit` all pass.
- [ ] Can add ≥2 business profiles in Settings and they persist across reloads.
- [ ] Each business profile has an accent colour (preset + custom hex) and default terms &
      conditions; changing the colour re-themes that business's preview and PDF, and
      header/band text stays readable.
- [ ] Buyers can be created, edited, and deleted in Settings and persist across reloads.
- [ ] Invoice builder requires selecting a profile from a dropdown, and lets the user pick a
      saved buyer (autofill) or add a new one, with an option to save that buyer.
- [ ] Ship To can be left as "same as billing" or filled in separately, and never changes
      the CGST/SGST vs IGST calculation.
- [ ] Items table adds/removes rows; totals update live and are correct for BOTH
      intra-state (CGST+SGST) and inter-state (IGST) cases.
- [ ] An item with no HSN/SAC saves without complaint and renders cleanly everywhere.
- [ ] A CSV of items uploads from the items table, appends every valid row, and lists the
      rows it rejected with a reason; a malformed file is reported, not crashed on.
- [ ] Round-off and amount-in-words are correct.
- [ ] Terms & conditions come from the business profile only, are editable nowhere but
      `/settings`, and are frozen into each invoice's snapshot at save time.
- [ ] PDF downloads, is vector text in Noto Sans, shows the ₹ symbol correctly, includes
      bank details and terms & conditions, and matches the on-screen preview, with the
      correct tax columns for the branch and the correct accent colour.
- [ ] Invoice saves to history as a snapshot with status defaulting to "paid", increments
      the profile's next number, is re-downloadable, and does NOT change when the source
      profile/buyer is later edited.
- [ ] Invoice status (Paid/Unpaid) can be toggled from the history page.
- [ ] Settings can export all data to JSON and import it back.
- [ ] App deploys to Vercel with no configuration and no database.

---

## 15. Out of scope for v1 (note as future work, do not build)

Multi-user accounts/auth, database-backed multi-device sync (revisit only after v1 is
tested, and only if actually needed), e-invoicing/IRN & QR, UPI QR code on invoice,
HSN-wise summary table, reverse-charge and TCS handling, multi-currency, email/WhatsApp
delivery, GSTR export, partial-payment or overdue tracking beyond a simple paid/unpaid flag.
Leave `// TODO` markers where these would hook in, but keep v1 lean.