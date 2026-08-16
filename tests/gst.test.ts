import { describe, expect, it } from "vitest";

import { computeInvoice, isIntraStateSupply, normalizeStateCode } from "@/lib/gst";
import type { BusinessProfile, Buyer, InvoiceItem, ShipTo } from "@/lib/types";

const seller: BusinessProfile = {
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
};

/** Same state as the seller (27) -> intra-state. */
const maharashtraBuyer: Buyer = {
  name: "Anand Traders",
  address: "5 MG Road",
  state: "Maharashtra",
  stateCode: "27",
  gstin: "27AAACB1234C1ZX",
};

/** Different state from the seller (29) -> inter-state. */
const karnatakaBuyer: Buyer = {
  name: "Nandi Retail",
  address: "88 Church Street",
  state: "Karnataka",
  stateCode: "29",
};

function item(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    description: "Cotton kurta",
    hsn: "6206",
    quantity: 2,
    rate: 500,
    gstRate: 18,
    ...overrides,
  };
}

describe("state-code comparison", () => {
  it("treats zero-padded and unpadded state codes as the same state", () => {
    expect(normalizeStateCode("7")).toBe("07");
    expect(isIntraStateSupply("07", "7")).toBe(true);
    expect(isIntraStateSupply("27", "29")).toBe(false);
  });

  it("falls back to intra-state when a state code is missing", () => {
    expect(isIntraStateSupply("27", "")).toBe(true);
  });
});

describe("computeInvoice — intra-state (CGST + SGST)", () => {
  const result = computeInvoice(seller, maharashtraBuyer, [item()]);

  it("splits the GST slab evenly between CGST and SGST", () => {
    const line = result.lines[0];
    expect(result.isIntraState).toBe(true);
    expect(line.taxable).toBe(1000);
    // 18% slab -> 9% + 9%
    expect(line.cgst).toBe(90);
    expect(line.sgst).toBe(90);
    expect(line.cgst).toBe(line.sgst);
    expect(line.cgst + line.sgst).toBe((line.taxable * line.gstRate) / 100);
    expect(line.igst).toBe(0);
    expect(line.lineTotal).toBe(1180);
  });

  it("totals CGST and SGST and leaves IGST at zero", () => {
    expect(result.subTotal).toBe(1000);
    expect(result.totalCgst).toBe(90);
    expect(result.totalSgst).toBe(90);
    expect(result.totalIgst).toBe(0);
    expect(result.totalTax).toBe(180);
    expect(result.grandTotal).toBe(1180);
    expect(result.roundOff).toBe(0);
  });

  it("reports the place of supply as the Bill To buyer's state", () => {
    expect(result.placeOfSupply).toBe("Maharashtra");
    expect(result.placeOfSupplyStateCode).toBe("27");
  });
});

describe("computeInvoice — inter-state (IGST only)", () => {
  const result = computeInvoice(seller, karnatakaBuyer, [item()]);

  it("charges the full slab as IGST with no CGST/SGST", () => {
    const line = result.lines[0];
    expect(result.isIntraState).toBe(false);
    expect(line.taxable).toBe(1000);
    expect(line.igst).toBe(180);
    expect(line.cgst).toBe(0);
    expect(line.sgst).toBe(0);
    expect(line.lineTotal).toBe(1180);
  });

  it("totals IGST only", () => {
    expect(result.totalIgst).toBe(180);
    expect(result.totalCgst).toBe(0);
    expect(result.totalSgst).toBe(0);
    expect(result.totalTax).toBe(180);
    expect(result.grandTotal).toBe(1180);
  });

  it("reports the place of supply as the buyer's state", () => {
    expect(result.placeOfSupply).toBe("Karnataka");
    expect(result.placeOfSupplyStateCode).toBe("29");
  });
});

