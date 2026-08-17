/**
 * Ordering and filtering for the saved-invoice history (§4, §9).
 *
 * Pure functions, kept out of the component so the rules that decide what a user
 * sees on /invoices are testable without a DOM. Everything here reads the
 * invoice's own frozen fields — never the live profile or buyer records (§5).
 */

import type { Invoice, InvoiceStatus } from "./types";

/** History can be filtered to one status, or left showing everything. */
export type StatusFilter = "all" | InvoiceStatus;

/**
 * Invoice numbers share a prefix and end in a running number, so a plain string
 * compare puts "SC/2026/10" before "SC/2026/9". The numeric collator compares
 * the digit runs as numbers, which is the order they were issued in.
 */
const numberCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/**
 * Newest first. Dates are ISO (`YYYY-MM-DD`), so they sort correctly as plain
 * strings; invoices raised on the same day fall back to their number so the
 * order is stable rather than dependent on save order.
 */
export function sortInvoicesNewestFirst(invoices: Invoice[]): Invoice[] {
  return [...invoices].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return numberCollator.compare(b.invoiceNumber, a.invoiceNumber);
  });
}

/**
 * Free-text search over the fields shown in the list: invoice number, buyer, and
 * date. Status is deliberately NOT part of the haystack — "unpaid" contains
 * "paid", so typing either word would match both. Status has its own filter.
 */
export function matchesInvoiceQuery(invoice: Invoice, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    invoice.invoiceNumber,
    invoice.buyer.name,
    invoice.buyer.state,
    invoice.date,
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/** Apply the search box and the status filter, then order newest first. */
export function filterInvoices(
  invoices: Invoice[],
  options: { query?: string; status?: StatusFilter } = {},
): Invoice[] {
  const { query = "", status = "all" } = options;
  return sortInvoicesNewestFirst(
    invoices.filter(
      (invoice) =>
        (status === "all" || invoice.status === status) &&
        matchesInvoiceQuery(invoice, query),
    ),
  );
}

/** How many saved invoices are still awaiting payment. */
export function countUnpaid(invoices: Invoice[]): number {
  return invoices.filter((invoice) => invoice.status === "unpaid").length;
}
