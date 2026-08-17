/**
 * Rules behind the /invoices list (§4, §9, §11.7).
 *
 * The ordering/filtering helpers are pure, and `snapshotPdfProps` is the one
 * place the re-download path decides what a saved invoice is rendered from — so
 * the snapshot rule (§5) is asserted here rather than left to a manual check.
 */

import { describe, expect, it } from "vitest";

import { snapshotPdfProps } from "@/components/invoice/InvoiceHistory";
import { formatDisplayDate } from "@/lib/format";
import {
  countUnpaid,
  filterInvoices,
  matchesInvoiceQuery,
  sortInvoicesNewestFirst,
} from "@/lib/history";
import type { BusinessProfile, Invoice } from "@/lib/types";

function profile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: "profile-1",
    name: "Saara Collection",
    address: "12 Linking Road",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    gstin: "27ABCDE1234F1Z5",
    phone: "9800000000",
    email: "hello@saara.example",
    bank: {
      accountName: "Saara Collection",
      accountNo: "000111222333",
      ifsc: "HDFC0000123",
      bankName: "HDFC Bank",
      upi: "saara@hdfcbank",
    },
    invoicePrefix: "SC/2026/",
    nextInvoiceNumber: 1,
    accentColor: "#7a5230",
    termsAndConditions: "Payment due in 15 days.",
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    invoiceNumber: "SC/2026/1",
    date: "2026-08-16",
    businessProfileId: "profile-1",
    businessSnapshot: profile(),
    buyer: {
      name: "Anand Traders",
      address: "5 MG Road",
      state: "Maharashtra",
      stateCode: "27",
    },
    accentColor: "#7a5230",
    items: [
      { description: "Cotton kurta", hsn: "6206", quantity: 2, rate: 500, gstRate: 18 },
    ],
    termsAndConditions: "Payment due in 15 days.",
    status: "paid",
    ...overrides,
  };
}

const numbers = (list: Invoice[]) => list.map((i) => i.invoiceNumber);

describe("sortInvoicesNewestFirst", () => {
  it("puts the most recent date first", () => {
    const sorted = sortInvoicesNewestFirst([
      invoice({ id: "a", invoiceNumber: "SC/2026/1", date: "2026-08-01" }),
      invoice({ id: "b", invoiceNumber: "SC/2026/2", date: "2026-08-20" }),
      invoice({ id: "c", invoiceNumber: "SC/2026/3", date: "2026-08-10" }),
    ]);
    expect(numbers(sorted)).toEqual(["SC/2026/2", "SC/2026/3", "SC/2026/1"]);
  });

  it("breaks a same-day tie by running number, not by string order", () => {
    const sorted = sortInvoicesNewestFirst([
      invoice({ id: "a", invoiceNumber: "SC/2026/9", date: "2026-08-16" }),
      invoice({ id: "b", invoiceNumber: "SC/2026/10", date: "2026-08-16" }),
      invoice({ id: "c", invoiceNumber: "SC/2026/11", date: "2026-08-16" }),
    ]);
    expect(numbers(sorted)).toEqual(["SC/2026/11", "SC/2026/10", "SC/2026/9"]);
  });

  it("does not mutate the list it was given", () => {
    const list = [
      invoice({ id: "a", invoiceNumber: "SC/2026/1", date: "2026-08-01" }),
      invoice({ id: "b", invoiceNumber: "SC/2026/2", date: "2026-08-20" }),
    ];
    sortInvoicesNewestFirst(list);
    expect(numbers(list)).toEqual(["SC/2026/1", "SC/2026/2"]);
  });
});

describe("matchesInvoiceQuery", () => {
  const record = invoice({ invoiceNumber: "SC/2026/7", date: "2026-08-16" });

  it("matches on number, buyer name, buyer state, and date", () => {
    expect(matchesInvoiceQuery(record, "2026/7")).toBe(true);
    expect(matchesInvoiceQuery(record, "anand")).toBe(true);
    expect(matchesInvoiceQuery(record, "maharashtra")).toBe(true);
    expect(matchesInvoiceQuery(record, "2026-08-16")).toBe(true);
  });

  it("treats a blank query as matching everything", () => {
    expect(matchesInvoiceQuery(record, "   ")).toBe(true);
  });

  it("ignores status so 'paid' cannot match an unpaid invoice", () => {
    expect(matchesInvoiceQuery(invoice({ status: "unpaid" }), "paid")).toBe(
      false,
    );
  });
});

