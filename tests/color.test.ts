/**
 * Accent colour + readability tests (§4, §8, and milestone 2's "colour helpers
 * + tests").
 *
 * The claim these exist to defend is the one the invoice depends on: whatever
 * accent a user picks, the text sitting on the accent band stays readable. Every
 * shipped preset must clear WCAG AA, and the white/dark switch must actually
 * fire for light accents rather than leaving white-on-cream.
 */

import { describe, expect, it } from "vitest";

import {
  ACCENT_PRESETS,
  ACCENT_TEXT_DARK,
  ACCENT_TEXT_LIGHT,
  DEFAULT_ACCENT,
  contrastRatio,
  isValidHexColor,
  normalizeHex,
  readableTextOn,
  relativeLuminance,
  resolveAccent,
} from "@/lib/color";

/** WCAG AA for normal-sized text. The band labels are small, so this is the bar. */
const AA = 4.5;

describe("normalizeHex", () => {
  it("expands shorthand and lowercases", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("7A5230")).toBe("#7a5230");
    expect(normalizeHex("  #7A5230  ")).toBe("#7a5230");
  });

  it("rejects anything that is not a hex colour", () => {
    for (const bad of ["", "#12", "#1234567", "burnt sienna", "#GGGGGG"]) {
      expect(normalizeHex(bad)).toBeNull();
      expect(isValidHexColor(bad)).toBe(false);
    }
  });
});

describe("resolveAccent", () => {
  it("falls back to the readable default rather than rendering a broken colour", () => {
    expect(resolveAccent(undefined)).toBe(DEFAULT_ACCENT);
    expect(resolveAccent("")).toBe(DEFAULT_ACCENT);
    expect(resolveAccent("nonsense")).toBe(DEFAULT_ACCENT);
    expect(resolveAccent("#ABC")).toBe("#aabbcc");
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it("anchors at the WCAG extremes", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#7a5230", "#7a5230")).toBeCloseTo(1, 5);
  });

  it("is symmetric — argument order cannot change a verdict", () => {
    expect(contrastRatio("#7a5230", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#7a5230"),
      10,
    );
  });
});

describe("readableTextOn", () => {
  it("keeps every shipped preset above WCAG AA on the accent band", () => {
    for (const preset of ACCENT_PRESETS) {
      const text = readableTextOn(preset.hex);
      const ratio = contrastRatio(preset.hex, text);
      expect(
        ratio,
        `${preset.name} (${preset.hex}) only reaches ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it("switches to dark text on a light accent and white on a dark one", () => {
    // A very light custom hex is exactly the case white text would fail.
    expect(readableTextOn("#ffffff")).toBe(ACCENT_TEXT_DARK);
    expect(readableTextOn("#fffbeb")).toBe(ACCENT_TEXT_DARK);
    expect(readableTextOn("#fde047")).toBe(ACCENT_TEXT_DARK);

    expect(readableTextOn("#000000")).toBe(ACCENT_TEXT_LIGHT);
    expect(readableTextOn("#111111")).toBe(ACCENT_TEXT_LIGHT);
    expect(readableTextOn(DEFAULT_ACCENT)).toBe(ACCENT_TEXT_LIGHT);
  });

  it("always picks whichever text colour contrasts better", () => {
    for (const hex of ["#ffffff", "#000000", "#808080", "#22a06b", "#7a5230"]) {
      const chosen = readableTextOn(hex);
      const other =
        chosen === ACCENT_TEXT_LIGHT ? ACCENT_TEXT_DARK : ACCENT_TEXT_LIGHT;
      expect(contrastRatio(hex, chosen)).toBeGreaterThanOrEqual(
        contrastRatio(hex, other),
      );
    }
  });

  it("falls back to the default accent's treatment for an invalid colour", () => {
    expect(readableTextOn("not a colour")).toBe(readableTextOn(DEFAULT_ACCENT));
  });

  /**
   * Documents a real limit rather than asserting a bug away: with only two text
   * colours, a mid-tone accent cannot reach AA either way. This is what the
   * ColorPicker's low-contrast warning exists to surface, so if the palette or
   * the text colours ever change enough to fix it, this test should be revisited.
   */
  it("cannot reach AA on a mid-tone accent — which is why the picker warns", () => {
    for (const midTone of ["#808080", "#22a06b", "#ec4899"]) {
      const ratio = contrastRatio(midTone, readableTextOn(midTone));
      expect(ratio).toBeLessThan(AA);
      expect(ratio).toBeGreaterThan(3); // still legible at large sizes
    }
  });
});
