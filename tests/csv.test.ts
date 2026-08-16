/**
 * Tests for the CSV bulk-upload parser (§4).
 *
 * The behaviour that matters here is not "does it split on commas" — it is that
 * a real, messy spreadsheet export survives, and that a bad row is *reported*
 * rather than dropped or allowed to crash the import.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_CSV_ROWS,
  parseCsvRows,
  parseInvoiceItemsCsv,
} from "@/lib/csv";

const HEADER = "description,hsn,quantity,rate,gstRate";

describe("parseCsvRows", () => {
  it("splits a plain file into rows and cells", () => {
    expect(parseCsvRows("a,b\nc,d")).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["c", "d"] },
    ]);
  });

  it("handles CRLF, CR, and a trailing newline without inventing a row", () => {
    expect(parseCsvRows("a,b\r\nc,d\r\n")).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["c", "d"] },
    ]);
    expect(parseCsvRows("a\rb")).toHaveLength(2);
  });

  it("skips entirely blank lines but keeps the line numbers honest", () => {
    expect(parseCsvRows("a\n\n\nb")).toEqual([
      { line: 1, cells: ["a"] },
      { line: 4, cells: ["b"] },
    ]);
  });

  it("keeps commas, quotes, and newlines that are inside a quoted field", () => {
    expect(parseCsvRows('"Kurta, cotton",6206')).toEqual([
      { line: 1, cells: ["Kurta, cotton", "6206"] },
    ]);
    expect(parseCsvRows('"He said ""hi""",x')).toEqual([
      { line: 1, cells: ['He said "hi"', "x"] },
    ]);
    // A field spanning two physical lines still leaves the NEXT row on line 3.
    expect(parseCsvRows('"line one\nline two",x\nlast,y')).toEqual([
      { line: 1, cells: ["line one\nline two", "x"] },
      { line: 3, cells: ["last", "y"] },
    ]);
  });

  it("treats a mid-field quote as a literal, not an opening quote", () => {
    // An inch mark in a description must not swallow the rest of the file.
    expect(parseCsvRows('5" pipe,6206')).toEqual([
      { line: 1, cells: ['5" pipe', "6206"] },
    ]);
  });

  it("strips a UTF-8 BOM so the first header cell still matches", () => {
    expect(parseCsvRows("﻿description,hsn")).toEqual([
      { line: 1, cells: ["description", "hsn"] },
    ]);
  });

  it("returns nothing for an empty or whitespace-only file", () => {
    expect(parseCsvRows("")).toEqual([]);
    expect(parseCsvRows("\n\n")).toEqual([]);
  });
});

describe("parseInvoiceItemsCsv — happy path", () => {
  it("imports every valid row", () => {
    const result = parseInvoiceItemsCsv(
      `${HEADER}\nCotton kurta,6206,2,500,18\nSilk dupatta,6214,1,1200,5\n`,
    );

    expect(result.fileError).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.totalRows).toBe(2);
    expect(result.items).toEqual([
      {
        description: "Cotton kurta",
        hsn: "6206",
        quantity: 2,
        rate: 500,
        gstRate: 18,
      },
      {
        description: "Silk dupatta",
        hsn: "6214",
        quantity: 1,
        rate: 1200,
        gstRate: 5,
      },
    ]);
  });

  it("does not care about column order", () => {
    const result = parseInvoiceItemsCsv(
      "gstRate,rate,description,quantity\n12,300,Scarf,4\n",
    );
    expect(result.items).toEqual([
      { description: "Scarf", hsn: undefined, quantity: 4, rate: 300, gstRate: 12 },
    ]);
  });

  it("accepts the header spellings a real spreadsheet has", () => {
    const result = parseInvoiceItemsCsv(
      'Item Name,HSN/SAC,Qty,Unit Price,GST %\nCotton kurta,6206,2,500,18\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.items[0]).toMatchObject({
      description: "Cotton kurta",
      hsn: "6206",
      quantity: 2,
      rate: 500,
      gstRate: 18,
    });
  });

  it("reads numbers the way a spreadsheet writes them", () => {
    const result = parseInvoiceItemsCsv(
      `${HEADER}\nCotton kurta,6206," 2 ","₹1,250.50",18%\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.items[0]).toMatchObject({ quantity: 2, rate: 1250.5, gstRate: 18 });
  });

  it("imports rows with no HSN — the column may be blank or absent (§4)", () => {
    const blank = parseInvoiceItemsCsv(`${HEADER}\nCotton kurta,,2,500,18\n`);
    expect(blank.errors).toEqual([]);
    expect(blank.items[0].hsn).toBe("");

    const absent = parseInvoiceItemsCsv(
      "description,quantity,rate,gstRate\nCotton kurta,2,500,18\n",
    );
    expect(absent.errors).toEqual([]);
    expect(absent.items[0].hsn).toBeUndefined();
  });

  it("accepts a 0% slab and a zero rate", () => {
    const result = parseInvoiceItemsCsv(`${HEADER}\nFree sample,,1,0,0\n`);
    expect(result.errors).toEqual([]);
    expect(result.items[0]).toMatchObject({ rate: 0, gstRate: 0 });
  });
});

describe("parseInvoiceItemsCsv — bad rows are reported, not dropped", () => {
  it("imports the good rows and explains each rejected one", () => {
    const result = parseInvoiceItemsCsv(
      [
        HEADER,
        "Cotton kurta,6206,2,500,18", // line 2 — fine
        ",6206,2,500,18", // line 3 — no description
        "Odd slab,6206,1,100,17", // line 4 — off-slab GST
        "Silk dupatta,6214,1,1200,5", // line 5 — fine
        "No qty,6206,,500,18", // line 6 — missing quantity
      ].join("\n"),
    );

    expect(result.totalRows).toBe(5);
    expect(result.items.map((item) => item.description)).toEqual([
      "Cotton kurta",
      "Silk dupatta",
    ]);

    expect(result.errors.map((error) => error.line)).toEqual([3, 4, 6]);
    expect(result.errors[0].messages.join(" ")).toMatch(/Description: Describe the item/);
    expect(result.errors[1].messages.join(" ")).toMatch(/GST rate: GST rate must be one of/);
    expect(result.errors[2].messages.join(" ")).toMatch(/Quantity: Enter a quantity/);
  });

  it("reports a row whose numbers are not numbers at all", () => {
    const result = parseInvoiceItemsCsv(`${HEADER}\nCotton kurta,6206,two,lots,18\n`);
    expect(result.items).toEqual([]);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[0].messages.join(" ")).toMatch(/Quantity/);
    expect(result.errors[0].messages.join(" ")).toMatch(/Rate/);
  });

  it("reports a short row rather than throwing on the missing cells", () => {
    const result = parseInvoiceItemsCsv(`${HEADER}\nCotton kurta\n`);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
  });

  it("rejects a negative rate and a zero quantity, matching the form", () => {
    const result = parseInvoiceItemsCsv(`${HEADER}\nCotton kurta,6206,0,-5,18\n`);
    expect(result.errors[0].messages.join(" ")).toMatch(/Quantity/);
    expect(result.errors[0].messages.join(" ")).toMatch(/Rate cannot be negative/);
  });
});

describe("parseInvoiceItemsCsv — unusable files", () => {
  it("reports an empty file", () => {
    expect(parseInvoiceItemsCsv("").fileError).toMatch(/empty/i);
  });

  it("reports a file with no description column", () => {
    const result = parseInvoiceItemsCsv("colour,size\nred,large\n");
    expect(result.fileError).toMatch(/description/i);
    expect(result.items).toEqual([]);
  });

  it("reports binary junk rather than crashing on it", () => {
    const result = parseInvoiceItemsCsv("%PDF-1.7\n\u0000\u0001\u0002 binary");
    expect(result.fileError).toMatch(/description/i);
    expect(result.items).toEqual([]);
  });

  it("reports a header with no rows under it", () => {
    expect(parseInvoiceItemsCsv(`${HEADER}\n`).fileError).toMatch(/no items/i);
  });

  it("refuses an oversized file outright instead of truncating it", () => {
    const rows = Array.from(
      { length: MAX_CSV_ROWS + 1 },
      (_unused, index) => `Item ${index},6206,1,100,18`,
    );
    const result = parseInvoiceItemsCsv(`${HEADER}\n${rows.join("\n")}`);
    expect(result.items).toEqual([]);
    expect(result.fileError).toMatch(new RegExp(`${MAX_CSV_ROWS}`));
  });

  it("accepts a file exactly at the row limit", () => {
    const rows = Array.from(
      { length: MAX_CSV_ROWS },
      (_unused, index) => `Item ${index},6206,1,100,18`,
    );
    const result = parseInvoiceItemsCsv(`${HEADER}\n${rows.join("\n")}`);
    expect(result.fileError).toBeUndefined();
    expect(result.items).toHaveLength(MAX_CSV_ROWS);
  });
});
