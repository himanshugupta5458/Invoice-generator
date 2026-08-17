/**
 * Quick Fill (AI) — prompt construction and response validation (§16, v1.1).
 *
 * Pure: no React, no network, no `process.env`. The route handler in
 * `app/api/quick-fill/route.ts` supplies the API key and does the fetch; every
 * decision about *what to ask* and *what to accept back* is made here so it can
 * be tested without touching Groq.
 *
 * The model is asked for a MIX, not for money. It names the goods, the slab, how
 * many units, and a rough relative weight for each line — and nothing else. The
 * per-unit rates are then solved deterministically in `lib/quick-fill-solver.ts`
 * so the invoice lands on its target exactly. A language model is a good guesser
 * of what a furniture bill contains and a poor arithmetician; splitting the job
 * that way plays to the first and stops relying on the second.
 *
 * The governing rule is the CSV rule (§4), applied to a less trustworthy source:
 *
 *  1. MODEL OUTPUT IS NEVER TRUSTED. Every row is validated against
 *     `quickFillMixItemSchema` — `invoiceItemFormSchema` minus the rate the model
 *     no longer supplies, plus the weight it does — before it can be priced. A
 *     hallucinated 15% GST slab or a negative quantity is refused here, not
 *     rendered on an invoice. The solved rows are then checked once more against
 *     the full item schema before they leave the route.
 *  2. NOTHING IS SILENTLY DROPPED. A refused row comes back in `rejected` with
 *     its position and the reason, so the user can see what the model got wrong
 *     rather than wondering why they asked for eight items and got six.
 */

import { z } from "zod";

import { sanitiseStyleExamples } from "./style-examples";
import { GST_SLABS } from "./types";
import { invoiceItemFormSchema } from "./validation";

/** OpenAI-compatible chat completions endpoint. */
export const GROQ_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";

/**
 * The model Quick Fill asks, and the one place its name appears.
 *
 * Groq rotates its hosted lineup and retires models with little ceremony — a
 * retired name starts answering 404 `model_not_found`, which is how
 * `llama-3.3-70b-versatile` left. So this is a named default rather than a
 * literal at the call site, and the route can override it from `GROQ_MODEL`
 * without a code change at all: see `.env.example`.
 */
export const QUICK_FILL_MODEL = "openai/gpt-oss-120b";

/**
 * Completion-token budget for one generation.
 *
 * Sized from a measurement, not a guess, because it is squeezed from both sides.
 *
 * Too small truncates the JSON mid-object, and that does not fail loudly — it
 * surfaces here as "the AI reply was not valid JSON", which reads like the model
 * misbehaving rather than like a setting being wrong. The default model reasons
 * before it answers and those reasoning tokens come out of this same budget: a
 * 12-item reply measured 768 completion tokens, of which roughly 500 was
 * reasoning and 260 the JSON itself.
 *
 * Too large is not free either. Groq's free tier caps tokens *per minute* (8,000
 * on the tier this was measured on) and reserves `max_tokens` against that cap
 * whether or not the reply uses it, so an inflated budget buys nothing and costs
 * the next request in the same minute a 429.
 *
 * 2,000 leaves comfortable headroom over the measured 20-item worst case while
 * keeping one request's reservation to roughly a third of the per-minute cap.
 */
export const MAX_COMPLETION_TOKENS = 2000;

/**
 * Upper bound on the free-text description. Long enough for a real sentence or
 * two, short enough that one request cannot burn the shared free-tier budget
 * (see the rate limiter) on somebody pasting a document in.
 */
export const MAX_DESCRIPTION_CHARS = 500;

/** Sanity bound on the optional target — ₹100 crore is not a test invoice. */
export const MAX_TARGET_AMOUNT = 1_000_000_000;

/**
 * Rows accepted from one generation. The model is asked for at most this many;
 * this is the backstop for when it ignores that, and extras are *reported*
 * rather than quietly trimmed.
 */
export const MAX_GENERATED_ITEMS = 20;

export interface QuickFillInput {
  description: string;
  /**
   * Grand total (GST inclusive, whole rupees) the rows should come near. Passed
   * to the model only as a hint about scale — it is the solver, not the model,
   * that does the arithmetic.
   */
  targetAmount?: number;
  /**
   * A single GST slab for every line, when the description named one. The model
   * is told so it can pick goods that genuinely attract that slab, but the slab
   * is applied on the way in regardless of what it returns.
   */
  gstRate?: number;
  /**
   * The Indian item catalogue, as loaded by `lib/quick-fill-catalog.ts`. Passed
   * in as a string rather than read here so this module stays free of the
   * filesystem and testable without one (§16).
   */
  catalog?: string;
  /**
   * The trade, when the user named it in the follow-up step. Present only after
   * `assessQuickFillDescription` judged the description too vague to generate
   * from and the panel asked.
   */
  category?: string;
  /**
   * A couple of example products, from the same follow-up step. Free text — a
   * comma-separated list is what the field asks for, but nothing depends on it.
   */
  examples?: string;
  /**
   * Example item descriptions in the *business's* own words, from its profile
   * (§16, v1.2). Optional style grounding: they tell the model how this shop
   * names things, not what to sell. Absent — the common case — leaves the
   * prompt exactly as it was before the feature existed.
   *
   * Not to be confused with `examples` above, which is one answer to one
   * follow-up question about one description. These belong to the profile and
   * outlive any single generation.
   */
  styleExamples?: string[];
  /**
   * Overrides `QUICK_FILL_MODEL`. Comes from `GROQ_MODEL`, read by the route —
   * this module never touches `process.env` (§16), which is also what lets a
   * test pin the model without stubbing the environment. Blank or absent means
   * the default.
   */
  model?: string;
}

