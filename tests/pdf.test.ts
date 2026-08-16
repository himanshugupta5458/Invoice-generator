import { describe, expect, it } from "vitest";

import { invoicePdfFileName, sanitizeFileSegment } from "@/lib/pdf";

describe("sanitizeFileSegment", () => {
  it("keeps characters that are already safe", () => {
    expect(sanitizeFileSegment("SC-2026-1")).toBe("SC-2026-1");
    expect(sanitizeFileSegment("INV_042")).toBe("INV_042");
  });

  it("replaces the slashes a real invoice prefix produces", () => {
    // "SC/2026/" is the §5 example prefix — the slashes must not survive.
    expect(sanitizeFileSegment("SC/2026/1")).toBe("SC-2026-1");
  });

  it("collapses runs of unsafe characters into one dash", () => {
    expect(sanitizeFileSegment("SC // 2026 // 1")).toBe("SC-2026-1");
    expect(sanitizeFileSegment("A\\B:C*D?E")).toBe("A-B-C-D-E");
  });

  it("trims leading and trailing separators", () => {
    expect(sanitizeFileSegment("  /2026/  ")).toBe("2026");
    expect(sanitizeFileSegment("...INV...")).toBe("INV");
  });

  it("falls back when nothing usable is left", () => {
    expect(sanitizeFileSegment("")).toBe("draft");
    expect(sanitizeFileSegment("   ")).toBe("draft");
    expect(sanitizeFileSegment("///")).toBe("draft");
  });
});

describe("invoicePdfFileName", () => {
  it("uses the invoice-{number}.pdf format (§8)", () => {
    expect(invoicePdfFileName("SC/2026/1")).toBe("invoice-SC-2026-1.pdf");
    expect(invoicePdfFileName("42")).toBe("invoice-42.pdf");
  });

  it("still produces a valid filename for an unnumbered draft", () => {
    expect(invoicePdfFileName("")).toBe("invoice-draft.pdf");
  });
});
