/**
 * Render smoke tests for the PDF document (§8).
 *
 * These actually run @react-pdf/renderer and inspect the bytes it produces, so
 * they catch the failures a typecheck cannot: a malformed style, an unregistered
 * font, a crash on absent optional data, or the ₹ glyph silently falling back to
 * a blank box.
 *
 * The one accommodation for Node: InvoicePdf registers Noto Sans from
 * `/fonts/...`, which is a URL the *browser* resolves against the site origin.
 * Here there is no origin, so the font store is re-pointed at the same two files
 * on disk. Everything else is exactly what ships.
 *
 * Note the surgical delete rather than `Font.clear()`. Clearing the store also
 * wipes react-pdf's built-in standard-14 registrations, which it needs
 * internally — every render then dies on "Font family not registered:
 * Helvetica", including a document that only ever asks for Noto Sans.
 */

import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { Font, renderToBuffer } from "@react-pdf/renderer";

import { columnsFor, InvoicePdf } from "@/components/invoice/InvoicePdf";
import { computeInvoice } from "@/lib/gst";
import type { BusinessProfile, Buyer, InvoiceItem } from "@/lib/types";

const FONT_DIR = join(process.cwd(), "public", "fonts");

beforeAll(() => {
  delete (Font.getRegisteredFonts() as Record<string, unknown>)["Noto Sans"];
  Font.register({
    family: "Noto Sans",
    fonts: [
      { src: join(FONT_DIR, "NotoSans-Regular.ttf"), fontWeight: 400 },
      { src: join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
});

const SELLER: BusinessProfile = {
  id: "p1",
  name: "Saara Collection",
  address: "12 Linking Road",
  city: "Mumbai",
  state: "Maharashtra",
  stateCode: "27",
  gstin: "27ABCDE1234F1Z5",
  phone: "+91 98200 00000",
  email: "hello@saara.example",
  bank: {
    accountName: "Saara Collection",
    accountNo: "001122334455",
    ifsc: "HDFC0000123",
    bankName: "HDFC Bank",
    upi: "saara@upi",
  },
  invoicePrefix: "SC/2026/",
  nextInvoiceNumber: 1,
  accentColor: "#7a5230",
  termsAndConditions: "Payment due within 15 days.",
};

/** Same state as the seller -> CGST + SGST. */
const LOCAL_BUYER: Buyer = {
  name: "Kapoor Textiles",
  address: "8 MG Road",
  state: "Maharashtra",
  stateCode: "27",
  gstin: "27ZZZZZ9999Z1Z5",
};

/** Different state -> IGST. */
const OUTSTATE_BUYER: Buyer = {
  name: "Rao Traders",
  address: "5 Brigade Road",
  state: "Karnataka",
  stateCode: "29",
};

const ITEMS: InvoiceItem[] = [
  { description: "Cotton saree", hsn: "5407", quantity: 3, rate: 1250, gstRate: 5 },
  { description: "Silk dupatta", hsn: "5007", quantity: 2, rate: 899.5, gstRate: 12 },
];

async function render(buyer: Buyer, overrides: Partial<Parameters<typeof InvoicePdf>[0]> = {}) {
  const computed = computeInvoice(SELLER, buyer, ITEMS);
  const buffer = await renderToBuffer(
    <InvoicePdf
      business={SELLER}
      buyer={buyer}
      invoiceNumber="SC/2026/1"
      date="2026-08-16"
      computed={computed}
      termsAndConditions={SELLER.termsAndConditions}
      accentColor={SELLER.accentColor}
      status="unpaid"
      {...overrides}
    />,
  );
  return { buffer, computed };
}

/**
 * The text in a PDF is compressed, so it cannot be grepped directly. What we can
 * assert from the raw bytes is the file header, the font programme actually
 * being embedded (a subset keeps the "NotoSans" name), and that it is not a
 * near-empty document.
 */
function assertValidPdf(buffer: Buffer) {
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(buffer.subarray(-6).toString("latin1")).toContain("%%EOF");
  expect(buffer.length).toBeGreaterThan(10_000);
}

describe("InvoicePdf", () => {
  it("renders an intra-state invoice as a valid PDF", async () => {
    const { buffer, computed } = await render(LOCAL_BUYER);
    expect(computed.isIntraState).toBe(true);
    assertValidPdf(buffer);
  });

  it("renders an inter-state invoice as a valid PDF", async () => {
    const { buffer, computed } = await render(OUTSTATE_BUYER);
    expect(computed.isIntraState).toBe(false);
    assertValidPdf(buffer);
  });

  it("embeds Noto Sans as the only font family", async () => {
    const { buffer } = await render(LOCAL_BUYER);
    const raw = buffer.toString("latin1");

    expect(raw).toContain("NotoSans");
    // Nothing may fall back to a built-in PDF base font (§8: sole family).
    for (const standard of ["Helvetica", "Times-Roman", "Courier"]) {
      expect(raw).not.toContain(standard);
    }
  });

  it("has a real ₹ glyph rather than a missing-glyph box", async () => {
    // The grand-total band is the only ₹ in the document. If the font lacked
    // the codepoint react-pdf would map it to glyph 0 (.notdef).
    // Asserted against the font react-pdf itself loaded, not a copy re-opened
    // here, so this covers the font that actually ends up in the document.
    const sources = Font.getRegisteredFonts()["Noto Sans"].sources;
    expect(sources).toHaveLength(2); // Regular + Bold, and nothing else

    for (const source of sources) {
      await source.load();
      const font = source.data as unknown as {
        hasGlyphForCodePoint(codePoint: number): boolean;
        glyphsForString(text: string): { id: number }[];
      };
      expect(font.hasGlyphForCodePoint(0x20b9)).toBe(true);
      // Glyph 0 is .notdef — the empty box a missing ₹ would render as.
      expect(font.glyphsForString("₹")[0].id).not.toBe(0);
    }
  });

  it("renders with a Ship To block without changing the tax branch", async () => {
    // A Karnataka shipping address on a Maharashtra->Maharashtra sale (§6).
    const { buffer, computed } = await render(LOCAL_BUYER, {
      shipTo: {
        name: "Rao Warehouse",
        address: "Plot 9, Peenya",
        state: "Karnataka",
        stateCode: "29",
      },
    });
    expect(computed.isIntraState).toBe(true);
    assertValidPdf(buffer);
  });

  it("survives a profile with no logo, bank details, terms, or notes", async () => {
    const bare: BusinessProfile = {
      ...SELLER,
      logoDataUrl: undefined,
      bank: { accountName: "", accountNo: "", ifsc: "", bankName: "", upi: "" },
      termsAndConditions: undefined,
    };
    const computed = computeInvoice(bare, LOCAL_BUYER, ITEMS);
    const buffer = await renderToBuffer(
      <InvoicePdf
        business={bare}
        buyer={LOCAL_BUYER}
        invoiceNumber="SC/2026/2"
        date="2026-08-16"
        computed={computed}
        accentColor={bare.accentColor}
      />,
    );
    assertValidPdf(buffer);
  });

  it("renders an empty-item invoice rather than crashing", async () => {
    const computed = computeInvoice(SELLER, LOCAL_BUYER, []);
    const buffer = await renderToBuffer(
      <InvoicePdf
        business={SELLER}
        buyer={LOCAL_BUYER}
        invoiceNumber="SC/2026/3"
        date="2026-08-16"
        computed={computed}
        accentColor={SELLER.accentColor}
      />,
    );
    assertValidPdf(buffer);
  });

  it("pages a long invoice instead of overflowing one page", async () => {
    const many: InvoiceItem[] = Array.from({ length: 60 }, (_, index) => ({
      description: `Item ${index + 1} — a deliberately long description to exercise wrapping`,
      hsn: "5407",
      quantity: index + 1,
      rate: 1250.75,
      gstRate: 18,
    }));
    const computed = computeInvoice(SELLER, LOCAL_BUYER, many);
    const buffer = await renderToBuffer(
      <InvoicePdf
        business={SELLER}
        buyer={LOCAL_BUYER}
        invoiceNumber="SC/2026/4"
        date="2026-08-16"
        computed={computed}
        accentColor={SELLER.accentColor}
        status="paid"
      />,
    );
    assertValidPdf(buffer);
    // /Count in the page tree tells us how many pages were produced.
    const pageCount = Number(/\/Count (\d+)/.exec(buffer.toString("latin1"))?.[1]);
    expect(pageCount).toBeGreaterThan(1);
  });
});

describe("columnsFor", () => {
  // react-pdf does not complain when percentage widths fail to add up — the
  // header and the body just quietly stop lining up, which is exactly the kind
  // of defect a rendered-bytes assertion cannot see.
  it.each([
    ["intra-state", true],
    ["inter-state", false],
  ])("keeps the %s widths summing to 100%%", (_label, isIntraState) => {
    const total = columnsFor(isIntraState).reduce(
      (sum, column) => sum + column.width,
      0,
    );
    expect(total).toBeCloseTo(100, 6);
  });

  it("shows CGST + SGST intra-state and IGST inter-state, never both (§6)", () => {
    const intra = columnsFor(true).map((column) => column.key);
    const inter = columnsFor(false).map((column) => column.key);

    expect(intra).toEqual(expect.arrayContaining(["cgst", "sgst"]));
    expect(intra).not.toContain("igst");

    expect(inter).toContain("igst");
    expect(inter).not.toContain("cgst");
    expect(inter).not.toContain("sgst");
  });

  it("halves the slab for CGST/SGST and charges it whole for IGST", () => {
    const line = computeInvoice(SELLER, LOCAL_BUYER, ITEMS).lines[1]; // 12%
    const rateCell = (isIntraState: boolean, key: string) =>
      columnsFor(isIntraState)
        .find((column) => column.key === key)!
        .cell(line, 0);

    expect(rateCell(true, "cgstRate")).toBe("6%");
    expect(rateCell(true, "sgstRate")).toBe("6%");
    expect(rateCell(false, "igstRate")).toBe("12%");
  });
});