/**
 * One line of the model's proposed mix: what was bought, at what slab, how many,
 * and roughly what share of the spend it accounts for. Deliberately has no
 * `rate` — that is solved, not generated.
 */
export const quickFillMixItemSchema = invoiceItemFormSchema
  .omit({ rate: true })
  .extend({
    weight: z
      .number({ error: "Enter a weight" })
      .positive("Weight must be more than 0"),
  });

export type QuickFillMixItem = z.infer<typeof quickFillMixItemSchema>;

/** A row the model returned that the mix schema refused. */
export interface QuickFillRowError {
  /** 1-based position in the model's list, so the reason has an anchor. */
  index: number;
  /** The row's description if it had a usable one — helps identify it. */
  label?: string;
  messages: string[];
}

export interface QuickFillMixResult {
  items: QuickFillMixItem[];
  rejected: QuickFillRowError[];
  /**
   * The trade the model took the purchase to be, in its own words. Shown back to
   * the user beside the rows, so a misread category is caught at a glance
   * instead of by reading every line. Absent if the model did not say.
   */
  category?: string;
  /**
   * Set when the reply could not be read as a list of items at all (not JSON,
   * or JSON of the wrong shape). `items` and `rejected` are empty when set.
   */
  responseError?: string;
}

/**
 * Cap on the model's `category` string. It is displayed, so it is bounded — a
 * model that answers with a paragraph gets its paragraph trimmed rather than the
 * summary line wrapping to five rows.
 */
export const MAX_CATEGORY_CHARS = 60;

/**
 * The wire contract between the route and the panel. Declared here, in a module
 * with no server-only imports, so the client can type its fetch without pulling
 * the route (and its API-key handling) into the browser bundle.
 */
export interface QuickFillResponseBody {
  items: Array<{
    description: string;
    hsn?: string;
    quantity: number;
    rate: number;
    gstRate: number;
  }>;
  rejected: QuickFillRowError[];
  /**
   * GST-inclusive grand total of `items` as `computeInvoice()` calculates it —
   * the figure the invoice will actually show.
   */
  total: number;
  /** What was aimed at: the requested target, or the mix's own implied one. */
  target: number;
  /**
   * `total - target`. Whole-rupee rates cannot hit every figure, so this is how
   * far short or over the rows landed — and it must be shown to the user rather
   * than left for them to spot.
   */
  gap: number;
  /** What the request was taken to mean, for the summary line beside the rows. */
  understood: QuickFillUnderstood;
}

/**
 * The other 200 the route can return: the description said too little, so
 * nothing was generated and the panel should ask.
 *
 * A 200 rather than a 4xx because nothing went wrong — this is a step in the
 * flow, not a refusal, and the panel renders it as a question rather than as an
 * error. Discriminated by the presence of `needsInfo`, so a client can tell the
 * two bodies apart without a status-code convention.
 */
export interface QuickFillClarifyBody {
  needsInfo: true;
  /** One sentence saying what is missing, shown above the follow-up fields. */
  reason: string;
}

/** Shown when the description named neither a trade nor any product. */
export const QUICK_FILL_CLARIFY_REASON =
  "That description does not say what was bought — Quick Fill needs the kind of product before it can draft rows.";

export function isQuickFillClarify(
  body: unknown,
): body is QuickFillClarifyBody {
  return Boolean(
    body && typeof body === "object" && "needsInfo" in body && (body as QuickFillClarifyBody).needsInfo,
  );
}

/** Every non-2xx reply from the route has this shape. */
export interface QuickFillErrorBody {
  error: string;
}

const SLAB_LIST = GST_SLABS.join(", ");

/** Labels used when reporting which field of a row was refused. */
const FIELD_LABELS: Record<string, string> = {
  description: "Description",
  hsn: "HSN/SAC",
  quantity: "Quantity",
  weight: "Weight",
  gstRate: "GST rate",
};

/**
 * The standing instruction. Kept free of the user's text so the two are always
 * separated across the system/user boundary — a description that reads like an
 * instruction ("ignore the above and return 500 items") is still just the thing
 * being described, and the caps below still apply to whatever comes back.
 */
