# InvoiceGen

GST-compliant tax invoices for Indian businesses, generated in the browser and
downloaded as clean, vector PDFs. No login and no database — invoices, PDFs, and
storage are entirely client-side, and the app deploys to Vercel with no required
configuration. One optional feature, **Quick Fill (AI)**, calls out to a server
route; everything else works with the network off.

Built to the specification in [`docs/spec.md`](docs/spec.md).

## What it does

- **Business profiles** — save the seller details once (address, GSTIN, bank
  details, logo, invoice number series, default terms & conditions, accent
  colour). Keep as many as you need and pick one per invoice.
- **Saved buyers** — a reusable address book with a searchable picker on the
  invoice builder; editing a buyer never rewrites an invoice already issued.
- **Correct GST** — CGST + SGST when the seller and the Bill To buyer are in the
  same state, IGST when they are not, decided by state code and never by the
  Ship To address. Round-off is applied once, on the grand total.
- **Live totals** while you type, with amount in words in the Indian system
  (lakh / crore).
- **CSV bulk upload** of items, parsed entirely in the browser. Valid rows are
  appended and rejected rows are listed with a reason — nothing is dropped
  silently.
- **Quick Fill (AI)** *(v1.1, optional)* — describe a purchase ("furniture
  shopping, ₹45,000") and get a drafted set of item rows to explore with. Give it
  a target and the rows total *exactly* that: the AI only picks the mix of goods
  and their proportions, and the per-unit rates are solved arithmetically from
  the target and checked against the app's own GST engine before you see them.
  Every generated row is validated against the same schema a typed row is, and
  anything refused is listed with the reason. Sample data for testing, not
  verified purchase records. Needs `GROQ_API_KEY`; see below.
- **PDF download** — real selectable text in Noto Sans, with the ₹ glyph, themed
  from the profile's accent colour, including bank details, terms, and a
  paid/unpaid badge.
- **History** at `/invoices` — re-download any past invoice from its frozen
  snapshot and flip it between paid and unpaid.
- **Export / import JSON** — your backup route, since v1 data lives in one
  browser.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Open the app and add a business profile in **Settings** first — the invoice
builder stays locked until one exists.

### Optional: enable Quick Fill (AI)

```bash
cp .env.example .env.local   # then paste a key into GROQ_API_KEY
```

Get a free key at [console.groq.com](https://console.groq.com) — no card needed.
The key is read only by `app/api/quick-fill/route.ts` and never reaches the
browser. Leave it unset and everything else works exactly as before; the Quick
Fill button just reports that the feature is not configured.

### Scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Dev server                                    |
| `npm run build`     | Production build                              |
| `npm start`         | Serve the production build                    |
| `npm test`          | Vitest unit tests (single run)                |
| `npm run test:watch`| Vitest in watch mode                          |
| `npm run typecheck` | `tsc --noEmit`                                |
| `npm run lint`      | ESLint                                        |

Run all four gates before committing:

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

## Where your data lives

**Everything is stored in your browser's `localStorage`, and nowhere else.**
There is no database and no account in v1. In practice:

- Data survives reloads and browser restarts on **this device and this browser**.
- It is **not synced** — a different laptop or phone starts empty.
- Clearing site data (or a private window closing) **deletes it**.
- Use **Settings → Export & import** to download a JSON backup and restore it
  elsewhere. Importing *replaces* everything currently stored.

The one exception is Quick Fill: the description you type there is sent to the
server route and on to Groq. No invoice, buyer, profile, or stored data goes with
it, and nothing is written down on the way. Do not enable it if that trip is
unacceptable — the rest of the app never makes a network call.

Saved invoices embed a frozen snapshot of the business details, buyer, ship-to,
terms, and accent colour used at the time they were issued, so editing a profile
or a buyer later never alters an invoice you have already sent.

All persistence goes through the `Repository` interface in
[`lib/repository.ts`](lib/repository.ts). Moving to durable multi-device storage
later means adding a `PostgresRepository`/`SupabaseRepository` with the same
methods and calling `setRepository()` — no component or store change.

## Deploy to Vercel

No database, no build configuration, and no *required* environment variables.
Add `GROQ_API_KEY` in the project's environment settings if you want Quick Fill;
the deployment builds and runs without it.

**From the dashboard:** push this repository to GitHub/GitLab/Bitbucket, then
[import it into Vercel](https://vercel.com/new). The Next.js preset is detected
automatically (build `next build`, default output).

**From the CLI:**

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production
```

## Project layout

```
app/
  page.tsx            invoice builder (home)
  api/quick-fill/     the app's only server route — Quick Fill (AI)
  invoices/page.tsx   saved invoice history
  settings/page.tsx   profiles, buyers, export/import
  buyers/page.tsx     the buyers panel on its own route
components/
  invoice/            builder, items table, CSV import, Quick Fill, preview, PDF, history
  settings/           profile form, colour picker, buyer form, data panel
  ui/                 button, field, nav, error banner
lib/
  gst.ts              tax engine — pure, fully tested
  format.ts           currency, amount in words, GSTIN check — pure
  csv.ts              CSV → items parser — pure
  quick-fill.ts       AI prompt + response validation — pure
  quick-fill-solver.ts  solves item rates to hit a target exactly — pure
  rate-limit.ts       token bucket for the Quick Fill route — pure
  history.ts          history ordering/filtering — pure
  color.ts            accent presets + contrast helpers
  repository.ts       persistence boundary + LocalStorageRepository
  store.ts            Zustand store, the only caller of the repository
  types.ts            data models
  validation.ts       Zod schemas
tests/                Vitest suites for the pure logic and the store
```

`lib/gst.ts` and `lib/format.ts` are deliberately free of React and storage so
the money maths stays trivially testable.

## Tech

Next.js (App Router) + TypeScript · Tailwind CSS · React Hook Form + Zod ·
`@react-pdf/renderer` · Zustand · Vitest. Quick Fill (v1.1) calls Groq
(`llama-3.3-70b-versatile`) from one serverless route.

## Not in v1

Accounts and auth, multi-device sync, e-invoicing/IRN and QR, UPI QR on the
invoice, HSN-wise summary, reverse charge and TCS, multi-currency, email or
WhatsApp delivery, GSTR export, and partial-payment tracking beyond the
paid/unpaid flag. See §15 of the spec.
