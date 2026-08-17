/**
 * The Indian item catalogue Quick Fill grounds its descriptions in (§16).
 *
 * Left to itself a model writes "Wooden Table" and "Decorative Lamp" — plausible
 * English, and nothing like what a shop in Karol Bagh puts on a bill. The
 * catalogue at `.claude/skills/indian-invoice-items/SKILL.md` lists real item
 * names with their HSN codes and usual slabs, by trade, and this module reads it
 * so the route can append it to the model's standing instruction.
 *
 * This is the ONLY module in `lib/` that touches the filesystem, which is why it
 * is a module of its own: `lib/quick-fill.ts` stays pure and testable, and takes
 * the catalogue as a plain string argument (§16 structure rules). Nothing here
 * runs in the browser.
 *
 * Two deliberate choices:
 *
 *  - **It degrades to absent.** A missing, unreadable, or empty file is not an
 *    error — Quick Fill simply generates without the grounding, exactly as it did
 *    before the catalogue existed. The feature is an exploration aid; losing some
 *    of its polish must never turn into a 500.
 *  - **It is read per request, not cached at module load.** A `readFileSync` of a
 *    few kilobytes is nothing beside the ~1s Groq call in the same handler, and
 *    reading each time means editing the catalogue takes effect immediately
 *    rather than after a restart — which is the whole point of keeping it in a
 *    markdown file somebody can edit.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the catalogue lives, relative to the project root.
 *
 * Note the coupling: an app route reads a file out of the agent tooling
 * directory. It is there so that the skill a person edits and the reference the
 * model receives are the same file rather than two copies that drift apart.
 * `next.config.ts` lists it in `outputFileTracingIncludes` so it is bundled with
 * the route — static analysis cannot see through a `readFileSync` path, so
 * without that entry it would be missing from a production deploy.
 */
export const CATALOG_PATH = join(
  ".claude",
  "skills",
  "indian-invoice-items",
  "SKILL.md",
);

/**
 * Everything after the `## Catalogue` heading is for the model. The prose above
 * it explains the file to a human contributor and would only spend tokens.
 */
const CATALOG_HEADING = "## Catalogue";

/**
 * Cap on what is appended to the prompt.
 *
 * The catalogue is meant to grow, and a model's context is not free — nor is a
 * shared free-tier request. Truncation is at a line boundary so a table never
 * arrives cut in half mid-row.
 */
export const MAX_CATALOG_CHARS = 8000;

/**
 * Pull the model-facing half out of the skill file's text.
 *
 * Pure, and exported separately from the reading so it can be tested without a
 * filesystem: given the file, this is exactly what the model will be shown.
 */
export function extractCatalog(source: string): string | undefined {
  const start = source.indexOf(CATALOG_HEADING);
  if (start === -1) return undefined;

  const body = source.slice(start + CATALOG_HEADING.length).trim();
  if (body === "") return undefined;

  if (body.length <= MAX_CATALOG_CHARS) return body;

  // Cut back to the last complete line inside the budget.
  const clipped = body.slice(0, MAX_CATALOG_CHARS);
  const lastBreak = clipped.lastIndexOf("\n");
  return (lastBreak > 0 ? clipped.slice(0, lastBreak) : clipped).trimEnd();
}

/**
 * Read the catalogue, or return undefined if it is not there to be read.
 *
 * Never throws: a catalogue that cannot be loaded costs the generated rows some
 * authenticity, and nothing else.
 */
export function readItemCatalog(): string | undefined {
  try {
    return extractCatalog(
      readFileSync(join(process.cwd(), CATALOG_PATH), "utf8"),
    );
  } catch {
    // Absent in a deploy that did not include it, or unreadable. Either way the
    // feature carries on without it.
    return undefined;
  }
}