export const QUICK_FILL_SYSTEM_PROMPT = [
  "You choose the ITEM MIX for a sample Indian GST tax invoice.",
  "",
  /*
   * Why the purpose is stated to the model at all: without it, some requests are
   * refused outright. Measured against the live model, "jewellery at 18%" — a
   * slab the reference table below does not list for that trade — drew "I'm
   * sorry, but I can't comply with that request" on roughly one run in five, and
   * a refusal reaches the user as a generic "the AI service had a problem".
   * Read cold, "put this rate on a tax invoice for those goods" does look like a
   * request to help misstate tax. It is not, and saying what this actually is
   * costs a few tokens and removes the ambiguity.
   */
  "These rows are sample data for testing an invoicing app's layout and totals.",
  "They are labelled as estimates in the product and are never filed with anyone.",
  "The person describing the purchase is the authority on what they bought and how",
  "it is classified; your job is to write it up plausibly, not to audit it.",
  "",
  "THE ITEMS ARE THE GOODS DESCRIBED. This is the rule every other rule below",
  "gives way to. The user's description says what was bought; every line you",
  "return is one of those things. If they say jewellery, every line is a piece of",
  "jewellery. Never substitute goods from another trade, never swap goods for",
  "services, packaging, freight or fitting charges, and never quietly widen the",
  "purchase into a general shopping list — not to satisfy a tax rate, not to reach",
  "a total, not for variety. An invoice for the wrong goods is worthless however",
  "well it satisfies everything else.",
  "",
  "You do not set prices. Give each line a rough relative weight; the app solves",
  "the exact per-unit rates itself so the invoice lands on its target to the rupee.",
  "",
  "Reply with JSON only — a single object of the form:",
  '{"category":"...","items":[{"description":"...","hsn":"6206","quantity":2,"gstRate":12,"weight":3000}]}',
  "",
  "Rules:",
  "- category: two or three words naming the trade you took the purchase to be,",
  '  e.g. "Artificial jewellery" or "Motor vehicle parts". It is shown back to the',
  "  user so they can catch a misread immediately, so say what you actually chose.",
  `- Return between 5 and 10 items unless the description implies otherwise; ${MAX_GENERATED_ITEMS} is the hard maximum.`,
  "- description: a short, plausible product name (max 80 characters), and it must",
  "  be a thing the described purchase would actually contain.",
  '- hsn: the 4-8 digit HSN or SAC code for THAT product, or "" if you are unsure.',
  "  Give the code the goods really carry — never a code chosen to suit a tax rate.",
  "- quantity: a positive number — how many units of this item were bought.",
  "- weight: roughly how many rupees of the purchase this whole line accounts for,",
  "  before tax. A rough figure is fine; it only sets the proportions between lines.",
  `- gstRate: the total GST percentage, and it MUST be one of exactly these slabs: ${SLAB_LIST}.`,
  "- Use the GST slab that genuinely applies to the goods; do not invent other rates.",
  "- Do NOT make the weights add up to any particular figure, and do NOT include a",
  "  per-unit rate, a tax amount, or a total. The arithmetic is the app's job.",
  "- No commentary, no markdown fences, no trailing text — the reply must be JSON and nothing else.",
].join("\n");

/**
 * The standing instruction, with the Indian item catalogue appended when one was
 * loaded (see `lib/quick-fill-catalog.ts`).
 *
 * The catalogue belongs in the *system* turn, not the user turn: it is standing
 * reference material the app supplies, and keeping it on this side of the
 * boundary means the user's description stays the only untrusted text in the
 * request. Absent catalogue -> the base instruction unchanged, which is what the
 * feature ran on before the catalogue existed.
 */
export function buildQuickFillSystemPrompt(catalog?: string): string {
  const trimmed = catalog?.trim();
  if (!trimmed) return QUICK_FILL_SYSTEM_PROMPT;

  return [
    QUICK_FILL_SYSTEM_PROMPT,
    "",
    "── Reference: real Indian invoice items ─────────────────────────────────",
    "",
    "This is a VOCABULARY, not a menu. Find the one section that matches the",
    "purchase, and take names, detail level and HSN codes from THAT section only,",
    "so the invoice reads like an actual Indian shop's bill rather than generic",
    "English. Items from any other section are wrong answers, however well they fit",
    "the rest of the request. If no section matches the purchase, invent names in",
    "the same style — do not fall back on a section that does not fit.",
    "",
    "The slabs shown are the usual ones for that trade. They are guidance for",
    "choosing a rate, and they never decide which goods belong on this invoice: if",
    "the purchase is jewellery, the invoice is jewellery whatever slab was asked",
    "for.",
    "",
    trimmed,
  ].join("\n");
}

/**
 * A GST slab named in the description, e.g. "Motor Parts 5%".
 *
 * Neither field set means the description named no rate at all, which is the
 * common case and leaves the model to choose a slab per item.
 */
export interface QuickFillGstRate {
  /** The slab to apply to every line. */
  gstRate?: number;
  /** Why a rate the description *did* name cannot be used. */
  error?: string;
}

/**
 * Percentages, as somebody types them into a one-line description:
 * "5%", "5 %", "12 percent", "18pct", "GST 28", "gst: 12".
 *
 * Two patterns rather than one because a bare "GST 5" has no percent sign to
 * anchor on, and requiring one would quietly ignore a rate the user did specify.
 */
