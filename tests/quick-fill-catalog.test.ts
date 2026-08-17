/**
 * Tests for the Indian item catalogue Quick Fill grounds its rows in (§16).
 *
 * Two halves, tested separately. `extractCatalog()` is pure text work and is
 * tested on strings; `readItemCatalog()` touches the filesystem, so the only
 * thing asserted of it is the contract that matters — it reads the real skill
 * file when it is there, and returns undefined rather than throwing when it is
 * not.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CATALOG_PATH,
  MAX_CATALOG_CHARS,
  extractCatalog,
  readItemCatalog,
} from "@/lib/quick-fill-catalog";
import { buildQuickFillRequestBody, buildQuickFillSystemPrompt } from "@/lib/quick-fill";

describe("extractCatalog", () => {
  it("takes the whole body when the file has no marker heading", () => {
    // The shipped catalogue is shaped this way — plain `##` category headings and
    // nothing else. Requiring a marker would have made it vanish from the prompt
    // with nothing on screen to say so, which is why nothing is required.
    const source = [
      "# Indian Invoice Items Reference",
      "",
      "Draw from these so descriptions read authentically.",
      "",
      "## Artificial / Imitation Jewellery — HSN 7117, GST 3%",
      "Kundan necklace set, Meenakari jhumka, Maang tikka",
    ].join("\n");

    const catalog = extractCatalog(source);
    expect(catalog).toContain("Artificial / Imitation Jewellery");
    expect(catalog).toContain("Kundan necklace set");
    expect(catalog).toContain("7117");
  });

  it("strips YAML frontmatter, which is not for the model", () => {
    const source = [
      "---",
      "name: indian-invoice-items",
      "description: a long line about what this is for",
      "---",
      "",
      "## Furniture — HSN 9403, GST 18%",
      "Sheesham wood dining table, Godrej steel almirah",
    ].join("\n");

    const catalog = extractCatalog(source);
    expect(catalog).toContain("Sheesham wood dining table");
    expect(catalog).not.toContain("name: indian-invoice-items");
    expect(catalog).not.toContain("description:");
    expect(catalog!.startsWith("## Furniture")).toBe(true);
  });

  it("drops HTML comments, which are notes to whoever edits the file", () => {
    const catalog = extractCatalog(
      "<!-- Read by lib/quick-fill-catalog.ts. Keep under 8000 chars. -->\n\n## Furniture\nStudy table",
    );
    expect(catalog).toContain("Study table");
    expect(catalog).not.toContain("quick-fill-catalog");
    expect(catalog).not.toContain("8000");
  });

  it("honours a Catalogue marker when one is present", () => {
    const source = [
      "# Title",
      "",
      "Notes for whoever edits this file.",
      "",
      "## Catalogue",
      "",
      "### Artificial jewellery",
      "| Oxidised Jhumka Earrings | 7117 | 3% |",
    ].join("\n");

    const catalog = extractCatalog(source);
    expect(catalog).toContain("Artificial jewellery");
    expect(catalog).not.toContain("Notes for whoever edits");
  });

  it("is undefined only when there is genuinely no content", () => {
    expect(extractCatalog("")).toBeUndefined();
    expect(extractCatalog("   \n  \n")).toBeUndefined();
    expect(extractCatalog("---\nname: x\n---\n")).toBeUndefined();
    expect(extractCatalog("## Catalogue\n\n   \n")).toBeUndefined();
    expect(extractCatalog("<!-- only a comment -->")).toBeUndefined();
  });

  it("truncates a long catalogue at a line boundary, never mid-row", () => {
    const rows = Array.from(
      { length: 800 },
      (_, i) => `| Item ${i} | 1234 | 18% | a note that makes the row long |`,
    );
    const catalog = extractCatalog(`## Catalogue\n\n${rows.join("\n")}`);

    expect(catalog).toBeDefined();
    expect(catalog!.length).toBeLessThanOrEqual(MAX_CATALOG_CHARS);
    // Every line that survived is a whole row.
    for (const line of catalog!.split("\n")) {
      expect(line.endsWith("|")).toBe(true);
    }
  });
});

describe("readItemCatalog", () => {
  it("reads the catalogue that ships with the repo", () => {
    const catalog = readItemCatalog();

    expect(catalog).toBeDefined();
    // Every category, so a botched edit that drops one is caught here.
    for (const category of [
      "Artificial / Imitation Jewellery",
      "Motor Vehicle Parts",
      "Textiles & Apparel",
      "Furniture",
      "Electronics & Appliances",
      "FMCG & Groceries",
      "Hardware & Building Material",
      "Stationery & Office Supplies",
    ]) {
      expect(catalog).toContain(category);
    }

    // Real item names and real HSN codes, which is the whole point.
    expect(catalog).toContain("Meenakari jhumka");
    expect(catalog).toContain("Sheesham wood dining table");
    expect(catalog).toContain("7117");

    // And the caveat travels with the data rather than being left behind.
    expect(catalog).toContain("not authoritative tax guidance");
  });

  it("reads from the documented path, which next.config.ts must match", () => {
    // The one thing that has to stay in step: output tracing cannot see through
    // a runtime readFileSync, so if CATALOG_PATH moves without the
    // outputFileTracingIncludes entry moving too, the catalogue vanishes from
    // production builds only — where no test would be watching.
    expect(CATALOG_PATH).toBe(join("lib", "data", "indian-invoice-items.md"));
    const source = readFileSync(join(process.cwd(), CATALOG_PATH), "utf8");
    expect(extractCatalog(source)).toBe(readItemCatalog());
  });

  it("fits inside the prompt budget without being truncated", () => {
    // If the catalogue outgrows the cap, this fails rather than the tail of it
    // quietly disappearing from the prompt.
    const source = readFileSync(join(process.cwd(), CATALOG_PATH), "utf8");
    expect(extractCatalog(source)!.length).toBeLessThan(MAX_CATALOG_CHARS);
  });
});

describe("buildQuickFillSystemPrompt", () => {
  it("appends the catalogue and tells the model what to do with it", () => {
    const prompt = buildQuickFillSystemPrompt("### Motor parts\n| Brake Pad Set | 8708 | 28% |");

    expect(prompt).toContain("Brake Pad Set");
    expect(prompt).toContain("real Indian invoice items");
    expect(prompt).toContain("rather than generic English");
    // The base instruction is still all there.
    expect(prompt).toContain("You choose the ITEM MIX");
    expect(prompt).toContain("JSON only");
  });

  it("returns the base instruction untouched when there is no catalogue", () => {
    for (const catalog of [undefined, "", "   \n  "]) {
      const prompt = buildQuickFillSystemPrompt(catalog);
      expect(prompt).not.toContain("real Indian invoice items");
      expect(prompt).toContain("You choose the ITEM MIX");
    }
  });

  it("carries the catalogue in the system turn, not the user turn", () => {
    // The user's description must stay the only untrusted text in the request;
    // app-supplied reference material belongs on the other side of that line.
    const body = buildQuickFillRequestBody({
      description: "motor parts order",
      catalog: "### Motor parts\n| Brake Pad Set | 8708 | 28% |",
    });

    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Brake Pad Set");
    expect(body.messages[1].content).not.toContain("Brake Pad Set");
  });
});