describe("computeInvoice — round-off happens once, at the invoice level", () => {
  const items = [
    item({ description: "Silk dupatta", quantity: 3, rate: 249.75, gstRate: 18 }),
    item({ description: "Cotton stole", quantity: 2, rate: 125.3, gstRate: 12 }),
  ];
  const result = computeInvoice(seller, karnatakaBuyer, items);

  it("keeps paise on every line — no line is rounded to a whole rupee", () => {
    expect(result.lines[0].taxable).toBe(749.25);
    expect(result.lines[0].igst).toBe(134.87);
    expect(result.lines[0].lineTotal).toBe(884.12);

    expect(result.lines[1].taxable).toBe(250.6);
    expect(result.lines[1].igst).toBe(30.07);
    expect(result.lines[1].lineTotal).toBe(280.67);
  });

  it("rounds up to the nearest rupee with a positive round-off", () => {
    expect(result.subTotal).toBe(999.85);
    expect(result.totalIgst).toBe(164.94);
    expect(result.grandTotalRaw).toBe(1164.79);
    expect(result.grandTotal).toBe(1165);
    expect(result.roundOff).toBe(0.21);
    // The round-off is exactly the single invoice-level adjustment.
    expect(result.grandTotalRaw + result.roundOff).toBeCloseTo(
      result.grandTotal,
      2,
    );
  });

  it("rounds down with a negative round-off", () => {
    const down = computeInvoice(seller, karnatakaBuyer, [
      item({ description: "Wool shawl", quantity: 1, rate: 1000.4, gstRate: 18 }),
    ]);
    expect(down.grandTotalRaw).toBe(1180.47);
    expect(down.grandTotal).toBe(1180);
    expect(down.roundOff).toBe(-0.47);
  });

  it("applies no round-off when the raw total is already whole", () => {
    const exact = computeInvoice(seller, maharashtraBuyer, [item()]);
    expect(exact.grandTotalRaw).toBe(1180);
    expect(exact.roundOff).toBe(0);
  });

  it("keeps the tax total equal to the sum of the per-line tax figures", () => {
    const lineTax = result.lines.reduce((acc, l) => acc + l.gstAmount, 0);
    expect(result.totalTax).toBeCloseTo(lineTax, 2);
  });
});

describe("computeInvoice — Ship To never changes the tax branch", () => {
  // A Ship To in a different state is display-only (§6). It is not even an
  // argument to computeInvoice, so the branch stays keyed to the Bill To buyer.
  const shipTo: ShipTo = {
    name: "Nandi Retail Warehouse",
    address: "Plot 9, Industrial Area",
    state: "Karnataka",
    stateCode: "29",
  };

  it("stays intra-state when Bill To matches the seller but Ship To does not", () => {
    const result = computeInvoice(seller, maharashtraBuyer, [item()]);
    const baseline = computeInvoice(seller, maharashtraBuyer, [item()]);

    expect(shipTo.stateCode).not.toBe(maharashtraBuyer.stateCode);
    expect(result.isIntraState).toBe(true);
    expect(result.totalCgst).toBe(90);
    expect(result.totalSgst).toBe(90);
    expect(result.totalIgst).toBe(0);
    expect(result).toEqual(baseline);
  });

  it("stays inter-state when Bill To differs from the seller but Ship To matches it", () => {
    const sameStateShipTo: ShipTo = {
      name: "Mumbai drop point",
      address: "12 Linking Road",
      state: "Maharashtra",
      stateCode: "27",
    };
    const result = computeInvoice(seller, karnatakaBuyer, [item()]);

    expect(sameStateShipTo.stateCode).toBe(seller.stateCode);
    expect(result.isIntraState).toBe(false);
    expect(result.totalIgst).toBe(180);
    expect(result.totalCgst).toBe(0);
    expect(result.totalSgst).toBe(0);
  });
});

describe("computeInvoice — edge cases", () => {
  it("returns zeroed totals for an empty items list", () => {
    const result = computeInvoice(seller, maharashtraBuyer, []);
    expect(result.lines).toEqual([]);
    expect(result.subTotal).toBe(0);
    expect(result.totalTax).toBe(0);
    expect(result.grandTotal).toBe(0);
    expect(result.roundOff).toBe(0);
  });

  it("handles a 0% slab with no tax", () => {
    const result = computeInvoice(seller, maharashtraBuyer, [
      item({ description: "Exempt goods", quantity: 4, rate: 250, gstRate: 0 }),
    ]);
    expect(result.totalTax).toBe(0);
    expect(result.grandTotal).toBe(1000);
  });

  it("treats non-finite quantities and rates as zero", () => {
    const result = computeInvoice(seller, maharashtraBuyer, [
      item({ quantity: Number.NaN, rate: Number.NaN }),
    ]);
    expect(result.lines[0].taxable).toBe(0);
    expect(result.grandTotal).toBe(0);
  });
});