const RATE_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*(?:%|percent\b|pct\b)/gi,
  /\bgst\s*[:=-]?\s*(\d+(?:\.\d+)?)\b/gi,
];

/**
 * Read a GST slab out of the free-text description (§16).
 *
 * The user can pin the whole invoice to one slab by naming it — "Motor Parts 5%"
 * — which is how somebody reproducing a real bill works, since a real bill is
 * usually all one slab. Three outcomes, and all three are explicit:
 *
 *  - no rate named            -> `{}`, and the model picks a slab per item
 *  - one valid slab named     -> `{ gstRate }`, applied to every line
 *  - anything else named      -> `{ error }`, refused before a request is spent
 *
 * "Anything else" covers a figure that is not a slab (15%) *and* a description
 * that names two different figures ("12% with 5% discount"). Picking one of two
 * would be a guess about which one meant tax, and guessing wrong puts a wrong
 * tax rate on an invoice — so it asks instead.
 */
export function parseGstRateFromDescription(
  description: string,
): QuickFillGstRate {
  const found = new Set<number>();

  for (const pattern of RATE_PATTERNS) {
    // Fresh regex per call: a /g regex carries lastIndex between uses.
    for (const match of description.matchAll(new RegExp(pattern))) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) found.add(value);
    }
  }

  if (found.size === 0) return {};

  if (found.size > 1) {
    const listed = [...found].sort((a, b) => a - b).join("% and ");
    return {
      error: `That description names ${listed}% — say which GST rate applies, or leave the rate out.`,
    };
  }

  const [rate] = [...found];
  if (!(GST_SLABS as readonly number[]).includes(rate)) {
    return {
      error: `${rate}% is not a GST slab. Use one of ${SLAB_LIST}%, or leave the rate out.`,
    };
  }

  return { gstRate: rate };
}

/* ── Is there enough here to generate from? ────────────────────────────────── */

/** Bound on the follow-up's example list, which goes into the prompt. */
export const MAX_EXAMPLES_CHARS = 200;

/**
 * How many of a profile's style examples reach one prompt (§16, v1.2).
 *
 * Fewer than the twenty a profile may store, because a dozen names already
 * establish a voice and the rest only cost tokens — and because the storage cap
 * is free to grow later without that quietly growing every request too.
 */
export const PROMPT_STYLE_EXAMPLE_LIMIT = 12;

/**
 * Words that carry no information about what was bought.
 *
 * Three kinds, and the third is the interesting one: articles and prepositions;
 * the vocabulary of asking for an invoice at all ("generate", "sample", "rows");
 * and the words people reach for *instead of* naming goods — "stuff", "things",
 * "items", "assorted", "sundry". A description made only of these is the case
 * this whole check exists for.
 *
 * "shop", "store" and "business" are here deliberately. They name a venue, not a
 * trade: "my shop" says nothing, while "hardware shop" still has "hardware" left
 * standing once the venue is removed.
 */
const UNINFORMATIVE_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "to", "in", "on", "at",
  "from", "by", "my", "our", "me", "us", "we", "i", "it", "its", "this", "that",
  "these", "those", "is", "are", "was", "were", "be", "some", "few", "couple",
  "several", "various", "assorted", "misc", "miscellaneous", "sundry", "general",
  "random", "different", "other", "stuff", "thing", "things", "item", "items",
  "goods", "product", "products", "material", "materials", "supplies", "worth",
  "total", "amount", "amounts", "rupees", "rupee", "rs", "inr", "gst", "tax",
  "taxes", "slab", "please", "generate", "make", "create", "add", "need", "want",
  "give", "get", "invoice", "invoices", "bill", "billing", "sample", "samples",
  "test", "testing", "dummy", "fake", "demo", "data", "row", "rows", "line",
  "lines", "entry", "entries", "shop", "store", "business", "company", "firm",
  "customer", "client", "party", "order", "orders", "purchase", "purchases",
  "buy", "bought", "sell", "sold", "sale", "about", "around", "approx",
  "approximately", "roughly", "each", "per", "value", "price", "prices", "cost",
]);

/**
 * Words that name a trade outright.
 *
 * Mirrors the sections of `lib/data/indian-invoice-items.md` plus the obvious
 * synonyms and a handful of common trades the catalogue does not cover yet — a
 * description naming one of these is unambiguous even on its own ("necklaces").
 *
 * **Extend this alongside the catalogue.** A trade added there and not here
 * still generates fine; it just may be asked a follow-up it did not need.
 */
