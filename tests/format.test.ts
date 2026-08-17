import { describe, expect, it } from "vitest";

import {
  amountInWords,
  formatINR,
  formatWholeINR,
  gstinStateCode,
  isValidGstin,
  round2,
} from "@/lib/format";

describe("formatINR", () => {
  it("uses Indian digit grouping with 2 decimals", () => {
    // Spec §10 examples.
    expect(formatINR(1234567.5)).toBe("12,34,567.50");
    expect(formatINR(1250)).toBe("1,250.00");
  });

  it("groups the last three digits, then in pairs", () => {
    expect(formatINR(0)).toBe("0.00");
    expect(formatINR(7.5)).toBe("7.50");
    expect(formatINR(999)).toBe("999.00");
    expect(formatINR(1000)).toBe("1,000.00");
    expect(formatINR(100000)).toBe("1,00,000.00");
    expect(formatINR(10000000)).toBe("1,00,00,000.00");
    expect(formatINR(1234567890.05)).toBe("1,23,45,67,890.05");
  });

  it("formats negative values (used by the round-off line)", () => {
    expect(formatINR(-0.47)).toBe("-0.47");
    expect(formatINR(-123456.78)).toBe("-1,23,456.78");
  });

  it("rounds to paise rather than printing a raw float", () => {
    expect(formatINR(134.865)).toBe("134.87");
    expect(formatINR(0.1 + 0.2)).toBe("0.30");
  });
});

describe("round2", () => {
  it("rounds to 2 decimals without float drift", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(134.865)).toBe(134.87);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(-0.47000000000002)).toBe(-0.47);
  });
});

describe("amountInWords", () => {
  it("matches the spec example", () => {
    expect(amountInWords(123456.5)).toBe(
      "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only",
    );
  });

  it("omits paise when they are zero", () => {
    expect(amountInWords(1250)).toBe("Rupees One Thousand Two Hundred Fifty Only");
    expect(amountInWords(1180)).toBe(
      "Rupees One Thousand One Hundred Eighty Only",
    );
  });

  it("includes paise when non-zero", () => {
    expect(amountInWords(0.75)).toBe("Rupees Zero and Seventy Five Paise Only");
    expect(amountInWords(99.01)).toBe(
      "Rupees Ninety Nine and One Paise Only",
    );
  });

  it("handles zero", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });

  it("uses the Indian lakh/crore breakpoints", () => {
    expect(amountInWords(100)).toBe("Rupees One Hundred Only");
    expect(amountInWords(1000)).toBe("Rupees One Thousand Only");
    expect(amountInWords(100000)).toBe("Rupees One Lakh Only");
    expect(amountInWords(10000000)).toBe("Rupees One Crore Only");
    expect(amountInWords(1234567890.05)).toBe(
      "Rupees One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety and Five Paise Only",
    );
  });

  it("reads the teens and tens correctly", () => {
    expect(amountInWords(11)).toBe("Rupees Eleven Only");
    expect(amountInWords(19)).toBe("Rupees Nineteen Only");
    expect(amountInWords(20)).toBe("Rupees Twenty Only");
    expect(amountInWords(915)).toBe("Rupees Nine Hundred Fifteen Only");
  });

  it("does not drift a rupee on repeating fractions", () => {
    expect(amountInWords(1164.79)).toBe(
      "Rupees One Thousand One Hundred Sixty Four and Seventy Nine Paise Only",
    );
  });

  it("marks negative amounts", () => {
    expect(amountInWords(-50.25)).toBe(
      "Minus Rupees Fifty and Twenty Five Paise Only",
    );
  });
});

describe("isValidGstin", () => {
  it("accepts a well-formed GSTIN", () => {
    expect(isValidGstin("27ABCDE1234F1Z5")).toBe(true);
    expect(isValidGstin("29AAACB1234C1ZX")).toBe(true);
    expect(isValidGstin("  27ABCDE1234F1Z5  ")).toBe(true);
  });

  it("rejects malformed GSTINs", () => {
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin("27ABCDE1234F1Z")).toBe(false); // 14 chars
    expect(isValidGstin("27ABCDE1234F1Z55")).toBe(false); // 16 chars
    expect(isValidGstin("AB CDE1234F1Z5")).toBe(false); // no leading state digits
    expect(isValidGstin("27abcde1234f1z5")).toBe(false); // lowercase
    expect(isValidGstin("27ABCDE1234F1A5")).toBe(false); // 14th char must be "Z"
    expect(isValidGstin("27ABCDE1234F0Z5")).toBe(false); // entity char cannot be 0
  });
});

describe("gstinStateCode", () => {
  it("returns the first two digits of a valid GSTIN", () => {
    expect(gstinStateCode("27ABCDE1234F1Z5")).toBe("27");
  });

  it("returns null for an invalid GSTIN", () => {
    expect(gstinStateCode("nonsense")).toBe(null);
  });
});

describe("formatWholeINR", () => {
  it("groups the Indian way with no paise", () => {
    expect(formatWholeINR(1250)).toBe("1,250");
    expect(formatWholeINR(1234567)).toBe("12,34,567");
    expect(formatWholeINR(99654)).toBe("99,654");
    expect(formatWholeINR(0)).toBe("0");
    expect(formatWholeINR(999)).toBe("999");
  });

  it("rounds to the nearest rupee rather than truncating", () => {
    expect(formatWholeINR(1250.4)).toBe("1,250");
    expect(formatWholeINR(1250.5)).toBe("1,251");
  });

  it("keeps a negative sign outside the grouping", () => {
    expect(formatWholeINR(-1234567)).toBe("-12,34,567");
  });

  it("is 0 for anything that is not a finite number", () => {
    expect(formatWholeINR(Number.NaN)).toBe("0");
    expect(formatWholeINR(Number.POSITIVE_INFINITY)).toBe("0");
  });
});
