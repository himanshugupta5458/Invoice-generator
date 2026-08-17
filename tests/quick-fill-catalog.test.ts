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
  it("keeps what is below the Catalogue heading and drops the prose above it", () => {
    const source = [
      "---",
      "name: indian-invoice-items",
      "---",
      "",
      "# Indian invoice items",
      "",
      "Notes for whoever edits this file.",
      "",
      "## Catalogue",
      "",
      "### Artificial jewellery",
      "",
      "| Oxidised Jhumka Earrings | 7117 | 3% |",
    ].join("\n");

    const catalog = extractCatalog(source);
    expect(catalog).toContain("Artificial jewellery");
    expect(catalog).toContain("7117");
    // The contributor-facing half would only spend tokens.
    expect(catalog).not.toContain("Notes for whoever edits");
    expect(catalog).not.toContain("name: indian-invoice-items");
  });

  it("is undefined when there is no catalogue in the file", () => {
    expect(extractCatalog("# Just prose, no heading")).toBeUndefined();
    expect(extractCatalog("")).toBeUndefined();
    // A heading with nothing under it is the same as no catalogue.
    expect(extractCatalog("## Catalogue\n\n   \n")).toBeUndefined();
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
  it("reads the skill file that ships with the repo", () => {
    const catalog = readItemCatalog();

    expect(catalog).toBeDefined();
    // The scaffolded categories the prompt depends on being there.
    expect(catalog).toContain("Artificial jewellery");
    expect(catalog).toContain("Motor parts");
    expect(catalog).toContain("HSN/SAC");
  });

  it("reads from the documented path", () => {
    // Guards the one thing next.config.ts has to keep in step: if this path
    // moves, the outputFileTracingIncludes entry has to move with it or the
    // catalogue vanishes from production builds only.
    const source = readFileSync(join(process.cwd(), CATALOG_PATH), "utf8");
    expect(extractCatalog(source)).toBe(readItemCatalog());
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