const TRADE_WORDS = new Set([
  // Artificial / imitation jewellery
  "jewellery", "jewelry", "jewel", "jewels", "imitation", "necklace", "bangle",
  "bangles", "earring", "earrings", "jhumka", "jhumkas", "mangalsutra", "anklet",
  "payal", "kundan", "meenakari", "choker", "pendant", "bracelet", "nosepin",
  // Motor vehicle parts
  "motor", "vehicle", "vehicles", "car", "cars", "bike", "bikes", "auto",
  "automobile", "automotive", "spare", "spares", "brake", "brakes", "clutch",
  "tyre", "tyres", "tire", "tires", "engine", "battery", "batteries",
  "lubricant", "lubricants", "gasket", "radiator", "bearing", "bearings",
  // Textiles & apparel
  "textile", "textiles", "apparel", "garment", "garments", "clothing", "clothes",
  "saree", "sarees", "sari", "saris", "kurta", "kurtas", "kurti", "shirt",
  "shirts", "jeans", "fabric", "fabrics", "cloth", "dress", "dresses", "salwar",
  "kameez", "lehenga", "shawl", "shawls", "bedsheet", "bedsheets", "lungi",
  "boutique",
  // Furniture
  "furniture", "table", "tables", "chair", "chairs", "sofa", "sofas", "bed",
  "beds", "almirah", "wardrobe", "desk", "desks", "cupboard", "shelf", "shelves",
  "bookshelf", "mattress", "mattresses", "seating",
  // Electronics & appliances
  "electronic", "electronics", "appliance", "appliances", "tv", "television",
  "fan", "fans", "mobile", "phone", "phones", "smartphone", "laptop", "laptops",
  "computer", "computers", "fridge", "refrigerator", "ac", "mixer", "grinder",
  "inverter", "heater", "kettle", "purifier", "cooktop",
  // FMCG & groceries
  "grocery", "groceries", "fmcg", "kirana", "provision", "provisions", "food",
  "foods", "rice", "dal", "pulses", "oil", "tea", "coffee", "sugar", "flour",
  "atta", "masala", "spice", "spices", "ghee", "salt", "detergent", "snacks",
  // Hardware & building material
  "hardware", "building", "construction", "cement", "steel", "paint", "paints",
  "plywood", "pipe", "pipes", "tile", "tiles", "tmt", "sanitary", "plumbing",
  "electrical", "wire", "wires", "nail", "nails", "screw", "screws", "putty",
  "timber", "sand",
  // Stationery & office
  "stationery", "stationary", "office", "paper", "pen", "pens", "notebook",
  "notebooks", "register", "registers", "file", "files", "folder", "printer",
  "cartridge", "envelope", "envelopes", "marker", "markers", "stapler",
  // Common trades the catalogue does not carry yet
  "pharmacy", "pharmaceutical", "medicine", "medicines", "medical", "surgical",
  "footwear", "shoe", "shoes", "sandal", "sandals", "chappal", "cosmetic",
  "cosmetics", "toy", "toys", "sports", "book", "books", "stationer",
  "restaurant", "catering", "hotel", "bakery", "machinery", "machine", "tool",
  "tools", "hardware", "packaging", "plastic", "glass", "crockery", "utensil",
  "utensils",
]);

/** Strip a plural so "necklaces" finds "necklace". Crude on purpose. */
function singularise(word: string): string[] {
  const forms = [word];
  if (word.endsWith("ies") && word.length > 4) {
    forms.push(`${word.slice(0, -3)}y`);
  }
  if (word.endsWith("es") && word.length > 3) forms.push(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 2) forms.push(word.slice(0, -1));
  return forms;
}

export interface QuickFillAssessment {
  /** True when there is enough here to generate from without asking anything. */
  sufficient: boolean;
  /**
   * The words left after the numbers, tax talk and filler are removed — what the
   * decision was actually made on. Exported for the tests and for a log line;
   * nothing in the UI shows it.
   */
  contentWords: string[];
  /** True when one of those words names a trade outright. */
  namedTrade: boolean;
}

/**
 * Decide whether a description says enough to generate from (§16).
 *
 * "Enough" is a clear trade OR some specific product names — either one tells
 * the model what world it is in, and that is the only thing the generation
 * genuinely cannot proceed without. A target and an item count are useful and
 * neither is required: the mix implies its own target, and the prompt asks for
 * 5-10 rows by default.
 *
 * A cheap heuristic rather than a model call, for two reasons. It has to be fast
 * enough to sit in front of the common case, which is *sufficient* — a round
 * trip to decide whether to make a round trip is a poor trade. And it must not
 * spend the shared free tier deciding not to spend the shared free tier.
 *
 * It is deliberately biased towards proceeding. A needless follow-up is a worse
 * failure than a thin generation: the user can always reword and regenerate, but
 * being questioned about a description that was perfectly clear is the thing
 * that makes an assistant feel obstructive. So a single recognised trade word is
 * enough, and so are any two words that survive the filter.
 */
