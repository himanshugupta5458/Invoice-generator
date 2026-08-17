/**
 * The Indian item catalogue Quick Fill grounds its descriptions in (§16).
 *
 * Left to itself a model writes "Wooden Table" and "Decorative Lamp" — plausible
 * English, and nothing like what a shop in Karol Bagh puts on a bill. The
 * catalogue at `lib/data/indian-invoice-items.md` lists real item names with
 * their HSN codes and usual slabs, by trade, and this module reads it so the
 * route can append it to the model's standing instruction.
 *
 * This is the ONLY module in `lib/` that touches the filesystem, which is why it
 * is a module of its own: `lib/quick-fill.ts` stays pure and testable, and takes
 * the catalogue as a plain string argument (§16 structure rules). Nothing here
 * runs in the browser — the route is the only caller.
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
 * Under `lib/` because it is a runtime dependency of the route, not human
 * documentation — the route stops working properly without it, which is the test
 * for whether something belongs beside the code. It stays a markdown file rather
 * than becoming a TypeScript module so that adding a category is a one-line edit
 * anyone can make, with no build step and no risk of a stray quote breaking the
 * app.
 *
 * `next.config.ts` lists this path in `outputFileTracingIncludes` so it is
 * bundled with the route: output tracing works by static analysis and cannot see
 * through a `readFileSync` path assembled at runtime, so without that entry the
 * file would be missing from production builds only. **Move this constant and
 * that entry together.**
 */
export const CATALOG_PATH = join("lib", "data", "indian-invoice-items.md");

/**
 * An optional marker for "the model-facing part starts here", for a catalogue
 * that wants a human-facing preamble longer than a comment. Absent from the
 * shipped file, and absent is fine — see `extractCatalog()`.
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
 * Pull the model-facing content out of the catalogue file's text.
 *
 * Deliberately tolerant about the file's shape, because the file is meant to be
 * edited by hand and a formatting rule enforced by returning `undefined` is a
 * trap: the catalogue would vanish from the prompt with nothing on screen to say
 * so. So the only thing required is that there is *some* content.
 *
 *  - YAML frontmatter is stripped if present, and ignored if not.
 *  - `## Catalogue` is honoured as a "starts here" marker when it is there, and
 *    not required when it is not.
 *  - HTML comments are dropped: they are notes to whoever edits the file, and
 *    the model does not need to read the editing instructions.
 *
 * Pure, and exported separately from the reading so it can be tested without a
 * filesystem: given the file, this is exactly what the model will be shown.
 */
export function extractCatalog(source: string): string | undefined {
  let body = source.replace(/^﻿/, "").trimStart();

  // Frontmatter, if the file happens to carry any.
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body);
  if (frontmatter) body = body.slice(frontmatter[0].length);

  const marked = body.indexOf(CATALOG_HEADING);
  if (marked !== -1) body = body.slice(marked + CATALOG_HEADING.length);

  body = body.replace(/<!--[\s\S]*?-->/g, "").trim();
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