describe("filterInvoices", () => {
  const list = [
    invoice({ id: "a", invoiceNumber: "SC/2026/1", date: "2026-08-01", status: "paid" }),
    invoice({ id: "b", invoiceNumber: "SC/2026/2", date: "2026-08-20", status: "unpaid" }),
    invoice({
      id: "c",
      invoiceNumber: "SC/2026/3",
      date: "2026-08-10",
      status: "unpaid",
      buyer: {
        name: "Meera Fabrics",
        address: "9 Residency Road",
        state: "Karnataka",
        stateCode: "29",
      },
    }),
  ];

  it("returns everything, newest first, by default", () => {
    expect(numbers(filterInvoices(list))).toEqual([
      "SC/2026/2",
      "SC/2026/3",
      "SC/2026/1",
    ]);
  });

  it("filters by status", () => {
    expect(numbers(filterInvoices(list, { status: "unpaid" }))).toEqual([
      "SC/2026/2",
      "SC/2026/3",
    ]);
    expect(numbers(filterInvoices(list, { status: "paid" }))).toEqual([
      "SC/2026/1",
    ]);
  });

  it("combines the search box with the status filter", () => {
    expect(
      numbers(filterInvoices(list, { query: "meera", status: "unpaid" })),
    ).toEqual(["SC/2026/3"]);
    expect(
      numbers(filterInvoices(list, { query: "meera", status: "paid" })),
    ).toEqual([]);
  });
});

describe("countUnpaid", () => {
  it("counts only unpaid invoices", () => {
    expect(
      countUnpaid([
        invoice({ id: "a", status: "paid" }),
        invoice({ id: "b", status: "unpaid" }),
        invoice({ id: "c", status: "unpaid" }),
      ]),
    ).toBe(2);
  });
});

describe("formatDisplayDate", () => {
  it("renders an ISO date as DD/MM/YYYY", () => {
    expect(formatDisplayDate("2026-08-16")).toBe("16/08/2026");
  });

  it("falls back rather than inventing a date", () => {
    expect(formatDisplayDate("")).toBe("—");
    expect(formatDisplayDate("not-a-date")).toBe("not-a-date");
  });
});

describe("snapshotPdfProps", () => {
  it("renders from the frozen snapshot, not from live records", () => {
    // The snapshot is deliberately different from the profile that issued it:
    // this is what a later edit in /settings looks like from history's side.
    const issued = invoice({
      businessSnapshot: profile({
        name: "Saara Collection (as issued)",
        accentColor: "#0f766e",
        termsAndConditions: "Old terms, frozen at issue time.",
      }),
      accentColor: "#0f766e",
      termsAndConditions: "Old terms, frozen at issue time.",
    });

    const props = snapshotPdfProps(issued);

    expect(props.business.name).toBe("Saara Collection (as issued)");
    expect(props.accentColor).toBe("#0f766e");
    expect(props.termsAndConditions).toBe("Old terms, frozen at issue time.");
    expect(props.buyer.name).toBe("Anand Traders");
    expect(props.status).toBe("paid");
  });

  it("recomputes totals from the snapshot's own seller and buyer states", () => {
    // Same state on both sides -> CGST + SGST, no IGST. 2 × 500 @ 18%.
    const props = snapshotPdfProps(invoice());
    expect(props.computed.isIntraState).toBe(true);
    expect(props.computed.subTotal).toBe(1000);
    expect(props.computed.totalCgst).toBe(90);
    expect(props.computed.totalSgst).toBe(90);
    expect(props.computed.totalIgst).toBe(0);
    expect(props.computed.grandTotal).toBe(1180);
  });

  it("carries a separate ship-to through untouched", () => {
    const props = snapshotPdfProps(
      invoice({
        shipTo: {
          name: "Warehouse 4",
          address: "Plot 12, Bhiwandi",
          state: "Karnataka",
          stateCode: "29",
        },
      }),
    );

    expect(props.shipTo?.name).toBe("Warehouse 4");
    // Ship To is display-only — the tax branch still comes from Bill To (§6).
    expect(props.computed.isIntraState).toBe(true);
  });
});