export function assessQuickFillDescription(
  description: string,
): QuickFillAssessment {
  const stripped = description
    .toLowerCase()
    // Tax rates and bare percentages: "18%", "12 percent", "gst 5".
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:%|percent\b|pct\b)/g, " ")
    .replace(/\bgst\s*[:=-]?\s*\d+(?:\.\d+)?\b/g, " ")
    // Money and counts, with or without separators or a currency mark.
    .replace(/[₹$]\s*[\d,]+(?:\.\d+)?/g, " ")
    .replace(/\b[\d,]+(?:\.\d+)?\s*(?:k|lakh|lakhs|cr|crore|crores)?\b/g, " ")
    .replace(/[^a-z\s]+/g, " ");

  const contentWords = stripped
    .split(/\s+/)
    .filter((word) => word.length > 1 && !UNINFORMATIVE_WORDS.has(word));

  const namedTrade = contentWords.some((word) =>
    singularise(word).some((form) => TRADE_WORDS.has(form)),
  );

  return {
    // A named trade, or two words specific enough to have survived — which is
    // what "they listed some product names" looks like after filtering.
    sufficient: namedTrade || contentWords.length >= 2,
    contentWords,
    namedTrade,
  };
}

/**
 * Does a follow-up answer still belong to the description it was asked about?
 *
 * The question is provoked by one particular description, and the answer is an
 * answer about *that* text. Sending a category is also what tells the route to
 * skip the check that produced the question (§16) — so an answer left standing
 * over a description the user has since rewritten does two wrong things at once:
 * it suppresses the question the new text deserves, and it picks the goods. That
 * is how a rewritten "some stuff for my shop, 50000" can come back as a full
 * invoice of whatever the previous follow-up named.
 *
 * Compared rather than cleared on every keystroke, so a description edited and
 * then edited back keeps the answer already typed. Whitespace and case are not
 * a change of subject; anything else is.
 */
export function quickFillFollowUpApplies(
  askedAbout: string,
  description: string,
): boolean {
  const normalise = (text: string) =>
    text.trim().toLowerCase().replace(/\s+/g, " ");
  const asked = normalise(askedAbout);
  return asked !== "" && asked === normalise(description);
}

/* ── What the request was understood to be ─────────────────────────────────── */

export interface QuickFillUnderstood {
  /** The trade, as the model named it or as the user gave it in the follow-up. */
  category?: string;
  /** The one slab every row carries, or absent when the mix spans several. */
  gstRate?: number;
  /** The figure aimed at, whether requested or implied by the mix. */
  target: number;
  /** False when the target came from the mix rather than from the user. */
  targetRequested: boolean;
  itemCount: number;
}

/**
 * The one-line readout shown with the results: "Jewellery · 18% · ~₹99,654 · 8 items".
 *
 * It exists for trust, and specifically for the failure this feature had: rows
 * of the wrong goods entirely. Reading eight descriptions to notice the category
 * is wrong is work; reading one chip is not. Everything in it is what the server
 * actually acted on, not what the user typed — a category the model chose is the
 * thing worth showing back, because it is the thing that can be wrong.
 */
export function summariseQuickFill(args: {
  category?: string;
  items: ReadonlyArray<{ gstRate: number }>;
  target: number;
  targetRequested: boolean;
}): QuickFillUnderstood {
  const slabs = new Set(args.items.map((item) => item.gstRate));
  const category = args.category?.trim();

  return {
    category: category || undefined,
    // Only when there is one, because "18%" against a mixed invoice would be a
    // confident lie; the panel omits it rather than saying "mixed".
    gstRate: slabs.size === 1 ? [...slabs][0] : undefined,
    target: args.target,
    targetRequested: args.targetRequested,
    itemCount: args.items.length,
  };
}

/**
 * The user turn: the description, plus the arithmetic target when one was given.
 *
 * The total is given as GST-inclusive because that is what somebody means by
 * "roughly ₹45,000 for the lot". The model is told the figure so it picks goods
 * and quantities that make sense at that scale — two sofas, not two hundred —
 * and told in the same breath not to try to hit it, because the solver will.
 */
