/**
 * Tests for Quick Fill's style examples (§16, v1.2).
 *
 * Pure text in, stored list out — no network, no pdf.js, no React. What matters
 * here is that the two ways text arrives are both handled: a typed list of
 * product names, and a column ripped out of a real invoice with its serial
 * numbers, HSN codes, quantities and rates still attached. The second is the
 * reason this module exists; storing those rows verbatim would teach the model
 * that "3 Kundan Necklace Set 71171990 2 4,500.00" is what a product is called.
 *
 * And the caps, because everything here ends up in a prompt.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_STYLE_EXAMPLES,
  MAX_STYLE_EXAMPLE_CHARS,
  MAX_STYLE_EXAMPLES_TOTAL_CHARS,
  cleanStyleExample,
  formatStyleExamples,
  parseStyleExamples,
  sanitiseStyleExamples,
} from "@/lib/style-examples";

describe("parseStyleExamples — a typed list", () => {
  it("takes one example per line", () => {
    const { examples } = parseStyleExamples(
      "Kundan Necklace Set\nAntique Finish Jhumka Pair\nOxidised Silver Anklet",
    );
    expect(examples).toEqual([
      "Kundan Necklace Set",
      "Antique Finish Jhumka Pair",
      "Oxidised Silver Anklet",
    ]);
  });

  it("splits a single line on commas, since that is how a list is typed", () => {
    const { examples } = parseStyleExamples(
      "kundan necklace, jhumka, oxidised anklet",
    );
    expect(examples).toEqual(["kundan necklace", "jhumka", "oxidised anklet"]);
  });

  it("keeps a comma inside a line when the text has line breaks", () => {
    // "Cotton shirt, full sleeve" is one product, not two. Splitting every line
    // on commas would quietly halve names like this one.
    const { examples } = parseStyleExamples(
      "Cotton shirt, full sleeve\nDenim jeans, straight fit",
    );
    expect(examples).toEqual([
      "Cotton shirt, full sleeve",
      "Denim jeans, straight fit",
    ]);
  });

  it("drops blank lines without counting them as refusals", () => {
    const { examples, skipped } = parseStyleExamples(
      "Kundan Necklace Set\n\n   \nOxidised Silver Anklet\n",
    );
    expect(examples).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  it("deduplicates case-insensitively, keeping the first spelling", () => {
    const { examples } = parseStyleExamples(
      "Kundan Necklace Set\nkundan necklace set\nKUNDAN NECKLACE SET",
    );
    expect(examples).toEqual(["Kundan Necklace Set"]);
  });

  it("strips list markers and edge punctuation", () => {
    const { examples } = parseStyleExamples(
      "1. Kundan Necklace Set\n- Oxidised Silver Anklet\n• Meenakari Bangle Set,",
    );
    expect(examples).toEqual([
      "Kundan Necklace Set",
      "Oxidised Silver Anklet",
      "Meenakari Bangle Set",
    ]);
  });
});

describe("parseStyleExamples — a pasted invoice row", () => {
  it("keeps the description and drops the figures around it", () => {
    const { examples } = parseStyleExamples(
      "3\tKundan Necklace Set\t71171990\t2\t4,500.00\t9,000.00",
    );
    expect(examples).toEqual(["Kundan Necklace Set"]);
  });

  it("reads a row whose columns are spaces rather than tabs", () => {
    const { examples } = parseStyleExamples(
      "1   Antique Finish Jhumka Pair   7117   4   1,250.00   5,000.00",
    );
    expect(examples).toEqual(["Antique Finish Jhumka Pair"]);
  });

  it("drops a quantity and its unit when they trail the name", () => {
    const { examples } = parseStyleExamples("Oxidised Silver Anklet 2 nos 1,800");
    expect(examples).toEqual(["Oxidised Silver Anklet"]);
  });

  it("does not mistake a trailing word for a unit", () => {
    // "Set" and "Pair" end half the names in this trade. They are only units
    // when a figure sits immediately to their left.
    const { examples } = parseStyleExamples(
      "Kundan Necklace Set\nAntique Jhumka Pair\nBangle Box",
    );
    expect(examples).toEqual([
      "Kundan Necklace Set",
      "Antique Jhumka Pair",
      "Bangle Box",
    ]);
  });

  it("keeps a short trailing number, which is usually part of the name", () => {
    const { examples } = parseStyleExamples("Cotton Shirt 42\nLED Bulb 9W");
    expect(examples).toEqual(["Cotton Shirt 42", "LED Bulb 9W"]);
  });

  it("drops a long trailing number, which is an HSN code glued on", () => {
    // Four to eight digits after a name is an HSN or SAC code far more often
    // than it is part of the name, and it is the one figure that survives a
    // paste with no column separator left to split on.
    const { examples } = parseStyleExamples("Kundan Necklace Set 71171990");
    expect(examples).toEqual(["Kundan Necklace Set"]);
  });

  it("refuses the table's own headings and totals", () => {
    const { examples, skipped } = parseStyleExamples(
      [
        "Sr Description HSN Qty Rate Amount",
        "Total",
        "Sub Total",
        "Taxable Value",
        "CGST 9%",
        "Grand Total 45,000.00",
        "Rupees Forty Five Thousand Only",
      ].join("\n"),
    );
    expect(examples).toEqual([]);
    expect(skipped).toBe(7);
  });

  it("refuses the lines that identify the parties rather than the goods", () => {
    const { examples } = parseStyleExamples(
      [
        "GSTIN: 27ABCDE1234F1Z5",
        "hello@saara.example",
        "www.saara.example",
        "Invoice No: SC/2026/14",
        "Dated 12/04/2026",
        "IFSC HDFC0000123",
      ].join("\n"),
    );
    expect(examples).toEqual([]);
  });

  it("reads the items out of a whole pasted invoice", () => {
    const { examples } = parseStyleExamples(
      [
        "SAARA COLLECTION",
        "12 Linking Road, Mumbai",
        "GSTIN: 27ABCDE1234F1Z5",
        "Invoice No: SC/2026/14",
        "",
        "Sr\tDescription\tHSN\tQty\tRate\tAmount",
        "1\tKundan Necklace Set\t71171990\t2\t4,500.00\t9,000.00",
        "2\tAntique Finish Jhumka Pair\t71171990\t4\t1,250.00\t5,000.00",
        "3\tOxidised Silver Anklet\t71171990\t3\t900.00\t2,700.00",
        "Total\t\t\t9\t\t16,700.00",
        "CGST 1.5%\t\t\t\t\t250.50",
        "Rupees Seventeen Thousand Two Hundred Only",
      ].join("\n"),
    );

    // Everything above the header and below the totals line is out, so the
    // seller's own name and address never become "product names".
    expect(examples).toEqual([
      "Kundan Necklace Set",
      "Antique Finish Jhumka Pair",
      "Oxidised Silver Anklet",
    ]);
  });

  it("reads a plain list even though it has no table header to find", () => {
    // The table slice only applies when a header row is actually there; a typed
    // list must never lose its first line to a heuristic looking for one.
    const { examples } = parseStyleExamples("Teak Side Table\nFabric Sofa");
    expect(examples).toEqual(["Teak Side Table", "Fabric Sofa"]);
  });
});

describe("parseStyleExamples — the caps", () => {
  it("keeps at most MAX_STYLE_EXAMPLES and counts what did not fit", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `Silver anklet ${index}`);
    const { examples, dropped } = parseStyleExamples(lines.join("\n"));

    expect(examples).toHaveLength(MAX_STYLE_EXAMPLES);
    expect(dropped).toBe(30 - MAX_STYLE_EXAMPLES);
    expect(examples[0]).toBe("Silver anklet 0");
  });

  it("truncates a long example at a word boundary", () => {
    const long =
      "Handcrafted temple design gold plated bridal necklace set with matching earrings and maang tikka";
    const [example] = parseStyleExamples(long).examples;

    expect(example.length).toBeLessThanOrEqual(MAX_STYLE_EXAMPLE_CHARS);
    expect(long.startsWith(example)).toBe(true);
    // Cut between words, not through one.
    expect(long[example.length]).toBe(" ");
  });

  it("stops at the total character budget even under the count cap", () => {
    const lines = Array.from(
      { length: 16 },
      (_, index) => `Handcrafted temple design bridal necklace set variant ${index}`,
    );
    const { examples, dropped } = parseStyleExamples(lines.join("\n"));

    const total = examples.join("").length;
    expect(total).toBeLessThanOrEqual(MAX_STYLE_EXAMPLES_TOTAL_CHARS);
    expect(examples.length).toBeLessThan(MAX_STYLE_EXAMPLES);
    expect(dropped).toBeGreaterThan(0);
  });

  it("ignores source text past the source cap rather than parsing megabytes", () => {
    const filler = "Filler product name\n".repeat(5_000);
    // Well past MAX_STYLE_SOURCE_CHARS, and this must still return promptly.
    expect(parseStyleExamples(filler).examples).toEqual(["Filler product name"]);
  });
});

describe("cleanStyleExample", () => {
  it("returns undefined for a line with no product name in it", () => {
    expect(cleanStyleExample("   ")).toBeUndefined();
    expect(cleanStyleExample("2\t4,500.00\t9,000.00")).toBeUndefined();
    expect(cleanStyleExample("Qty Rate Amount")).toBeUndefined();
    expect(cleanStyleExample("A")).toBeUndefined();
  });

  it("flattens the control and no-break characters PDF text arrives with", () => {
    expect(cleanStyleExample("Kundan\u0001Necklace\u00a0Set")).toBe(
      "Kundan Necklace Set",
    );
  });
});

describe("sanitiseStyleExamples — what arrives over the wire", () => {
  it("cleans and caps a list of strings", () => {
    const examples = sanitiseStyleExamples([
      "Kundan Necklace Set",
      "  Oxidised Silver Anklet  ",
      "Total",
      ...Array.from({ length: 40 }, (_, index) => `Filler ${index}`),
    ]);

    expect(examples[0]).toBe("Kundan Necklace Set");
    expect(examples[1]).toBe("Oxidised Silver Anklet");
    expect(examples).not.toContain("Total");
    expect(examples.length).toBeLessThanOrEqual(MAX_STYLE_EXAMPLES);
  });

  it("stops one entry smuggling a list in on newlines", () => {
    const smuggled = Array.from({ length: 40 }, (_, index) => `Anklet ${index}`).join(
      "\n",
    );
    expect(sanitiseStyleExamples([smuggled]).length).toBe(MAX_STYLE_EXAMPLES);
  });

  it("treats anything that is not a list of strings as no examples", () => {
    expect(sanitiseStyleExamples(undefined)).toEqual([]);
    expect(sanitiseStyleExamples(null)).toEqual([]);
    expect(sanitiseStyleExamples(42)).toEqual([]);
    // A bare string is the form's shape, never the stored or sent one.
    expect(sanitiseStyleExamples("Kundan Necklace Set")).toEqual([]);
    expect(sanitiseStyleExamples({ examples: ["x"] })).toEqual([]);
    expect(sanitiseStyleExamples([1, true, null])).toEqual([]);
  });

  it("is idempotent — cleaning a cleaned list changes nothing", () => {
    const once = sanitiseStyleExamples([
      "1. Kundan Necklace Set\t71171990\t2\t4,500.00",
      "Cotton Shirt 42",
    ]);
    expect(sanitiseStyleExamples(once)).toEqual(once);
  });
});

describe("formatStyleExamples", () => {
  it("round-trips a stored list back through the textarea", () => {
    const stored = ["Kundan Necklace Set", "Oxidised Silver Anklet"];
    expect(parseStyleExamples(formatStyleExamples(stored)).examples).toEqual(
      stored,
    );
  });

  it("treats an absent list as an empty box", () => {
    expect(formatStyleExamples(undefined)).toBe("");
  });
});