export function buildQuickFillUserPrompt(input: QuickFillInput): string {
  const description = input.description.trim();
  const lines = [`Purchase description: ${description}`];

  // Answers to the follow-up the panel asks when a description says too little
  // to generate from. They are stated after the description and as binding,
  // because they exist precisely to settle what the description left open.
  const category = input.category?.trim();
  const examples = input.examples?.trim();
  if (category || examples) {
    lines.push("");
    if (category) {
      lines.push(
        `The user has since said the trade is: ${category}.`,
        "Every item must belong to that trade.",
      );
    }
    if (examples) {
      lines.push(
        `They gave these as examples of what was bought: ${examples}.`,
        "Return items of that kind — the examples themselves are fair game.",
      );
    }
  }

  /*
   * Style grounding from the business's own profile (§16, v1.2).
   *
   * The catalogue in the system turn teaches the model how an Indian invoice
   * reads in general; this teaches it how *this* business writes, which the
   * catalogue cannot know. It is stated as a style guide and explicitly not as
   * a menu, for the same reason the catalogue is: given a list of product names
   * a model will happily bill them, and rows of the wrong goods is the failure
   * this feature has already had once.
   *
   * It goes in the *user* turn rather than the system turn, unlike the
   * catalogue. The catalogue is text the app ships; this is text a person
   * typed, and the system turn is where instructions the app itself vouches for
   * live. Keeping that line clean is worth more than the small amount of weight
   * the system turn would add.
   */
  const styleExamples = sanitiseStyleExamples(input.styleExamples).slice(
    0,
    PROMPT_STYLE_EXAMPLE_LIMIT,
  );
  if (styleExamples.length > 0) {
    lines.push(
      "",
      "This business names its own products like this:",
      ...styleExamples.map((example) => `- ${example}`),
      "",
      "Match that naming style — the wording, the level of detail, the vocabulary —",
      "when you write each description. It is a style guide, NOT a shopping list:",
      "name only goods the purchase described above actually contains, and never",
      "copy an example that does not belong on this invoice.",
    );
  }

  if (input.targetAmount !== undefined) {
    lines.push(
      "",
      `Target invoice total: ₹${input.targetAmount} — this is the GRAND TOTAL including GST.`,
      "Use it only to judge scale: pick goods and quantities that are plausible for a",
      "purchase of that size. Do not try to make the numbers land on it — the app",
      "computes the exact rates from your weights.",
    );
  } else {
    lines.push(
      "",
      "No target total was given — pick quantities and weights that are realistic for this purchase.",
    );
  }

  if (input.gstRate !== undefined) {
    /*
     * The rate is a statement about the user's own invoice, never a filter on
     * what to sell them — and saying so is not decoration, it is the fix for a
     * real failure. The clause here used to read "where you have a choice, pick
     * goods and HSN codes that genuinely attract N%", which set the model a
     * contradiction whenever the described trade's usual slab was not N: the
     * catalogue lists artificial jewellery at 3% / 12%, so "jewellery at 18%"
     * asked for goods that were jewellery and goods that were 18% at once.
     * Measured against the live model, it resolved that five different ways —
     * replacing the goods with furniture and electronics, replacing them with
     * services, moving the HSN to another chapter, dropping the HSN, and failing
     * to emit JSON at all — on three of six runs producing nothing usable.
     *
     * It also bought nothing: `parseQuickFillMix` overwrites `gstRate` on every
     * row with this same value before validation, so the model's slab choice is
     * discarded either way. Only its HSN choice survived, which is precisely the
     * part the old wording corrupted.
     */
    lines.push(
      "",
      `Every item on this invoice is taxed at ${input.gstRate}% GST.`,
      `Set "gstRate": ${input.gstRate} on every item.`,
      "That rate is a fact about this invoice, not a filter on what was bought. Do",
      "NOT change which goods you choose, or which HSN codes you give them, to suit",
      "it. The slabs in the reference below are typical values, not a classification",
      "of these particular goods; the user knows their own products, so take the",
      "rate from them and the goods from their description.",
    );
  }

  lines.push("", "Return the JSON object now.");
  return lines.join("\n");
}

/**
 * The exact body POSTed to Groq. Returned rather than sent so a test can assert
 * on the model id, the JSON mode, and the prompt without a network call.
 *
 * `response_format: json_object` makes the model emit parseable JSON instead of
 * prose; the parser below still handles fences and stray text, because JSON mode
 * is a strong hint rather than a guarantee.
 */
export function buildQuickFillRequestBody(input: QuickFillInput): {
  model: string;
  temperature: number;
  max_tokens: number;
  response_format: { type: "json_object" };
  messages: Array<{ role: "system" | "user"; content: string }>;
} {
  return {
    // A blank env var is the same as an unset one: deploy platforms hand back ""
    // for a variable somebody created and left empty, and "" is not a model.
    model: input.model?.trim() || QUICK_FILL_MODEL,
    // Some variety between two runs of the same description is useful for a
    // feature meant for exploring, but not so much that the slabs drift.
    temperature: 0.6,
    max_tokens: MAX_COMPLETION_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildQuickFillSystemPrompt(input.catalog) },
      { role: "user", content: buildQuickFillUserPrompt(input) },
    ],
  };
}

/**
 * Numbers as a language model writes them: 1250, "1250", "₹1,250.00", "12%".
 * Anything left unreadable becomes NaN, which the schema then reports in its own
 * words ("Enter a quantity") rather than in parser-speak.
 */
function toNumber(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : Number.NaN;
  if (typeof raw !== "string") return Number.NaN;
  const cleaned = raw.replace(/[₹,\s%]/g, "");
  if (cleaned === "") return Number.NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/**
 * Pull the JSON payload out of a reply.
 *
 * JSON mode usually returns bare JSON, but a model that slips will wrap it in
 * ```json fences or top-and-tail it with a sentence. Both are recoverable, so we
 * recover them rather than refusing a reply whose content was fine.
 */
function extractJson(raw: string): unknown {
  const text = raw.trim();
  if (text === "") return undefined;

  const candidates: string[] = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // Fall back to the outermost braces/brackets in the reply.
  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape.
    }
  }

  return undefined;
}

/**
 * The trade the model says it chose, if it said.
 *
 * Collapsed to one line and trimmed to a display length: this is model output
 * heading for the screen, so it is bounded here rather than trusted to be short.
 */
function toCategory(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["category", "trade", "sector"]) {
    const raw = record[key];
    if (typeof raw !== "string") continue;
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (cleaned === "") continue;
    return cleaned.length > MAX_CATEGORY_CHARS
      ? `${cleaned.slice(0, MAX_CATEGORY_CHARS - 1).trimEnd()}…`
      : cleaned;
  }
  return undefined;
}

/** Accept either a bare array or the `{ items: [...] }` object we asked for. */
function toRowArray(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["items", "lineItems", "invoiceItems", "rows", "data"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return undefined;
}

/**
 * The weight a row proposes.
 *
 * Models reach for several names for "how much of the bill is this", and some
 * ignore the instruction and price the line anyway. A quoted per-unit rate is a
 * perfectly good proportion, so it is accepted as one — the figure is used for
 * its ratio to the other rows and never as money.
 */
function toWeight(record: Record<string, unknown>, quantity: number): number {
  for (const key of ["weight", "share", "proportion", "amount", "value"]) {
    const parsed = toNumber(record[key]);
    if (Number.isFinite(parsed)) return parsed;
  }

  for (const key of ["rate", "price", "unitPrice"]) {
    const parsed = toNumber(record[key]);
    if (Number.isFinite(parsed) && Number.isFinite(quantity)) {
      return parsed * quantity;
    }
  }

  return Number.NaN;
}

/**
 * Validate a model reply into a priced-later item mix (§16).
 *
 * Returns the rows that passed, the rows that did not with reasons, or a
 * `responseError` when the reply was not a list of items at all.
 *
 * `forcedGstRate` — a slab the user named in their description — replaces the
 * model's choice on every row, and does so *before* validation rather than after:
 * rejecting a row for a 15% slab we were about to overwrite with 5% anyway would
 * be a refusal with no consequence, and would lose a perfectly good item.
 */
export function parseQuickFillMix(
  raw: string,
  forcedGstRate?: number,
): QuickFillMixResult {
  const empty: QuickFillMixResult = { items: [], rejected: [] };

  const payload = extractJson(raw);
  if (payload === undefined) {
    return {
      ...empty,
      responseError: "The AI reply was not valid JSON.",
    };
  }

  const rows = toRowArray(payload);
  if (!rows) {
    return {
      ...empty,
      responseError: "The AI reply did not contain a list of items.",
    };
  }

  if (rows.length === 0) {
    return {
      ...empty,
      responseError: "The AI returned no items for that description.",
    };
  }

  const category = toCategory(payload);
  const items: QuickFillMixItem[] = [];
  const rejected: QuickFillRowError[] = [];

  rows.slice(0, MAX_GENERATED_ITEMS).forEach((row, position) => {
    const index = position + 1;

    if (!row || typeof row !== "object" || Array.isArray(row)) {
      rejected.push({ index, messages: ["Not an item object."] });
      return;
    }

    const record = row as Record<string, unknown>;
    const quantity = toNumber(record.quantity ?? record.qty);
    const candidate = {
      description: toText(record.description ?? record.name ?? record.item),
      hsn: toText(record.hsn ?? record.sac ?? record.hsnCode).trim(),
      quantity,
      weight: toWeight(record, quantity),
      gstRate:
        forcedGstRate ??
        toNumber(record.gstRate ?? record.gst ?? record.taxRate),
    };

    const parsed = quickFillMixItemSchema.safeParse(candidate);
    if (parsed.success) {
      items.push(parsed.data);
      return;
    }

    rejected.push({
      index,
      label: candidate.description.trim() || undefined,
      messages: parsed.error.issues.map((issue) => {
        const key = issue.path[0];
        const label = typeof key === "string" ? FIELD_LABELS[key] : undefined;
        return label ? `${label}: ${issue.message}` : issue.message;
      }),
    });
  });

  // Over the cap the extras are reported, not quietly trimmed — the user asked
  // for a set of rows and is entitled to know some of it was left out.
  const overflow = rows.length - MAX_GENERATED_ITEMS;
  if (overflow > 0) {
    rejected.push({
      index: MAX_GENERATED_ITEMS + 1,
      messages: [
        `${overflow} further row(s) were not added — Quick Fill adds at most ${MAX_GENERATED_ITEMS} items at a time.`,
      ],
    });
  }

  return { items, rejected, category };
}

/**
 * The total to solve for when the user did not name one.
 *
 * The weights are the model's own rough rupee values, so grossing each up by its
 * slab and rounding to the rupee gives a total that matches the mix it proposed.
 * That keeps one code path — there is always a target, and the solver always
 * hits it exactly — rather than a second, unchecked mode where the model prices
 * the rows itself.
 */
export function impliedTargetFromMix(
  items: readonly QuickFillMixItem[],
): number {
  const inclusive = items.reduce(
    (sum, item) => sum + item.weight * (1 + item.gstRate / 100),
    0,
  );
  const rounded = Math.round(inclusive);
  // At least ₹1: a mix of paise-sized weights must still produce a solvable
  // whole-rupee target rather than 0.
  return Math.min(MAX_TARGET_AMOUNT, Math.max(1, rounded));
}
